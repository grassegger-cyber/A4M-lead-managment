// imports.* methods: Excel import of the master list of companies.
// Flow: start → appendRows (batches) → validate (steps) → report / rows → apply (steps, resumable).
// The browser parses the file; the server checks every row again and never trusts the browser.
import type { Ctx, MethodMap } from '../context.ts';
import { inTransaction } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit, recordInitialState } from '../companies-core.ts';
import { clampPageSize, getSetting, getSettings, mergeSettingMap } from '../settings-core.ts';
import {
	DISTRICT_REGION_CODES,
	IMPORT_FIELDS,
	IMPORT_FIELD_LABELS,
	MULTI_COLUMN_FIELDS,
	REQUIRED_FIELDS,
	ROW_ERROR_LABELS,
	ROW_WARNING_LABELS,
	UPDATABLE_FIELDS,
	headerKey,
	isImportField,
	rulesFromSettings,
	sanitizeRawRow,
	validateRow
} from '../../import/rows.ts';
import { HOLDER_LABELS, isCompanyState, stateLabel } from '../../states.ts';
import type { ImportField, ImportRules, RawRow, RowErrorCode, RowWarning } from '../../import/rows.ts';

type ImportStatus = 'uploading' | 'uploaded' | 'validated' | 'applying' | 'applied' | 'cancelled';

interface ImportRow {
	id: number;
	filename: string;
	sheet_name: string | null;
	status: ImportStatus;
	mapping: Record<string, string[]>;
	rules: ImportRules | null;
	declared_rows: number;
	empty_rows: number;
	received_rows: number;
	validated_rows: number;
	rows_new: number | null;
	rows_update: number | null;
	rows_duplicate: number | null;
	rows_invalid_ico: number | null;
	rows_error: number | null;
	rows_warning: number | null;
	applied_through_row: number;
	applied_new: number;
	applied_updated: number;
	applied_unchanged: number;
	applied_phones: number;
	created_at: Date;
	created_by_name: string | null;
	uploaded_at: Date | null;
	validated_at: Date | null;
	confirmed_at: Date | null;
	confirmed_by_name: string | null;
	applied_at: Date | null;
	cancelled_at: Date | null;
	rows_purged_at: Date | null;
}

const IMPORT_COLUMNS = `id, filename, sheet_name, status, mapping, rules, declared_rows, empty_rows, received_rows,
	validated_rows, rows_new, rows_update, rows_duplicate, rows_invalid_ico, rows_error, rows_warning,
	applied_through_row, applied_new, applied_updated, applied_unchanged, applied_phones, created_at, created_by_name,
	uploaded_at, validated_at, confirmed_at, confirmed_by_name, applied_at, cancelled_at, rows_purged_at`;

/** Shape sent to the browser. */
function summary(row: ImportRow) {
	return {
		id: Number(row.id),
		filename: row.filename,
		sheetName: row.sheet_name,
		status: row.status,
		mapping: row.mapping,
		declaredRows: row.declared_rows,
		emptyRows: row.empty_rows,
		receivedRows: row.received_rows,
		validatedRows: row.validated_rows,
		counts:
			row.rows_new === null
				? null
				: {
						new: row.rows_new,
						update: row.rows_update ?? 0,
						duplicate: row.rows_duplicate ?? 0,
						invalidIco: row.rows_invalid_ico ?? 0,
						error: row.rows_error ?? 0,
						warning: row.rows_warning ?? 0
					},
		applied: {
			throughRow: row.applied_through_row,
			new: row.applied_new,
			updated: row.applied_updated,
			unchanged: row.applied_unchanged,
			phones: row.applied_phones
		},
		createdAt: row.created_at,
		createdByName: row.created_by_name,
		uploadedAt: row.uploaded_at,
		validatedAt: row.validated_at,
		confirmedAt: row.confirmed_at,
		confirmedByName: row.confirmed_by_name,
		appliedAt: row.applied_at,
		cancelledAt: row.cancelled_at,
		rowsPurgedAt: row.rows_purged_at
	};
}

function importId(args: any): number {
	const id = Number(args?.id);
	if (!Number.isInteger(id) || id < 1) throw new AppError('import_id_invalid', 'Chybí číslo importu.');
	return id;
}

/** Reads the import and locks its row, so two requests never work on the same import at once. */
async function lockImport(ctx: Ctx, id: number): Promise<ImportRow> {
	const row = await ctx.db.one<ImportRow>(`select ${IMPORT_COLUMNS} from imports where id = $1 for update`, [id]);
	if (!row) throw new AppError('import_not_found', `Import č. ${id} neexistuje.`, 404);
	return row;
}

async function readImport(ctx: Ctx, id: number): Promise<ImportRow> {
	const row = await ctx.db.one<ImportRow>(`select ${IMPORT_COLUMNS} from imports where id = $1`, [id]);
	if (!row) throw new AppError('import_not_found', `Import č. ${id} neexistuje.`, 404);
	return row;
}

async function positiveSetting(ctx: Ctx, key: string): Promise<number> {
	const n = Math.floor(Number(await getSetting(ctx.db, key)));
	if (!Number.isFinite(n) || n < 1) throw new AppError('setting_invalid', `Nastavení „${key}“ musí být kladné číslo.`, 500);
	return n;
}

async function loadRules(ctx: Ctx): Promise<ImportRules> {
	try {
		return rulesFromSettings(await getSettings(ctx.db, 'import.'));
	} catch (e) {
		throw new AppError('setting_invalid', `Nastavení importu není v pořádku: ${(e as Error).message}`, 500);
	}
}

const STATUS_LABELS: Record<ImportStatus, string> = {
	uploading: 'nahrává se',
	uploaded: 'čeká na kontrolu',
	validated: 'zkontrolovaný',
	applying: 'zapisuje se',
	applied: 'zapsaný',
	cancelled: 'zrušený'
};

/** Cleans the mapping sent by the browser: { field: [header, ...] }. */
function cleanMapping(input: unknown): Record<string, string[]> {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new AppError('mapping_invalid', 'Chybí mapování sloupců.');
	}
	const mapping: Record<string, string[]> = {};
	for (const [field, headers] of Object.entries(input as Record<string, unknown>)) {
		if (!isImportField(field)) throw new AppError('mapping_invalid', `Neznámé pole „${field}“ v mapování.`);
		if (!Array.isArray(headers)) throw new AppError('mapping_invalid', 'Mapování má neplatný tvar.');
		const list = headers.map((h) => String(h ?? '').slice(0, 200)).slice(0, 30);
		if (!list.length) continue;
		if (list.length > 1 && !MULTI_COLUMN_FIELDS.includes(field)) {
			throw new AppError('mapping_invalid', `Pole „${IMPORT_FIELD_LABELS[field]}“ smí mít jen jeden sloupec.`);
		}
		mapping[field] = list;
	}
	for (const field of REQUIRED_FIELDS) {
		if (!mapping[field]) throw new AppError('mapping_invalid', `V mapování chybí sloupec pro pole „${IMPORT_FIELD_LABELS[field]}“.`);
	}
	return mapping;
}

/** Cleans the header → field memory sent by the browser ('-' = do not use the column). */
function cleanHeaderMap(input: unknown): Record<string, string> {
	const result: Record<string, string> = {};
	if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
	for (const [header, field] of Object.entries(input as Record<string, unknown>).slice(0, 200)) {
		const key = headerKey(header).slice(0, 100);
		if (!key) continue;
		if (field === '-' || isImportField(field)) result[key] = field as string;
	}
	return result;
}

