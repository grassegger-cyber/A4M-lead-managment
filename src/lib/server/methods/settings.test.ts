// settings.*, audit.* and dashboard.* against an in-memory PGlite database with the real migrations.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import type { Db } from '../db.ts';
import { systemCtx } from '../context.ts';
import type { Ctx } from '../context.ts';
import { getSetting } from '../settings-core.ts';
import { recordInitialState, transition } from '../companies-core.ts';
import { icoFromPrefix } from '../../ico.ts';
import { graphProblems } from '../../transition-graph.ts';
import { methods as settings, validateSettingValue } from './settings.ts';
import { methods as auditMethods } from './audit.ts';
import { methods as dashboard } from './dashboard.ts';

let db: Db;
let ctx: Ctx;
let clock = new Date('2026-11-19T10:00:00Z');

const call = (map: Record<string, any>, name: string, args?: unknown) => map[name](ctx, args) as Promise<any>;
const lastAudit = () =>
	db.one<{ action: string; entity_id: string; details: any; actor_name: string }>(
		'select action, entity_id, details, actor_name from audit_log order by id desc limit 1'
	);
const auditCount = async () => (await db.one<{ n: number }>('select count(*)::int as n from audit_log'))!.n;

beforeAll(async () => {
	db = await openDb({ dir: 'memory' });
	ctx = systemCtx(db, { now: () => clock, actor: { id: null, name: 'Test' } });
});

afterAll(async () => {
	await db.close();
});

describe('validateSettingValue', () => {
	const row = (value_type: any, default_value: unknown) => ({ value_type, default_value });
	it('accepts values of the right type', () => {
		expect(validateSettingValue(row('number', 1), 0.002)).toBe(0.002);
		expect(validateSettingValue(row('text', 'a'), '  any ')).toBe('any');
		expect(validateSettingValue(row('boolean', true), false)).toBe(false);
		expect(validateSettingValue(row('list', ['A']), [' B ', 'C'])).toEqual(['B', 'C']);
		expect(validateSettingValue(row('list', [1, 5]), [2, 3])).toEqual([2, 3]);
		expect(validateSettingValue(row('map', {}), { a: 1 })).toEqual({ a: 1 });
	});
	it('rejects values of the wrong type', () => {
		for (const [type, def, value] of [
			['number', 1, '5'],
			['number', 1, Number.NaN],
			['number', 1, -1],
			['text', 'a', 5],
			['text', 'a', '   '],
			['boolean', true, 'true'],
			['list', ['A'], 'A'],
			['list', ['A'], ['A', '']],
			['list', ['A'], ['A', 'A']],
			['list', [1], ['x']],
			['map', {}, []],
			['map', {}, 'x'],
			['number', 1, null]
		] as const) {
			expect(() => validateSettingValue(row(type, def), value), `${type} ${JSON.stringify(value)}`).toThrow();
		}
	});
	it('accepts null only where the default is null', () => {
		expect(validateSettingValue(row('text', null), null)).toBeNull();
		expect(validateSettingValue(row('text', null), '')).toBeNull();
		expect(() => validateSettingValue(row('text', 'x'), null)).toThrow();
	});
});

