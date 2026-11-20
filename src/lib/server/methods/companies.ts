// companies.* methods: IČO list with search and filters, detail, manual state change,
// manual override of the return / quarantine dates and the Excel export.
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import type { Ctx, MethodMap } from '../context.ts';
import { inTransaction } from '../context.ts';
import type { Queryable } from '../db.ts';
import { AppError } from '../errors.ts';
import { audit, transition } from '../companies-core.ts';
import type { TransitionExtra } from '../companies-core.ts';
import { clampPageSize, getSetting, getSettings } from '../settings-core.ts';
import { fileResponse, XLSX_MIME } from '../files.ts';
import { parseIco } from '../../ico.ts';
import {
	CHANNELS,
	CHANNEL_LABELS,
	HOLDER_LABELS,
	HOLDER_TYPES,
	OPERATORS,
	OPERATOR_LABELS,
	STATES,
	SUBJECT_TYPES,
	isCompanyState,
	stateLabel
} from '../../states.ts';
import type { CompanyState, HolderType } from '../../states.ts';

/** Filter value meaning "the column is empty" (no rep, no cohort, operator not verified…). */
export const NONE = '-';

const DATE_RANGES = [
	['ownedFrom', 'owned_from'],
	['ownershipEnds', 'ownership_ends_on'],
	['returnOn', 'return_on'],
	['quarantineUntil', 'quarantine_until']
] as const;
/** Ranges over verification timestamps (IČO in ARES, operator of a phone number). */
const VERIFIED_RANGES = ['icoVerified', 'operatorVerified'] as const;
type DateRangeKey = (typeof DATE_RANGES)[number][0] | (typeof VERIFIED_RANGES)[number];

/** A timestamp belongs to the calendar day it has in Czech time (the database session runs in UTC). */
const TIME_ZONE = 'Europe/Prague';

/** Normalised filter: only validated values, safe to log (see filterForAudit). */
export interface CompanyFilter {
	search: string;
	state: string[];
	holderType: string[];
	holderLogin: string;
	subjectType: string[];
	regionCode: string[];
	districtCode: string[];
	operator: string[];
	cohortId: (number | typeof NONE)[];
	channel: string[];
	salesRepId: (number | typeof NONE)[];
	dates: Partial<Record<DateRangeKey, { from?: string; to?: string }>>;
	roundsMin: number | null;
	roundsMax: number | null;
	neverReturn: boolean | null;
	icoValid: 'yes' | 'no' | 'unknown' | null;
}

function invalid(what: string): never {
	throw new AppError('filter_invalid', `Neplatná hodnota filtru: ${what}.`);
}

function toList(value: unknown): string[] {
	if (value === null || value === undefined || value === '') return [];
	const items = Array.isArray(value) ? value : [value];
	return [...new Set(items.map((v) => String(v).trim()).filter((v) => v !== ''))];
}

function listOf(value: unknown, allowed: readonly string[], what: string, allowNone = false): string[] {
	const list = toList(value);
	for (const v of list) {
		if (!(allowed.includes(v) || (allowNone && v === NONE))) invalid(what);
	}
	return list;
}

function idList(value: unknown, what: string): (number | typeof NONE)[] {
	return toList(value).map((v) => {
		if (v === NONE) return NONE;
		if (!/^\d{1,9}$/.test(v)) invalid(what);
		return Number(v);
	});
}

function codeList(value: unknown, what: string, allowNone = false): string[] {
	const list = toList(value);
	for (const v of list) {
		if (!(/^[0-9A-Za-z]{1,12}$/.test(v) || (allowNone && v === NONE))) invalid(what);
	}
	return list;
}

function isoDateOrUndefined(value: unknown, what: string): string | undefined {
	if (value === null || value === undefined || value === '') return undefined;
	if (typeof value !== 'string' || !isIsoDate(value)) invalid(what);
	return value as string;
}

function isIsoDate(value: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function intOrNull(value: unknown, what: string): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0 || n > 32767) invalid(what);
	return n;
}

