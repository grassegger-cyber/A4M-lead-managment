// system.* methods: small read-only facts for the shell (overview page).
import type { MethodMap } from '../context.ts';

export const methods: MethodMap = {
	/** Counts for the overview page: { total, byState: [{ state, count }], reps, cohorts } */
	'system.overview': async (ctx) => {
		const byState = await ctx.db.query<{ state: string; count: number }>(
			'select state, count(*)::int as count from companies group by state'
		);
		const totals = await ctx.db.one<{ reps: number; cohorts: number }>(
			`select (select count(*)::int from sales_reps where active) as reps,
				(select count(*)::int from cohorts) as cohorts`
		);
		return {
			total: byState.reduce((sum, r) => sum + r.count, 0),
			byState,
			reps: totals?.reps ?? 0,
			cohorts: totals?.cohorts ?? 0
		};
	}
};
