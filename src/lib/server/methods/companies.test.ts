// companies.* methods against an in-memory PGlite database with the real migrations.
// Never touches ./data.nosync. All data is fictional (IČO 99xxxxxx, phones +420 000 …).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import type { Db } from '../db.ts';
import { systemCtx } from '../context.ts';
import type { Ctx } from '../context.ts';
import { recordInitialState } from '../companies-core.ts';
import { icoFromPrefix } from '../../ico.ts';
import { methods, NONE } from './companies.ts';

let db: Db;
let ctx: Ctx;
const fixedNow = new Date(2026, 10, 19, 10, 0, 0);
const TODAY = '2026-11-19';
const COUNT = 60;
const ico = (n: number) => icoFromPrefix(9900000 + n);
const call = (name: string, args: unknown = {}) => methods[name](ctx, args) as Promise<any>;

async function expectError(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ name: 'AppError', code });
}

beforeAll(async () => {
	db = await openDb({ dir: 'memory' });
	ctx = systemCtx(db, { now: () => fixedNow, actor: { id: null, name: 'Test' } });
	await db.run(
		`insert into sales_reps (id, name, siebel_login, rep_type, active) values
			(1, 'Jan Testovací 00001', 'TEST_OZ01', 'jezdi', true),
			(2, 'Jana Testovací 00002', 'TEST_OZ02', 'online', true),
			(3, 'Josef Testovací 00003', 'TEST_OZ03', 'online', false),
			(4, 'Jitka Testovací 00004', null, 'online', true),
			(5, 'Jiří Testovací 00005', null, 'online', true)`
	);
	await db.run(`insert into cohorts (id, code, status, day_zero_on) values (1, 'TEST-2026-10-A', 'on_superuser', '2026-10-20')`);
	for (let n = 1; n <= COUNT; n++) {
		// 1–20 pool (Praha, FO), 21–40 superuser (Brno, PO, cohort 1), 41–50 login OZ 1, 51–60 quarantine.
		const group = n <= 20 ? 'pool' : n <= 40 ? 'super' : n <= 50 ? 'rep' : 'quarantine';
		const row = {
			pool: { state: 'v_poolu', holder_type: 'neznamo', holder_login: null, type: 'FO', region: '19', district: '3100' },
			super: { state: 'superuser', holder_type: 'superuser', holder_login: 'TEST_SUPERUSER', type: 'PO', region: '116', district: '3702' },
			rep: { state: 'login_oz', holder_type: 'login_oz', holder_login: 'TEST_OZ01', type: 'PO', region: '116', district: '3702' },
			quarantine: { state: 'karantena', holder_type: 'pool', holder_login: 'VBCPOOL', type: null, region: null, district: null }
		}[group];
		const padded = String(n).padStart(5, '0');
		await db.run(
			`insert into companies (ico, name, subject_type, region_code, region_name, district_code, state, holder_type,
				holder_login, sales_rep_id, cohort_id, channel, ownership_ends_on, quarantine_until, rounds_count, ico_valid)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
			[
				ico(n),
				group === 'pool' ? `Jan Testovací ${padded}` : `Testovací firma ${padded} s.r.o.`,
				row.type,
				row.region,
				row.region === '19' ? 'Hlavní město Praha' : row.region ? 'Jihomoravský kraj' : null,
				row.district,
				row.state,
				row.holder_type,
				row.holder_login,
				group === 'rep' ? 1 : null,
				group === 'super' || group === 'rep' ? 1 : null,
				group === 'rep' ? 'cold_call' : group === 'super' ? 'operatorka' : null,
				group === 'super' ? `2026-12-${String(n - 20).padStart(2, '0')}` : null,
				group === 'quarantine' ? '2027-06-30' : null,
				group === 'quarantine' ? 2 : group === 'pool' ? 0 : 1,
				group === 'pool' ? null : true
			]
		);
		await recordInitialState(ctx, ico(n), 'import', 'test');
		if (n % 2 === 1) {
			await db.run(`insert into company_phones (ico, phone, is_primary, operator) values ($1, $2, true, $3)`, [
				ico(n),
				`+420000${String(100000 + n)}`,
				n % 4 === 1 ? 'O2' : null
			]);
		}
		if (group === 'rep') {
			await db.run(
				`insert into company_assignments (ico, sales_rep_id, channel, source, round_no, assigned_from)
				 values ($1, 1, 'cold_call', 'cold_call_allocation', 1, '2026-10-01')`,
				[ico(n)]
			);
		}
	}
});

afterAll(async () => {
	await db.close();
});

describe('companies.list', () => {
	it('pages on the server and reports the total', async () => {
		const first = await call('companies.list', { pageSize: 25 });
		expect(first.total).toBe(COUNT);
		expect(first.rows).toHaveLength(25);
		expect(first.rows[0].ico).toBe(ico(1));
		expect(first.rows[0]).not.toHaveProperty('name_search');
		const third = await call('companies.list', { pageSize: 25, page: 3 });
		expect(third.rows).toHaveLength(10);
		expect(third.page).toBe(3);
		// A page past the end falls back to the last page instead of an empty table.
		expect((await call('companies.list', { pageSize: 25, page: 99 })).page).toBe(3);
	});

	it('caps the page size by the list.max_page_size setting', async () => {
		await db.run(`update settings set value = '30'::jsonb where key = 'list.max_page_size'`);
		const result = await call('companies.list', { pageSize: 5000 });
		expect(result.pageSize).toBe(30);
		expect(result.rows).toHaveLength(30);
		await db.run(`update settings set value = default_value where key = 'list.max_page_size'`);
	});

	it('sorts by whitelisted columns only', async () => {
		const desc = await call('companies.list', { sort: { key: 'ico', dir: 'desc' }, pageSize: 5 });
		expect(desc.rows[0].ico).toBe(ico(COUNT));
		const byEnd = await call('companies.list', { sort: { key: 'ownership_ends_on', dir: 'desc' }, pageSize: 5 });
		expect(byEnd.rows[0].ownership_ends_on).toBe('2026-12-20');
		const injected = await call('companies.list', { sort: { key: 'ico; drop table companies', dir: 'asc' }, pageSize: 5 });
		expect(injected.sort).toEqual({ key: 'ico', dir: 'asc' });
		// Names every object inherits are not sort keys either.
		for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
			const inherited = await call('companies.list', { sort: { key, dir: 'desc' }, pageSize: 5 });
			expect(inherited.sort, key).toEqual({ key: 'ico', dir: 'desc' });
			expect(inherited.rows, key).toHaveLength(5);
		}
	});

	it('searches by IČO prefix, name without diacritics and phone', async () => {
		const byIco = await call('companies.list', { search: ico(7) });
		expect(byIco.rows.map((r: any) => r.ico)).toEqual([ico(7)]);
		const byPrefix = await call('companies.list', { search: '99000' });
		expect(byPrefix.total).toBe(COUNT);
		const byName = await call('companies.list', { search: 'testovaci FIRMA 00021' });
		expect(byName.rows.map((r: any) => r.ico)).toEqual([ico(21)]);
		const byPhone = await call('companies.list', { search: '+420 000 100 007' });
		expect(byPhone.rows.map((r: any) => r.ico)).toEqual([ico(7)]);
		expect(byPhone.rows[0].primary_phone).toBe('+420000100007');
		// % and _ are searched literally.
		expect((await call('companies.list', { search: '%' })).total).toBe(0);
	});

	it('finds an IČO typed without its leading zeros', async () => {
		const withZeros = icoFromPrefix('0099001');
		expect(withZeros.startsWith('00')).toBe(true);
		await db.run(`insert into companies (ico, name) values ($1, 'Testovací firma 00990 s.r.o.')`, [withZeros]);
		for (const typed of [withZeros, withZeros.slice(1), withZeros.slice(2)]) {
			const found = await call('companies.list', { search: typed });
			expect(found.rows.map((r: any) => r.ico), typed).toContain(withZeros);
		}
		// As the detail does: the same short number opens the company.
		expect((await call('companies.get', { ico: withZeros.slice(2) })).company.ico).toBe(withZeros);
		// The prefix search of the other companies is not disturbed.
		expect((await call('companies.list', { search: '99000' })).total).toBe(COUNT);
		// No history row was written for it, so the extra company can go again.
		await db.run('delete from companies where ico = $1', [withZeros]);
	});

	it('shows the operators of all numbers, as the operator filter matches them', async () => {
		await db.run(`insert into company_phones (ico, phone, is_primary, operator) values ($1, '+420000200001', false, 'VF')`, [ico(1)]);
		const row = (await call('companies.list', { search: ico(1) })).rows[0];
		expect(row.primary_operator).toBe('O2');
		expect(row.operators).toEqual(['O2', 'VF']);
		expect(row.phone_count).toBe(2);
		const vodafone = await call('companies.list', { filter: { operator: ['VF'] } });
		expect(vodafone.rows.map((r: any) => r.ico)).toEqual([ico(1)]);
		expect(vodafone.rows[0].operators).toContain('VF');
		// A number without a verified operator is listed with the "none" token; no phone, no entry.
		expect((await call('companies.list', { search: ico(3) })).rows[0].operators).toEqual([NONE]);
		expect((await call('companies.list', { search: ico(2) })).rows[0].operators).toEqual([]);
		await db.run(`delete from company_phones where phone = '+420000200001'`);
	});

	it('filters by the verification dates in Czech calendar days', async () => {
		// 00:30 Czech time on 20 November is still 19 November in UTC.
		await db.run(`update companies set ico_verified_at = '2026-11-20 00:30:00+01' where ico = $1`, [ico(5)]);
		await db.run(`update companies set ico_verified_at = '2026-11-18 12:00:00+01' where ico = $1`, [ico(6)]);
		await db.run(`update company_phones set operator_verified_at = '2026-11-20 00:30:00+01' where ico = $1`, [ico(5)]);
		await db.run(`update company_phones set operator_verified_at = '2026-10-01 12:00:00+02' where ico = $1`, [ico(7)]);
		const icos = async (filter: Record<string, unknown>) => (await call('companies.list', { filter })).rows.map((r: any) => r.ico);
		expect(await icos({ icoVerifiedFrom: '2026-11-20', icoVerifiedTo: '2026-11-20' })).toEqual([ico(5)]);
		expect(await icos({ icoVerifiedTo: '2026-11-19' })).toEqual([ico(6)]);
		expect(await icos({ icoVerifiedFrom: '2026-11-18' })).toEqual([ico(5), ico(6)]);
		expect(await icos({ operatorVerifiedFrom: '2026-11-20' })).toEqual([ico(5)]);
		expect(await icos({ operatorVerifiedTo: '2026-11-19' })).toEqual([ico(7)]);
		// Operator and verification date are met by the same number.
		expect(await icos({ operator: ['O2'], operatorVerifiedFrom: '2026-11-20' })).toEqual([ico(5)]);
		expect(await icos({ operator: [NONE], operatorVerifiedFrom: '2026-11-20' })).toEqual([]);
		await expectError(call('companies.list', { filter: { icoVerifiedFrom: '20. 11. 2026' } }), 'filter_invalid');
	});

	it('filters by every ownership field', async () => {
		const total = async (filter: Record<string, unknown>) => (await call('companies.list', { filter })).total;
		expect(await total({ state: ['superuser'] })).toBe(20);
		expect(await total({ state: ['superuser', 'login_oz'] })).toBe(30);
		expect(await total({ holderType: ['pool'] })).toBe(10);
		expect(await total({ holderLogin: 'TEST_OZ01' })).toBe(10);
		expect(await total({ subjectType: ['FO'] })).toBe(20);
		expect(await total({ subjectType: [NONE] })).toBe(10);
		expect(await total({ regionCode: ['19'] })).toBe(20);
		expect(await total({ districtCode: ['3702'] })).toBe(30);
		expect(await total({ cohortId: [1] })).toBe(30);
		expect(await total({ cohortId: [NONE] })).toBe(30);
		expect(await total({ channel: ['cold_call'] })).toBe(10);
		expect(await total({ salesRepId: [1] })).toBe(10);
		expect(await total({ salesRepId: [NONE] })).toBe(50);
		expect(await total({ operator: ['O2'] })).toBe(15);
		expect(await total({ operator: [NONE] })).toBe(15);
		expect(await total({ operator: ['VF'] })).toBe(0);
		expect(await total({ ownershipEndsFrom: '2026-12-01', ownershipEndsTo: '2026-12-05' })).toBe(5);
		expect(await total({ quarantineUntilFrom: '2027-01-01' })).toBe(10);
		expect(await total({ returnOnFrom: '2020-01-01' })).toBe(0);
		expect(await total({ roundsMin: 2 })).toBe(10);
		expect(await total({ roundsMin: 1, roundsMax: 1 })).toBe(30);
		expect(await total({ icoValid: 'unknown' })).toBe(20);
		expect(await total({ state: ['superuser'], regionCode: ['19'] })).toBe(0);
	});

	it('refuses invalid filter values', async () => {
		await expectError(call('companies.list', { filter: { state: ['nesmysl'] } }), 'filter_invalid');
		await expectError(call('companies.list', { filter: { ownershipEndsFrom: '31. 12. 2026' } }), 'filter_invalid');
		await expectError(call('companies.list', { filter: { cohortId: ['1; drop'] } }), 'filter_invalid');
		await expectError(call('companies.list', { filter: { roundsMin: -1 } }), 'filter_invalid');
	});
});

describe('companies.filterOptions', () => {
	it('returns reps, cohorts, holder logins and pools from settings', async () => {
		const options = await call('companies.filterOptions');
		expect(options.reps).toHaveLength(5);
		expect(options.cohorts[0].code).toBe('TEST-2026-10-A');
		expect(options.holderLogins).toContainEqual({ holder_type: 'superuser', holder_login: 'TEST_SUPERUSER', count: 20 });
		expect(options.pools.free).toEqual(['VBCPOOL', 'SADMIN', 'OBSPOOL']);
		expect(options.maxPageSize).toBe(200);
	});
});

describe('companies.get', () => {
	it('returns the company with phones, history, assignments and allowed transitions', async () => {
		const detail = await call('companies.get', { ico: ico(41) });
		expect(detail.company.state).toBe('login_oz');
		expect(detail.company.sales_rep_name).toBe('Jan Testovací 00001');
		expect(detail.company.cohort_code).toBe('TEST-2026-10-A');
		expect(detail.phones).toHaveLength(1);
		expect(detail.history).toHaveLength(1);
		expect(detail.assignments).toHaveLength(1);
		expect(detail.assignments[0].assigned_to).toBeNull();
		const targets = detail.transitions.map((t: any) => t.to_state);
		expect(targets).toContain('odvlastneno');
		expect(targets).not.toContain('v_poolu');
	});

	it('accepts an IČO without leading zeros and reports a missing one', async () => {
		await expectError(call('companies.get', { ico: icoFromPrefix(9912345) }), 'company_not_found');
		await expectError(call('companies.get', { ico: '123' }), 'ico_invalid');
	});

	it('does not offer transitions switched off in state_transitions', async () => {
		await db.run(`update state_transitions set manual_allowed = false where from_state = 'login_oz' and to_state = 'zakaznik'`);
		const detail = await call('companies.get', { ico: ico(41) });
		expect(detail.transitions.map((t: any) => t.to_state)).not.toContain('zakaznik');
		await expectError(
			call('companies.transition', { ico: ico(41), toState: 'zakaznik', reason: 'zkouška zakázaného přechodu' }),
			'transition_not_manual'
		);
		await db.run(`update state_transitions set manual_allowed = true where from_state = 'login_oz' and to_state = 'zakaznik'`);
	});
});

describe('companies.transition', () => {
	const company = (n: number) =>
		db.one<Record<string, any>>(
			'select state, holder_type, holder_login, sales_rep_id, owned_from, ownership_ends_on from companies where ico = $1',
			[ico(n)]
		);
	const assignments = (n: number) =>
		db.query<Record<string, any>>(
			'select sales_rep_id, assigned_from, assigned_to, end_reason, end_note from company_assignments where ico = $1 order by id',
			[ico(n)]
		);

	it('takes the need for a reason from state_transitions', async () => {
		await db.run(`update state_transitions set note_required = true where from_state = 'superuser' and to_state = 'zakaznik'`);
		await expectError(call('companies.transition', { ico: ico(31), toState: 'zakaznik', reason: '  ' }), 'note_required');
		await expectError(call('companies.transition', { ico: ico(31), toState: 'zakaznik' }), 'note_required');
		await expectError(call('companies.transition', { ico: ico(31), toState: 'zakaznik', reason: 'x'.repeat(1001) }), 'reason_too_long');
		await db.run(`update state_transitions set note_required = false where from_state = 'superuser' and to_state = 'zakaznik'`);
		// Not required by the table: the change passes without a reason and the history note stays empty.
		await call('companies.transition', { ico: ico(31), toState: 'zakaznik' });
		const detail = await call('companies.get', { ico: ico(31) });
		expect(detail.history[0]).toMatchObject({ to_state: 'zakaznik', source: 'manual', note: null });
	});

	it('refuses a transition outside the allowed paths and writes nothing', async () => {
		await expectError(call('companies.transition', { ico: ico(1), toState: 'zakaznik', reason: 'zkouška' }), 'transition_forbidden');
		// v_poolu → superuser exists for the import of the robot result only, never by hand.
		await expectError(call('companies.transition', { ico: ico(1), toState: 'superuser', reason: 'zkouška' }), 'transition_not_manual');
		const history = await db.one<{ n: number }>('select count(*)::int as n from company_state_history where ico = $1', [ico(1)]);
		expect(history!.n).toBe(1);
	});

	it('refuses when the state changed in the meantime', async () => {
		await expectError(
			call('companies.transition', { ico: ico(21), toState: 'vraceno', reason: 'zkouška', expectedFromState: 'v_poolu' }),
			'state_changed'
		);
	});

	it('moves superuser → login OZ with a rep, sets the holder and opens an assignment', async () => {
		await expectError(call('companies.transition', { ico: ico(22), toState: 'login_oz', reason: 'převod' }), 'rep_required');
		await expectError(call('companies.transition', { ico: ico(22), toState: 'login_oz', reason: 'převod', salesRepId: 3 }), 'rep_inactive');
		expect((await company(22))!.ownership_ends_on).toBe('2026-12-02');
		const result = await call('companies.transition', {
			ico: ico(22),
			toState: 'login_oz',
			reason: 'Ruční převod po dohodě',
			salesRepId: 2,
			expectedFromState: 'superuser'
		});
		expect(result).toMatchObject({ fromState: 'superuser', toState: 'login_oz', toHolder: 'login_oz:TEST_OZ02' });
		const detail = await call('companies.get', { ico: ico(22) });
		// The end of ownership on the superuser does not become the rep's end of ownership.
		expect(detail.company).toMatchObject({
			state: 'login_oz',
			holder_login: 'TEST_OZ02',
			sales_rep_id: 2,
			owned_from: TODAY,
			ownership_ends_on: null
		});
		expect(detail.history[0]).toMatchObject({ to_state: 'login_oz', source: 'manual', reason_code: 'manual', note: 'Ruční převod po dohodě', actor_name: 'Test' });
		expect(detail.assignments).toHaveLength(1);
		expect(detail.assignments[0]).toMatchObject({ sales_rep_id: 2, source: 'manual', assigned_from: TODAY, assigned_to: null });
		const auditRow = await db.one<{ n: number }>(
			`select count(*)::int as n from audit_log where action = 'company.state_change' and entity_id = $1`,
			[ico(22)]
		);
		expect(auditRow!.n).toBe(1);
	});

	it('rotates to another rep and closes the previous assignment with the reason', async () => {
		await expectError(call('companies.transition', { ico: ico(42), toState: 'login_oz', reason: 'rotace', salesRepId: 1 }), 'rep_unchanged');
		await call('companies.transition', { ico: ico(42), toState: 'login_oz', reason: 'rotace na jiného OZ', salesRepId: 2 });
		const detail = await call('companies.get', { ico: ico(42) });
		expect(detail.company.sales_rep_id).toBe(2);
		expect(detail.assignments).toHaveLength(2);
		expect(detail.assignments.find((a: any) => a.sales_rep_id === 1)).toMatchObject({
			assigned_to: TODAY,
			end_reason: 'manual',
			end_note: 'rotace na jiného OZ'
		});
		expect(detail.assignments.find((a: any) => a.sales_rep_id === 2).assigned_to).toBeNull();
	});

	it('tells two reps without a Siebel login apart', async () => {
		await call('companies.transition', { ico: ico(46), toState: 'login_oz', reason: 'rotace na OZ bez loginu', salesRepId: 4 });
		expect(await company(46)).toMatchObject({ holder_type: 'login_oz', holder_login: null, sales_rep_id: 4 });
		// Rep 5 has no login either; it is still another rep.
		await call('companies.transition', { ico: ico(46), toState: 'login_oz', reason: 'další rotace', salesRepId: 5 });
		expect((await company(46))!.sales_rep_id).toBe(5);
		expect(await assignments(46)).toMatchObject([
			{ sales_rep_id: 1, assigned_to: TODAY },
			{ sales_rep_id: 4, assigned_to: TODAY, end_note: 'další rotace' },
			{ sales_rep_id: 5, assigned_to: null }
		]);
		await expectError(call('companies.transition', { ico: ico(46), toState: 'login_oz', reason: 'znovu', salesRepId: 5 }), 'rep_unchanged');
	});

	it('releases from a rep login only to a pool, clears the rep and closes the assignment', async () => {
		await expectError(
			call('companies.transition', { ico: ico(43), toState: 'odvlastneno', reason: 'uvolnění', holderType: 'login_oz' }),
			'holder_invalid'
		);
		// "Odvlastněno" means a pool (setting ownership.manual_holder_by_state): no default, no other holder.
		await expectError(call('companies.transition', { ico: ico(43), toState: 'odvlastneno', reason: 'uvolnění' }), 'holder_login_required');
		await expectError(
			call('companies.transition', { ico: ico(43), toState: 'odvlastneno', reason: 'uvolnění', holderType: 'superuser' }),
			'holder_invalid'
		);
		await expectError(
			call('companies.transition', { ico: ico(43), toState: 'odvlastneno', reason: 'uvolnění', holderType: 'pool', holderLogin: 'NEZNAMY' }),
			'holder_invalid'
		);
		expect(await company(43)).toMatchObject({ state: 'login_oz', sales_rep_id: 1 });

		const result = await call('companies.transition', {
			ico: ico(43),
			toState: 'odvlastneno',
			reason: 'uvolnění z loginu',
			holderLogin: 'VBCPOOL'
		});
		expect(result.toHolder).toBe('pool:VBCPOOL');
		expect(await company(43)).toMatchObject({
			state: 'odvlastneno',
			holder_type: 'pool',
			holder_login: 'VBCPOOL',
			sales_rep_id: null,
			owned_from: null,
			ownership_ends_on: null
		});
		const detail = await call('companies.get', { ico: ico(43) });
		expect(detail.company.sales_rep_name).toBeNull();
		expect(detail.assignments[0]).toMatchObject({ assigned_to: TODAY, end_reason: 'manual', end_note: 'uvolnění z loginu' });
		expect(detail.transitions.map((t: any) => t.to_state).sort()).toEqual(['karantena', 'neaktivni_ico', 'plovak', 'v_poolu']);
		// The released IČO is no longer listed under its former rep.
		const ofRep = await call('companies.list', { filter: { salesRepId: [1] }, pageSize: 200 });
		expect(ofRep.rows.map((r: any) => r.ico)).not.toContain(ico(43));
	});

	it('sets the superuser holder and the ownership dates when an IČO lands on the superuser', async () => {
		await db.run(
			`update companies set state = 'u_robota_ocisteni', holder_type = 'jiny_partner', holder_login = 'Testovací partner 01' where ico = $1`,
			[ico(2)]
		);
		await expectError(
			call('companies.transition', { ico: ico(2), toState: 'superuser', reason: 'přistálo', holderType: 'pool', holderLogin: 'VBCPOOL' }),
			'holder_invalid'
		);
		const result = await call('companies.transition', { ico: ico(2), toState: 'superuser', reason: 'přistálo' });
		expect(result).toMatchObject({ fromHolder: 'jiny_partner:Testovací partner 01', toHolder: 'superuser' });
		// 30 days: ownership.superuser_hold_days.
		expect(await company(2)).toMatchObject({
			state: 'superuser',
			holder_type: 'superuser',
			holder_login: null,
			sales_rep_id: null,
			owned_from: TODAY,
			ownership_ends_on: '2026-12-19'
		});
		await db.run(`update settings set value = '45'::jsonb where key = 'ownership.superuser_hold_days'`);
		await db.run(`update companies set state = 'u_robota_ocisteni', holder_type = 'neznamo', holder_login = null where ico = $1`, [ico(3)]);
		await call('companies.transition', { ico: ico(3), toState: 'superuser', reason: 'přistálo', holderLogin: 'TEST_SUPERUSER' });
		expect(await company(3)).toMatchObject({ holder_type: 'superuser', holder_login: 'TEST_SUPERUSER', ownership_ends_on: '2027-01-03' });
		await db.run(`update settings set value = default_value where key = 'ownership.superuser_hold_days'`);
	});

	it('reads the holder of a target state from the setting', async () => {
		expect((await call('companies.filterOptions')).holderByState).toEqual({
			superuser: 'superuser',
			vraceno: 'pool',
			odvlastneno: 'pool',
			ztraceno: 'jiny_partner'
		});
		// Lost to another partner: the holder follows, the rep and the dates go.
		await call('companies.transition', { ico: ico(47), toState: 'ztraceno', reason: 'kontrola Siebelu', holderLogin: 'Testovací partner 02' });
		expect(await company(47)).toMatchObject({ state: 'ztraceno', holder_type: 'jiny_partner', holder_login: 'Testovací partner 02', sales_rep_id: null, owned_from: null });
		expect((await assignments(47))[0]).toMatchObject({ assigned_to: TODAY, end_note: 'kontrola Siebelu' });

		// Without the rule for "vraceno" the holder is left to the user again.
		await db.run(
			`update settings set value = '{"superuser": "superuser", "login_oz": "pool", "odvlastneno": "login_oz", "nesmysl": "pool"}'::jsonb
			 where key = 'ownership.manual_holder_by_state'`
		);
		expect((await call('companies.filterOptions')).holderByState).toEqual({ superuser: 'superuser' });
		await call('companies.transition', { ico: ico(23), toState: 'vraceno', reason: 'vráceno se statusy' });
		expect(await company(23)).toMatchObject({ state: 'vraceno', holder_type: 'superuser', holder_login: 'TEST_SUPERUSER' });
		await db.run(`update settings set value = default_value where key = 'ownership.manual_holder_by_state'`);
		await expectError(call('companies.transition', { ico: ico(24), toState: 'vraceno', reason: 'vráceno se statusy' }), 'holder_login_required');
	});

	it('keeps the holder, the rep and the assignment where the state implies no holder', async () => {
		await call('companies.transition', { ico: ico(44), toState: 'zakaznik', reason: 'deal uzavřen' });
		const detail = await call('companies.get', { ico: ico(44) });
		expect(detail.company).toMatchObject({ state: 'zakaznik', holder_type: 'login_oz', holder_login: 'TEST_OZ01', sales_rep_id: 1 });
		expect(detail.assignments[0].assigned_to).toBeNull();
	});
});

describe('companies.overrideDates', () => {
	it('needs a note and at least one date', async () => {
		await expectError(call('companies.overrideDates', { ico: ico(51), quarantineUntil: '2027-01-31', note: ' ' }), 'note_required');
		await expectError(call('companies.overrideDates', { ico: ico(51), note: 'poznámka' }), 'nothing_to_change');
		await expectError(call('companies.overrideDates', { ico: ico(51), returnOn: '2027-02-30', note: 'poznámka' }), 'date_invalid');
	});

	it('writes the date, the flag, the note and an audit row with old and new value', async () => {
		const updated = await call('companies.overrideDates', { ico: ico(51), quarantineUntil: '2027-01-31', note: 'Zkrácení po dohodě' });
		expect(updated).toMatchObject({
			quarantine_until: '2027-01-31',
			quarantine_overridden: true,
			quarantine_override_note: 'Zkrácení po dohodě',
			return_on: null,
			return_on_overridden: false
		});
		await call('companies.overrideDates', { ico: ico(51), quarantineUntil: null, returnOn: '2027-03-01', note: 'Druhé přepsání' });
		const detail = await call('companies.get', { ico: ico(51) });
		expect(detail.company).toMatchObject({
			quarantine_until: null,
			quarantine_overridden: true,
			return_on: '2027-03-01',
			return_on_overridden: true,
			return_on_override_note: 'Druhé přepsání'
		});
		// Both overrides stay readable in the audit log.
		expect(detail.overrides).toHaveLength(2);
		expect(detail.overrides[1].details).toMatchObject({
			note: 'Zkrácení po dohodě',
			quarantine_until: { old: '2027-06-30', new: '2027-01-31' }
		});
		expect(detail.overrides[0].details.quarantine_until).toEqual({ old: '2027-01-31', new: null });
	});
});

describe('companies.export', () => {
	/** Runs both steps of the export like the browser does and returns all rows. */
	async function exportAll(args: Record<string, unknown> = {}) {
		const start = await call('companies.exportStart', args);
		const rows: Record<string, any>[] = [];
		let after = '';
		for (;;) {
			const page = await call('companies.exportRows', { ...args, exportId: start.exportId, after });
			rows.push(...page.rows);
			after = page.last;
			if (page.done) break;
		}
		return { start, rows };
	}

	it('exports the filtered rows and writes the row count to the audit log', async () => {
		const { start, rows } = await exportAll({ filter: { state: ['superuser'] } });
		expect(start.filename).toBe(`ico-export-${TODAY}.xlsx`);
		expect(start.total).toBe(19); // superuser rows (three left the superuser above, two arrived)
		expect(start.columns[0]).toMatchObject({ header: 'IČO', key: 'ico' });
		expect(rows).toHaveLength(19);
		expect(rows[0].ico).toBe(ico(2));
		expect(rows[0].state_label).toBe('Superuser');
		expect(rows[0].ownership_ends_on).toMatch(/^2026-12-\d\d$/);
		const row = await db.one<{ details: any; description: string; actor_name: string }>(
			`select details, description, actor_name from audit_log where action = 'export.companies' order by id desc limit 1`
		);
		expect(row!.details).toEqual({ filter: { state: ['superuser'] }, rows: 19 });
		expect(row!.actor_name).toBe('Test');
	});

	it('exports everything ordered by IČO', async () => {
		const { rows } = await exportAll();
		expect(rows).toHaveLength(COUNT);
		expect(rows[COUNT - 1].ico).toBe(ico(COUNT));
	});

	it('writes the verification dates as Czech calendar days', async () => {
		// Stamped at 00:30 Czech time on 20 November (19 November in UTC) by the list test above.
		const { rows } = await exportAll({ search: ico(5) });
		expect(rows[0].ico).toBe(ico(5));
		expect(rows[0].ico_verified_on).toBe('2026-11-20');
		expect(rows[0].operator_verified_on).toBe('2026-11-20');
	});

	it('hands out rows only for an export that was logged with the same filter by the same user', async () => {
		const start = await call('companies.exportStart', { filter: { state: ['superuser'] } });
		await expectError(call('companies.exportRows', { exportId: start.exportId, after: '' }), 'export_not_started');
		await expectError(call('companies.exportRows', { filter: { state: ['superuser'] }, after: '' }), 'export_not_started');
		const other = { ...ctx, actor: { id: null, name: 'Někdo jiný' } };
		await expectError(
			methods['companies.exportRows'](other, { filter: { state: ['superuser'] }, exportId: start.exportId, after: '' }) as Promise<unknown>,
			'export_not_started'
		);
		const late = { ...ctx, now: () => new Date(fixedNow.getTime() + 31 * 60_000) };
		await expectError(
			methods['companies.exportRows'](late, { filter: { state: ['superuser'] }, exportId: start.exportId, after: '' }) as Promise<unknown>,
			'export_not_started'
		);
	});

	it('never logs a searched phone number and refuses an empty export', async () => {
		await call('companies.exportStart', { search: '+420 000 100 007' });
		const row = await db.one<{ details: any }>(`select details from audit_log where action = 'export.companies' order by id desc limit 1`);
		expect(row!.details).toEqual({ filter: { search: '[telefonní číslo]' }, rows: 1 });
		const before = await db.one<{ n: number }>(`select count(*)::int as n from audit_log where action = 'export.companies'`);
		await expectError(call('companies.exportStart', { search: 'neexistující název' }), 'export_empty');
		const after = await db.one<{ n: number }>(`select count(*)::int as n from audit_log where action = 'export.companies'`);
		expect(after!.n).toBe(before!.n);
	});
});

describe('companies.list: contact and age of information', () => {
	it('filters companies without a phone, with a phone, and never verified', async () => {
		const total = (await call('companies.list', {})).total;
		const withPhone = (await call('companies.list', { filter: { hasPhone: 'yes' } })).total;
		const without = (await call('companies.list', { filter: { hasPhone: 'no' } })).total;
		expect(withPhone + without).toBe(total);
		expect(withPhone).toBeGreaterThan(0);
		await expectError(call('companies.list', { filter: { hasPhone: 'maybe' } }), 'filter_invalid');

		const stateUnverified = (await call('companies.list', { filter: { unverified: ['state'] } })).total;
		const stateVerified = (await call('companies.list', { filter: { stateVerifiedFrom: '2000-01-01' } })).total;
		expect(stateUnverified + stateVerified).toBe(total);
		// The manual transitions made by the tests above stamped the state as verified.
		expect(stateVerified).toBeGreaterThan(0);
		const row = (await call('companies.list', { filter: { stateVerifiedFrom: '2000-01-01' }, pageSize: 1 })).rows[0];
		expect(row.state_verified_at).toBeTruthy();
		expect(row).toHaveProperty('phone_added_at');
		expect(row).toHaveProperty('ico_verified_at');
	});
});
