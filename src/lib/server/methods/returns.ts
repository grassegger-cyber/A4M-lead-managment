// returns.* methods: ownership deadlines of the IČO held on the protective login and the file of
// returned statuses for the operator (sheet "statuses": ICO, STATUS). The .xlsx is built in the browser.
import type { Ctx, MethodMap } from '../context.ts';
import { inTransaction } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit } from '../companies-core.ts';
import { getSetting, getSettings } from '../settings-core.ts';
import { buildWhere, parseFilter } from './companies.ts';
import { czechToday } from './imports.ts';

/** IČO the file is about: held by us on the superuser (protective) login, with a known end of ownership. */
const HELD = `c.state = 'superuser' and c.holder_type = 'superuser' and c.ownership_ends_on is not null`;

async function numberSetting(ctx: Ctx, key: string, min = 0): Promise<number> {
	const n = Math.floor(Number(await getSetting(ctx.db, key)));
	if (!Number.isFinite(n) || n < min) throw new AppError('setting_invalid', `Nastavení „${key}“ musí být číslo.`, 500);
	return n;
}

function fileSettings(settings: Record<string, unknown>) {
	const labels = settings['returned_statuses.labels'] as Record<string, unknown> | null;
	const file = settings['returned_statuses.file'] as Record<string, unknown> | null;
	const text = (value: unknown, name: string): string => {
		if (typeof value !== 'string' || !value.trim()) {
			throw new AppError('setting_invalid', `V nastavení souboru vrácení statusů chybí „${name}“.`, 500);
		}
		return value;
	};
	return {
		extend: text(labels?.extend, 'extend'),
		sheet: text(file?.sheet, 'sheet'),
		icoHeader: text(file?.ico_header, 'ico_header'),
		statusHeader: text(file?.status_header, 'status_header')
	};
}

interface ReturnRow {
	id: number;
	created_at: Date;
	created_by_name: string | null;
	total: number;
	extend_count: number;
	blank_count: number;
	confirmed_at: Date | null;
	confirmed_by_name: string | null;
	extended_count: number | null;
	cancelled_at: Date | null;
}

const RETURN_COLUMNS = `id::int as id, created_at, created_by_name, total, extend_count, blank_count, confirmed_at,
	confirmed_by_name, extended_count, cancelled_at`;

