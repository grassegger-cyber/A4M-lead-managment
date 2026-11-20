// Runs against an in-memory PGlite database with the real migrations. Never touches ./data.nosync.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from './db.ts';
import type { Db } from './db.ts';
import { systemCtx } from './context.ts';
import type { Ctx } from './context.ts';
import { audit, recordInitialState, transition } from './companies-core.ts';
import { getSetting } from './settings-core.ts';
import { icoFromPrefix } from '../ico.ts';
import { STATES } from '../states.ts';

let db: Db;
let ctx: Ctx;
const fixedNow = new Date('2026-11-19T10:00:00Z');
const ICO_A = icoFromPrefix(9900001);
const ICO_B = icoFromPrefix(9900002);
const ICO_MISSING = icoFromPrefix(9900003);

beforeAll(async () => {
	db = await openDb({ dir: 'memory' });
	ctx = systemCtx(db, { now: () => fixedNow, actor: { id: null, name: 'Test' } });
	for (const [ico, n] of [[ICO_A, 1], [ICO_B, 2]] as const) {
		await db.run('insert into companies (ico, name, subject_type) values ($1, $2, $3)', [
			ico,
			`Testovací firma 0000${n} s.r.o.`,
			'PO'
		]);
		await recordInitialState(ctx, ico, 'import', 'test');
	}
});

afterAll(async () => {
	await db.close();
});

describe('migrations', () => {
	it('seed every state in the transition table and all settings', async () => {
		const rows = await db.query<{ from_state: string; to_state: string }>('select from_state, to_state from state_transitions');
		expect(rows.length).toBeGreaterThanOrEqual(40);
		for (const r of rows) {
			expect(STATES).toContain(r.from_state);
			expect(STATES).toContain(r.to_state);
		}
		expect(await getSetting(db, 'limits.superuser_max')).toBe(10000);
		expect(await getSetting(db, 'pools.free')).toEqual(['VBCPOOL', 'SADMIN', 'OBSPOOL']);
		const count = await db.one<{ n: number }>('select count(*)::int as n from settings');
		expect(count!.n).toBeGreaterThanOrEqual(90);
	});
	it('are recorded once each', async () => {
		const rows = await db.query<{ filename: string }>('select filename from schema_migrations order by filename');
		expect(rows.map((r) => r.filename).slice(0, 3)).toEqual([
			'0001_core_schema.sql',
			'0002_state_transitions.sql',
			'0003_settings.sql'
		]);
	});
	it('keep a search column without diacritics', async () => {
		const row = await db.one<{ name_search: string }>('select name_search from companies where ico = $1', [ICO_A]);
		expect(row!.name_search).toBe('testovaci firma 00001 s.r.o.');
	});
});