describe('settings', () => {
	it('lists every setting in groups with Czech labels', async () => {
		const { groups } = await call(settings, 'settings.list');
		const total = (await db.one<{ n: number }>('select count(*)::int as n from settings'))!.n;
		expect(groups.reduce((sum: number, g: any) => sum + g.items.length, 0)).toBe(total);
		for (const g of groups) expect(g.label, g.key).toBeTruthy();
		expect(groups.find((g: any) => g.key === 'semaphore').label).toBe('Semafor');
		const limits = groups.find((g: any) => g.key === 'limits');
		expect(limits.label).toBe('Limity');
		expect(limits.items[0]).toMatchObject({ key: 'limits.superuser_max', valueType: 'number', isDefault: true });
	});

	it('updates a value and writes old and new value to the audit log', async () => {
		const result = await call(settings, 'settings.update', { key: 'limits.superuser_max', value: 6000 });
		expect(result).toMatchObject({ changed: true, value: 6000 });
		expect(await getSetting(db, 'limits.superuser_max')).toBe(6000);
		const row = await lastAudit();
		expect(row).toMatchObject({ action: 'settings.update', entity_id: 'limits.superuser_max', actor_name: 'Test' });
		expect(row!.details).toMatchObject({ old: 10000, new: 6000 });
	});

	it('does not write anything when the value is unchanged', async () => {
		const before = await auditCount();
		const result = await call(settings, 'settings.update', { key: 'limits.superuser_max', value: 6000 });
		expect(result.changed).toBe(false);
		// Same map with keys in another order is also "unchanged".
		const map = await call(settings, 'settings.update', {
			key: 'cohort.channel_rules',
			value: { target_nace: 'cold_call', PO: 'cold_call', FO: 'operatorka' }
		});
		expect(map.changed).toBe(false);
		expect(await auditCount()).toBe(before);
	});

	it('rejects a wrong type and an unknown key without writing', async () => {
		const before = await auditCount();
		await expect(call(settings, 'settings.update', { key: 'limits.superuser_max', value: 'hodně' })).rejects.toMatchObject({
			code: 'setting_invalid'
		});
		await expect(call(settings, 'settings.update', { key: 'no.such', value: 1 })).rejects.toMatchObject({
			code: 'setting_unknown',
			status: 404
		});
		expect(await getSetting(db, 'limits.superuser_max')).toBe(6000);
		expect(await auditCount()).toBe(before);
	});

	it('saves lists, maps, booleans and null', async () => {
		await call(settings, 'settings.update', { key: 'pools.free', value: ['VBCPOOL', 'TESTPOOL'] });
		expect(await getSetting(db, 'pools.free')).toEqual(['VBCPOOL', 'TESTPOOL']);
		await call(settings, 'settings.update', { key: 'raynet.sync_hours', value: { from: 7, to: 19 } });
		expect(await getSetting(db, 'raynet.sync_hours')).toEqual({ from: 7, to: 19 });
		await call(settings, 'settings.update', { key: 'semaphore.require_planned_activity', value: false });
		expect(await getSetting(db, 'semaphore.require_planned_activity')).toBe(false);
		await call(settings, 'settings.update', { key: 'ownership.rep_end_source', value: 'siebel' });
		expect(await getSetting(db, 'ownership.rep_end_source')).toBe('siebel');
		await call(settings, 'settings.update', { key: 'ownership.rep_end_source', value: null });
		expect(await getSetting(db, 'ownership.rep_end_source')).toBeNull();
	});

	it('resets to the default value with an audit row', async () => {
		const result = await call(settings, 'settings.reset', { key: 'limits.superuser_max' });
		expect(result).toMatchObject({ changed: true, value: 10000 });
		const row = await lastAudit();
		expect(row).toMatchObject({ action: 'settings.reset', entity_id: 'limits.superuser_max' });
		expect(row!.details).toMatchObject({ old: 6000, new: 10000 });
		expect((await call(settings, 'settings.reset', { key: 'limits.superuser_max' })).changed).toBe(false);
	});
});

