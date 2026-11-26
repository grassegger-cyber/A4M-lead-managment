// returns.* methods: deadlines and the file of returned statuses. In-memory database, fictional IČO.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import type { Db } from '../db.ts';
import { systemCtx } from '../context.ts';
import type { Ctx } from '../context.ts';
import { icoFromPrefix } from '../../ico.ts';
import { methods } from './returns.ts';

let db: Db;
let ctx: Ctx;
// 26 November 2026, noon in Prague.
const now = new Date('2026-11-26T11:00:00Z');
const ico = (n: number) => icoFromPrefix(9940000 + n);
const call = (name: string, args: unknown = {}) => methods[name](ctx, args) as Promise<any>;

async function held(n: number, endsOn: string, extendedOn: string | null = null) {
	await db.run(
		`insert into companies (ico, name, state, holder_type, holder_login, owned_from, ownership_ends_on, ownership_extended_on)
		 values ($1, $2, 'superuser', 'superuser', 'TEST_PROTECT', '2026-11-01', $3, $4)`,
		[ico(n), `Testovací ${n}`, endsOn, extendedOn]
	);
}

beforeAll(async () => {
	db = await openDb({ dir: 'memory' });
	ctx = systemCtx(db, { now: () => now, actor: { id: null, name: 'Test' } });
	// Reserve 5 days, steps 7 and 14: "overdue" = end before 1 Dec, "within 7" = 1–8 Dec, "8–14" = 9–15 Dec.
	await held(1, '2026-11-28'); // overdue
	await held(2, '2026-12-01'); // send today … within 7
	await held(3, '2026-12-08'); // within 7 (last day)
	await held(4, '2026-12-09'); // 8–14
	await held(5, '2026-12-30'); // later
	await held(6, '2026-12-03', '2026-11-10'); // within 7, extension already used
	// Not held on the protective login: never in the file.
	await db.run(`insert into companies (ico, name, state, holder_type, holder_login, ownership_ends_on) values ($1, 'U obchodníka', 'login_oz', 'login_oz', 'TEST_OZ', '2026-12-02')`, [ico(7)]);
	await db.run(`insert into companies (ico, name) values ($1, 'V poolu')`, [ico(8)]);
});

afterAll(async () => {
	await db.close();
});

describe('returns.overview', () => {
	it('sorts the held IČO by when the file has to go out', async () => {
		const o = await call('returns.overview');
		expect(o.today).toBe('2026-11-26');
		expect(o.reserveDays).toBe(5);
		expect(o.buckets.map((b: any) => [b.key, b.count, b.extendable])).toEqual([
			['overdue', 1, 1],
			['within_7', 3, 2],
			['within_14', 1, 1],
			['later', 1, 1]
		]);
		// Every held IČO is in exactly one group.
		expect(o.buckets.reduce((sum: number, b: any) => sum + b.count, 0)).toBe(6);
		expect(o.buckets[1]).toMatchObject({ from: '2026-12-01', to: '2026-12-08' });
	});
});

describe('returns.file and returns.confirm', () => {
	let fileId: number;

	it('builds the file in the format of the operator and writes it to the audit log', async () => {
		const bucket = (await call('returns.overview')).buckets[1];
		const file = await call('returns.file', { endsFrom: bucket.from, endsTo: bucket.to });
		fileId = file.id;
		expect(file.sheet).toBe('statuses');
		expect(file.headers).toEqual(['ICO', 'STATUS']);
		expect(file.rows).toEqual([
			[ico(2), 'Prodloužit o 30 dnů'],
			[ico(3), 'Prodloužit o 30 dnů'],
			[ico(6), ''] // extension already used: to be filled in by hand
		]);
		expect(file).toMatchObject({ extendCount: 2, blankCount: 1 });
		const log = await db.one<{ details: any }>(`select details from audit_log where action = 'export.returned_statuses' order by id desc limit 1`);
		expect(log!.details).toEqual({ rows: 3, extend: 2, blank: 1 });
	});

	it('refuses an empty selection', async () => {
		await expect(call('returns.file', { endsFrom: '2030-01-01' })).rejects.toMatchObject({ code: 'return_empty' });
	});

	it('moves the end of ownership only after the confirmation, once', async () => {
		const before = await db.one<{ d: string }>('select ownership_ends_on as d from companies where ico = $1', [ico(2)]);
		expect(before!.d).toBe('2026-12-01');
		expect(await call('returns.confirm', { id: fileId })).toEqual({ extended: 2 });
		const rows = await db.query<Record<string, any>>(
			`select ico, ownership_ends_on, ownership_extended_on from companies where ico = any($1::char(8)[]) order by ico`,
			[[ico(2), ico(3), ico(6)]]
		);
		expect(rows).toEqual([
			{ ico: ico(2), ownership_ends_on: '2026-12-31', ownership_extended_on: '2026-11-26' },
			{ ico: ico(3), ownership_ends_on: '2027-01-07', ownership_extended_on: '2026-11-26' },
			{ ico: ico(6), ownership_ends_on: '2026-12-03', ownership_extended_on: '2026-11-10' }
		]);
		const history = await db.one<{ n: number }>(`select count(*)::int as n from company_state_history where reason_code = 'ownership_extended'`);
		expect(history!.n).toBe(2);
		await expect(call('returns.confirm', { id: fileId })).rejects.toMatchObject({ code: 'return_confirmed' });
	});

	it('an extended IČO gets no second extension in the next file', async () => {
		const file = await call('returns.file', { endsFrom: '2026-12-31', endsTo: '2026-12-31' });
		expect(file.rows).toEqual([[ico(2), '']]);
		await call('returns.cancel', { id: file.id });
		await expect(call('returns.confirm', { id: file.id })).rejects.toMatchObject({ code: 'return_cancelled' });
		await expect(call('returns.cancel', { id: file.id })).rejects.toMatchObject({ code: 'return_not_open' });
	});
});