/** Validates the filter coming from the browser. Unknown keys are ignored. */
export function parseFilter(args: any): CompanyFilter {
	const f = (args && typeof args.filter === 'object' && args.filter) || {};
	const search = typeof args?.search === 'string' ? args.search.trim().slice(0, 100) : '';
	const dates: CompanyFilter['dates'] = {};
	for (const key of [...DATE_RANGES.map(([k]) => k), ...VERIFIED_RANGES]) {
		const from = isoDateOrUndefined(f[`${key}From`], 'datum od');
		const to = isoDateOrUndefined(f[`${key}To`], 'datum do');
		if (from || to) dates[key] = { from, to };
	}
	const icoValid = f.icoValid === undefined || f.icoValid === null || f.icoValid === '' ? null : String(f.icoValid);
	if (icoValid !== null && !['yes', 'no', 'unknown'].includes(icoValid)) invalid('platnost IČO');
	const neverReturn =
		f.neverReturn === true || f.neverReturn === 'yes' ? true : f.neverReturn === false || f.neverReturn === 'no' ? false : null;
	return {
		search,
		state: listOf(f.state, STATES, 'stav'),
		holderType: listOf(f.holderType, HOLDER_TYPES, 'držitel'),
		holderLogin: typeof f.holderLogin === 'string' ? f.holderLogin.trim().slice(0, 100) : '',
		subjectType: listOf(f.subjectType, SUBJECT_TYPES, 'typ subjektu', true),
		regionCode: codeList(f.regionCode, 'kraj', true),
		districtCode: codeList(f.districtCode, 'okres'),
		operator: listOf(f.operator, OPERATORS, 'operátor', true),
		cohortId: idList(f.cohortId, 'dávka'),
		channel: listOf(f.channel, CHANNELS, 'kanál', true),
		salesRepId: idList(f.salesRepId, 'obchodník'),
		dates,
		roundsMin: intOrNull(f.roundsMin, 'počet kol od'),
		roundsMax: intOrNull(f.roundsMax, 'počet kol do'),
		neverReturn,
		icoValid: icoValid as CompanyFilter['icoValid']
	};
}

const likeEscape = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

interface Where {
	sql: string;
	params: unknown[];
}

/** Builds the WHERE clause over alias c. Every value goes through a parameter. */
export function buildWhere(filter: CompanyFilter): Where {
	const conditions: string[] = [];
	const params: unknown[] = [];
	const p = (value: unknown) => {
		params.push(value);
		return `$${params.length}`;
	};
	/** column = any(values), where the NONE token matches NULL. */
	const anyOf = (column: string, values: (string | number)[], cast: string) => {
		if (!values.length) return;
		const real = values.filter((v) => v !== NONE);
		const parts: string[] = [];
		if (real.length) parts.push(`${column} = any(${p(real)}::${cast}[])`);
		if (values.includes(NONE)) parts.push(`${column} is null`);
		conditions.push(parts.length > 1 ? `(${parts.join(' or ')})` : parts[0]);
	};

	if (filter.search) {
		const digits = filter.search.replace(/[\s+\-/()]/g, '');
		if (/^\d+$/.test(digits)) {
			// Number: IČO prefix (range on the primary key), part of a phone number, or part of a name.
			const parts: string[] = [];
			if (digits.length <= 8) {
				parts.push(`(c.ico >= ${p(digits.padEnd(8, '0'))}::char(8) and c.ico <= ${p(digits.padEnd(8, '9'))}::char(8))`);
				// Excel drops leading zeros: fewer than 8 digits may also be a whole IČO written without them.
				if (digits.length < 8) parts.push(`c.ico = ${p(digits.padStart(8, '0'))}::char(8)`);
			}
			if (digits.length >= 3) {
				parts.push(`c.ico in (select ph.ico from company_phones ph where ph.phone like ${p(`%${digits}%`)})`);
			}
			parts.push(`c.name_search like ${p(`%${digits}%`)}`);
			conditions.push(`(${parts.join(' or ')})`);
		} else {
			conditions.push(`c.name_search like search_norm(${p(`%${likeEscape(filter.search)}%`)})`);
		}
	}

	anyOf('c.state', filter.state, 'text');
	anyOf('c.holder_type', filter.holderType, 'text');
	if (filter.holderLogin) conditions.push(`c.holder_login = ${p(filter.holderLogin)}`);
	anyOf('c.subject_type', filter.subjectType, 'text');
	anyOf('c.region_code', filter.regionCode, 'text');
	anyOf('c.district_code', filter.districtCode, 'text');
	anyOf('c.cohort_id', filter.cohortId, 'integer');
	anyOf('c.channel', filter.channel, 'text');
	anyOf('c.sales_rep_id', filter.salesRepId, 'integer');

	const dayStart = (date: string) => `(${p(date)}::date)::timestamp at time zone '${TIME_ZONE}'`;
	const dayAfter = (date: string) => `(${p(date)}::date + 1)::timestamp at time zone '${TIME_ZONE}'`;

	// The operator and its verification date belong to a phone number: a company matches when one
	// of its numbers meets all the phone conditions (the list column shows the operators of all numbers).
	const phone: string[] = [];
	if (filter.operator.length) {
		const real = filter.operator.filter((v) => v !== NONE);
		const parts: string[] = [];
		if (real.length) parts.push(`ph.operator = any(${p(real)}::text[])`);
		if (filter.operator.includes(NONE)) parts.push('ph.operator is null');
		phone.push(parts.length > 1 ? `(${parts.join(' or ')})` : parts[0]);
	}
	const operatorVerified = filter.dates.operatorVerified;
	if (operatorVerified?.from) phone.push(`ph.operator_verified_at >= ${dayStart(operatorVerified.from)}`);
	if (operatorVerified?.to) phone.push(`ph.operator_verified_at < ${dayAfter(operatorVerified.to)}`);
	if (phone.length) conditions.push(`c.ico in (select ph.ico from company_phones ph where ${phone.join(' and ')})`);

	const icoVerified = filter.dates.icoVerified;
	if (icoVerified?.from) conditions.push(`c.ico_verified_at >= ${dayStart(icoVerified.from)}`);
	if (icoVerified?.to) conditions.push(`c.ico_verified_at < ${dayAfter(icoVerified.to)}`);

	for (const [key, column] of DATE_RANGES) {
		const range = filter.dates[key];
		if (range?.from) conditions.push(`c.${column} >= ${p(range.from)}::date`);
		if (range?.to) conditions.push(`c.${column} <= ${p(range.to)}::date`);
	}
	if (filter.roundsMin !== null) conditions.push(`c.rounds_count >= ${p(filter.roundsMin)}`);
	if (filter.roundsMax !== null) conditions.push(`c.rounds_count <= ${p(filter.roundsMax)}`);
	if (filter.neverReturn !== null) conditions.push(filter.neverReturn ? 'c.never_return' : 'not c.never_return');
	if (filter.icoValid === 'yes') conditions.push('c.ico_valid is true');
	if (filter.icoValid === 'no') conditions.push('c.ico_valid is false');
	if (filter.icoValid === 'unknown') conditions.push('c.ico_valid is null');

	return { sql: conditions.length ? `where ${conditions.join(' and ')}` : '', params };
}