describe('transition', () => {
	it('performs an allowed transition and writes history', async () => {
		const result = await transition(ctx, ICO_A, 've_filtru', 'cohort_build', { source: 'system', expectedFromState: 'v_poolu' });
		expect(result.fromState).toBe('v_poolu');
		expect(result.toState).toBe('ve_filtru');
		const company = await db.one<{ state: string }>('select state from companies where ico = $1', [ICO_A]);
		expect(company!.state).toBe('ve_filtru');
		const history = await db.query<{ from_state: string | null; to_state: string; reason_code: string; source: string; at: Date }>(
			'select from_state, to_state, reason_code, source, at from company_state_history where ico = $1 order by id',
			[ICO_A]
		);
		expect(history).toHaveLength(2);
		expect(history[0]).toMatchObject({ from_state: null, to_state: 'v_poolu', source: 'import' });
		expect(history[1]).toMatchObject({ from_state: 'v_poolu', to_state: 've_filtru', reason_code: 'cohort_build', source: 'system' });
		expect(history[1].at.toISOString()).toBe(fixedNow.toISOString());
	});

	it('updates holder and ownership fields passed in extra', async () => {
		await transition(ctx, ICO_A, 'u_robota_ocisteni', 'robot_upload', { source: 'robot' });
		const result = await transition(ctx, ICO_A, 'superuser', 'robot_landed', {
			source: 'robot',
			holderType: 'superuser',
			holderLogin: 'KAISER2',
			ownedFrom: '2026-11-19',
			ownershipEndsOn: '2026-12-19'
		});
		expect(result.fromHolder).toBe('neznamo');
		expect(result.toHolder).toBe('superuser:KAISER2');
		const company = await db.one<Record<string, unknown>>(
			'select state, holder_type, holder_login, owned_from, ownership_ends_on from companies where ico = $1',
			[ICO_A]
		);
		expect(company).toEqual({
			state: 'superuser',
			holder_type: 'superuser',
			holder_login: 'KAISER2',
			owned_from: '2026-11-19',
			ownership_ends_on: '2026-12-19'
		});
	});

	it('refuses a transition that is not in the table and leaves no trace', async () => {
		const before = await db.one<{ n: number }>('select count(*)::int as n from company_state_history where ico = $1', [ICO_B]);
		await expect(transition(ctx, ICO_B, 'zakaznik', 'x', { source: 'system' })).rejects.toMatchObject({
			code: 'transition_forbidden'
		});
		const after = await db.one<{ n: number }>('select count(*)::int as n from company_state_history where ico = $1', [ICO_B]);
		expect(after!.n).toBe(before!.n);
		const company = await db.one<{ state: string }>('select state from companies where ico = $1', [ICO_B]);
		expect(company!.state).toBe('v_poolu');
	});

	it('refuses a disabled transition', async () => {
		await db.run("update state_transitions set enabled = false where from_state = 'v_poolu' and to_state = 'karantena'");
		await expect(transition(ctx, ICO_B, 'karantena', 'x', { source: 'system' })).rejects.toMatchObject({
			code: 'transition_forbidden'
		});
		await db.run("update state_transitions set enabled = true where from_state = 'v_poolu' and to_state = 'karantena'");
	});

	it('refuses when the company is no longer in the expected state', async () => {
		await expect(
			transition(ctx, ICO_B, 've_filtru', 'x', { source: 'system', expectedFromState: 'superuser' })
		).rejects.toMatchObject({ code: 'state_changed' });
	});

	it('refuses unknown IČO, invalid IČO and unknown state', async () => {
		await expect(transition(ctx, ICO_MISSING, 've_filtru', 'x')).rejects.toMatchObject({ code: 'company_not_found' });
		await expect(transition(ctx, '12345678', 've_filtru', 'x')).rejects.toMatchObject({ code: 'ico_invalid' });
		await expect(transition(ctx, ICO_B, 'nesmysl' as never, 'x')).rejects.toMatchObject({ code: 'state_unknown' });
	});

	it('manual transition honours manual_allowed and note_required and writes audit_log', async () => {
		// ICO_A is on superuser → zakaznik → v_poolu (the last one requires a note)
		await transition(ctx, ICO_A, 'zakaznik', 'deal', { source: 'system' });
		await expect(transition(ctx, ICO_A, 'v_poolu', 'manual_return')).rejects.toMatchObject({ code: 'note_required' });

		await db.run("update state_transitions set manual_allowed = false where from_state = 'zakaznik' and to_state = 'v_poolu'");
		await expect(transition(ctx, ICO_A, 'v_poolu', 'manual_return', { note: 'Test' })).rejects.toMatchObject({
			code: 'transition_not_manual'
		});
		await db.run("update state_transitions set manual_allowed = true where from_state = 'zakaznik' and to_state = 'v_poolu'");

		const auditBefore = await db.one<{ n: number }>("select count(*)::int as n from audit_log where action = 'company.state_change'");
		await transition(ctx, ICO_A, 'v_poolu', 'manual_return', { note: 'Vráceno ručně při testu' });
		const auditRows = await db.query<{ entity_id: string; details: Record<string, unknown>; actor_name: string }>(
			"select entity_id, details, actor_name from audit_log where action = 'company.state_change' order by id"
		);
		expect(auditRows.length).toBe(auditBefore!.n + 1);
		const last = auditRows[auditRows.length - 1];
		expect(last.entity_id).toBe(ICO_A);
		expect(last.actor_name).toBe('Test');
		expect(last.details).toMatchObject({ from_state: 'zakaznik', to_state: 'v_poolu', note: 'Vráceno ručně při testu' });
	});

	it('rolls back together with the caller transaction', async () => {
		await expect(
			db.transaction(async (tx) => {
				await transition({ ...ctx, db: tx }, ICO_B, 've_filtru', 'x', { source: 'system' });
				throw new Error('caller failed');
			})
		).rejects.toThrow('caller failed');
		const company = await db.one<{ state: string }>('select state from companies where ico = $1', [ICO_B]);
		expect(company!.state).toBe('v_poolu');
	});
});

describe('append-only tables', () => {
	it('refuse update, delete and truncate', async () => {
		await audit(ctx, 'test.action', { entity: 'test', description: 'Test' });
		await expect(db.run("update audit_log set action = 'x'")).rejects.toThrow(/append-only/);
		await expect(db.run('delete from audit_log')).rejects.toThrow(/append-only/);
		await expect(db.exec('truncate audit_log')).rejects.toThrow(/append-only/);
		await expect(db.run("update company_state_history set note = 'x'")).rejects.toThrow(/append-only/);
		await expect(db.run('delete from company_state_history')).rejects.toThrow(/append-only/);
		await expect(db.exec('truncate company_state_history')).rejects.toThrow(/append-only/);
	});
});