describe('technical bounds of number settings', () => {
	it('refuses a page size or a batch size the lists and the import cannot work with', async () => {
		const row = (key: string) => ({ key, value_type: 'number' as const, default_value: 200 });
		for (const bad of [0, 0.5, 10.5]) {
			expect(() => validateSettingValue(row('list.max_page_size'), bad), String(bad)).toThrow();
			await expect(call(settings, 'settings.update', { key: 'list.max_page_size', value: bad }), String(bad)).rejects.toMatchObject({
				code: 'setting_invalid'
			});
		}
		await expect(call(settings, 'settings.update', { key: 'import.apply_chunk_rows', value: 0 })).rejects.toMatchObject({ code: 'setting_invalid' });
		expect(await getSetting(db, 'list.max_page_size')).toBe(200);
		expect(validateSettingValue(row('list.max_page_size'), 1)).toBe(1);
		// Keys without a rule keep taking fractions and zero (prices, tolerances).
		expect(validateSettingValue(row('checkmobi.price_per_lookup'), 0.002)).toBe(0.002);
		expect((await call(settings, 'settings.update', { key: 'review.overdue_activity_grace_days', value: 0 })).changed).toBe(false);
	});

	it('keeps the lists working when the stored page size is unusable', async () => {
		for (const broken of ['0', '0.5', '-3', '"mnoho"']) {
			await db.run(`update settings set value = $1::jsonb where key = 'list.max_page_size'`, [broken]);
			const list = await call(auditMethods, 'audit.list', { pageSize: 500 });
			expect(list.pageSize, broken).toBe(50);
			expect(list.rows.length, broken).toBeGreaterThan(0);
			expect((await call(auditMethods, 'audit.list', {})).pageSize, broken).toBe(50);
		}
		await db.run(`update settings set value = default_value where key = 'list.max_page_size'`);
		expect((await call(auditMethods, 'audit.list', { pageSize: 500 })).pageSize).toBe(200);
	});
});

describe('state transitions', () => {
	it('lists the table without problems by default', async () => {
		const { transitions, problems } = await call(settings, 'settings.transitions');
		expect(transitions.length).toBeGreaterThanOrEqual(40);
		expect(problems).toEqual({ unreachable: [], deadEnds: [] });
	});

	it('disabling a transition is saved, audited and takes effect in transition()', async () => {
		const ico = icoFromPrefix(9900101);
		await db.run('insert into companies (ico, name, subject_type) values ($1, $2, $3)', [ico, 'Testovací firma 00101 s.r.o.', 'PO']);
		await recordInitialState(ctx, ico, 'import', 'test');

		const result = await call(settings, 'settings.saveTransition', { fromState: 'v_poolu', toState: 've_filtru', enabled: false });
		expect(result.changed).toBe(true);
		// ve_filtru stays reachable through plovak, but u_robota_ocisteni etc. are still reachable too.
		const row = await lastAudit();
		expect(row).toMatchObject({ action: 'settings.transition_update', entity_id: 'v_poolu>ve_filtru' });
		expect(row!.details.old.enabled).toBe(true);
		expect(row!.details.new.enabled).toBe(false);
		await expect(transition(ctx, ico, 've_filtru', null)).rejects.toMatchObject({ code: 'transition_forbidden' });

		await call(settings, 'settings.saveTransition', { fromState: 'v_poolu', toState: 've_filtru', enabled: true });
		await expect(transition(ctx, ico, 've_filtru', null)).resolves.toMatchObject({ toState: 've_filtru' });
	});

	it('warns when a change leaves a state unreachable, but still saves it', async () => {
		// neni_v_siebelu is entered from three states; with all three closed nothing leads to it.
		const entries = ['v_poolu', 've_filtru', 'u_robota_ocisteni'];
		let result: any;
		for (const fromState of entries) {
			result = await call(settings, 'settings.saveTransition', { fromState, toState: 'neni_v_siebelu', enabled: false });
		}
		expect(result.changed).toBe(true);
		expect(result.warnings.unreachable).toContain('neni_v_siebelu');
		const { problems } = await call(settings, 'settings.transitions');
		expect(problems.unreachable).toContain('neni_v_siebelu');
		for (const fromState of entries) {
			await call(settings, 'settings.saveTransition', { fromState, toState: 'neni_v_siebelu', enabled: true });
		}
		expect((await call(settings, 'settings.transitions')).problems.unreachable).toEqual([]);
	});

	it('edits the note flag and label, adds a new pair, rejects unknown states', async () => {
		await call(settings, 'settings.saveTransition', {
			fromState: 'karantena',
			toState: 'v_poolu',
			noteRequired: true,
			label: 'Uplynulo datum karantény (test)'
		});
		const row = await db.one<{ note_required: boolean; label_cs: string }>(
			"select note_required, label_cs from state_transitions where from_state = 'karantena' and to_state = 'v_poolu'"
		);
		expect(row).toEqual({ note_required: true, label_cs: 'Uplynulo datum karantény (test)' });

		await expect(call(settings, 'settings.saveTransition', { fromState: 'zakaznik', toState: 'karantena' })).rejects.toMatchObject({
			code: 'transition_invalid'
		});
		const created = await call(settings, 'settings.saveTransition', {
			fromState: 'zakaznik',
			toState: 'karantena',
			label: 'Testovací přechod'
		});
		expect(created).toMatchObject({ changed: true, created: true });
		expect((await lastAudit())!.action).toBe('settings.transition_create');

		await expect(call(settings, 'settings.saveTransition', { fromState: 'nic', toState: 'v_poolu', enabled: false })).rejects.toMatchObject({
			code: 'transition_invalid'
		});
		await expect(
			call(settings, 'settings.saveTransition', { fromState: 'v_poolu', toState: 've_filtru', enabled: 'ne' })
		).rejects.toMatchObject({ code: 'transition_invalid' });
	});

	it('graphProblems finds dead ends', () => {
		const problems = graphProblems(
			[
				{ from_state: 'a', to_state: 'b', enabled: true },
				{ from_state: 'b', to_state: 'c', enabled: false },
				{ from_state: 'b', to_state: 'b', enabled: true }
			],
			['v_poolu', 'a', 'b', 'c']
		);
		expect(problems.unreachable).toEqual(['a', 'b', 'c']);
		expect(problems.deadEnds).toEqual(['v_poolu', 'b', 'c']);
	});
});