/** Filter as stored in audit_log. A searched phone number is never written to the log. */
function filterForAudit(filter: CompanyFilter): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(filter)) {
		if (value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
		if (key === 'dates' && !Object.keys(value as object).length) continue;
		out[key] = value;
	}
	if (filter.search) {
		const digits = filter.search.replace(/[\s+\-/()]/g, '');
		if (/^\d{9,}$/.test(digits)) out.search = '[telefonní číslo]';
	}
	return out;
}

// Sort keys the list accepts → SQL expression over alias c.
const SORT_COLUMNS: Record<string, string> = {
	ico: 'c.ico',
	name: 'c.name_search',
	subject_type: 'c.subject_type',
	state: 'c.state',
	holder_type: 'c.holder_type',
	holder_login: 'c.holder_login',
	region_name: 'c.region_name',
	district_name: 'c.district_name',
	channel: 'c.channel',
	owned_from: 'c.owned_from',
	ownership_ends_on: 'c.ownership_ends_on',
	return_on: 'c.return_on',
	quarantine_until: 'c.quarantine_until',
	rounds_count: 'c.rounds_count',
	updated_at: 'c.updated_at'
};

function orderBy(sort: unknown): { sql: string; key: string; dir: 'asc' | 'desc' } {
	const s = (sort && typeof sort === 'object' ? sort : {}) as { key?: unknown; dir?: unknown };
	// Own keys only: "constructor" or "toString" are found by `in` on every object.
	const key = typeof s.key === 'string' && Object.hasOwn(SORT_COLUMNS, s.key) ? s.key : 'ico';
	const dir = s.dir === 'desc' ? 'desc' : 'asc';
	const sql = key === 'ico' ? `c.ico ${dir}` : `${SORT_COLUMNS[key]} ${dir} nulls last, c.ico asc`;
	return { sql, key, dir };
}

// Columns of the list. Fixed set; the detail and the export return more.
const LIST_COLUMNS = `c.ico, c.name, c.subject_type, c.state, c.holder_type, c.holder_login, c.region_code,
	c.region_name, c.district_code, c.district_name, c.sales_rep_id, c.cohort_id, c.channel, c.owned_from,
	c.ownership_ends_on, c.return_on, c.quarantine_until, c.never_return, c.rounds_count, c.ico_valid`;

function localIsoDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' plus a number of days. */
function addDaysIso(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

const HOLDER_BY_STATE_KEY = 'ownership.manual_holder_by_state';

/**
 * Which holder a manual change into a state sets: { state: holder type }, from the setting
 * ownership.manual_holder_by_state. A state that is not listed leaves the holder to the user.
 * Login OZ never appears here: that holder always follows from the chosen sales rep.
 */
export async function holderByState(db: Queryable): Promise<Partial<Record<CompanyState, HolderType>>> {
	// Read through getSettings, so a database that does not have the key yet means "no rule".
	const value = (await getSettings(db, [HOLDER_BY_STATE_KEY]))[HOLDER_BY_STATE_KEY];
	const rules: Partial<Record<CompanyState, HolderType>> = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) return rules;
	for (const [state, holder] of Object.entries(value as Record<string, unknown>)) {
		if (!isCompanyState(state) || state === 'login_oz') continue;
		if (typeof holder !== 'string' || holder === 'login_oz' || !(HOLDER_TYPES as readonly string[]).includes(holder)) continue;
		rules[state] = holder as HolderType;
	}
	return rules;
}

