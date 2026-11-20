// dashboard.* methods: numbers for the overview page.
import type { Ctx, MethodMap } from '../context.ts';
import { getSettings } from '../settings-core.ts';

interface CountRow {
	key: string | null;
	count: number;
}

/** Column names the overview understands in the imports table, in order of preference. */
const IMPORT_COLUMNS = {
	at: ['created_at', 'started_at', 'uploaded_at', 'at'],
	name: ['file_name', 'filename', 'original_name', 'name'],
	kind: ['kind', 'type', 'import_type'],
	status: ['status', 'state'],
	rows: ['received_rows', 'declared_rows', 'rows_total', 'total_rows', 'row_count']
} as const;

/**
 * Last imports. The imports table belongs to the import area and may not exist yet, so the
 * block is built from whichever known columns are present; null means "hide the block".
 */
async function lastImports(ctx: Ctx, limit: number) {
	const columns = (
		await ctx.db.query<{ column_name: string }>(
			`select column_name::text as column_name from information_schema.columns
			 where table_schema = current_schema() and table_name = 'imports'`
		)
	).map((c) => c.column_name);
	if (columns.length === 0) return null;
	const pick = (names: readonly string[]) => names.find((n) => columns.includes(n)) ?? null;
	const at = pick(IMPORT_COLUMNS.at);
	if (!at || !columns.includes('id')) return null;
	const select = [
		'id::text as id',
		`${at} as at`,
		...(['name', 'kind', 'status', 'rows'] as const).map((field) => {
			const column = pick(IMPORT_COLUMNS[field]);
			return column ? `${column}${field === 'rows' ? '::int' : '::text'} as ${field}` : `null as ${field}`;
		})
	];
	return ctx.db.query(`select ${select.join(', ')} from imports order by ${at} desc limit $1`, [limit]);
}

export const methods: MethodMap = {
	/**
	 * { total, byState, byHolder, bySubjectType, byRegion, superuser: { count, limit, pct, warningPct, level },
	 *   reps, cohorts, lastImports (null = table missing), lastAudit }
	 */
	'dashboard.overview': async (ctx) => {
		const group = (column: string) =>
			ctx.db.query<CountRow>(`select ${column} as key, count(*)::int as count from companies group by ${column}`);
		const byState = await group('state');
		const byHolder = await group('holder_type');
		const bySubjectType = await group('subject_type');
		const byRegion = await ctx.db.query<{ code: string | null; name: string | null; count: number }>(
			`select region_code as code, max(region_name) as name, count(*)::int as count
			 from companies group by region_code order by count desc, region_code`
		);
		const totals = await ctx.db.one<{ reps: number; cohorts: number }>(
			`select (select count(*)::int from sales_reps where active) as reps,
				(select count(*)::int from cohorts) as cohorts`
		);

		const limits = await getSettings(ctx.db, ['limits.superuser_max', 'limits.warning_pct']);
		const limit = Number(limits['limits.superuser_max']);
		const warningPct = Number(limits['limits.warning_pct']);
		const onSuperuser = byHolder.find((r) => r.key === 'superuser')?.count ?? 0;
		const pct = Number.isFinite(limit) && limit > 0 ? (onSuperuser / limit) * 100 : null;
		const level =
			pct === null ? 'unknown' : pct >= 100 ? 'full' : Number.isFinite(warningPct) && pct >= warningPct ? 'warning' : 'ok';

		const lastAudit = await ctx.db.query(
			`select id::int as id, at, actor_name, action, entity, entity_id, description
			 from audit_log order by at desc, id desc limit 10`
		);

		return {
			total: byState.reduce((sum, r) => sum + r.count, 0),
			byState,
			byHolder,
			bySubjectType,
			byRegion,
			superuser: {
				count: onSuperuser,
				limit: Number.isFinite(limit) ? limit : null,
				pct,
				warningPct: Number.isFinite(warningPct) ? warningPct : null,
				level
			},
			reps: totals?.reps ?? 0,
			cohorts: totals?.cohorts ?? 0,
			lastImports: await lastImports(ctx, 5),
			lastAudit
		};
	}
};