/** Deletes staged rows of finished imports once the retention period has passed. */
async function purgeOldRows(ctx: Ctx): Promise<void> {
	const days = Number(await getSetting(ctx.db, 'retention.import_error_rows_days'));
	if (!Number.isFinite(days) || days < 0) return;
	const cutoff = new Date(ctx.now().getTime() - days * 86_400_000);
	const due = await ctx.db.query<{ id: number }>(
		`select id from imports
		 where status in ('applied', 'cancelled') and rows_purged_at is null and coalesce(applied_at, cancelled_at) < $1`,
		[cutoff]
	);
	if (!due.length) return;
	await inTransaction(ctx, async (tx) => {
		const ids = due.map((r) => Number(r.id));
		const removed = await tx.db.run('delete from import_rows where import_id = any($1::bigint[])', [ids]);
		await tx.db.run('update imports set rows_purged_at = $2 where id = any($1::bigint[])', [ids, tx.now()]);
		await audit(tx, 'import.rows_purged', {
			entity: 'import',
			description: `Smazány uložené řádky starých importů (${ids.length})`,
			details: { import_ids: ids, rows: removed, retention_days: days }
		});
	});
	await reclaimSpace(ctx);
}

/**
 * PGlite runs a single backend, so nothing vacuums or analyses on its own: the space of staged
 * rows (written about three times, then deleted) would never be reused and the planner would
 * keep its statistics from before the import. Runs outside a transaction; a failure is only
 * logged, the import itself is already written.
 */
async function reclaimSpace(ctx: Ctx): Promise<void> {
	// Called from inside a caller's transaction there is nothing to do: VACUUM cannot run there.
	if (ctx.db.inTransaction) return;
	try {
		await ctx.db.exec('vacuum (analyze) import_rows, companies, company_phones, company_state_history');
	} catch (e) {
		console.error('[imports] vacuum failed:', e instanceof Error ? e.message : e);
	}
}

// ---------- validation ----------
async function finishValidation(ctx: Ctx, imp: ImportRow): Promise<void> {
	const id = imp.id;
	// Duplicates inside the file: the first row with an IČO is used, later ones are marked.
	await ctx.db.run(
		`update import_rows r set status = 'duplicate', duplicate_of = f.first_row
		 from (select row_no, first_row from (
				select row_no, min(row_no) over (partition by ico) as first_row
				from import_rows where import_id = $1 and status = 'parsed') s
		       where row_no <> first_row) f
		 where r.import_id = $1 and r.row_no = f.row_no`,
		[id]
	);
	// The rest: update of a company already in the database, or a new one.
	await ctx.db.run(
		`update import_rows r
		 set status = case when exists (select 1 from companies c where c.ico = r.ico) then 'update' else 'new' end
		 where r.import_id = $1 and r.status = 'parsed'`,
		[id]
	);
	// Stav z robota: a company that already has another state (an owner, a customer…) keeps it.
	const overwrite = await getSetting<unknown>(ctx.db, 'import.robot_overwrite_states');
	await ctx.db.run(
		`update import_rows r
		 set warnings = coalesce(r.warnings, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
			'code', 'robot_status_skipped', 'field', 'robot_status', 'value', coalesce(r.data->>'robot_status', '')))
		 from companies c
		 where r.import_id = $1 and r.status = 'update' and r.parsed ? 'robot_outcome'
			and c.ico = r.ico and not (c.state = any($2::text[]))
			-- The same file loaded again: an IČO that is already ours as the file says needs no warning.
			and not (r.parsed->>'robot_outcome' = 'owned' and c.state = 'superuser' and c.holder_type = 'superuser')`,
		[id, Array.isArray(overwrite) ? overwrite : []]
	);
	const counts = await ctx.db.query<{ status: string; n: number; warned: number }>(
		`select status, count(*)::int as n, (count(*) filter (where warnings is not null))::int as warned
		 from import_rows where import_id = $1 group by status`,
		[id]
	);
	const of = (status: string) => counts.find((c) => c.status === status)?.n ?? 0;
	const warned = counts.reduce((sum, c) => sum + c.warned, 0);
	await ctx.db.run(
		`update imports set status = 'validated', validated_at = $2, rows_new = $3, rows_update = $4,
			rows_duplicate = $5, rows_invalid_ico = $6, rows_error = $7, rows_warning = $8
		 where id = $1`,
		[id, ctx.now(), of('new'), of('update'), of('duplicate'), of('invalid_ico'), of('error'), warned]
	);
	await audit(ctx, 'import.validated', {
		entity: 'import',
		entityId: id,
		description: `Import č. ${id} zkontrolován: ${of('new')} nových, ${of('update')} existujících, ${of('duplicate')} duplicit, ${of('invalid_ico')} neplatných IČO`,
		details: {
			filename: imp.filename,
			rows: imp.received_rows,
			empty_rows: imp.empty_rows,
			new: of('new'),
			update: of('update'),
			duplicate: of('duplicate'),
			invalid_ico: of('invalid_ico'),
			error: of('error'),
			warning: warned
		}
	});
}

// ---------- apply ----------
interface ChunkResult {
	inserted: number;
	updated: number;
	unchanged: number;
	phones: number;
}