function requireIco(input: unknown): string {
	const parsed = parseIco(typeof input === 'string' ? input : String(input ?? ''));
	if (!parsed.ok) throw new AppError('ico_invalid', 'Neplatné IČO.');
	return parsed.ico;
}

async function countCompanies(db: Queryable, where: Where): Promise<number> {
	const row = await db.one<{ total: number }>(`select count(*)::int as total from companies c ${where.sql}`, where.params);
	return row?.total ?? 0;
}

const EXPORT_CHUNK = 5000;

const EXPORT_COLUMNS: { header: string; key: string; width: number; date?: boolean }[] = [
	{ header: 'IČO', key: 'ico', width: 11 },
	{ header: 'Název', key: 'name', width: 40 },
	{ header: 'Typ subjektu', key: 'subject_type', width: 12 },
	{ header: 'Stav', key: 'state_label', width: 20 },
	{ header: 'Stav (kód)', key: 'state', width: 18 },
	{ header: 'Držitel', key: 'holder', width: 14 },
	{ header: 'Login držitele', key: 'holder_login', width: 18 },
	{ header: 'Přiřazený OZ', key: 'sales_rep_name', width: 24 },
	{ header: 'Dávka', key: 'cohort_code', width: 16 },
	{ header: 'Kanál', key: 'channel', width: 14 },
	{ header: 'Vlastnictví od', key: 'owned_from', width: 14, date: true },
	{ header: 'Konec vlastnictví', key: 'ownership_ends_on', width: 16, date: true },
	{ header: 'Datum návratu', key: 'return_on', width: 14, date: true },
	{ header: 'Karanténa do', key: 'quarantine_until', width: 14, date: true },
	{ header: 'Trvale vyřazeno', key: 'never_return', width: 14 },
	{ header: 'Počet kol', key: 'rounds_count', width: 10 },
	{ header: 'Kraj', key: 'region_name', width: 22 },
	{ header: 'Okres', key: 'district_name', width: 22 },
	{ header: 'Telefony', key: 'phones', width: 34 },
	{ header: 'Operátor', key: 'operators', width: 16 },
	{ header: 'Operátor ověřen', key: 'operator_verified_on', width: 15, date: true },
	{ header: 'IČO platné', key: 'ico_valid', width: 11 },
	{ header: 'IČO ověřeno', key: 'ico_verified_on', width: 13, date: true },
	{ header: 'Založeno', key: 'founded_on', width: 12, date: true },
	{ header: 'CZ-NACE', key: 'nace', width: 20 }
];

const yesNo = (value: boolean | null | undefined) => (value === null || value === undefined ? '' : value ? 'ano' : 'ne');
const excelDate = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);

