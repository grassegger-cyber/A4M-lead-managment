// Import flow against an in-memory PGlite database with the real migrations.
// Never touches ./data.nosync. Only fictional data (IČO range 99…, phones +420 000 …).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db.ts';
import type { Db } from '../db.ts';
import { systemCtx } from '../context.ts';
import type { Ctx } from '../context.ts';
import { recordInitialState, transition } from '../companies-core.ts';
import { icoFromPrefix } from '../../ico.ts';
import { methods } from './imports.ts';

let db: Db;
let ctx: Ctx;
const call = (name: string, args: unknown = {}) => methods[name](ctx, args) as Promise<any>;
const ico = (n: number) => icoFromPrefix(9970000 + n);
const EXISTING = ico(1); // in the database before the import, on the superuser
const SHORT = icoFromPrefix('0000123'); // 7 significant digits or fewer → needs zero padding
const mapping = { ico: ['IČO'], name: ['Název'], subject_type: ['Typ'], region: ['Kraj'], phone: ['Telefon', 'Telefon 2'] };

async function expectError(promise: Promise<unknown>, code: string) {
	await expect(promise).rejects.toMatchObject({ code });
}
async function setSetting(key: string, value: unknown) {
	await db.run('update settings set value = $2::jsonb where key = $1', [key, JSON.stringify(value)]);
}
async function upload(rows: { rowNo: number; data: unknown }[], emptyRows = 0) {
	const imp = await call('imports.start', { filename: 'ukazka-test.xlsx', sheetName: 'Kmen', declaredRows: rows.length, emptyRows, mapping });
	for (let i = 0; i < rows.length; i += 3) await call('imports.appendRows', { id: imp.id, rows: rows.slice(i, i + 3) });
	return imp.id as number;
}
async function validateAll(id: number) {
	for (let i = 0; i < 100; i++) {
		const res = await call('imports.validate', { id });
		if (res.done) return res.import;
	}
	throw new Error('validation did not finish');
}

beforeAll(async () => {
	db = await openDb({ dir: 'memory' });
	ctx = systemCtx(db, { actor: { id: null, name: 'Test' } });
	await db.run(
		`insert into companies (ico, name, subject_type, region_code, region_name) values ($1, 'Testovací firma 00001 s.r.o.', 'PO', '19', 'Hlavní město Praha')`,
		[EXISTING]
	);
	await recordInitialState(ctx, EXISTING, 'import', 'test');
	for (const to of ['ve_filtru', 'u_robota_ocisteni', 'superuser'] as const) {
		await transition(ctx, EXISTING, to, 'test', { source: 'system', holderType: to === 'superuser' ? 'superuser' : undefined, holderLogin: to === 'superuser' ? 'TEST_SUPERUSER' : undefined });
	}
	await db.run(`insert into company_phones (ico, phone, is_primary, source) values ($1, '+420000100001', true, 'test')`, [EXISTING]);
	// Small steps so the tests exercise several of them.
	await setSetting('import.validate_chunk_rows', 4);
	await setSetting('import.apply_chunk_rows', 3);
});

afterAll(async () => {
	await db.close();
});

// Excel row numbers start at 2 (row 1 is the header).
const FILE = [
	{ rowNo: 2, data: { ico: ico(2), name: 'Testovací firma 00002 s.r.o.', subject_type: 'PO', region: 'Praha', phones: ['000 200 001', '000200002; 000 200 001'] } },
	{ rowNo: 3, data: { ico: String(Number(SHORT)), name: 'Jan Testovací 00003', subject_type: 'FO', phones: ['+420 000 300 001'] } },
	{ rowNo: 4, data: { ico: EXISTING, name: 'Testovací firma 00001 a.s.', region: 'Jihomoravský kraj', phones: ['000100001', '000100002'] } },
	{ rowNo: 5, data: { ico: '12345678', name: 'Testovací firma 00005 s.r.o.' } }, // wrong check digit
	{ rowNo: 6, data: { ico: ico(2), name: 'Testovací firma 00002 duplicitní', phones: ['000200003'] } }, // duplicate of row 2
	{ rowNo: 7, data: { name: 'Testovací firma 00007 s.r.o.' } }, // no IČO
	{ rowNo: 9, data: { ico: ico(4), name: 'Testovací firma 00004 s.r.o.', subject_type: 'neznámý typ', phones: ['12345', '000400001'] } }, // warnings
	{ rowNo: 10, data: { ico: ico(5), name: 'x'.repeat(400) } }, // other error
	{ rowNo: 11, data: { ico: ico(2), phones: ['000200001'] } }, // second duplicate of row 2
	{ rowNo: 12, data: { ico: ico(6), name: 'Testovací firma 00006 s.r.o.' } },
	{ rowNo: 13, data: { ico: ico(7), name: 'Testovací firma 00007 s.r.o.', phones: ['000700001'] } }
];