/** Writes the staged rows with fromRow < row_no <= toRow. Runs inside the caller's transaction. */
async function applyChunk(ctx: Ctx, imp: ImportRow, fromRow: number, toRow: number): Promise<ChunkResult> {
	const range = [imp.id, fromRow, toRow];
	const usable = (await ctx.db.one<{ n: number }>(
		`select count(*)::int as n from import_rows
		 where import_id = $1 and row_no > $2 and row_no <= $3 and status in ('new', 'update')`,
		range
	))!.n;

	// 1. New companies. They start in the default state v_poolu; a company that appeared in the
	//    database since the check is left to step 2 (on conflict do nothing).
	const inserted = await ctx.db.query<{ ico: string }>(
		`insert into companies (ico, name, subject_type, legal_form_code, region_code, region_name,
			district_code, district_name, nace_codes, founded_on, ca_number)
		 select r.ico, r.parsed->>'name', r.parsed->>'subject_type', r.parsed->>'legal_form_code',
			r.parsed->>'region_code', r.parsed->>'region_name', r.parsed->>'district_code', r.parsed->>'district_name',
			coalesce((select array_agg(v) from jsonb_array_elements_text(r.parsed->'nace_codes') as v), '{}'),
			(r.parsed->>'founded_on')::date, r.parsed->>'ca_number'
		 from import_rows r
		 where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
		 order by r.row_no
		 on conflict (ico) do nothing
		 returning ico`,
		range
	);
	const insertedIcos = inserted.map((r) => r.ico);
	// First history row of every new company, through the core function (source 'import').
	const note = `Import č. ${imp.id}`;
	for (const ico of insertedIcos) {
		await recordInitialState(ctx, ico, 'import', 'import_new', note);
	}

	// 2. Companies already in the database: only the non-ownership fields allowed by the setting,
	//    and only where the row gives a value. State, holder, dates of ownership are never touched.
	//    A value the company does not have yet is always filled in; a value that differs from the
	//    stored one is overwritten only for the fields chosen for this import (or, without a choice,
	//    by the setting).
	const chosen = (imp.rules as { overwriteFields?: unknown } | null)?.overwriteFields;
	const allowed = Array.isArray(chosen) ? chosen : ((await getSetting<unknown>(ctx.db, 'import.update_existing_fields')) as unknown);
	const may = (field: (typeof UPDATABLE_FIELDS)[number]) => Array.isArray(allowed) && allowed.includes(field);
	const flags = [
		may('name'),
		may('subject_type'),
		may('legal_form_code'),
		may('region'),
		may('district'),
		may('nace'),
		may('founded_on'),
		may('ca_number')
	];
	// Region and district are written as a pair that belongs together (district code → region code
	// in $13): a district from the row is not taken when it contradicts a region that may not be
	// overwritten; a region without a district clears a stored district that lies elsewhere, or,
	// when the district may not be overwritten, the region is not taken.
	const updated = await ctx.db.run(
		`with p as (
			select r.ico,
				($8 or c0.region_code is null) as may_region,
				($9 or c0.district_code is null) as may_district,
				case when $5 or coalesce(c0.name, '') = '' then r.parsed->>'name' end as name,
				case when $6 or c0.subject_type is null then r.parsed->>'subject_type' end as subject_type,
				case when $7 or c0.legal_form_code is null then r.parsed->>'legal_form_code' end as legal_form_code,
				case when $8 or c0.region_code is null then r.parsed->>'region_code' end as region_code,
				case when $8 or c0.region_code is null then r.parsed->>'region_name' end as region_name,
				case when $9 or c0.district_code is null then r.parsed->>'district_code' end as district_code,
				case when $9 or c0.district_code is null then r.parsed->>'district_name' end as district_name,
				case when ($10 or coalesce(cardinality(c0.nace_codes), 0) = 0) and r.parsed ? 'nace_codes'
					then (select array_agg(v) from jsonb_array_elements_text(r.parsed->'nace_codes') as v) end as nace_codes,
				case when $11 or c0.founded_on is null then (r.parsed->>'founded_on')::date end as founded_on,
				case when $12 or coalesce(c0.ca_number, '') = '' then r.parsed->>'ca_number' end as ca_number
			from import_rows r
			join companies c0 on c0.ico = r.ico
			where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
				and not (r.ico = any($4::char(8)[]))
		 ), f as (
			select p.ico,
				coalesce(p.name, c.name) as name,
				coalesce(p.subject_type, c.subject_type) as subject_type,
				coalesce(p.legal_form_code, c.legal_form_code) as legal_form_code,
				case when k.region_conflict and not p.may_district then c.region_code else coalesce(p.region_code, c.region_code) end as region_code,
				case when k.region_conflict and not p.may_district then c.region_name else coalesce(p.region_name, c.region_name) end as region_name,
				case when k.skip_district then c.district_code when k.region_conflict and p.may_district then null
					else coalesce(p.district_code, c.district_code) end as district_code,
				case when k.skip_district then c.district_name when k.region_conflict and p.may_district then null
					else coalesce(p.district_name, c.district_name) end as district_name,
				coalesce(p.nace_codes, c.nace_codes) as nace_codes,
				coalesce(p.founded_on, c.founded_on) as founded_on,
				coalesce(p.ca_number, c.ca_number) as ca_number
			from p
			join companies c on c.ico = p.ico
			cross join lateral (
				select
					(p.district_code is not null and p.region_code is null and c.region_code is not null
						and ($13::jsonb ->> p.district_code) is distinct from c.region_code) as skip_district,
					(p.region_code is not null and p.district_code is null and c.district_code is not null
						and ($13::jsonb ->> c.district_code) <> p.region_code) as region_conflict
			) k
		 )
		 update companies c set
			name = f.name,
			subject_type = f.subject_type,
			legal_form_code = f.legal_form_code,
			region_code = f.region_code,
			region_name = f.region_name,
			district_code = f.district_code,
			district_name = f.district_name,
			nace_codes = f.nace_codes,
			founded_on = f.founded_on,
			ca_number = f.ca_number
		 from f
		 where c.ico = f.ico and (
			f.name is distinct from c.name
			or f.subject_type is distinct from c.subject_type
			or f.legal_form_code is distinct from c.legal_form_code
			or f.region_code is distinct from c.region_code
			or f.region_name is distinct from c.region_name
			or f.district_code is distinct from c.district_code
			or f.district_name is distinct from c.district_name
			or f.nace_codes is distinct from c.nace_codes
			or f.founded_on is distinct from c.founded_on
			or f.ca_number is distinct from c.ca_number)`,
		[...range, insertedIcos, ...flags, JSON.stringify(DISTRICT_REGION_CODES)]
	);

	// 3. Phones: added to what the company already has, the same number is never stored twice.
	const mergeDuplicates = (await getSetting(ctx.db, 'import.merge_duplicate_phones')) === true;
	const phoneStatuses = mergeDuplicates ? ['new', 'update', 'duplicate'] : ['new', 'update'];
	const phones = await ctx.db.run(
		`insert into company_phones (ico, phone, source)
		 select r.ico, ph.phone, 'import'
		 from import_rows r
		 cross join lateral jsonb_array_elements_text(r.parsed->'phones') with ordinality as ph(phone, ord)
		 where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status = any($4::text[])
		 order by r.row_no, ph.ord
		 on conflict (ico, phone) do nothing`,
		[...range, phoneStatuses]
	);
	// A company without a primary number gets its first one marked.
	if (phones > 0) {
		await ctx.db.run(
			`update company_phones set is_primary = true
			 where id in (
				select min(p.id) from company_phones p
				where p.ico in (select r.ico from import_rows r
					where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status = any($4::text[]))
				group by p.ico having not bool_or(p.is_primary))`,
			[...range, phoneStatuses]
		);
	}

	// 4. Operator from the file: belongs to the first phone number of the row; the day of the
	//    import is the day the operator was verified.
	await ctx.db.run(
		`update company_phones p set operator = r.parsed->>'operator', operator_verified_at = $4
		 from import_rows r
		 where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
			and r.parsed ? 'operator' and p.ico = r.ico and p.phone = r.parsed->'phones'->>0
			-- The same operator is confirmed (new date), a missing one is filled in; a different
			-- one is overwritten only when chosen for this import.
			and (p.operator is null or p.operator = r.parsed->>'operator' or $5)`,
		[...range, ctx.now(), Array.isArray(chosen) ? chosen.includes('operator') : true]
	);

	// 5. The main phone number: a number from the file that the company did not have as its main one
	//    becomes the main one only when chosen (numbers are never deleted).
	if (Array.isArray(chosen) && chosen.includes('phone')) {
		await ctx.db.run(
			`with want as (
				select r.ico, r.parsed->'phones'->>0 as phone from import_rows r
				where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
					and r.parsed->'phones'->>0 is not null
			 )
			 update company_phones p set is_primary = (p.phone = want.phone)
			 from want where p.ico = want.ico and p.is_primary is distinct from (p.phone = want.phone)`,
			range
		);
	}

	await applyRobotStatus(ctx, imp, range, !Array.isArray(chosen) || chosen.includes('robot_status'), Array.isArray(chosen) && chosen.includes('owned_from'));

	return { inserted: insertedIcos.length, updated, unchanged: usable - insertedIcos.length - updated, phones };
}

/** Calendar day in Czech time, wherever the server runs. */
export function czechToday(d: Date): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Column "Stav z robota": what the robot found in Siebel. Set-based twin of transition() for
 * whole chunks (thousands of rows): the same checks against state_transitions and one history
 * row per changed company, in the caller's transaction. Only companies whose state is in
 * import.robot_overwrite_states are touched; the others got a warning during the check.
 *  - owned: state superuser on the protective login, ownership from the row's date (or today)
 *  - missing_in_siebel: state neni_v_siebelu
 *  - other_owner: the state stays, the holder becomes jiny_partner
 */