describe('audit', () => {
	it('pages newest first and caps the page size by the setting', async () => {
		const total = await auditCount();
		const first = await call(auditMethods, 'audit.list', { page: 1, pageSize: 3 });
		expect(first).toMatchObject({ total, page: 1, pageSize: 3 });
		expect(first.rows).toHaveLength(3);
		expect(first.rows[0].id).toBeGreaterThan(first.rows[1].id);
		const second = await call(auditMethods, 'audit.list', { page: 2, pageSize: 3 });
		expect(second.rows[0].id).toBeLessThan(first.rows[2].id);
		const capped = await call(auditMethods, 'audit.list', { pageSize: 100000 });
		expect(capped.pageSize).toBe(await getSetting(db, 'list.max_page_size'));
		const beyond = await call(auditMethods, 'audit.list', { page: 9999, pageSize: 3 });
		expect(beyond.page).toBe(Math.ceil(total / 3));
	});

	it('filters by action, area and text', async () => {
		const resets = await call(auditMethods, 'audit.list', { action: 'settings.reset' });
		expect(resets.total).toBe(1);
		const area = await call(auditMethods, 'audit.list', { area: 'settings' });
		expect(area.total).toBeGreaterThan(resets.total);
		expect(area.rows.every((r: any) => r.action.startsWith('settings.'))).toBe(true);
		const text = await call(auditMethods, 'audit.list', { text: 'superuser_max' });
		expect(text.total).toBe(2);
		// % and _ are searched literally
		expect((await call(auditMethods, 'audit.list', { text: '%' })).total).toBe(0);
		const actions = await call(auditMethods, 'audit.actions');
		expect(actions.map((a: any) => a.action)).toContain('settings.update');
	});

	it('filters by date range in Czech calendar days', async () => {
		const before = clock;
		// 23:30 UTC on 1 Dec is already 2 Dec in Prague.
		clock = new Date('2026-12-01T23:30:00Z');
		await call(settings, 'settings.update', { key: 'limits.warning_pct', value: 85 });
		clock = before;
		expect((await call(auditMethods, 'audit.list', { from: '2026-12-02', to: '2026-12-02' })).total).toBe(1);
		expect((await call(auditMethods, 'audit.list', { from: '2026-12-01', to: '2026-12-01' })).total).toBe(0);
		expect((await call(auditMethods, 'audit.list', { to: '2026-11-19' })).total).toBe((await auditCount()) - 1);
		await expect(call(auditMethods, 'audit.list', { from: '2. 12. 2026' })).rejects.toMatchObject({ code: 'date_invalid' });
		await expect(call(auditMethods, 'audit.list', { from: '2026-12-02', to: '2026-12-01' })).rejects.toMatchObject({
			code: 'date_invalid'
		});
	});

	it('exposes no write method and the table refuses changes', async () => {
		expect(Object.keys(auditMethods).sort()).toEqual(['audit.actions', 'audit.list']);
		await expect(db.run('delete from audit_log')).rejects.toThrow();
	});
});