describe('imports: upload', () => {
	it('needs a column for IČO and a positive number of rows', async () => {
		await expectError(call('imports.start', { filename: 'a.xlsx', declaredRows: 5, mapping: { name: ['Název'] } }), 'mapping_invalid');
		await expectError(call('imports.start', { filename: 'a.xlsx', declaredRows: 5, mapping: { ico: ['A', 'B'] } }), 'mapping_invalid');
		await expectError(call('imports.start', { filename: 'a.xlsx', declaredRows: 0, mapping }), 'rows_missing');
		await setSetting('import.max_rows', 3);
		await expectError(call('imports.start', { filename: 'a.xlsx', declaredRows: 4, mapping }), 'too_many_rows');
		await setSetting('import.max_rows', 200000);
	});

	it('remembers the mapping in settings and offers it next time', async () => {
		const imp = await call('imports.start', {
			filename: 'pamet.xlsx', declaredRows: 1, mapping: { ico: ['Identifikátor'] }, headerMap: { 'Identifikátor': 'ico', 'Poznámka': '-', 'Cokoli': 'nonsense' }
		});
		const config = await call('imports.config');
		expect(config.remembered).toMatchObject({ identifikator: 'ico', poznamka: '-' });
		expect(config.remembered.cokoli).toBeUndefined();
		expect(config.aliases.ico).toContain('ico');
		expect(config.uploadBatchRows).toBe(1000);
		await call('imports.cancel', { id: imp.id });
	});

	it('refuses to validate an incomplete upload and replaces a row sent twice', async () => {
		const imp = await call('imports.start', { filename: 'neuplny.xlsx', declaredRows: 2, mapping });
		await call('imports.appendRows', { id: imp.id, rows: [{ rowNo: 2, data: { ico: ico(50) } }] });
		const again = await call('imports.appendRows', { id: imp.id, rows: [{ rowNo: 2, data: { ico: ico(51) } }] });
		expect(again.receivedRows).toBe(1);
		await expectError(call('imports.validate', { id: imp.id }), 'upload_incomplete');
		await expectError(
			call('imports.appendRows', { id: imp.id, rows: [{ rowNo: 3, data: {} }, { rowNo: 4, data: {} }] }),
			'too_many_rows'
		);
		const cancelled = await call('imports.cancel', { id: imp.id });
		expect(cancelled.status).toBe('cancelled');
		expect((await db.one<{ n: number }>('select count(*)::int as n from import_rows where import_id = $1', [imp.id]))!.n).toBe(0);
		await expectError(call('imports.appendRows', { id: imp.id, rows: [{ rowNo: 2, data: {} }] }), 'import_wrong_status');
	});
});