async function applyRobotStatus(
	ctx: Ctx,
	imp: ImportRow,
	range: (number | string)[],
	/** A state that was confirmed before and differs from the file may be overwritten. */
	overwriteState: boolean,
	/** A stored start of ownership that differs from the file may be overwritten. */
	overwriteOwnedFrom: boolean
): Promise<void> {
	const states = await getSetting<unknown>(ctx.db, 'import.robot_overwrite_states');
	const login = await getSetting<unknown>(ctx.db, 'import.robot_owner_login');
	const days = await positiveSetting(ctx, 'ownership.superuser_hold_days');
	if (!Array.isArray(states) || !states.length) return;
	if (typeof login !== 'string' || !login.trim()) {
		throw new AppError('setting_invalid', 'Nastavení „import.robot_owner_login“ musí být vyplněné.', 500);
	}
	await ctx.db.run(
		`with t as (
			select r.ico, r.parsed->>'robot_outcome' as outcome, (r.parsed->>'owned_from')::date as owned_from
			from import_rows r
			where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
				and r.parsed ? 'robot_outcome'
		), l as (
			select c.ico, c.state as from_state, c.cohort_id, t.outcome, coalesce(t.owned_from, $4::date) as owned_from,
				case when c.holder_login is null then c.holder_type else c.holder_type || ':' || c.holder_login end as from_holder,
				case t.outcome when 'owned' then 'superuser' when 'missing_in_siebel' then 'neni_v_siebelu' else c.state end as to_state
			from companies c join t on t.ico = c.ico
			where c.state = any($5::text[])
				-- A company still in the default state that nobody confirmed takes the state always;
				-- a state confirmed before is overwritten only when chosen for this import.
				and ($12 or (c.state = 'v_poolu' and c.state_verified_at is null))
			for update of c
		), ok as (
			select l.* from l
			where l.outcome = 'other_owner'
				or exists (select 1 from state_transitions st
					where st.from_state = l.from_state and st.to_state = l.to_state and st.enabled)
		), u as (
			update companies c set
				state = ok.to_state,
				holder_type = case ok.outcome when 'owned' then 'superuser' when 'other_owner' then 'jiny_partner' else c.holder_type end,
				holder_login = case ok.outcome when 'owned' then $6 when 'other_owner' then null else c.holder_login end,
				owned_from = case when ok.outcome = 'owned' then ok.owned_from else c.owned_from end,
				ownership_ends_on = case when ok.outcome = 'owned'
					then ok.owned_from + $7::int else c.ownership_ends_on end
			from ok
			where c.ico = ok.ico and (
				c.state is distinct from ok.to_state
				or (ok.outcome = 'other_owner' and c.holder_type is distinct from 'jiny_partner')
				or (ok.outcome = 'owned' and (c.holder_type is distinct from 'superuser' or c.holder_login is distinct from $6)))
			returning c.ico, c.state, c.holder_type, c.holder_login
		)
		insert into company_state_history
			(ico, at, from_state, to_state, from_holder, to_holder, reason_code, note, cohort_id, source, actor_id, actor_name)
		select ok.ico, $8, ok.from_state, u.state, ok.from_holder,
			case when u.holder_login is null then u.holder_type else u.holder_type || ':' || u.holder_login end,
			case ok.outcome when 'owned' then 'import_robot_owned' when 'missing_in_siebel' then 'import_robot_missing'
				else 'import_robot_other_owner' end,
			$9, ok.cohort_id, 'import', $10, $11
		from ok join u on u.ico = ok.ico`,
		[...range, czechToday(ctx.now()), states, login.trim(), days, ctx.now(), `Import č. ${imp.id}`, ctx.actor.id, ctx.actor.name, overwriteState]
	);
	// Start of ownership given in the file for an IČO that is already ours: filled in when missing,
	// replaced only when chosen. The end of ownership moves with it (plus the extension, if used).
	const extension = await positiveSetting(ctx, 'ownership.superuser_extension_days');
	await ctx.db.run(
		`update companies c set owned_from = (r.parsed->>'owned_from')::date,
			ownership_ends_on = (r.parsed->>'owned_from')::date + $4::int
				+ case when c.ownership_extended_on is not null then $5::int else 0 end
		 from import_rows r
		 where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
			and r.parsed->>'robot_outcome' = 'owned' and r.parsed->>'owned_from' is not null and c.ico = r.ico
			and c.state = 'superuser' and c.holder_type = 'superuser'
			and c.owned_from is distinct from (r.parsed->>'owned_from')::date
			and (c.owned_from is null or $6)`,
		[...range, days, extension, overwriteOwnedFrom]
	);
	// The state is confirmed as of now wherever the company is (now) in the state the robot reported,
	// also when nothing had to change.
	await ctx.db.run(
		`update companies c set state_verified_at = $4
		 from import_rows r
		 where r.import_id = $1 and r.row_no > $2 and r.row_no <= $3 and r.status in ('new', 'update')
			and r.parsed ? 'robot_outcome' and c.ico = r.ico and (
				(r.parsed->>'robot_outcome' = 'owned' and c.state = 'superuser' and c.holder_type = 'superuser')
				or (r.parsed->>'robot_outcome' = 'missing_in_siebel' and c.state = 'neni_v_siebelu')
				or (r.parsed->>'robot_outcome' = 'other_owner' and c.holder_type = 'jiny_partner'))`,
		[...range, ctx.now()]
	);
}

// ---------- error report ----------
interface ProblemRow {
	row_no: number;
	status: string;
	data: RawRow;
	ico: string | null;
	error_code: RowErrorCode | null;
	duplicate_of: number | null;
	warnings: RowWarning[] | null;
}

const PROBLEM_KINDS = ['invalid_ico', 'duplicate', 'error', 'warning'] as const;
type ProblemKind = (typeof PROBLEM_KINDS)[number];

function problemWhere(kind: ProblemKind): string {
	return kind === 'warning' ? 'warnings is not null' : `status = '${kind}'`;
}

function problemText(row: ProblemRow): string {
	if (row.status === 'duplicate') return `Duplicitní IČO, použije se řádek ${row.duplicate_of}`;
	if (row.error_code) return ROW_ERROR_LABELS[row.error_code] ?? row.error_code;
	return '';
}

function warningText(w: RowWarning): string {
	return ROW_WARNING_LABELS[w.code] ?? w.code;
}

const REPORT_SHEETS: { name: string; kind: ProblemKind }[] = [
	{ name: 'Neplatná IČO', kind: 'invalid_ico' },
	{ name: 'Duplicity', kind: 'duplicate' },
	{ name: 'Ostatní chyby', kind: 'error' },
	{ name: 'Upozornění', kind: 'warning' }
];
const REPORT_PAGE = 5000;

function reportColumns(kind: ProblemKind): { header: string; width: number }[] {
	return kind === 'warning'
		? [
				{ header: 'Řádek v Excelu', width: 16 },
				{ header: 'IČO', width: 12 },
				{ header: 'Název', width: 40 },
				{ header: 'Pole', width: 22 },
				{ header: 'Hodnota v souboru', width: 28 },
				{ header: 'Upozornění', width: 48 }
			]
		: [
				{ header: 'Řádek v Excelu', width: 16 },
				{ header: 'IČO v souboru', width: 16 },
				{ header: 'Název', width: 40 },
				{ header: 'Problém', width: 52 }
			];
}

/** Date and time in Czech time, wherever the server runs. */
function czDateTime(d: Date | null): string {
	if (!d) return '';
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: 'Europe/Prague',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(new Date(d))
			.map((part) => [part.type, part.value])
	);
	return `${parts.day}. ${parts.month}. ${parts.year} ${parts.hour}:${parts.minute}`;
}

function reportSummary(imp: ImportRow): [string, string | number][] {
	return [
		['Import č.', imp.id],
		['Soubor', imp.filename],
		['List', imp.sheet_name ?? ''],
		['Nahráno', czDateTime(imp.created_at)],
		['Nahrál', imp.created_by_name ?? ''],
		['Stav importu', STATUS_LABELS[imp.status]],
		['Řádků s daty', imp.received_rows],
		['Prázdných řádků (přeskočeno)', imp.empty_rows],
		['Nová IČO', imp.rows_new ?? 0],
		['IČO, která už v databázi jsou', imp.rows_update ?? 0],
		['Duplicity v souboru', imp.rows_duplicate ?? 0],
		['Neplatná IČO', imp.rows_invalid_ico ?? 0],
		['Ostatní chyby', imp.rows_error ?? 0],
		['Řádky s upozorněním (zapíšou se bez vadné hodnoty)', imp.rows_warning ?? 0]
	];
}

async function reportableImport(ctx: Ctx, id: number): Promise<ImportRow> {
	const imp = await readImport(ctx, id);
	if (imp.rows_new === null) throw new AppError('import_not_validated', `Import č. ${id} ještě není zkontrolovaný.`, 409);
	if (imp.rows_purged_at) {
		throw new AppError('rows_purged', `Řádky importu č. ${id} už byly smazány, report nejde sestavit.`, 409);
	}
	return imp;
}

/**
 * What the column "Stav z robota" will do (or did): number of IČO per outcome among the usable
 * rows, and how many are skipped because the company already has another state. Null when the
 * file has no such column or its rows are gone.
 */