describe('dashboard', () => {
	it('counts by state, holder, subject type and region and reads the superuser limit from settings', async () => {
		for (let n = 201; n <= 204; n++) {
			const ico = icoFromPrefix(9900000 + n);
			await db.run(
				`insert into companies (ico, name, subject_type, region_code, region_name, holder_type, holder_login, state)
				 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
				[
					ico,
					`Testovací firma 00${n} s.r.o.`,
					n === 204 ? 'FO' : 'PO',
					n === 204 ? null : '19',
					n === 204 ? null : 'Hlavní město Praha',
					n <= 203 ? 'superuser' : 'pool',
					n <= 203 ? 'TEST_SUPERUSER' : 'VBCPOOL',
					n <= 203 ? 'superuser' : 'v_poolu'
				]
			);
		}
		const data = await call(dashboard, 'dashboard.overview');
		expect(data.total).toBe(5);
		expect(data.byState.find((r: any) => r.key === 'superuser').count).toBe(3);
		expect(data.byHolder.find((r: any) => r.key === 'superuser').count).toBe(3);
		expect(data.bySubjectType.find((r: any) => r.key === 'FO').count).toBe(1);
		expect(data.byRegion[0]).toEqual({ code: '19', name: 'Hlavní město Praha', count: 3 });
		expect(data.superuser).toMatchObject({ count: 3, limit: 10000, warningPct: 85, level: 'ok' });
		expect(data.lastImports === null || data.lastImports.length === 0).toBe(true);
		expect(data.lastAudit.length).toBeGreaterThan(0);
		expect(data.lastAudit.length).toBeLessThanOrEqual(10);
	});

	it('raises the warning from the configured percentage and reports a full superuser', async () => {
		await call(settings, 'settings.update', { key: 'limits.superuser_max', value: 4 });
		await call(settings, 'settings.update', { key: 'limits.warning_pct', value: 75 });
		expect((await call(dashboard, 'dashboard.overview')).superuser).toMatchObject({ pct: 75, level: 'warning' });
		await call(settings, 'settings.update', { key: 'limits.warning_pct', value: 80 });
		expect((await call(dashboard, 'dashboard.overview')).superuser.level).toBe('ok');
		await call(settings, 'settings.update', { key: 'limits.superuser_max', value: 3 });
		expect((await call(dashboard, 'dashboard.overview')).superuser.level).toBe('full');
		await call(settings, 'settings.update', { key: 'limits.superuser_max', value: 0 });
		expect((await call(dashboard, 'dashboard.overview')).superuser).toMatchObject({ pct: null, level: 'unknown' });
	});

	it('shows last imports when an imports table exists', async () => {
		await db.exec(
			// Same column names as the import area's table; created here only when that migration is absent.
			`create table if not exists imports (id bigint generated always as identity primary key,
				created_at timestamptz not null default now(), filename text, kind text, status text, received_rows int);
			 insert into imports (filename, kind, status, received_rows) values ('testovaci-kmen.xlsx', 'master_import', 'applied', 42);`
		);
		const data = await call(dashboard, 'dashboard.overview');
		expect(data.lastImports).toHaveLength(1);
		expect(data.lastImports[0]).toMatchObject({ name: 'testovaci-kmen.xlsx', kind: 'master_import', status: 'applied', rows: 42 });
	});
});
