// Fills the local database with obviously fictional companies for trying the application out.
// Usage: npm run seed -- --count 10000 [--force]
// Runs on plain Node (type stripping), so it imports with relative paths and .ts extensions.
//
// Everything here is made up: names carry the word "Testovací" and a number, IČO come from the
// 99xxxxxx range (valid check digit; the range is believed to be unassigned, NOT verified),
// phone numbers use the non-existent prefix +420 000.
import { closeDb, dataDir, getDb } from '../src/lib/server/db.ts';
import type { Queryable } from '../src/lib/server/db.ts';
import { getSettings } from '../src/lib/server/settings-core.ts';
import { audit } from '../src/lib/server/companies-core.ts';
import { systemCtx } from '../src/lib/server/context.ts';
import { icoFromPrefix } from '../src/lib/ico.ts';
import { REGIONS } from '../src/lib/regions.ts';
import type { CompanyState } from '../src/lib/states.ts';

// ---------- arguments ----------
function parseArgs(argv: string[]): { count: number; force: boolean } {
	let count = 10000;
	let force = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--force') force = true;
		else if (argv[i] === '--count') count = Number(argv[++i]);
		else if (argv[i].startsWith('--count=')) count = Number(argv[i].slice(8));
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive whole number');
	return { count, force };
}

// ---------- deterministic random numbers (same data on every run) ----------
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
let rand = mulberry32(20261119);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
function weighted<T>(options: readonly (readonly [T, number])[]): T {
	const total = options.reduce((sum, [, w]) => sum + w, 0);
	let r = rand() * total;
	for (const [value, w] of options) {
		r -= w;
		if (r < 0) return value;
	}
	return options[options.length - 1][0];
}

// ---------- dates ----------
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

// ---------- fictional building blocks ----------
const FIRST_NAMES = ['Jan', 'Petr', 'Eva', 'Jana', 'Tomáš', 'Lucie', 'Martin', 'Hana', 'Pavel', 'Alena', 'Jiří', 'Věra'];
const PO_FORMS: readonly (readonly [{ suffix: string; code: string }, number])[] = [
	[{ suffix: 's.r.o.', code: '112' }, 80],
	[{ suffix: 'a.s.', code: '121' }, 8],
	[{ suffix: 'v.o.s.', code: '111' }, 4],
	[{ suffix: 'z.s.', code: '706' }, 4],
	[{ suffix: 'družstvo', code: '205' }, 4]
];
// CZ-NACE codes (public classification), a small sample.
const NACE = [
	'01110', '10710', '25620', '41200', '43210', '45200', '46900', '47110', '49410', '55100',
	'56100', '62010', '68200', '69200', '70220', '73110', '81210', '85590', '86210', '96020'
];
// Rough population weights so the spread over regions looks plausible.
const REGION_WEIGHTS: Record<string, number> = {
	'19': 16, '27': 13, '35': 6, '43': 6, '51': 3, '60': 7, '78': 4, '86': 5, '94': 5, '108': 5,
	'116': 11, '124': 6, '141': 5, '132': 11
};
const STATE_WEIGHTS: readonly (readonly [CompanyState, number])[] = [
	['v_poolu', 62], ['ve_filtru', 3], ['u_robota_ocisteni', 3], ['superuser', 12], ['login_oz', 6],
	['vraceno', 2], ['odvlastneno', 2], ['plovak', 3], ['karantena', 3], ['ztraceno', 1],
	['zakaznik', 1], ['neaktivni_ico', 2]
];
const SUPERUSER_LOGIN = 'TEST_SUPERUSER';
const OTHER_PARTNER = 'Testovací partner 01';
const REPS = [
	{ name: 'Obchodník Testovací 01', login: 'TEST_OZ01', type: 'jezdi', region: '19' },
	{ name: 'Obchodník Testovací 02', login: 'TEST_OZ02', type: 'jezdi', region: '27' },
	{ name: 'Obchodník Testovací 03', login: 'TEST_OZ03', type: 'jezdi', region: '116' },
	{ name: 'Obchodník Testovací 04', login: 'TEST_OZ04', type: 'jezdi', region: '132' },
	{ name: 'Obchodník Testovací 05', login: 'TEST_OZ05', type: 'jezdi', region: '43' },
	{ name: 'Obchodník Testovací 06', login: 'TEST_OZ06', type: 'online', region: '19' },
	{ name: 'Obchodník Testovací 07', login: 'TEST_OZ07', type: 'online', region: '116' },
	{ name: 'Obchodník Testovací 08', login: 'TEST_OZ08', type: 'online', region: '86' }
];