async function robotCounts(ctx: Ctx, imp: ImportRow) {
	if (imp.rows_new === null || imp.rows_purged_at || !imp.mapping?.robot_status?.length) return null;
	const row = await ctx.db.one<{ owned: number; other_owner: number; missing: number; skipped: number }>(
		`select
			(count(*) filter (where not skipped and outcome = 'owned'))::int as owned,
			(count(*) filter (where not skipped and outcome = 'other_owner'))::int as other_owner,
			(count(*) filter (where not skipped and outcome = 'missing_in_siebel'))::int as missing,
			(count(*) filter (where skipped))::int as skipped
		 from (
			select parsed->>'robot_outcome' as outcome,
				coalesce(warnings @> '[{"code": "robot_status_skipped"}]'::jsonb, false) as skipped
			from import_rows
			where import_id = $1 and status in ('new', 'update') and parsed ? 'robot_outcome') s`,
		[imp.id]
	);
	return { owned: row?.owned ?? 0, otherOwner: row?.other_owner ?? 0, missing: row?.missing ?? 0, skipped: row?.skipped ?? 0 };
}

// ---------- differences against the database ----------
/** For every field the import may overwrite: stored value and value in the file, as SQL over c and r. */
const DIFF_FIELDS = [...UPDATABLE_FIELDS, 'phone', 'operator', 'robot_status', 'owned_from'] as const;
type DiffField = (typeof DIFF_FIELDS)[number];
const DIFF_LABELS: Record<DiffField, string> = {
	...IMPORT_FIELD_LABELS,
	phone: 'Hlavní telefon',
	operator: 'Operátor telefonu',
	robot_status: 'Stav a vlastnictví (z robota)',
	owned_from: 'Vlastnictví od'
};
/** What "overwrite" and "keep" mean where it is not obvious. */
const DIFF_NOTES: Partial<Record<DiffField, string>> = {
	phone: 'Přepsat: číslo ze souboru bude hlavní. Nechat: jen se přidá k ostatním. Čísla se nikdy nemažou.',
	robot_status:
		'Týká se IČO, jejichž stav už byl dříve potvrzen. IČO, které má obchodníka, je zákazník apod., import nezmění nikdy (řádek „Robot: nepoužito“).',
	owned_from: 'S datem vlastnictví se posune i konec vlastnictví a lhůta pro vrácení statusů.'
};
/** Without a choice (and as the pre-set choice on the screen): overwrite or keep. */
const DIFF_DEFAULTS: Partial<Record<DiffField, boolean>> = { phone: false, operator: true, robot_status: true, owned_from: false };
const OPERATOR_NAMES: Record<string, string> = { VF: 'Vodafone', TM: 'T-Mobile', O2: 'O2', jiny: 'Jiný' };

interface DiffSpec {
	/** Stored value and value in the file, as SQL (aliases: c company, r import row, fp / pp phones). */
	cur: string;
	inc: string;
	curText?: string;
	incText?: string;
	/** Extra condition for the field to apply at all. */
	where?: string;
	/** A differing value that is nevertheless only "filled in" (written always, without a choice). */
	fillsWhen?: string;
	/** Extra condition for counting a missing stored value as "filled in". */
	fillsWhere?: string;
}

/** Target of the robot result as 'state/holder type', comparable with the stored pair. */
const ROBOT_TARGET = `case r.parsed->>'robot_outcome'
	when 'owned' then 'superuser/superuser'
	when 'missing_in_siebel' then 'neni_v_siebelu/' || c.holder_type
	when 'other_owner' then c.state || '/jiny_partner' end`;

function diffSpecs(robotStates: string[]): Record<DiffField, DiffSpec> {
	// Only known state names reach the SQL text.
	const states = robotStates.filter((state) => isCompanyState(state)).map((state) => `'${state}'`);
	return {
		name: { cur: `nullif(c.name, '')`, inc: `r.parsed->>'name'` },
		subject_type: { cur: 'c.subject_type', inc: `r.parsed->>'subject_type'` },
		legal_form_code: { cur: 'c.legal_form_code', inc: `r.parsed->>'legal_form_code'` },
		region: { cur: 'c.region_code', inc: `r.parsed->>'region_code'`, curText: 'c.region_name', incText: `r.parsed->>'region_name'` },
		district: { cur: 'c.district_code', inc: `r.parsed->>'district_code'`, curText: 'c.district_name', incText: `r.parsed->>'district_name'` },
		nace: {
			cur: `nullif(array_to_string(c.nace_codes, ', '), '')`,
			inc: `(select string_agg(v, ', ') from jsonb_array_elements_text(r.parsed->'nace_codes') as v)`
		},
		founded_on: { cur: 'c.founded_on::text', inc: `r.parsed->>'founded_on'` },
		ca_number: { cur: `nullif(c.ca_number, '')`, inc: `r.parsed->>'ca_number'` },
		// pp = the main number of the company, fp = the stored row of the first number of the import row.
		phone: { cur: 'pp.phone', inc: `r.parsed->'phones'->>0` },
		operator: { cur: 'fp.operator', inc: `r.parsed->>'operator'`, fillsWhere: 'fp.id is not null' },
		robot_status: {
			cur: `c.state || '/' || c.holder_type`,
			inc: ROBOT_TARGET,
			where: states.length ? `c.state in (${states.join(', ')})` : 'false',
			fillsWhen: `c.state = 'v_poolu' and c.state_verified_at is null`
		},
		owned_from: {
			cur: 'c.owned_from::text',
			inc: `case when r.parsed->>'robot_outcome' = 'owned' then r.parsed->>'owned_from' end`,
			where: `c.state = 'superuser' and c.holder_type = 'superuser'`
		}
	};
}

const differsSql = (d: DiffSpec) =>
	`(${d.inc} is not null and ${d.where ?? 'true'} and ${d.cur} is not null and ${d.inc} <> ${d.cur}${d.fillsWhen ? ` and not (${d.fillsWhen})` : ''})`;
const fillsSql = (d: DiffSpec) =>
	`(${d.inc} is not null and ${d.where ?? 'true'} and ((${d.cur} is null and ${d.fillsWhere ?? 'true'})${
		d.fillsWhen ? ` or (${d.cur} is not null and ${d.inc} <> ${d.cur} and ${d.fillsWhen})` : ''
	}))`;

const DIFF_FROM = `from import_rows r join companies c on c.ico = r.ico
	left join company_phones fp on fp.ico = r.ico and fp.phone = r.parsed->'phones'->>0
	left join lateral (select p.phone from company_phones p where p.ico = r.ico order by p.is_primary desc, p.id limit 1) pp on true
	where r.import_id = $1 and r.status = 'update'`;

async function loadDiffSpecs(ctx: Ctx): Promise<Record<DiffField, DiffSpec>> {
	const states = await getSetting<unknown>(ctx.db, 'import.robot_overwrite_states');
	return diffSpecs(Array.isArray(states) ? states.map(String) : []);
}

/** 'state/holder type' → readable text. */
function stateHolderText(value: string): string {
	const [state, holder] = value.split('/');
	return `${stateLabel(state)} · ${HOLDER_LABELS[holder as keyof typeof HOLDER_LABELS] ?? holder}`;
}

async function diffableImport(ctx: Ctx, id: number): Promise<ImportRow> {
	const imp = await readImport(ctx, id);
	if (imp.status !== 'validated') {
		throw new AppError('import_wrong_status', `Rozdíly jdou zobrazit jen u zkontrolovaného importu před zápisem (import č. ${id} je ${STATUS_LABELS[imp.status]}).`, 409);
	}
	return imp;
}

