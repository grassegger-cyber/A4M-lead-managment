// audit.* methods: read-only view of audit_log.
import type { MethodMap } from '../context.ts';
import { AppError } from '../errors.ts';
import { clampPageSize } from '../settings-core.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Days in the filter are calendar days in Czech time. */
const TIME_ZONE = 'Europe/Prague';

function dateArg(value: unknown, label: string): string | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string' || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
		throw new AppError('date_invalid', `Datum „${label}“ není platné.`, 400);
	}
	return value;
}

function textArg(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim().slice(0, 200);
	return text || null;
}

/** Escapes % and _ so the text is searched literally. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export const methods: MethodMap = {
	/**
	 * args: { page?, pageSize?, action? (exact), area? (part before the dot), from?, to? ('YYYY-MM-DD'), text? }
	 * → { rows, total, page, pageSize }
	 */
	'audit.list': async (ctx, args) => {
		const pageSize = await clampPageSize(ctx.db, args?.pageSize, 50);
		const requestedPage = Math.floor(Number(args?.page));
		const from = dateArg(args?.from, 'od');
		const to = dateArg(args?.to, 'do');
		if (from && to && from > to) throw new AppError('date_invalid', 'Datum „od“ je pozdější než datum „do“.', 400);
		const action = textArg(args?.action);
		const area = textArg(args?.area);
		const text = textArg(args?.text);

		const where: string[] = [];
		const params: unknown[] = [];
		const add = (sql: string, value: unknown) => {
			params.push(value);
			where.push(sql.replaceAll('?', `$${params.length}`));
		};
		if (action) add('action = ?', action);
		if (area) add("action like ? || '.%'", likeEscape(area));
		if (from) add(`at >= (?::date)::timestamp at time zone '${TIME_ZONE}'`, from);
		if (to) add(`at < (?::date + 1)::timestamp at time zone '${TIME_ZONE}'`, to);
		if (text) {
			add(
				`(description ilike ? or entity_id ilike ? or action ilike ? or actor_name ilike ? or details::text ilike ?)`,
				`%${likeEscape(text)}%`
			);
		}
		const whereSql = where.length ? `where ${where.join(' and ')}` : '';

		const count = await ctx.db.one<{ n: number }>(`select count(*)::int as n from audit_log ${whereSql}`, params);
		const total = count?.n ?? 0;
		const pages = Math.max(1, Math.ceil(total / pageSize));
		const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.min(requestedPage, pages) : 1;
		const rows = await ctx.db.query(
			`select id::int as id, at, actor_name, action, entity, entity_id, description, details
			 from audit_log ${whereSql}
			 order by at desc, id desc
			 limit $${params.length + 1} offset $${params.length + 2}`,
			[...params, pageSize, (page - 1) * pageSize]
		);
		return { rows, total, page, pageSize };
	},

	/** Actions that occur in the log, for the filter: [{ action, count }] */
	'audit.actions': async (ctx) =>
		ctx.db.query<{ action: string; count: number }>(
			'select action, count(*)::int as count from audit_log group by action order by action'
		)
};