export const methods: MethodMap = {
	/**
	 * Deadlines: { today, reserveDays, buckets: [{ key, label, from, to, count, extendable }], files }.
	 * "Send by" = end of ownership minus the reserve. from / to are ends of ownership ('YYYY-MM-DD',
	 * null = open) and can be passed to returns.file as the range.
	 */
	'returns.overview': async (ctx) => {
		const reserve = await numberSetting(ctx, 'ownership.return_reserve_days');
		const raw = await getSetting<unknown>(ctx.db, 'ownership.watch_days');
		const steps = (Array.isArray(raw) ? raw : [])
			.map((n) => Math.floor(Number(n)))
			.filter((n) => Number.isFinite(n) && n > 0)
			.sort((a, b) => a - b);
		const today = czechToday(ctx.now());
		const plus = (days: number) => {
			const d = new Date(`${today}T00:00:00Z`);
			d.setUTCDate(d.getUTCDate() + days);
			return d.toISOString().slice(0, 10);
		};
		// Bounds are ends of ownership: "send within N days" means the end lies within N + reserve days.
		const bounds: { key: string; label: string; from: string | null; to: string | null }[] = [
			{ key: 'overdue', label: 'Po termínu odeslání', from: null, to: plus(reserve - 1) }
		];
		let previous = 0;
		for (const step of steps) {
			bounds.push({
				key: `within_${step}`,
				label: previous === 0 ? `Odeslat do ${step} dní` : `Odeslat za ${previous + 1}–${step} dní`,
				from: previous === 0 ? plus(reserve) : plus(reserve + previous + 1),
				to: plus(reserve + step)
			});
			previous = step;
		}
		bounds.push({ key: 'later', label: previous ? `Odeslat později než za ${previous} dní` : 'Odeslat později', from: plus(reserve + previous + 1), to: null });
		const buckets = [];
		for (const b of bounds) {
			const row = await ctx.db.one<{ n: number; extendable: number }>(
				`select count(*)::int as n, (count(*) filter (where c.ownership_extended_on is null))::int as extendable
				 from companies c
				 where ${HELD} and ($1::date is null or c.ownership_ends_on >= $1::date) and ($2::date is null or c.ownership_ends_on <= $2::date)`,
				[b.from, b.to]
			);
			buckets.push({ ...b, count: row?.n ?? 0, extendable: row?.extendable ?? 0 });
		}
		const files = await ctx.db.query<ReturnRow>(`select ${RETURN_COLUMNS} from status_returns order by id desc limit 20`);
		return { today, reserveDays: reserve, buckets, files };
	},

	/**
	 * Builds the content of a file of returned statuses and remembers what was in it.
	 * args: { endsFrom?, endsTo? } (range of ends of ownership) or the filter of companies.list.
	 * Every IČO that was not extended yet gets "Prodloužit o 30 dnů"; one that already used its
	 * extension gets an empty status to be filled in by hand.
	 * Returns { id, filename, sheet, headers, rows: [[ico, status]], extendCount, blankCount }.
	 */
	'returns.file': async (ctx, args) => {
		const settings = fileSettings(await getSettings(ctx.db, 'returned_statuses.'));
		const filter = parseFilter(args);
		const where = buildWhere(filter);
		const params = [...where.params];
		const conditions = [where.sql ? where.sql.replace(/^where /, '') : 'true', HELD];
		for (const [key, op] of [
			['endsFrom', '>='],
			['endsTo', '<=']
		] as const) {
			const value = args?.[key];
			if (value === undefined || value === null || value === '') continue;
			if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('date_invalid', 'Neplatné datum.');
			params.push(value);
			conditions.push(`c.ownership_ends_on ${op} $${params.length}::date`);
		}
		return inTransaction(ctx, async (tx) => {
			const found = await tx.db.query<{ ico: string; extended: boolean }>(
				`select c.ico, (c.ownership_extended_on is not null) as extended
				 from companies c where ${conditions.join(' and ')} order by c.ico`,
				params
			);
			if (!found.length) {
				throw new AppError('return_empty', 'Výběru neodpovídá žádné IČO, které držíme na ochranném useru.');
			}
			const extendCount = found.filter((r) => !r.extended).length;
			const blankCount = found.length - extendCount;
			const created = await tx.db.one<{ id: number }>(
				`insert into status_returns (created_at, created_by, created_by_name, filter, total, extend_count, blank_count)
				 values ($1, $2, $3, $4::jsonb, $5, $6, $7) returning id`,
				[
					tx.now(),
					tx.actor.id,
					tx.actor.name,
					JSON.stringify({ endsFrom: args?.endsFrom ?? null, endsTo: args?.endsTo ?? null }),
					found.length,
					extendCount,
					blankCount
				]
			);
			const id = Number(created!.id);
			await tx.db.run(
				`insert into status_return_items (return_id, ico, status_key)
				 select $1, t.ico, case when t.extended then null else 'extend' end
				 from jsonb_to_recordset($2::jsonb) as t(ico char(8), extended boolean)`,
				[id, JSON.stringify(found)]
			);
			await audit(tx, 'export.returned_statuses', {
				entity: 'status_return',
				entityId: id,
				description: `Soubor vrácení statusů č. ${id}: ${found.length} IČO, z toho ${extendCount} k prodloužení`,
				details: { rows: found.length, extend: extendCount, blank: blankCount }
			});
			return {
				id,
				filename: `vraceni-statusu-${czechToday(tx.now())}-c${id}.xlsx`,
				sheet: settings.sheet,
				headers: [settings.icoHeader, settings.statusHeader],
				rows: found.map((r) => [r.ico, r.extended ? '' : settings.extend]),
				extendCount,
				blankCount
			};
		});
	},

	/**
	 * The file was sent to the operator: every IČO that was in it with "Prodloužit" and is still
	 * held and not extended gets its end of ownership moved and the extension marked as used.
	 * args: { id }. Returns { extended }.
	 */
	'returns.confirm': async (ctx, args) => {
		const id = Math.floor(Number(args?.id));
		if (!Number.isInteger(id) || id < 1) throw new AppError('return_id_invalid', 'Chybí číslo souboru.');
		const days = await numberSetting(ctx, 'ownership.superuser_extension_days', 1);
		return inTransaction(ctx, async (tx) => {
			const file = await tx.db.one<ReturnRow>(`select ${RETURN_COLUMNS} from status_returns where id = $1 for update`, [id]);
			if (!file) throw new AppError('return_not_found', `Soubor č. ${id} neexistuje.`, 404);
			if (file.confirmed_at) throw new AppError('return_confirmed', `Soubor č. ${id} už byl potvrzen.`, 409);
			if (file.cancelled_at) throw new AppError('return_cancelled', `Soubor č. ${id} byl zahozen.`, 409);
			const today = czechToday(tx.now());
			const extended = await tx.db.run(
				`with u as (
					update companies c
					set ownership_ends_on = c.ownership_ends_on + $2::int, ownership_extended_on = $3::date
					from status_return_items i
					where i.return_id = $1 and i.status_key = 'extend' and c.ico = i.ico and ${HELD} and c.ownership_extended_on is null
					returning c.ico, c.state, c.holder_type, c.holder_login, c.cohort_id
				)
				insert into company_state_history
					(ico, at, from_state, to_state, from_holder, to_holder, reason_code, note, cohort_id, source, actor_id, actor_name)
				select u.ico, $4, u.state, u.state,
					case when u.holder_login is null then u.holder_type else u.holder_type || ':' || u.holder_login end,
					case when u.holder_login is null then u.holder_type else u.holder_type || ':' || u.holder_login end,
					'ownership_extended', $5, u.cohort_id, 'manual', $6, $7
				from u`,
				[id, days, today, tx.now(), `Soubor vrácení statusů č. ${id}`, tx.actor.id, tx.actor.name]
			);
			await tx.db.run(`update status_returns set confirmed_at = $2, confirmed_by_name = $3, extended_count = $4 where id = $1`, [
				id,
				tx.now(),
				tx.actor.name,
				extended
			]);
			await audit(tx, 'returns.confirmed', {
				entity: 'status_return',
				entityId: id,
				description: `Soubor vrácení statusů č. ${id} potvrzen jako odeslaný: prodlouženo ${extended} IČO o ${days} dní`,
				details: { extended, days, in_file: file.extend_count }
			});
			return { extended };
		});
	},

	/** A generated file that was never sent. args: { id } */
	'returns.cancel': async (ctx, args) => {
		const id = Math.floor(Number(args?.id));
		return inTransaction(ctx, async (tx) => {
			const changed = await tx.db.run(
				`update status_returns set cancelled_at = $2 where id = $1 and confirmed_at is null and cancelled_at is null`,
				[id, tx.now()]
			);
			if (!changed) throw new AppError('return_not_open', 'Soubor už byl potvrzen nebo zahozen.', 409);
			await audit(tx, 'returns.cancelled', { entity: 'status_return', entityId: id, description: `Soubor vrácení statusů č. ${id} zahozen` });
			return { ok: true };
		});
	}
};