// ---------- methods ----------
export const methods: MethodMap = {
	/** What the import screen needs before a file is chosen. */
	'imports.config': async (ctx) => {
		const s = await getSettings(ctx.db, 'import.');
		return {
			fields: IMPORT_FIELDS.map((key) => ({
				key,
				label: IMPORT_FIELD_LABELS[key],
				required: REQUIRED_FIELDS.includes(key),
				multiple: MULTI_COLUMN_FIELDS.includes(key)
			})),
			aliases: s['import.header_aliases'] ?? {},
			remembered: s['import.column_mapping'] ?? {},
			uploadBatchRows: await positiveSetting(ctx, 'import.upload_batch_rows'),
			previewRows: await positiveSetting(ctx, 'import.preview_rows'),
			maxRows: await positiveSetting(ctx, 'import.max_rows')
		};
	},

	/**
	 * Opens an import. args: { filename, sheetName?, declaredRows, emptyRows?, mapping: { field: [header] },
	 * headerMap?: { header: field | '-' } }. Remembers the mapping in settings. Returns the import.
	 */
	'imports.start': async (ctx, args) => {
		const filename = String(args?.filename ?? '').trim().slice(0, 255);
		if (!filename) throw new AppError('filename_missing', 'Chybí název souboru.');
		const declared = Number(args?.declaredRows);
		const empty = Number(args?.emptyRows ?? 0);
		if (!Number.isInteger(declared) || declared < 1) throw new AppError('rows_missing', 'Soubor neobsahuje žádný řádek s daty.');
		if (!Number.isInteger(empty) || empty < 0) throw new AppError('rows_invalid', 'Neplatný počet prázdných řádků.');
		const maxRows = await positiveSetting(ctx, 'import.max_rows');
		if (declared > maxRows) {
			throw new AppError('too_many_rows', `Soubor má ${declared} řádků, nejvýše lze nahrát ${maxRows} (nastavení importu).`);
		}
		const mapping = cleanMapping(args?.mapping);
		const headerMap = cleanHeaderMap(args?.headerMap);
		const sheetName = args?.sheetName ? String(args.sheetName).slice(0, 100) : null;

		return inTransaction(ctx, async (tx) => {
			const row = await tx.db.one<ImportRow>(
				`insert into imports (filename, sheet_name, status, mapping, declared_rows, empty_rows, created_at, created_by, created_by_name)
				 values ($1, $2, 'uploading', $3::jsonb, $4, $5, $6, $7, $8) returning ${IMPORT_COLUMNS}`,
				[filename, sheetName, JSON.stringify(mapping), declared, empty, tx.now(), tx.actor.id, tx.actor.name]
			);
			// Remembered through the settings helper: size cap and a settings.update audit row with old and new value.
			const remembered = Object.keys(headerMap).length
				? await mergeSettingMap(tx, 'import.column_mapping', headerMap, `zapamatováno při importu č. ${row!.id}`)
				: 'unchanged';
			await audit(tx, 'import.started', {
				entity: 'import',
				entityId: row!.id,
				description: `Import č. ${row!.id} založen: ${filename} (${declared} řádků)`,
				details: {
					filename,
					sheet: sheetName,
					declared_rows: declared,
					empty_rows: empty,
					mapping,
					remembered_mapping: headerMap,
					mapping_remembered: remembered !== 'too_large'
				}
			});
			return summary(row!);
		});
	},

	/**
	 * Stores one batch of rows. args: { id, rows: [{ rowNo, data }] }. Sending the same row number
	 * again replaces it, so a failed batch can simply be sent once more.
	 */
	'imports.appendRows': async (ctx, args) => {
		const id = importId(args);
		if (!Array.isArray(args?.rows) || !args.rows.length) throw new AppError('rows_missing', 'Dávka neobsahuje žádné řádky.');
		const limit = (await positiveSetting(ctx, 'import.upload_batch_rows')) * 2;
		if (args.rows.length > limit) throw new AppError('batch_too_large', `Dávka smí mít nejvýše ${limit} řádků.`);
		const seen = new Set<number>();
		const rows: { row_no: number; data: RawRow }[] = [];
		for (const item of args.rows) {
			const rowNo = Number(item?.rowNo);
			if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > 10_000_000) throw new AppError('row_no_invalid', 'Dávka obsahuje neplatné číslo řádku.');
			if (seen.has(rowNo)) throw new AppError('row_no_invalid', `Řádek ${rowNo} je v dávce dvakrát.`);
			seen.add(rowNo);
			// A row that cannot be read is kept (as an empty object marker) and reported by the check.
			const data = sanitizeRawRow(item?.data);
			rows.push({ row_no: rowNo, data: data ?? ({ _malformed: true } as unknown as RawRow) });
		}
		return inTransaction(ctx, async (tx) => {
			const imp = await lockImport(tx, id);
			if (imp.status !== 'uploading') {
				throw new AppError('import_wrong_status', `Do importu č. ${id} už nejde přidávat řádky (je ${STATUS_LABELS[imp.status]}).`, 409);
			}
			await tx.db.run(
				`insert into import_rows (import_id, row_no, data)
				 select $1, x.row_no, x.data from jsonb_to_recordset($2::jsonb) as x(row_no integer, data jsonb)
				 on conflict (import_id, row_no) do update set data = excluded.data, status = 'pending'`,
				[id, JSON.stringify(rows)]
			);
			const received = (await tx.db.one<{ n: number }>('select count(*)::int as n from import_rows where import_id = $1', [id]))!.n;
			if (received > imp.declared_rows) {
				throw new AppError('too_many_rows', `Přišlo víc řádků (${received}), než bylo ohlášeno (${imp.declared_rows}).`);
			}
			await tx.db.run('update imports set received_rows = $2 where id = $1', [id, received]);
			return { id, receivedRows: received, declaredRows: imp.declared_rows };
		});
	},

	/**
	 * Checks the next part of the rows; call it again until done is true. The last call marks
	 * duplicates, splits rows into new / existing and stores the counts.
	 * args: { id, restart? } (restart checks a validated import again). Returns { done, import }.
	 */
	'imports.validate': async (ctx, args) => {
		const id = importId(args);
		const chunk = await positiveSetting(ctx, 'import.validate_chunk_rows');
		return inTransaction(ctx, async (tx) => {
			let imp = await lockImport(tx, id);
			if (imp.status === 'uploading') {
				if (imp.received_rows !== imp.declared_rows) {
					throw new AppError(
						'upload_incomplete',
						`Nahrávání není dokončené: přišlo ${imp.received_rows} z ${imp.declared_rows} řádků. Import zrušte a nahrajte soubor znovu.`,
						409
					);
				}
				const rules = await loadRules(tx);
				await tx.db.run(
					`update imports set status = 'uploaded', uploaded_at = $2, rules = $3::jsonb, validated_rows = 0 where id = $1`,
					[id, tx.now(), JSON.stringify(rules)]
				);
				imp = await lockImport(tx, id);
			} else if (imp.status === 'validated' && args?.restart === true) {
				const rules = await loadRules(tx);
				await tx.db.run(
					`update import_rows set status = 'pending', ico = null, parsed = null, error_code = null, duplicate_of = null, warnings = null
					 where import_id = $1`,
					[id]
				);
				await tx.db.run(
					`update imports set status = 'uploaded', rules = $2::jsonb, validated_rows = 0, validated_at = null,
						rows_new = null, rows_update = null, rows_duplicate = null, rows_invalid_ico = null, rows_error = null, rows_warning = null
					 where id = $1`,
					[id, JSON.stringify(rules)]
				);
				imp = await lockImport(tx, id);
			}
			if (imp.status === 'validated') return { done: true, import: summary(imp) };
			if (imp.status !== 'uploaded') {
				throw new AppError('import_wrong_status', `Import č. ${id} nejde kontrolovat (je ${STATUS_LABELS[imp.status]}).`, 409);
			}
			const rules = imp.rules ?? (await loadRules(tx));

			const pending = await tx.db.query<{ row_no: number; data: unknown }>(
				`select row_no, data from import_rows where import_id = $1 and status = 'pending' order by row_no limit $2`,
				[id, chunk]
			);
			if (pending.length) {
				const results = pending.map((r) => {
					const malformed = !!(r.data as { _malformed?: boolean })?._malformed;
					const res = validateRow(malformed ? null : r.data, rules);
					return {
						row_no: r.row_no,
						status: res.status,
						ico: res.ico,
						parsed: res.parsed,
						error_code: res.errorCode,
						warnings: res.warnings.length ? res.warnings : null
					};
				});
				await tx.db.run(
					`update import_rows r set status = x.status, ico = x.ico, parsed = x.parsed, error_code = x.error_code,
						warnings = x.warnings, duplicate_of = null
					 from jsonb_to_recordset($2::jsonb) as x(row_no integer, status text, ico char(8), parsed jsonb, error_code text, warnings jsonb)
					 where r.import_id = $1 and r.row_no = x.row_no`,
					[id, JSON.stringify(results)]
				);
				await tx.db.run('update imports set validated_rows = validated_rows + $2 where id = $1', [id, pending.length]);
			}
			const left = (await tx.db.one<{ n: number }>(
				`select count(*)::int as n from import_rows where import_id = $1 and status = 'pending'`,
				[id]
			))!.n;
			if (left === 0) await finishValidation(tx, await lockImport(tx, id));
			return { done: left === 0, import: summary(await readImport(tx, id)) };
		});
	},

	/**
	 * Writes the next part of a checked import; call it again until done is true. The first call
	 * needs confirm: true (the explicit confirmation). Each call is one transaction that also moves
	 * applied_through_row, so an interrupted write continues where it stopped.
	 * args: { id, confirm? }. Returns { done, import }.
	 */
	'imports.apply': async (ctx, args) => {
		const id = importId(args);
		const chunk = await positiveSetting(ctx, 'import.apply_chunk_rows');
		const result = await inTransaction(ctx, async (tx) => {
			let imp = await lockImport(tx, id);
			if (imp.status === 'applied') return { done: true, finishedNow: false, import: summary(imp) };
			if (imp.status === 'validated') {
				if (args?.confirm !== true) {
					throw new AppError('confirm_required', 'Zápis importu je potřeba výslovně potvrdit.', 409);
				}
				// Fields whose differing values this import may overwrite (absent = by the setting).
				let overwrite: string[] | null = null;
				if (args?.overwrite !== undefined && args?.overwrite !== null) {
					if (!Array.isArray(args.overwrite) || args.overwrite.some((f: unknown) => !(DIFF_FIELDS as readonly unknown[]).includes(f))) {
						throw new AppError('overwrite_invalid', 'Neplatný výběr polí k přepsání.');
					}
					overwrite = [...new Set(args.overwrite as string[])];
				}
				await tx.db.run(
					`update imports set status = 'applying', confirmed_at = $2, confirmed_by_name = $3,
						rules = case when $4::jsonb is null then rules else coalesce(rules, '{}'::jsonb) || jsonb_build_object('overwriteFields', $4::jsonb) end
					 where id = $1`,
					[id, tx.now(), tx.actor.name, overwrite ? JSON.stringify(overwrite) : null]
				);
				await audit(tx, 'import.confirmed', {
					entity: 'import',
					entityId: id,
					description: `Import č. ${id} potvrzen k zápisu (${imp.rows_new ?? 0} nových, ${imp.rows_update ?? 0} existujících IČO)`,
					details: {
						filename: imp.filename,
						new: imp.rows_new,
						update: imp.rows_update,
						duplicate: imp.rows_duplicate,
						...(overwrite ? { overwrite_fields: overwrite } : {})
					}
				});
				imp = await lockImport(tx, id);
			}
			if (imp.status !== 'applying') {
				throw new AppError('import_wrong_status', `Import č. ${id} nejde zapsat (je ${STATUS_LABELS[imp.status]}).`, 409);
			}

			const next = await tx.db.one<{ to_row: number | null }>(
				`select max(row_no) as to_row from (
					select row_no from import_rows where import_id = $1 and row_no > $2 order by row_no limit $3) s`,
				[id, imp.applied_through_row, chunk]
			);
			if (next?.to_row) {
				const result = await applyChunk(tx, imp, imp.applied_through_row, next.to_row);
				await tx.db.run(
					`update imports set applied_through_row = $2, applied_new = applied_new + $3, applied_updated = applied_updated + $4,
						applied_unchanged = applied_unchanged + $5, applied_phones = applied_phones + $6 where id = $1`,
					[id, next.to_row, result.inserted, result.updated, result.unchanged, result.phones]
				);
				imp = await lockImport(tx, id);
			}
			const left = (await tx.db.one<{ n: number }>(
				'select count(*)::int as n from import_rows where import_id = $1 and row_no > $2',
				[id, imp.applied_through_row]
			))!.n;
			if (left > 0) return { done: false, finishedNow: false, import: summary(imp) };

			// Finished: clean rows are no longer needed, problem rows stay for the report.
			await tx.db.run(`delete from import_rows where import_id = $1 and status in ('new', 'update') and warnings is null`, [id]);
			await tx.db.run(`update imports set status = 'applied', applied_at = $2 where id = $1`, [id, tx.now()]);
			await audit(tx, 'import.applied', {
				entity: 'import',
				entityId: id,
				description: `Import č. ${id} zapsán: ${imp.applied_new} nových IČO, ${imp.applied_updated} aktualizovaných, ${imp.applied_phones} nových telefonů`,
				details: {
					filename: imp.filename,
					new: imp.applied_new,
					updated: imp.applied_updated,
					unchanged: imp.applied_unchanged,
					phones_added: imp.applied_phones,
					duplicate: imp.rows_duplicate,
					invalid_ico: imp.rows_invalid_ico,
					error: imp.rows_error
				}
			});
			return { done: true, finishedNow: true, import: summary(await readImport(tx, id)) };
		});
		// The staged rows of a finished import are gone: give their space back and refresh statistics.
		if (result.finishedNow) await reclaimSpace(ctx);
		return { done: result.done, import: result.import };
	},

	/** Cancels an import that has not been written yet and deletes its staged rows. args: { id } */
	'imports.cancel': async (ctx, args) => {
		const id = importId(args);
		const cancelled = await inTransaction(ctx, async (tx) => {
			const imp = await lockImport(tx, id);
			if (!['uploading', 'uploaded', 'validated'].includes(imp.status)) {
				throw new AppError(
					'import_wrong_status',
					imp.status === 'applying'
						? `Import č. ${id} se už zapisuje. Zrušit nejde, zápis je potřeba dokončit.`
						: `Import č. ${id} nejde zrušit (je ${STATUS_LABELS[imp.status]}).`,
					409
				);
			}
			const removed = await tx.db.run('delete from import_rows where import_id = $1', [id]);
			await tx.db.run(`update imports set status = 'cancelled', cancelled_at = $2, rows_purged_at = $2 where id = $1`, [id, tx.now()]);
			await audit(tx, 'import.cancelled', {
				entity: 'import',
				entityId: id,
				description: `Import č. ${id} zrušen před zápisem`,
				details: { filename: imp.filename, previous_status: imp.status, rows_deleted: removed }
			});
			return summary(await readImport(tx, id));
		});
		await reclaimSpace(ctx);
		return cancelled;
	},

	/** History of imports. args: { page?, pageSize? }. Returns { items, total, page, pageSize }. */
	'imports.list': async (ctx, args) => {
		await purgeOldRows(ctx);
		const pageSize = await clampPageSize(ctx.db, args?.pageSize, 20);
		const page = Math.max(1, Math.floor(Number(args?.page)) || 1);
		const total = (await ctx.db.one<{ n: number }>('select count(*)::int as n from imports'))!.n;
		const rows = await ctx.db.query<ImportRow>(
			`select ${IMPORT_COLUMNS} from imports order by id desc limit $1 offset $2`,
			[pageSize, (page - 1) * pageSize]
		);
		return { items: rows.map(summary), total, page, pageSize };
	},

	/** One import with its counts. args: { id } */
	'imports.get': async (ctx, args) => {
		const imp = await readImport(ctx, importId(args));
		return { ...summary(imp), robot: await robotCounts(ctx, imp) };
	},

	/**
	 * Problem rows of an import for the screen. args: { id, kind: 'invalid_ico' | 'duplicate' | 'error' | 'warning',
	 * page?, pageSize? }. Returns { items: [{ rowNo, ico, name, problem }], total, page, pageSize }.
	 */
	'imports.rows': async (ctx, args) => {
		const id = importId(args);
		const kind = args?.kind as ProblemKind;
		if (!PROBLEM_KINDS.includes(kind)) throw new AppError('kind_invalid', 'Neznámý druh řádků.');
		await readImport(ctx, id);
		const pageSize = await clampPageSize(ctx.db, args?.pageSize, 20);
		const page = Math.max(1, Math.floor(Number(args?.page)) || 1);
		const where = problemWhere(kind);
		const total = (await ctx.db.one<{ n: number }>(
			`select count(*)::int as n from import_rows where import_id = $1 and ${where}`,
			[id]
		))!.n;
		const rows = await ctx.db.query<ProblemRow>(
			`select row_no, status, data, ico, error_code, duplicate_of, warnings from import_rows
			 where import_id = $1 and ${where} order by row_no limit $2 offset $3`,
			[id, pageSize, (page - 1) * pageSize]
		);
		return {
			items: rows.map((r) => ({
				rowNo: r.row_no,
				ico: r.ico ?? r.data.ico ?? null,
				name: r.data.name ?? null,
				problem:
					kind === 'warning'
						? (r.warnings ?? []).map((w) => `${IMPORT_FIELD_LABELS[w.field as ImportField] ?? w.field}: ${warningText(w)} („${w.value}“)`).join('; ')
						: problemText(r)
			})),
			total,
			page,
			pageSize
		};
	},

	/**
	 * What a checked import would change on companies already in the database. args: { id }.
	 * Returns { fields: [{ field, label, differs, fills, overwrite }] }: differs = both have a value
	 * and they are not the same (overwritten only when chosen), fills = the company has none yet
	 * (always filled in), overwrite = the default from the setting.
	 */
	'imports.diff': async (ctx, args) => {
		const id = importId(args);
		await diffableImport(ctx, id);
		const allowed = await getSetting<unknown>(ctx.db, 'import.update_existing_fields');
		const specs = await loadDiffSpecs(ctx);
		const select = DIFF_FIELDS.map(
			(field) =>
				`(count(*) filter (where ${differsSql(specs[field])}))::int as "${field}_differs",
				(count(*) filter (where ${fillsSql(specs[field])}))::int as "${field}_fills"`
		).join(', ');
		const row = (await ctx.db.one<Record<string, number>>(`select ${select} ${DIFF_FROM}`, [id])) ?? {};
		return {
			fields: DIFF_FIELDS.map((field) => ({
				field,
				label: DIFF_LABELS[field],
				note: DIFF_NOTES[field] ?? null,
				differs: row[`${field}_differs`] ?? 0,
				fills: row[`${field}_fills`] ?? 0,
				overwrite: field in DIFF_DEFAULTS ? DIFF_DEFAULTS[field] === true : Array.isArray(allowed) && allowed.includes(field)
			}))
		};
	},

	/**
	 * The differing values themselves. args: { id, field?, after?, limit? } (after = row number of
	 * the last item; without field all fields, for the report). Returns { items: [{ rowNo, ico,
	 * field, label, current, incoming }], last, done }.
	 */
	'imports.diffRows': async (ctx, args) => {
		const id = importId(args);
		await diffableImport(ctx, id);
		const fields = args?.field === undefined || args?.field === null ? [...DIFF_FIELDS] : [args.field];
		if (fields.some((f) => !(DIFF_FIELDS as readonly unknown[]).includes(f))) throw new AppError('field_invalid', 'Neznámé pole.');
		const after = Math.max(0, Math.floor(Number(args?.after)) || 0);
		const limit = Math.min(Math.max(1, Math.floor(Number(args?.limit)) || 50), REPORT_PAGE);
		const specs = await loadDiffSpecs(ctx);
		const parts = (fields as DiffField[]).map((field) => {
			const d = specs[field];
			return `select r.row_no, r.ico, '${field}' as field, coalesce(${d.curText ?? d.cur}, ${d.cur}) as current,
				coalesce(${d.incText ?? d.inc}, ${d.inc}) as incoming
				${DIFF_FROM} and r.row_no > $2 and ${differsSql(d)}`;
		});
		// Whole rows only: the page ends at a row number, so no row is split between two pages.
		const rows = await ctx.db.query<{ row_no: number; ico: string; field: DiffField; current: string; incoming: string }>(
			`with d as (${parts.join(' union all ')}),
				page as (select distinct row_no from d order by row_no limit $3)
			 select d.* from d join page using (row_no) order by d.row_no, d.field`,
			[id, after, limit]
		);
		const rowCount = new Set(rows.map((r) => r.row_no)).size;
		return {
			items: rows.map((r) => {
				const name = (value: string) =>
					r.field === 'operator' ? (OPERATOR_NAMES[value] ?? value) : r.field === 'robot_status' ? stateHolderText(value) : value;
				return { rowNo: r.row_no, ico: r.ico, field: r.field, label: DIFF_LABELS[r.field], current: name(r.current), incoming: name(r.incoming) };
			}),
			last: rows.length ? rows[rows.length - 1].row_no : after,
			done: rowCount < limit
		};
	},

	/**
	 * Error report, step 1 (the .xlsx itself is built in the browser). args: { id }. Writes the audit
	 * row and returns { filename, summary: [label, value][], sheets: [{ name, kind, columns }], rows }.
	 */
	'imports.reportStart': async (ctx, args) => {
		const id = importId(args);
		const imp = await reportableImport(ctx, id);
		const rows = (await ctx.db.one<{ n: number }>(
			`select count(*)::int as n from import_rows
			 where import_id = $1 and (status in ('invalid_ico', 'duplicate', 'error') or warnings is not null)`,
			[id]
		))!.n;
		await audit(ctx, 'import.report_downloaded', {
			entity: 'import',
			entityId: id,
			description: `Stažen report chyb importu č. ${id} (${rows} řádků)`,
			details: { filename: imp.filename, rows }
		});
		return {
			filename: `import-${id}-report-chyb.xlsx`,
			summary: reportSummary(imp),
			sheets: REPORT_SHEETS.map((sheet) => ({ ...sheet, columns: reportColumns(sheet.kind) })),
			rows
		};
	},

	/**
	 * Error report, step 2: one page of one sheet. args: { id, kind, after } (after = last row number
	 * of the previous page). Returns { rows: cell values in column order, last, done }.
	 */
	'imports.reportRows': async (ctx, args) => {
		const id = importId(args);
		const kind = args?.kind as ProblemKind;
		if (!PROBLEM_KINDS.includes(kind)) throw new AppError('kind_invalid', 'Neznámý druh řádků.');
		await reportableImport(ctx, id);
		const after = Math.max(0, Math.floor(Number(args?.after)) || 0);
		const found = await ctx.db.query<ProblemRow>(
			`select row_no, status, data, ico, error_code, duplicate_of, warnings from import_rows
			 where import_id = $1 and row_no > $2 and ${problemWhere(kind)} order by row_no limit ${REPORT_PAGE}`,
			[id, after]
		);
		const rows: (string | number)[][] = [];
		for (const r of found) {
			if (kind === 'warning') {
				for (const w of r.warnings ?? []) {
					rows.push([r.row_no, r.ico ?? r.data.ico ?? '', r.data.name ?? '', IMPORT_FIELD_LABELS[w.field] ?? w.field, w.value, warningText(w)]);
				}
			} else {
				rows.push([r.row_no, r.data.ico ?? '', r.data.name ?? '', problemText(r)]);
			}
		}
		return { rows, last: found.length ? found[found.length - 1].row_no : after, done: found.length < REPORT_PAGE };
	}
};