export const methods: MethodMap = {
	/**
	 * Page of the IČO list.
	 * args: { search?, filter?, sort?: { key, dir }, page?, pageSize? }
	 * → { rows, total, page, pageSize, sort }
	 */
	'companies.list': async (ctx, args) => {
		const filter = parseFilter(args);
		const where = buildWhere(filter);
		const order = orderBy(args?.sort);
		const pageSize = await clampPageSize(ctx.db, args?.pageSize, 50);
		const total = await countCompanies(ctx.db, where);
		const pages = Math.max(1, Math.ceil(total / pageSize));
		const requested = Math.floor(Number(args?.page));
		const page = Math.min(pages, Number.isFinite(requested) && requested >= 1 ? requested : 1);
		const n = where.params.length;
		// Page first (inner query), then names and the primary phone only for the rows shown.
		const rows = await ctx.db.query(
			`select c.*, r.name as sales_rep_name, co.code as cohort_code,
				ph.primary_phone, ph.primary_operator, coalesce(ph.operators, '{}') as operators,
				coalesce(ph.phone_count, 0) as phone_count
			 from (
				select ${LIST_COLUMNS}, c.name_search, c.updated_at
				from companies c ${where.sql}
				order by ${order.sql} limit $${n + 1} offset $${n + 2}
			 ) c
			 left join sales_reps r on r.id = c.sales_rep_id
			 left join cohorts co on co.id = c.cohort_id
			 left join lateral (
				select (array_agg(p.phone order by p.is_primary desc, p.id))[1] as primary_phone,
					(array_agg(p.operator order by p.is_primary desc, p.id))[1] as primary_operator,
					array_agg(coalesce(p.operator, '${NONE}') order by p.is_primary desc, p.id) as operators,
					count(*)::int as phone_count
				from company_phones p where p.ico = c.ico
			 ) ph on true
			 order by ${order.sql}`,
			[...where.params, pageSize, (page - 1) * pageSize]
		);
		for (const row of rows) delete (row as Record<string, unknown>).name_search;
		return { rows, total, page, pageSize, sort: { key: order.key, dir: order.dir } };
	},

	/** Values for the filter panel and the action dialogs. */
	'companies.filterOptions': async (ctx) => {
		const reps = await ctx.db.query(
			'select id, name, siebel_login, active, rep_type, home_region_code from sales_reps order by active desc, name'
		);
		const cohorts = await ctx.db.query('select id, code, status, day_zero_on from cohorts order by day_zero_on desc nulls last, code desc');
		const holderLogins = await ctx.db.query(
			`select holder_type, holder_login, count(*)::int as count from companies
			 where holder_login is not null group by holder_type, holder_login order by holder_type, holder_login`
		);
		return {
			reps,
			cohorts,
			holderLogins,
			pools: {
				free: await getSetting<string[]>(ctx.db, 'pools.free'),
				releaseTargets: await getSetting<string[]>(ctx.db, 'pools.release_targets')
			},
			holderByState: await holderByState(ctx.db),
			maxPageSize: Number(await getSetting(ctx.db, 'list.max_page_size'))
		};
	},

	/**
	 * Detail of one IČO: company, phones, full state history, rep assignments,
	 * manual transitions allowed from the current state and earlier date overrides.
	 */
	'companies.get': async (ctx, args) => {
		const ico = requireIco(args?.ico);
		const company = await ctx.db.one<Record<string, unknown> & { state: string }>(
			`select c.ico, c.name, c.subject_type, c.legal_form_code, c.region_code, c.region_name, c.district_code,
				c.district_name, c.nace_codes, c.founded_on, c.dissolved_on, c.ico_valid, c.ico_verified_at, c.state,
				c.holder_type, c.holder_login, c.sales_rep_id, c.owned_from, c.ownership_ends_on, c.cohort_id, c.channel,
				c.rounds_count, c.return_on, c.return_path, c.quarantine_until, c.never_return, c.return_on_overridden,
				c.return_on_override_note, c.quarantine_overridden, c.quarantine_override_note, c.ca_number, c.siebel_owner,
				c.siebel_opportunity_valid_until, c.siebel_checked_at, c.raynet_company_id, c.created_at, c.updated_at,
				r.name as sales_rep_name, r.siebel_login as sales_rep_login, co.code as cohort_code, co.status as cohort_status,
				co.day_zero_on as cohort_day_zero_on, co.deadline_on as cohort_deadline_on
			 from companies c
			 left join sales_reps r on r.id = c.sales_rep_id
			 left join cohorts co on co.id = c.cohort_id
			 where c.ico = $1`,
			[ico]
		);
		if (!company) throw new AppError('company_not_found', `IČO ${ico} v databázi není.`, 404);
		const phones = await ctx.db.query(
			`select id, phone, is_primary, operator, operator_verified_at, number_type, source
			 from company_phones where ico = $1 order by is_primary desc, id`,
			[ico]
		);
		const history = await ctx.db.query(
			`select h.id, h.at, h.from_state, h.to_state, h.from_holder, h.to_holder, h.reason_code, h.note, h.source,
				h.actor_name, h.cohort_id, co.code as cohort_code
			 from company_state_history h left join cohorts co on co.id = h.cohort_id
			 where h.ico = $1 order by h.at desc, h.id desc`,
			[ico]
		);
		const assignments = await ctx.db.query(
			`select a.id, a.sales_rep_id, r.name as sales_rep_name, r.siebel_login, a.channel, a.source, a.handed_over_on,
				a.round_no, a.cohort_id, co.code as cohort_code, a.assigned_from, a.assigned_to, a.end_reason, a.end_note
			 from company_assignments a
			 join sales_reps r on r.id = a.sales_rep_id
			 left join cohorts co on co.id = a.cohort_id
			 where a.ico = $1 order by a.assigned_from desc, a.id desc`,
			[ico]
		);
		const transitions = await ctx.db.query(
			`select to_state, label_cs, note_required from state_transitions
			 where from_state = $1 and enabled and manual_allowed order by to_state`,
			[company.state]
		);
		const overrides = await ctx.db.query(
			`select id, at, actor_name, description, details from audit_log
			 where entity = 'company' and entity_id = $1 and action = 'company.dates_override'
			 order by at desc, id desc limit 50`,
			[ico]
		);
		return { company, phones, history, assignments, transitions, overrides };
	},

	/**
	 * Manual state change. args: { ico, toState, reason?, expectedFromState?, salesRepId?, holderType?, holderLogin? }
	 * The reason is stored as the note of the history row; whether it is mandatory is decided by
	 * note_required in state_transitions. The holder follows the target state where the setting
	 * ownership.manual_holder_by_state says so, and the ownership fields follow the holder.
	 */
	'companies.transition': async (ctx, args) => {
		const ico = requireIco(args?.ico);
		const toState = args?.toState;
		if (!isCompanyState(toState)) throw new AppError('state_unknown', 'Vyberte cílový stav.');
		const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
		if (reason.length > 1000) throw new AppError('reason_too_long', 'Důvod je příliš dlouhý (nejvýše 1000 znaků).');
		const expected = args?.expectedFromState;
		if (expected !== undefined && expected !== null && !isCompanyState(expected)) {
			throw new AppError('state_unknown', 'Neznámý výchozí stav.');
		}
		let givenHolder: HolderType | null = null;
		if (args?.holderType !== undefined && args.holderType !== null && args.holderType !== '') {
			if (!(HOLDER_TYPES as readonly string[]).includes(args.holderType)) throw new AppError('holder_invalid', 'Neplatný typ držitele.');
			givenHolder = args.holderType as HolderType;
		}
		const givenLogin = typeof args?.holderLogin === 'string' && args.holderLogin.trim() ? args.holderLogin.trim().slice(0, 100) : null;

		return inTransaction(ctx, async (tx) => {
			const company = await tx.db.one<{
				state: string;
				holder_type: string;
				holder_login: string | null;
				sales_rep_id: number | null;
				channel: 'operatorka' | 'cold_call' | null;
				cohort_id: number | null;
				rounds_count: number;
			}>(
				'select state, holder_type, holder_login, sales_rep_id, channel, cohort_id, rounds_count from companies where ico = $1 for update',
				[ico]
			);
			if (!company) throw new AppError('company_not_found', `IČO ${ico} v databázi není.`, 404);
			// Checked here as well (transition() checks again): a stale dialog should hear that the
			// state changed, not that a holder is missing for a transition that no longer applies.
			if (expected && expected !== company.state) {
				throw new AppError(
					'state_changed',
					`IČO ${ico} už není ve stavu „${stateLabel(expected)}“, ale „${stateLabel(company.state)}“.`,
					409
				);
			}

			const today = localIsoDate(tx.now());
			const extra: TransitionExtra = { source: 'manual', note: reason || null };
			if (expected) extra.expectedFromState = expected as CompanyState;
			let repId: number | null = null;

			if (toState === 'login_oz') {
				// A login of a sales rep always needs the rep; the holder follows from it.
				repId = Number(args?.salesRepId);
				if (!Number.isInteger(repId) || repId <= 0) throw new AppError('rep_required', 'Vyberte obchodníka, na jehož login IČO přechází.');
				const rep = await tx.db.one<{ id: number; siebel_login: string | null; active: boolean; name: string }>(
					'select id, siebel_login, active, name from sales_reps where id = $1',
					[repId]
				);
				if (!rep) throw new AppError('rep_not_found', 'Vybraný obchodník neexistuje.', 404);
				if (!rep.active) throw new AppError('rep_inactive', `Obchodník ${rep.name} není aktivní.`);
				// The rep is identified by id: two reps without a Siebel login are still two reps.
				const sameRep =
					company.sales_rep_id !== null
						? company.sales_rep_id === rep.id
						: company.holder_login !== null && company.holder_login === rep.siebel_login;
				if (company.state === 'login_oz' && company.holder_type === 'login_oz' && sameRep) {
					throw new AppError('rep_unchanged', `IČO už je na loginu obchodníka ${rep.name}.`);
				}
				extra.holderType = 'login_oz';
				extra.holderLogin = rep.siebel_login;
			} else {
				if (givenHolder === 'login_oz') {
					throw new AppError('holder_invalid', 'Držitele „Login OZ“ jde nastavit jen přechodem do stavu Login OZ.');
				}
				const required = (await holderByState(tx.db))[toState] ?? null;
				if (required) {
					if (givenHolder && givenHolder !== required) {
						throw new AppError(
							'holder_invalid',
							`Stav „${stateLabel(toState)}“ znamená držitele „${HOLDER_LABELS[required]}“ (nastavení Vlastnictví).`
						);
					}
					// Without a new login the present one stays, when the holder already is of that type.
					const login = givenLogin ?? (company.holder_type === required ? company.holder_login : null);
					if (required === 'pool') {
						const free = await getSetting<unknown>(tx.db, 'pools.free');
						const pools = Array.isArray(free) ? free.map(String) : [];
						if (!login) throw new AppError('holder_login_required', 'Vyberte pool, do kterého IČO přechází.');
						if (!pools.includes(login)) {
							throw new AppError('holder_invalid', `Pool „${login}“ není mezi volnými pooly v nastavení (${pools.join(', ') || 'žádný'}).`);
						}
					}
					extra.holderType = required;
					extra.holderLogin = login;
				} else if (givenHolder) {
					extra.holderType = givenHolder;
					extra.holderLogin = givenLogin;
				}
			}

			// Ownership follows the holder: the rep, "owned from" and the end of ownership describe
			// the present holder and must not survive a change of it.
			const newHolderType = extra.holderType ?? company.holder_type;
			const newHolderLogin = extra.holderType !== undefined ? (extra.holderLogin ?? null) : company.holder_login;
			const holderChanged =
				newHolderType !== company.holder_type ||
				newHolderLogin !== company.holder_login ||
				(repId !== null && company.sales_rep_id !== repId);
			if (holderChanged) {
				if (newHolderType === 'login_oz') {
					extra.salesRepId = repId;
					extra.ownedFrom = today;
					// Where the end of ownership on a rep's login comes from is not decided yet (ownership.rep_end_source).
					extra.ownershipEndsOn = null;
				} else if (newHolderType === 'superuser') {
					const holdDays = Number(await getSetting(tx.db, 'ownership.superuser_hold_days'));
					extra.salesRepId = null;
					extra.ownedFrom = today;
					extra.ownershipEndsOn = Number.isInteger(holdDays) && holdDays >= 0 ? addDaysIso(today, holdDays) : null;
				} else {
					extra.salesRepId = null;
					extra.ownedFrom = null;
					extra.ownershipEndsOn = null;
				}
			}

			const result = await transition(tx, ico, toState, 'manual', extra);

			// Rep assignments follow the holder: leaving a rep's login closes the open assignment
			// (with the reason the user gave), arriving on one opens a new assignment.
			if (holderChanged) {
				await tx.db.run(
					`update company_assignments set assigned_to = $2::date, end_reason = 'manual', end_note = $3
					 where ico = $1 and assigned_to is null`,
					[ico, today, reason || null]
				);
				if (repId !== null) {
					await tx.db.run(
						`insert into company_assignments (ico, sales_rep_id, channel, source, round_no, cohort_id, assigned_from)
						 values ($1, $2, $3, 'manual', $4, $5, $6::date)`,
						[ico, repId, company.channel, Math.max(1, company.rounds_count), company.cohort_id, today]
					);
				}
			}
			return result;
		});
	},

	/**
	 * Manual override of the return date and / or the quarantine end.
	 * args: { ico, note, returnOn?: 'YYYY-MM-DD' | null, quarantineUntil?: 'YYYY-MM-DD' | null }
	 * A key that is present is written (null clears the date) and marked as overridden.
	 */
	'companies.overrideDates': async (ctx, args) => {
		const ico = requireIco(args?.ico);
		const note = typeof args?.note === 'string' ? args.note.trim() : '';
		if (!note) throw new AppError('note_required', 'Přepsání data vyžaduje poznámku.');
		if (note.length > 1000) throw new AppError('note_too_long', 'Poznámka je příliš dlouhá (nejvýše 1000 znaků).');
		const hasReturn = args && 'returnOn' in args && args.returnOn !== undefined;
		const hasQuarantine = args && 'quarantineUntil' in args && args.quarantineUntil !== undefined;
		if (!hasReturn && !hasQuarantine) throw new AppError('nothing_to_change', 'Vyberte, které datum chcete přepsat.');
		const dateArg = (value: unknown, label: string): string | null => {
			if (value === null || value === '') return null;
			if (typeof value !== 'string' || !isIsoDate(value)) throw new AppError('date_invalid', `${label}: neplatné datum.`);
			return value;
		};
		const returnOn = hasReturn ? dateArg(args.returnOn, 'Datum návratu') : null;
		const quarantineUntil = hasQuarantine ? dateArg(args.quarantineUntil, 'Karanténa do') : null;

		return inTransaction(ctx, async (tx) => {
			const before = await tx.db.one<{ return_on: string | null; quarantine_until: string | null }>(
				'select return_on, quarantine_until from companies where ico = $1 for update',
				[ico]
			);
			if (!before) throw new AppError('company_not_found', `IČO ${ico} v databázi není.`, 404);
			const sets: string[] = [];
			const params: unknown[] = [ico, note];
			const details: Record<string, unknown> = { note };
			const parts: string[] = [];
			if (hasReturn) {
				params.push(returnOn);
				sets.push(`return_on = $${params.length}::date`, 'return_on_overridden = true', 'return_on_override_note = $2');
				details.return_on = { old: before.return_on, new: returnOn };
				parts.push('datum návratu');
			}
			if (hasQuarantine) {
				params.push(quarantineUntil);
				sets.push(`quarantine_until = $${params.length}::date`, 'quarantine_overridden = true', 'quarantine_override_note = $2');
				details.quarantine_until = { old: before.quarantine_until, new: quarantineUntil };
				parts.push('karanténa do');
			}
			await tx.db.run(`update companies set ${sets.join(', ')} where ico = $1`, params);
			await audit(tx, 'company.dates_override', {
				entity: 'company',
				entityId: ico,
				description: `IČO ${ico}: ručně přepsáno ${parts.join(' a ')}`,
				details
			});
			return tx.db.one(
				`select ico, return_on, return_on_overridden, return_on_override_note, quarantine_until,
					quarantine_overridden, quarantine_override_note from companies where ico = $1`,
				[ico]
			);
		});
	},

	/**
	 * Excel export of everything the filter matches (same args as companies.list, paging ignored,
	 * rows ordered by IČO). The audit row with the filter and the row count is written before any
	 * data is read, in the same transaction.
	 */
	'companies.export': async (ctx, args) => {
		const filter = parseFilter(args);
		const where = buildWhere(filter);
		return inTransaction(ctx, async (tx) => {
			const total = await countCompanies(tx.db, where);
			if (total === 0) throw new AppError('export_empty', 'Filtru neodpovídá žádné IČO, není co exportovat.');
			await audit(tx, 'export.companies', {
				entity: 'companies',
				description: `Export IČO do Excelu: ${total} řádků`,
				details: { filter: filterForAudit(filter), rows: total }
			});

			const stream = new PassThrough();
			const chunks: Buffer[] = [];
			stream.on('data', (chunk: Buffer) => chunks.push(chunk));
			const finished = new Promise<void>((resolve, reject) => {
				stream.on('end', () => resolve());
				stream.on('error', reject);
			});
			const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
			const sheet = workbook.addWorksheet('IČO', { views: [{ state: 'frozen', ySplit: 1 }] });
			sheet.columns = EXPORT_COLUMNS.map((column) => ({
				header: column.header,
				key: column.key,
				width: column.width,
				style: column.date ? { numFmt: 'dd". "mm". "yyyy' } : {}
			}));
			sheet.getRow(1).font = { bold: true };
			sheet.getRow(1).commit();

			const n = where.params.length;
			const keyset = `${where.sql ? `${where.sql} and` : 'where'} c.ico > $${n + 1}::char(8)`;
			let last = '';
			let written = 0;
			for (;;) {
				const rows = await tx.db.query<Record<string, any>>(
					`select c.*, r.name as sales_rep_name, co.code as cohort_code, ph.phones, ph.operators, ph.operator_verified_on
					 from (
						select c.ico, c.name, c.subject_type, c.state, c.holder_type, c.holder_login, c.sales_rep_id, c.cohort_id,
							c.channel, c.owned_from, c.ownership_ends_on, c.return_on, c.quarantine_until, c.never_return,
							c.rounds_count, c.region_name, c.district_name, c.ico_valid,
							(c.ico_verified_at at time zone '${TIME_ZONE}')::date as ico_verified_on,
							c.founded_on, c.nace_codes
						from companies c ${keyset} order by c.ico limit ${EXPORT_CHUNK}
					 ) c
					 left join sales_reps r on r.id = c.sales_rep_id
					 left join cohorts co on co.id = c.cohort_id
					 left join lateral (
						select string_agg(p.phone, ', ' order by p.is_primary desc, p.id) as phones,
							string_agg(coalesce(p.operator, '?'), ', ' order by p.is_primary desc, p.id) as operators,
							(max(p.operator_verified_at) at time zone '${TIME_ZONE}')::date as operator_verified_on
						from company_phones p where p.ico = c.ico
					 ) ph on true
					 order by c.ico`,
					[...where.params, last]
				);
				if (!rows.length) break;
				for (const row of rows) {
					sheet
						.addRow({
							ico: row.ico,
							name: row.name ?? '',
							subject_type: row.subject_type ?? '',
							state_label: stateLabel(row.state),
							state: row.state,
							holder: HOLDER_LABELS[row.holder_type as HolderType] ?? row.holder_type,
							holder_login: row.holder_login ?? '',
							sales_rep_name: row.sales_rep_name ?? '',
							cohort_code: row.cohort_code ?? '',
							channel: row.channel ? (CHANNEL_LABELS[row.channel as keyof typeof CHANNEL_LABELS] ?? row.channel) : '',
							owned_from: excelDate(row.owned_from),
							ownership_ends_on: excelDate(row.ownership_ends_on),
							return_on: excelDate(row.return_on),
							quarantine_until: excelDate(row.quarantine_until),
							never_return: yesNo(row.never_return),
							rounds_count: row.rounds_count,
							region_name: row.region_name ?? '',
							district_name: row.district_name ?? '',
							phones: row.phones ?? '',
							operators: row.operators
								? String(row.operators)
										.split(', ')
										.map((op) => OPERATOR_LABELS[op as keyof typeof OPERATOR_LABELS] ?? 'neověřeno')
										.join(', ')
								: '',
							operator_verified_on: excelDate(row.operator_verified_on),
							ico_valid: yesNo(row.ico_valid),
							ico_verified_on: excelDate(row.ico_verified_on),
							founded_on: excelDate(row.founded_on),
							nace: Array.isArray(row.nace_codes) ? row.nace_codes.join(', ') : ''
						})
						.commit();
				}
				written += rows.length;
				last = rows[rows.length - 1].ico;
				if (rows.length < EXPORT_CHUNK) break;
			}
			sheet.commit();
			await workbook.commit();
			await finished;
			if (written !== total) throw new Error(`export row count mismatch: counted ${total}, wrote ${written}`);

			const response = fileResponse(new Uint8Array(Buffer.concat(chunks)), `ico-export-${localIsoDate(tx.now())}.xlsx`, XLSX_MIME);
			response.headers.set('x-row-count', String(total));
			return response;
		});
	}
};