describe('imports: validate, report, apply', () => {
	let id: number;

	it('sorts the rows into new, existing, duplicates, invalid IČO and other errors', async () => {
		id = await upload(FILE, 1);
		const first = await call('imports.validate', { id });
		expect(first.done).toBe(false);
		expect(first.import.validatedRows).toBe(4);
		const imp = await validateAll(id);
		expect(imp.status).toBe('validated');
		expect(imp.counts).toEqual({ new: 5, update: 1, duplicate: 2, invalidIco: 2, error: 1, warning: 1 });
		const rows = await db.query<{ row_no: number; status: string; ico: string | null; duplicate_of: number | null; error_code: string | null }>(
			'select row_no, status, ico, duplicate_of, error_code from import_rows where import_id = $1 order by row_no',
			[id]
		);
		const by = new Map(rows.map((r) => [r.row_no, r]));
		expect(by.get(2)).toMatchObject({ status: 'new', ico: ico(2) });
		expect(by.get(3)).toMatchObject({ status: 'new', ico: SHORT }); // padded with zeros, not rejected
		expect(by.get(4)).toMatchObject({ status: 'update', ico: EXISTING });
		expect(by.get(5)).toMatchObject({ status: 'invalid_ico', error_code: 'ico_checksum' });
		expect(by.get(6)).toMatchObject({ status: 'duplicate', duplicate_of: 2 });
		expect(by.get(7)).toMatchObject({ status: 'invalid_ico', error_code: 'ico_empty' });
		expect(by.get(10)).toMatchObject({ status: 'error', error_code: 'name_too_long' });
		expect(by.get(11)).toMatchObject({ status: 'duplicate', duplicate_of: 2 });
		// Nothing is written before the confirmation.
		expect((await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n).toBe(1);
	});

	it('lists problem rows and builds the xlsx error report', async () => {
		const dup = await call('imports.rows', { id, kind: 'duplicate' });
		expect(dup.total).toBe(2);
		expect(dup.items[0]).toMatchObject({ rowNo: 6, problem: 'Duplicitní IČO, použije se řádek 2' });
		const warn = await call('imports.rows', { id, kind: 'warning' });
		expect(warn.items[0].problem).toContain('12345');
		await expectError(call('imports.rows', { id, kind: 'new' }), 'kind_invalid');

		const report = await call('imports.reportStart', { id });
		expect(report.filename).toBe(`import-${id}-report-chyb.xlsx`);
		expect(report.summary[0]).toEqual(['Import č.', id]);
		expect(report.sheets.map((sheet: { name: string }) => sheet.name)).toEqual(['Neplatná IČO', 'Duplicity', 'Ostatní chyby', 'Upozornění']);
		const sheetRows = async (kind: string) => (await call('imports.reportRows', { id, kind, after: 0 })).rows;
		expect(await sheetRows('invalid_ico')).toHaveLength(2);
		expect(await sheetRows('duplicate')).toHaveLength(2);
		expect(await sheetRows('error')).toHaveLength(1);
		expect(await sheetRows('warning')).toHaveLength(2); // 2 warnings of one row
		expect((await sheetRows('invalid_ico'))[0][3]).toBe('IČO má neplatnou kontrolní číslici');
		const page = await call('imports.reportRows', { id, kind: 'duplicate', after: 0 });
		expect(page.done).toBe(true);
		expect((await call('imports.reportRows', { id, kind: 'duplicate', after: page.last })).rows).toHaveLength(0);
	});

	it('writes nothing without the explicit confirmation', async () => {
		await expectError(call('imports.apply', { id }), 'confirm_required');
		expect((await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n).toBe(1);
	});

	it('writes in steps and continues after an interruption', async () => {
		const first = await call('imports.apply', { id, confirm: true });
		expect(first.done).toBe(false);
		expect(first.import.status).toBe('applying');
		expect(first.import.applied.throughRow).toBe(4); // rows 2, 3, 4
		expect((await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n).toBe(3);
		// A write in progress cannot be cancelled or validated again.
		await expectError(call('imports.cancel', { id }), 'import_wrong_status');
		await expectError(call('imports.validate', { id, restart: true }), 'import_wrong_status');

		// "Interruption": the caller goes away. Later calls need no confirmation and carry on.
		let last = first;
		for (let i = 0; i < 20 && !last.done; i++) last = await call('imports.apply', { id });
		expect(last.done).toBe(true);
		expect(last.import.status).toBe('applied');
		expect(last.import.applied).toMatchObject({ new: 5, updated: 1, unchanged: 0 });
		// A further call changes nothing.
		const after = await call('imports.apply', { id });
		expect(after.import.applied).toEqual(last.import.applied);
	});

	it('puts new companies into v_poolu with a history row from the import', async () => {
		const rows = await db.query<{ ico: string; state: string; holder_type: string; name: string; subject_type: string | null; region_code: string | null }>(
			'select ico, state, holder_type, name, subject_type, region_code from companies where ico <> $1 order by ico',
			[EXISTING]
		);
		expect(rows.map((r) => r.ico).sort()).toEqual([SHORT, ico(2), ico(4), ico(6), ico(7)].sort());
		expect(rows.every((r) => r.state === 'v_poolu')).toBe(true);
		expect(rows.find((r) => r.ico === ico(2))).toMatchObject({ name: 'Testovací firma 00002 s.r.o.', subject_type: 'PO', region_code: '19' });
		expect(rows.find((r) => r.ico === ico(4))!.subject_type).toBeNull(); // unknown value dropped with a warning
		const history = await db.query<{ ico: string; from_state: string | null; to_state: string; source: string; note: string }>(
			`select ico, from_state, to_state, source, note from company_state_history where ico <> $1`,
			[EXISTING]
		);
		expect(history).toHaveLength(5);
		expect(history.every((h) => h.from_state === null && h.to_state === 'v_poolu' && h.source === 'import' && h.note === `Import č. ${id}`)).toBe(true);
	});

	it('updates only non-ownership fields of a company already in the database', async () => {
		const c = await db.one<{ name: string; state: string; holder_type: string; holder_login: string; region_code: string; region_name: string; subject_type: string }>(
			'select name, state, holder_type, holder_login, region_code, region_name, subject_type from companies where ico = $1',
			[EXISTING]
		);
		expect(c).toEqual({
			name: 'Testovací firma 00001 a.s.',
			state: 'superuser',
			holder_type: 'superuser',
			holder_login: 'TEST_SUPERUSER',
			region_code: '116',
			region_name: 'Jihomoravský kraj',
			subject_type: 'PO' // the row gave none, the old value stays
		});
		const history = (await db.one<{ n: number }>('select count(*)::int as n from company_state_history where ico = $1', [EXISTING]))!.n;
		expect(history).toBe(4); // the import added no state change
	});

	it('merges phones without duplicates, including those of duplicate rows', async () => {
		const phones = async (i: string) =>
			(await db.query<{ phone: string; is_primary: boolean }>('select phone, is_primary from company_phones where ico = $1 order by id', [i]));
		expect(await phones(EXISTING)).toEqual([
			{ phone: '+420000100001', is_primary: true },
			{ phone: '+420000100002', is_primary: false }
		]);
		expect(await phones(ico(2))).toEqual([
			{ phone: '+420000200001', is_primary: true },
			{ phone: '+420000200002', is_primary: false },
			{ phone: '+420000200003', is_primary: false } // from duplicate row 6
		]);
		expect((await phones(ico(4))).map((p) => p.phone)).toEqual(['+420000400001']); // the malformed one was skipped
		expect(await phones(ico(6))).toEqual([]);
	});

	it('keeps problem rows for the report, deletes clean ones and audits every step', async () => {
		const left = await db.query<{ row_no: number }>('select row_no from import_rows where import_id = $1 order by row_no', [id]);
		expect(left.map((r) => r.row_no)).toEqual([5, 6, 7, 9, 10, 11]);
		const actions = (await db.query<{ action: string }>(`select action from audit_log where entity = 'import' and entity_id = $1 order by id`, [String(id)])).map((a) => a.action);
		expect(actions).toEqual(['import.started', 'import.validated', 'import.report_downloaded', 'import.confirmed', 'import.applied']);
		const details = await db.one<{ details: Record<string, unknown> }>(`select details from audit_log where action = 'import.applied' and entity_id = $1`, [String(id)]);
		expect(details!.details).toMatchObject({ new: 5, updated: 1, phones_added: 7 });
		expect(JSON.stringify(details!.details)).not.toContain('+420'); // no phone numbers in the audit log
	});

	it('shows the import in the history', async () => {
		const list = await call('imports.list', { pageSize: 2 });
		expect(list.total).toBeGreaterThanOrEqual(3);
		expect(list.items).toHaveLength(2);
		expect(list.items[0]).toMatchObject({ id, status: 'applied', createdByName: 'Test', filename: 'ukazka-test.xlsx', emptyRows: 1 });
		expect((await call('imports.get', { id })).counts.new).toBe(5);
		await expectError(call('imports.get', { id: 99999 }), 'import_not_found');
	});

	it('importing the same file again adds nothing', async () => {
		const second = await upload(FILE);
		const imp = await validateAll(second);
		expect(imp.counts).toMatchObject({ new: 0, update: 6, duplicate: 2 });
		let res = await call('imports.apply', { id: second, confirm: true });
		for (let i = 0; i < 20 && !res.done; i++) res = await call('imports.apply', { id: second });
		expect(res.import.applied).toMatchObject({ new: 0, updated: 0, unchanged: 6, phones: 0 });
		expect((await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n).toBe(6);
		expect((await db.one<{ n: number }>('select count(*)::int as n from company_state_history'))!.n).toBe(9);
	});

	it('respects the list of fields allowed to be overwritten', async () => {
		await setSetting('import.update_existing_fields', ['region']);
		const third = await upload([{ rowNo: 2, data: { ico: EXISTING, name: 'Testovací firma 00001 přejmenovaná', region: 'Praha' } }]);
		await validateAll(third);
		const res = await call('imports.apply', { id: third, confirm: true });
		expect(res.done).toBe(true);
		const c = await db.one<{ name: string; region_code: string }>('select name, region_code from companies where ico = $1', [EXISTING]);
		expect(c).toEqual({ name: 'Testovací firma 00001 a.s.', region_code: '19' });
	});

	it('a company that appeared after the check is updated, not inserted twice', async () => {
		const fourth = await upload([{ rowNo: 2, data: { ico: ico(8), name: 'Testovací firma 00008 s.r.o.' } }]);
		expect((await validateAll(fourth)).counts.new).toBe(1);
		await db.run(`insert into companies (ico, name, state) values ($1, 'Testovací firma 00008 dřívější', 'karantena')`, [ico(8)]);
		const res = await call('imports.apply', { id: fourth, confirm: true });
		expect(res.import.applied).toMatchObject({ new: 0 });
		expect((await db.one<{ state: string }>('select state from companies where ico = $1', [ico(8)]))!.state).toBe('karantena');
	});

	it('deletes kept rows after the retention period', async () => {
		await setSetting('retention.import_error_rows_days', 0);
		const later = { ...ctx, now: () => new Date(Date.now() + 60_000) };
		await methods['imports.list'](later, {});
		expect((await db.one<{ n: number }>('select count(*)::int as n from import_rows where import_id = $1', [id]))!.n).toBe(0);
		await expectError(call('imports.reportStart', { id }), 'rows_purged');
	});
});

describe('imports: region and district belong together', () => {
	const place = (i: string) =>
		db.one<{ region_code: string | null; region_name: string | null; district_code: string | null; district_name: string | null }>(
			'select region_code, region_name, district_code, district_name from companies where ico = $1',
			[i]
		);
	async function importRows(rows: { rowNo: number; data: unknown }[]) {
		const id = await upload(rows);
		const imp = await validateAll(id);
		let res = await call('imports.apply', { id, confirm: true });
		for (let i = 0; i < 20 && !res.done; i++) res = await call('imports.apply', { id });
		return { imp, res };
	}
	const PRAHA = { region_code: '19', region_name: 'Hlavní město Praha', district_code: '3100', district_name: 'Praha' };

	beforeAll(async () => {
		await setSetting('import.update_existing_fields', ['name', 'region', 'district']);
		for (const n of [21, 22, 23, 24]) {
			await db.run(
				`insert into companies (ico, name, region_code, region_name, district_code, district_name)
				 values ($1, $2, '19', 'Hlavní město Praha', '3100', 'Praha')`,
				[ico(n), `Testovací firma ${String(n).padStart(5, '0')} s.r.o.`]
			);
		}
	});

	it('a new company never gets a region that contradicts its district', async () => {
		const { imp } = await importRows([
			{ rowNo: 2, data: { ico: ico(20), name: 'Testovací firma 00020 s.r.o.', region: 'Zlínský kraj', district: 'Praha' } }
		]);
		expect(imp.counts).toMatchObject({ new: 1, warning: 1 });
		expect(await place(ico(20))).toEqual(PRAHA);
	});

	it('a region without a district clears a stored district that lies elsewhere', async () => {
		await importRows([
			{ rowNo: 2, data: { ico: ico(21), region: 'Zlínský kraj' } },
			// The same region as stored: the district stays.
			{ rowNo: 3, data: { ico: ico(22), region: 'Praha' } },
			// Region and district of the row replace the stored pair.
			{ rowNo: 4, data: { ico: ico(23), district: 'Kroměříž' } }
		]);
		expect(await place(ico(21))).toEqual({ region_code: '141', region_name: 'Zlínský kraj', district_code: null, district_name: null });
		expect(await place(ico(22))).toEqual(PRAHA);
		expect(await place(ico(23))).toEqual({ region_code: '141', region_name: 'Zlínský kraj', district_code: '3708', district_name: 'Kroměříž' });
	});

	it('does not take a value that would contradict a field the import may not overwrite', async () => {
		// The district may not be overwritten: a region of another district is not taken.
		await setSetting('import.update_existing_fields', ['region']);
		await importRows([{ rowNo: 2, data: { ico: ico(24), region: 'Zlínský kraj' } }]);
		expect(await place(ico(24))).toEqual(PRAHA);
		// The region may not be overwritten: a district of another region is not taken.
		await setSetting('import.update_existing_fields', ['district']);
		await importRows([{ rowNo: 2, data: { ico: ico(24), district: 'Kroměříž' } }]);
		expect(await place(ico(24))).toEqual(PRAHA);
		await setSetting('import.update_existing_fields', ['name', 'subject_type', 'legal_form_code', 'region', 'district', 'nace', 'founded_on', 'ca_number']);
	});
});

describe('imports: housekeeping', () => {
	it('remembers the mapping as an audited settings change and skips one that is too large', async () => {
		const audits = async () =>
			db.query<{ details: any; description: string }>(
				`select details, description from audit_log where action = 'settings.update' and entity_id = 'import.column_mapping' order by id`
			);
		const before = (await audits()).length;
		const first = await call('imports.start', { filename: 'audit.xlsx', declaredRows: 1, mapping, headerMap: { 'Sloupec audit': 'name' } });
		const rows = await audits();
		expect(rows).toHaveLength(before + 1);
		expect(rows[rows.length - 1].details.old).not.toHaveProperty('sloupec audit');
		expect(rows[rows.length - 1].details.new).toMatchObject({ 'sloupec audit': 'name' });
		expect(rows[rows.length - 1].description).toContain(`č. ${first.id}`);
		// The same mapping again changes nothing and writes no settings row.
		const second = await call('imports.start', { filename: 'audit.xlsx', declaredRows: 1, mapping, headerMap: { 'Sloupec audit': 'name' } });
		expect(await audits()).toHaveLength(before + 1);

		// Larger than a map setting may be: the import starts, the mapping is just not remembered.
		const huge = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${'x'.repeat(95)} ${i}`, 'name']));
		const third = await call('imports.start', { filename: 'velky.xlsx', declaredRows: 1, mapping, headerMap: huge });
		expect(third.status).toBe('uploading');
		expect(await audits()).toHaveLength(before + 1);
		const started = await db.one<{ details: any }>(`select details from audit_log where action = 'import.started' and entity_id = $1`, [String(third.id)]);
		expect(started!.details.mapping_remembered).toBe(false);
		const remembered = (await call('imports.config')).remembered;
		expect(Object.keys(remembered).some((k) => k.startsWith('xxxx'))).toBe(false);
		for (const imp of [first, second, third]) await call('imports.cancel', { id: imp.id });
	});

	it('vacuums and analyses after the last step, so staged rows give their space back', async () => {
		const stats = async () =>
			Object.fromEntries(
				(
					await db.query<{ relname: string; reltuples: number }>(
						`select relname::text as relname, reltuples::float8 as reltuples from pg_class
						 where relname in ('import_rows', 'companies', 'company_phones', 'company_state_history')`
					)
				).map((r) => [r.relname, r.reltuples])
			);
		const id = await upload(
			Array.from({ length: 40 }, (_, i) => ({ rowNo: i + 2, data: { ico: ico(300 + i), name: `Testovací firma ${300 + i} s.r.o.`, phones: [`000${600000 + i}`] } }))
		);
		await validateAll(id);
		let res = await call('imports.apply', { id, confirm: true });
		for (let i = 0; i < 40 && !res.done; i++) res = await call('imports.apply', { id });
		expect(res.done).toBe(true);
		const after = await stats();
		const companies = (await db.one<{ n: number }>('select count(*)::int as n from companies'))!.n;
		// ANALYZE ran: the planner knows the real sizes (reltuples is -1 on a table never analysed).
		expect(after.companies).toBe(companies);
		expect(after.import_rows).toBeGreaterThanOrEqual(0);
		expect(after.company_phones).toBeGreaterThan(0);
		// Inside a caller's transaction the maintenance is skipped instead of breaking the transaction.
		await db.transaction(async (tx) => {
			const inner = { ...ctx, db: tx };
			const imp = await methods['imports.start'](inner, { filename: 'v-transakci.xlsx', declaredRows: 1, mapping });
			await methods['imports.cancel'](inner, { id: (imp as { id: number }).id });
			expect((await tx.one<{ n: number }>('select count(*)::int as n from imports where id = $1', [(imp as { id: number }).id]))!.n).toBe(1);
		});
	});
});

describe('imports: volume', () => {
	it('handles 3 000 rows with the default step sizes', async () => {
		await setSetting('import.validate_chunk_rows', 5000);
		await setSetting('import.apply_chunk_rows', 2000);
		const rows = Array.from({ length: 3000 }, (_, i) => ({
			rowNo: i + 2,
			data: { ico: ico(1000 + i), name: `Testovací firma ${String(1000 + i).padStart(5, '0')} s.r.o.`, phones: [`000${String(500000 + i)}`] }
		}));
		const imp = await call('imports.start', { filename: 'objem.xlsx', declaredRows: rows.length, mapping });
		const t0 = Date.now();
		for (let i = 0; i < rows.length; i += 1000) await call('imports.appendRows', { id: imp.id, rows: rows.slice(i, i + 1000) });
		const t1 = Date.now();
		const validated = await validateAll(imp.id);
		const t2 = Date.now();
		expect(validated.counts).toMatchObject({ new: 3000, update: 0, duplicate: 0 });
		let res = await call('imports.apply', { id: imp.id, confirm: true });
		let steps = 1;
		while (!res.done) {
			res = await call('imports.apply', { id: imp.id });
			steps++;
		}
		const t3 = Date.now();
		expect(steps).toBe(2);
		expect(res.import.applied).toMatchObject({ new: 3000, phones: 3000 });
		console.log(`3000 rows: upload ${t1 - t0} ms, validate ${t2 - t1} ms, apply ${t3 - t2} ms`);
	});
});

describe('imports: stav z robota', () => {
	const A = icoFromPrefix(9950001);
	const B = icoFromPrefix(9950002);
	const C = icoFromPrefix(9950003);
	const D = icoFromPrefix(9950004);
	const E = icoFromPrefix(9950005);

	it('writes owner, missing-in-Siebel and other-owner, and leaves a company with another state alone', async () => {
		// D is already with a sales rep: the import must not touch its state.
		await db.run(`insert into companies (ico, name, state, holder_type, holder_login) values ($1, 'Testovací D', 'login_oz', 'login_oz', 'TEST_OZ01')`, [D]);
		const started = await call('imports.start', {
			filename: 'robot.xlsx',
			sheetName: 'List1',
			mapping: { ico: ['IČO'], name: ['Název'], robot_status: ['Stav z robota'], owned_from: ['Vlastnictví od'] },
			declaredRows: 5,
			emptyRows: 0
		});
		const id = started.id;
		await call('imports.appendRows', {
			id,
			rows: [
				{ rowNo: 2, data: { ico: A, name: 'Testovací A', robot_status: 'ANO', owned_from: '01. 11. 2026' } },
				{ rowNo: 3, data: { ico: B, name: 'Testovací B', robot_status: 'ano - doplň do Siebelu' } },
				{ rowNo: 4, data: { ico: C, name: 'Testovací C', robot_status: ' NE ' } },
				{ rowNo: 5, data: { ico: D, name: 'Testovací D', robot_status: 'ANO' } },
				{ rowNo: 6, data: { ico: E, name: 'Testovací E', robot_status: 'možná' } }
			]
		});
		let state = await call('imports.validate', { id });
		while (!state.done) state = await call('imports.validate', { id });
		const checked = await call('imports.get', { id });
		expect(checked.robot).toEqual({ owned: 1, otherOwner: 1, missing: 1, skipped: 1 });
		const warn = await call('imports.rows', { id, kind: 'warning' });
		expect(warn.items.map((w: { problem: string }) => w.problem).join(' | ')).toContain('stav z robota se nepoužije');
		expect(warn.items.map((w: { problem: string }) => w.problem).join(' | ')).toContain('Neznámý stav z robota');

		let applied = await call('imports.apply', { id, confirm: true });
		while (!applied.done) applied = await call('imports.apply', { id });

		const rows = await db.query<Record<string, any>>(
			`select ico, state, holder_type, holder_login, owned_from, ownership_ends_on from companies where ico = any($1::char(8)[]) order by ico`,
			[[A, B, C, D, E]]
		);
		const by = Object.fromEntries(rows.map((r) => [r.ico, r]));
		expect(by[A]).toMatchObject({ state: 'superuser', holder_type: 'superuser', holder_login: 'KAJZAR2', owned_from: '2026-11-01', ownership_ends_on: '2026-12-01' });
		expect(by[B]).toMatchObject({ state: 'neni_v_siebelu', holder_type: 'neznamo', owned_from: null });
		expect(by[C]).toMatchObject({ state: 'v_poolu', holder_type: 'jiny_partner', holder_login: null });
		expect(by[D]).toMatchObject({ state: 'login_oz', holder_type: 'login_oz', holder_login: 'TEST_OZ01' });
		expect(by[E]).toMatchObject({ state: 'v_poolu', holder_type: 'neznamo' });

		const history = await db.query<Record<string, any>>(
			`select ico, from_state, to_state, to_holder, reason_code, source from company_state_history
			 where ico = any($1::char(8)[]) and reason_code like 'import_robot%' order by ico`,
			[[A, B, C, D, E]]
		);
		expect(history).toEqual([
			{ ico: A, from_state: 'v_poolu', to_state: 'superuser', to_holder: 'superuser:KAJZAR2', reason_code: 'import_robot_owned', source: 'import' },
			{ ico: B, from_state: 'v_poolu', to_state: 'neni_v_siebelu', to_holder: 'neznamo', reason_code: 'import_robot_missing', source: 'import' },
			{ ico: C, from_state: 'v_poolu', to_state: 'v_poolu', to_holder: 'jiny_partner', reason_code: 'import_robot_other_owner', source: 'import' }
		]);
	});

	it('the same file again changes nothing and writes no second history row', async () => {
		const started = await call('imports.start', {
			filename: 'robot.xlsx',
			sheetName: 'List1',
			mapping: { ico: ['IČO'], robot_status: ['Stav z robota'] },
			declaredRows: 2,
			emptyRows: 0
		});
		const id = started.id;
		await call('imports.appendRows', {
			id,
			rows: [
				{ rowNo: 2, data: { ico: B, robot_status: 'ANO - doplň do Siebelu' } },
				{ rowNo: 3, data: { ico: C, robot_status: 'NE' } }
			]
		});
		let state = await call('imports.validate', { id });
		while (!state.done) state = await call('imports.validate', { id });
		let applied = await call('imports.apply', { id, confirm: true });
		while (!applied.done) applied = await call('imports.apply', { id });
		const n = await db.one<{ n: number }>(
			`select count(*)::int as n from company_state_history where ico = any($1::char(8)[]) and reason_code like 'import_robot%'`,
			[[B, C]]
		);
		expect(n!.n).toBe(2);
	});
});

describe('imports: differences against the database and the choice what to overwrite', () => {
	const P = icoFromPrefix(9951001);
	const Q = icoFromPrefix(9951002);

	async function staged() {
		const started = await call('imports.start', {
			filename: 'rozdily.xlsx',
			sheetName: 'List1',
			mapping: { ico: ['IČO'], name: ['Název'], subject_type: ['Typ'], ca_number: ['CA'] },
			declaredRows: 2,
			emptyRows: 0
		});
		await call('imports.appendRows', {
			id: started.id,
			rows: [
				{ rowNo: 2, data: { ico: P, name: 'Nový název P', subject_type: 'PO', ca_number: '111' } },
				{ rowNo: 3, data: { ico: Q, name: 'Testovací Q', subject_type: 'FO', ca_number: '222' } }
			]
		});
		let state = await call('imports.validate', { id: started.id });
		while (!state.done) state = await call('imports.validate', { id: started.id });
		return started.id as number;
	}

	it('counts what differs and what would only be filled in, and lists the differing values', async () => {
		// P: another name and type, no CA yet. Q: the same name, no type, another CA.
		await db.run(`insert into companies (ico, name, subject_type, ca_number) values ($1, 'Starý název P', 'FO', null), ($2, 'Testovací Q', null, '999')`, [P, Q]);
		const id = await staged();
		const diff = await call('imports.diff', { id });
		const by = Object.fromEntries(diff.fields.map((f: any) => [f.field, f]));
		expect(by.name).toMatchObject({ differs: 1, fills: 0, overwrite: true });
		expect(by.subject_type).toMatchObject({ differs: 1, fills: 1 });
		expect(by.ca_number).toMatchObject({ differs: 1, fills: 1 });
		expect(by.region).toMatchObject({ differs: 0, fills: 0 });

		const names = await call('imports.diffRows', { id, field: 'name' });
		expect(names.items).toEqual([{ rowNo: 2, ico: P, field: 'name', label: 'Název', current: 'Starý název P', incoming: 'Nový název P' }]);
		const all = await call('imports.diffRows', { id });
		expect(all.items.map((i: any) => [i.ico, i.field])).toEqual([
			[P, 'name'],
			[P, 'subject_type'],
			[Q, 'ca_number']
		]);
		expect(all.done).toBe(true);
		await expectError(call('imports.diffRows', { id, field: 'state' }), 'field_invalid');
		await call('imports.cancel', { id });
		await expectError(call('imports.diff', { id }), 'import_wrong_status');
	});

	it('overwrites only the chosen fields; a missing value is filled in always', async () => {
		const id = await staged();
		await expectError(call('imports.apply', { id, confirm: true, overwrite: ['state'] }), 'overwrite_invalid');
		// Overwrite the CA only: names and types that differ stay as they are.
		let applied = await call('imports.apply', { id, confirm: true, overwrite: ['ca_number'] });
		while (!applied.done) applied = await call('imports.apply', { id });
		const rows = await db.query<Record<string, any>>(`select ico, name, subject_type, ca_number from companies where ico = any($1::char(8)[]) order by ico`, [[P, Q]]);
		expect(rows).toEqual([
			{ ico: P, name: 'Starý název P', subject_type: 'FO', ca_number: '111' }, // CA filled in, the rest kept
			{ ico: Q, name: 'Testovací Q', subject_type: 'FO', ca_number: '222' } // type filled in, CA overwritten
		]);
		const log = await db.one<{ details: any }>(`select details from audit_log where action = 'import.confirmed' order by id desc limit 1`);
		expect(log!.details.overwrite_fields).toEqual(['ca_number']);
	});
});

describe('imports: operator from the file and the age of information', () => {
	const A = icoFromPrefix(9952001);
	const B = icoFromPrefix(9952002);

	it('writes the operator to the first phone with the day of the import, and marks the state as verified', async () => {
		const started = await call('imports.start', {
			filename: 'operator.xlsx',
			sheetName: 'List1',
			mapping: { ico: ['IČO'], phone: ['Telefon', 'Telefon 2'], operator: ['Operátor'], robot_status: ['Stav z robota'] },
			declaredRows: 2,
			emptyRows: 0
		});
		const id = started.id;
		await call('imports.appendRows', {
			id,
			rows: [
				{ rowNo: 2, data: { ico: A, phones: ['+420 000 520 001', '+420 000 520 002'], operator: 'T-Mobile', robot_status: 'ANO' } },
				{ rowNo: 3, data: { ico: B, phones: ['+420 000 520 003'], operator: 'Orange' } }
			]
		});
		let state = await call('imports.validate', { id });
		while (!state.done) state = await call('imports.validate', { id });
		const warn = await call('imports.rows', { id, kind: 'warning' });
		expect(warn.items.map((w: { problem: string }) => w.problem).join(' | ')).toContain('Neznámý operátor');
		let applied = await call('imports.apply', { id, confirm: true });
		while (!applied.done) applied = await call('imports.apply', { id });

		const phones = await db.query<Record<string, any>>(
			`select phone, operator, operator_verified_at is not null as verified from company_phones where ico = any($1::char(8)[]) order by phone`,
			[[A, B]]
		);
		expect(phones).toEqual([
			{ phone: '+420000520001', operator: 'TM', verified: true },
			{ phone: '+420000520002', operator: null, verified: false },
			{ phone: '+420000520003', operator: null, verified: false }
		]);
		const companies = await db.query<Record<string, any>>(
			`select ico, state, state_verified_at is not null as verified from companies where ico = any($1::char(8)[]) order by ico`,
			[[A, B]]
		);
		expect(companies).toEqual([
			{ ico: A, state: 'superuser', verified: true },
			{ ico: B, state: 'v_poolu', verified: false }
		]);
	});
});