interface Holder {
	type: 'superuser' | 'login_oz' | 'pool' | 'jiny_partner' | 'neznamo';
	login: string | null;
}
const holderText = (h: Holder) => (h.login ? `${h.type}:${h.login}` : h.type);

interface CohortSeed {
	code: string;
	status: string;
	/** Days before today on which the cohort landed on the superuser (day zero). */
	dayZeroAgo: number;
	id?: number;
}

interface Step {
	to: CompanyState;
	at: Date;
	holder: Holder;
	reason: string;
	source: string;
	note?: string;
}

async function insertJson(db: Queryable, sql: string, rows: unknown[], batch = 1000): Promise<void> {
	for (let i = 0; i < rows.length; i += batch) {
		await db.run(sql, [JSON.stringify(rows.slice(i, i + batch))]);
	}
}

async function main() {
	const { count, force } = parseArgs(process.argv.slice(2));
	const started = Date.now();
	const db = await getDb();
	console.log(`Database: ${dataDir()}/pglite`);

	const existing = (await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n;
	if (existing > 0 && !force) {
		console.error(
			`The database already holds ${existing} companies. Nothing was written.\n` +
				'Run with --force to add more fictional companies next to them.'
		);
		process.exitCode = 1;
		return;
	}
	// History is append-only, so --force never deletes: it continues the fictional number series.
	const firstSeq =
		((await db.one<{ n: number | null }>("select max(substring(ico from 3 for 5)::int) as n from companies where ico like '99%'"))!.n ?? 0) + 1;
	if (firstSeq + count - 1 > 99999) {
		throw new Error(`The fictional IČO range holds 99 999 companies; ${firstSeq - 1} are used, cannot add ${count}.`);
	}
	rand = mulberry32(20261119 + firstSeq);

	const settings = await getSettings(db, [
		'ownership.superuser_hold_days',
		'ownership.superuser_extension_days',
		'cohort.day_extension',
		'cohort.day_checkpoint1',
		'cohort.day_checkpoint2',
		'cohort.day_decisions_from',
		'cohort.day_decisions_to',
		'cohort.day_deadline',
		'pools.free',
		'pools.quarantine_target'
	]);
	const num = (key: string) => Number(settings[key]);
	const pools = settings['pools.free'] as string[];
	const releasePool = String(settings['pools.quarantine_target']);

	const allowed = new Set(
		(await db.query<{ from_state: string; to_state: string }>('select from_state, to_state from state_transitions where enabled')).map(
			(r) => `${r.from_state}>${r.to_state}`
		)
	);

	// "Today" is 09:00 of the current day, but never later than now: run before nine in the
	// morning, the seed must not date history rows or cohorts into the future.
	const now = new Date();
	const today = new Date(now);
	today.setHours(9, 0, 0, 0);
	if (today > now) today.setTime(now.getTime());

	await db.transaction(async (tx) => {
		// ---------- sales reps ----------
		await insertJson(
			tx,
			`insert into sales_reps (name, siebel_login, rep_type, home_region_code)
			 select name, login, type, region from jsonb_to_recordset($1::jsonb) as x(name text, login text, type text, region text)
			 on conflict (siebel_login) do nothing`,
			REPS
		);
		const reps = await tx.query<{ id: number; siebel_login: string; home_region_code: string; rep_type: string }>(
			"select id, siebel_login, home_region_code, rep_type from sales_reps where siebel_login like 'TEST_OZ%' order by id"
		);

		// ---------- cohorts ----------
		const month = (ago: number) => {
			const d = addDays(today, -ago);
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
		};
		const cohorts: CohortSeed[] = [
			{ code: `TEST-${month(170)}-A`, status: 'closed', dayZeroAgo: 170 },
			{ code: `TEST-${month(100)}-B`, status: 'closed', dayZeroAgo: 100 },
			{ code: `TEST-${month(35)}-C`, status: 'on_superuser', dayZeroAgo: 35 },
			{ code: `TEST-${month(0)}-D`, status: 'at_robot', dayZeroAgo: -3 },
			{ code: `TEST-${month(0)}-E`, status: 'draft', dayZeroAgo: -10 }
		];
		for (const c of cohorts) {
			const zero = addDays(today, -c.dayZeroAgo);
			const landed = c.status === 'closed' || c.status === 'on_superuser';
			const day = (key: string) => (landed ? isoDate(addDays(zero, num(key))) : null);
			const row = await tx.one<{ id: number }>(
				`insert into cohorts (code, status, filter, target_size, day_zero_on, extension_on, checkpoint1_on,
					checkpoint2_on, decisions_from_on, decisions_to_on, deadline_on, created_at)
				 values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12)
				 on conflict (code) do update set code = excluded.code returning id`,
				[
					c.code,
					c.status,
					JSON.stringify({ note: 'seed' }),
					Math.round(count / 10),
					landed ? isoDate(zero) : null,
					day('cohort.day_extension'),
					day('cohort.day_checkpoint1'),
					day('cohort.day_checkpoint2'),
					day('cohort.day_decisions_from'),
					day('cohort.day_decisions_to'),
					day('cohort.day_deadline'),
					// A cohort that has not landed yet (day zero ahead) was still created in the past.
					addDays(zero, -7) > today ? today : addDays(zero, -7)
				]
			);
			c.id = row!.id;
		}
		const [cohortA, cohortB, cohortC, cohortD, cohortE] = cohorts;

		// ---------- companies ----------
		const companies: Record<string, unknown>[] = [];
		const phones: Record<string, unknown>[] = [];
		const history: Record<string, unknown>[] = [];
		const assignments: Record<string, unknown>[] = [];
		const regionOptions = REGIONS.map((r) => [r, REGION_WEIGHTS[r.code] ?? 1] as const);
		const stateCounts: Record<string, number> = {};

		for (let n = 0; n < count; n++) {
			const seq = firstSeq + n;
			const label = String(seq).padStart(5, '0');
			const ico = icoFromPrefix(`99${label}`);
			const isFo = rand() < 0.55;
			const form = weighted(PO_FORMS);
			const name = isFo ? `${pick(FIRST_NAMES)} Testovací ${label}` : `Testovací firma ${label} ${form.suffix}`;
			const region = weighted(regionOptions);
			const district = pick(region.districts);
			const nace = [pick(NACE)];
			if (rand() < 0.3) {
				const second = pick(NACE);
				if (second !== nace[0]) nace.push(second);
			}
			// Newer companies are over-represented, as in the real pool.
			const yearsBack = Math.floor(Math.pow(rand(), 2.2) * 34);
			const founded = new Date(today.getFullYear() - yearsBack, int(0, 11), int(1, 28));
			const foundedOn = founded > today ? isoDate(addDays(today, -int(5, 60))) : isoDate(founded);
			const state = weighted(STATE_WEIGHTS);
			stateCounts[state] = (stateCounts[state] ?? 0) + 1;
			const channel = isFo ? 'operatorka' : 'cold_call';
			const poolHolder = (): Holder => ({ type: 'pool', login: pick(pools) });
			const startHolder: Holder = weighted<Holder>([
				[poolHolder(), 60],
				[{ type: 'neznamo', login: null }, 30],
				[{ type: 'jiny_partner', login: OTHER_PARTNER }, 10]
			]);
			// Jezdící rep from the home region when there is one, otherwise an online rep.
			const localReps = reps.filter((r) => r.rep_type === 'jezdi' && r.home_region_code === region.code);
			const rep = localReps.length && rand() < 0.7 ? pick(localReps) : pick(reps.filter((r) => r.rep_type === 'online'));
			const repHolder: Holder = { type: 'login_oz', login: rep.siebel_login };
			const superHolder: Holder = { type: 'superuser', login: SUPERUSER_LOGIN };
			const released: Holder = { type: 'pool', login: releasePool };

			const steps: Step[] = [];
			let cohort: CohortSeed | null = null;
			const company: Record<string, unknown> = {
				sales_rep_id: null, owned_from: null, ownership_ends_on: null, cohort_id: null, channel: null,
				rounds_count: 0, return_on: null, return_path: null, quarantine_until: null, never_return: false,
				dissolved_on: null, ico_valid: true
			};

			// The walk every company takes once it leaves the pool. Day zero = landing on the superuser.
			const walkTo = (c: CohortSeed, last: 've_filtru' | 'u_robota_ocisteni' | 'superuser') => {
				cohort = c;
				company.cohort_id = c.id;
				company.channel = channel;
				company.rounds_count = 1;
				const zero = addDays(today, -c.dayZeroAgo);
				steps.push({ to: 've_filtru', at: addDays(zero, -7), holder: startHolder, reason: 'cohort_build', source: 'system' });
				if (last === 've_filtru') return zero;
				steps.push({ to: 'u_robota_ocisteni', at: addDays(zero, -5), holder: startHolder, reason: 'robot_uploaded', source: 'robot' });
				if (last === 'u_robota_ocisteni') return zero;
				steps.push({ to: 'superuser', at: zero, holder: superHolder, reason: 'robot_landed', source: 'robot' });
				return zero;
			};
			const toRep = (zero: Date, after: number) => {
				const at = addDays(zero, after);
				steps.push({ to: 'login_oz', at, holder: repHolder, reason: 'semaphore_green', source: 'semaphore' });
				return at;
			};
			const assign = (from: Date, to: Date | null, endReason: string | null) => {
				assignments.push({
					ico,
					sales_rep_id: rep.id,
					channel,
					source: channel === 'operatorka' ? 'operator_handover' : 'cold_call_allocation',
					handed_over_on: channel === 'operatorka' ? isoDate(from) : null,
					round_no: 1,
					cohort_id: cohort?.id ?? null,
					assigned_from: isoDate(from),
					assigned_to: to ? isoDate(to) : null,
					end_reason: endReason
				});
			};
			const older = () => (rand() < 0.5 ? cohortA : cohortB);

			switch (state) {
				case 'v_poolu': {
					// A small part already went one round and came back from quarantine.
					if (rand() < 0.08) {
						const zero = walkTo(cohortA, 'superuser');
						steps.push({ to: 'odvlastneno', at: addDays(zero, 58), holder: released, reason: 'release_red', source: 'robot' });
						steps.push({ to: 'karantena', at: addDays(zero, 59), holder: released, reason: 'loss_121', source: 'loss_rule' });
						steps.push({ to: 'v_poolu', at: addDays(today, -int(1, 20)), holder: released, reason: 'quarantine_expired', source: 'system' });
					}
					break;
				}
				case 've_filtru':
					walkTo(cohortE, 've_filtru');
					break;
				case 'u_robota_ocisteni':
					walkTo(cohortD, 'u_robota_ocisteni');
					break;
				case 'superuser': {
					const zero = walkTo(cohortC, 'superuser');
					company.owned_from = isoDate(zero);
					company.ownership_ends_on = isoDate(
						addDays(zero, num('ownership.superuser_hold_days') + num('ownership.superuser_extension_days'))
					);
					break;
				}
				case 'login_oz': {
					const c = weighted([[cohortA, 4], [cohortB, 4], [cohortC, 2]] as const);
					const zero = walkTo(c, 'superuser');
					const at = toRep(zero, c === cohortC ? int(10, 30) : int(30, 55));
					company.sales_rep_id = rep.id;
					company.owned_from = isoDate(at);
					assign(at, null, null);
					break;
				}
				case 'vraceno': {
					const zero = walkTo(cohortB, 'superuser');
					steps.push({ to: 'vraceno', at: addDays(zero, int(56, 59)), holder: released, reason: 'statuses_returned', source: 'robot' });
					break;
				}
				case 'odvlastneno': {
					const zero = walkTo(cohortB, 'superuser');
					if (rand() < 0.5) {
						const at = toRep(zero, int(30, 50));
						const end = addDays(at, int(10, 40));
						steps.push({ to: 'odvlastneno', at: end, holder: released, reason: 'loss_243', source: 'loss_rule' });
						assign(at, end, 'loss_243');
					} else {
						steps.push({ to: 'odvlastneno', at: addDays(zero, int(56, 59)), holder: released, reason: 'release_red', source: 'robot' });
					}
					break;
				}
				case 'plovak': {
					const zero = walkTo(older(), 'superuser');
					const at = toRep(zero, int(30, 50));
					const end = addDays(at, int(10, 30));
					const reason = pick(['loss_122', 'loss_292', 'loss_123']);
					steps.push({ to: 'odvlastneno', at: end, holder: released, reason, source: 'loss_rule' });
					steps.push({ to: 'plovak', at: addDays(end, 1), holder: released, reason, source: 'loss_rule' });
					assign(at, end, reason);
					company.return_on = isoDate(addDays(today, int(20, 400)));
					company.return_path = pick(['siebel_check', 'robot']);
					break;
				}
				case 'karantena': {
					const zero = walkTo(older(), 'superuser');
					const end = addDays(zero, int(56, 59));
					const reason = pick(['loss_121', 'loss_294', 'loss_206']);
					steps.push({ to: 'odvlastneno', at: end, holder: released, reason: 'release_red', source: 'robot' });
					steps.push({ to: 'karantena', at: addDays(end, 1), holder: released, reason, source: 'loss_rule' });
					if (reason === 'loss_206') company.never_return = true;
					else company.quarantine_until = isoDate(addDays(today, int(15, 330)));
					break;
				}
				case 'ztraceno': {
					const zero = walkTo(older(), 'superuser');
					const at = toRep(zero, int(30, 50));
					const end = addDays(at, int(10, 30));
					steps.push({ to: 'ztraceno', at: end, holder: { type: 'jiny_partner', login: OTHER_PARTNER }, reason: 'loss_300', source: 'siebel' });
					assign(at, end, 'loss_300');
					break;
				}
				case 'zakaznik': {
					const zero = walkTo(older(), 'superuser');
					const at = toRep(zero, int(20, 50));
					steps.push({ to: 'zakaznik', at: addDays(at, int(5, 30)), holder: repHolder, reason: 'deal_won', source: 'system' });
					company.sales_rep_id = rep.id;
					company.owned_from = isoDate(at);
					assign(at, null, null);
					break;
				}
				case 'neaktivni_ico': {
					const at = addDays(today, -int(5, 150));
					steps.push({ to: 'neaktivni_ico', at, holder: startHolder, reason: 'ares_dissolved', source: 'system' });
					company.ico_valid = false;
					company.dissolved_on = isoDate(addDays(at, -int(10, 200)));
					break;
				}
			}

			// History rows: the import row first, then each step, checked against state_transitions.
			const importedAt = addDays(today, -int(200, 420));
			history.push({
				ico, at: importedAt, from_state: null, to_state: 'v_poolu', from_holder: null, to_holder: holderText(startHolder),
				reason_code: 'seed_import', note: null, cohort_id: null, source: 'import'
			});
			let current: CompanyState = 'v_poolu';
			let holder = startHolder;
			for (const step of steps) {
				if (!allowed.has(`${current}>${step.to}`)) {
					throw new Error(`Seed path uses a transition that is not enabled: ${current} → ${step.to}`);
				}
				const at = step.at > today ? today : step.at < importedAt ? addDays(importedAt, 1) : step.at;
				history.push({
					ico, at, from_state: current, to_state: step.to, from_holder: holderText(holder), to_holder: holderText(step.holder),
					reason_code: step.reason, note: step.note ?? null, cohort_id: (cohort as CohortSeed | null)?.id ?? null, source: step.source
				});
				current = step.to;
				holder = step.holder;
			}
			if (current !== state) throw new Error(`Seed path for ${state} ended in ${current}`);

			const verified = rand() < 0.8;
			companies.push({
				...company,
				ico,
				name,
				subject_type: isFo ? 'FO' : 'PO',
				legal_form_code: isFo ? '101' : form.code,
				region_code: region.code,
				region_name: region.name,
				district_code: district.code,
				district_name: district.name,
				nace_codes: nace,
				founded_on: foundedOn,
				ico_valid: verified || state === 'neaktivni_ico' ? company.ico_valid : null,
				ico_verified_at: verified || state === 'neaktivni_ico' ? addDays(today, -int(1, 120)) : null,
				state,
				holder_type: holder.type,
				holder_login: holder.login,
				created_at: importedAt
			});

			const phoneCount = weighted([[1, 60], [2, 30], [3, 10]] as const);
			for (let k = 0; k < phoneCount; k++) {
				const operator = weighted([['O2', 30], ['TM', 30], ['VF', 14], ['jiny', 3], [null, 23]] as const);
				phones.push({
					ico,
					phone: `+420000${String(seq * 3 + k).padStart(6, '0')}`,
					is_primary: k === 0,
					operator,
					operator_verified_at: operator ? addDays(today, -int(1, 300)) : null,
					number_type: 'mobil',
					source: 'import'
				});
			}
		}

		await insertJson(
			tx,
			`insert into companies (ico, name, subject_type, legal_form_code, region_code, region_name, district_code,
				district_name, nace_codes, founded_on, dissolved_on, ico_valid, ico_verified_at, state, holder_type,
				holder_login, sales_rep_id, owned_from, ownership_ends_on, cohort_id, channel, rounds_count, return_on,
				return_path, quarantine_until, never_return, created_at)
			 select ico, name, subject_type, legal_form_code, region_code, region_name, district_code,
				district_name, nace_codes, founded_on, dissolved_on, ico_valid, ico_verified_at, state, holder_type,
				holder_login, sales_rep_id, owned_from, ownership_ends_on, cohort_id, channel, rounds_count, return_on,
				return_path, quarantine_until, never_return, created_at
			 from jsonb_to_recordset($1::jsonb) as x(ico char(8), name text, subject_type text, legal_form_code text,
				region_code text, region_name text, district_code text, district_name text, nace_codes text[],
				founded_on date, dissolved_on date, ico_valid boolean, ico_verified_at timestamptz, state text,
				holder_type text, holder_login text, sales_rep_id integer, owned_from date, ownership_ends_on date,
				cohort_id integer, channel text, rounds_count smallint, return_on date, return_path text,
				quarantine_until date, never_return boolean, created_at timestamptz)`,
			companies
		);
		await insertJson(
			tx,
			`insert into company_phones (ico, phone, is_primary, operator, operator_verified_at, number_type, source)
			 select ico, phone, is_primary, operator, operator_verified_at, number_type, source
			 from jsonb_to_recordset($1::jsonb) as x(ico char(8), phone text, is_primary boolean, operator text,
				operator_verified_at timestamptz, number_type text, source text)`,
			phones,
			2000
		);
		history.sort((a, b) => (a.at as Date).getTime() - (b.at as Date).getTime());
		await insertJson(
			tx,
			`insert into company_state_history (ico, at, from_state, to_state, from_holder, to_holder, reason_code, note,
				cohort_id, source, actor_name)
			 select ico, at, from_state, to_state, from_holder, to_holder, reason_code, note, cohort_id, source, 'Zkušební data'
			 from jsonb_to_recordset($1::jsonb) as x(ico char(8), at timestamptz, from_state text, to_state text,
				from_holder text, to_holder text, reason_code text, note text, cohort_id integer, source text)`,
			history,
			2000
		);
		await insertJson(
			tx,
			`insert into company_assignments (ico, sales_rep_id, channel, source, handed_over_on, round_no, cohort_id,
				assigned_from, assigned_to, end_reason)
			 select ico, sales_rep_id, channel, source, handed_over_on, round_no, cohort_id, assigned_from, assigned_to, end_reason
			 from jsonb_to_recordset($1::jsonb) as x(ico char(8), sales_rep_id integer, channel text, source text,
				handed_over_on date, round_no smallint, cohort_id integer, assigned_from date, assigned_to date, end_reason text)`,
			assignments
		);
		await audit(systemCtx(tx, { actor: { id: null, name: 'Zkušební data' } }), 'seed.run', {
			entity: 'seed',
			description: `Vygenerováno ${count} smyšlených IČO`,
			details: { count, first_seq: firstSeq, states: stateCounts }
		});

		console.log(
			`Written: ${companies.length} companies, ${phones.length} phones, ${history.length} history rows, ` +
				`${assignments.length} assignments, ${reps.length} sales reps, ${cohorts.length} cohorts.`
		);
		console.log('By state:', stateCounts);
	});
	await db.exec('analyze');
	console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
}

main()
	.catch((e) => {
		console.error(e instanceof Error ? e.message : e);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
