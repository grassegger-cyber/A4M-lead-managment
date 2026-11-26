// The demo build: kept apart from the local application, and its stand-ins behave like the
// originals. Runs against in-memory databases with fictional data only; never touches ./data.nosync.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { Db } from '../server/db.ts';
import { AppError } from '../server/errors.ts';
import { systemCtx } from '../server/context.ts';
import { seedFictionalCompanies } from '../server/seed-core.ts';
import { methods as companies } from '../server/methods/companies.ts';
import { methods as realAuth } from '../server/methods/auth.ts';
import { methods as demoAuth } from './auth-methods.ts';
import { migrationNames, openDemoDb } from './db.ts';
import { runMethod, toJson } from './runtime.ts';
import { PAGE_SWAPS, WORKER_SWAPS } from './swaps.ts';

// In this file companies.export writes with the demo's in-memory Excel writer, as in the demo worker.
vi.mock('../server/xlsx-writer.ts', () => import('./xlsx-writer.ts'));

const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
		const relative = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(relative);
		return /\.(ts|js|svelte)$/.test(entry.name) ? [relative] : [];
	});
}

describe('separation from the local application', () => {
	it('nothing outside src/lib/demo imports the demo modules', () => {
		const files = [...sourceFiles('src'), ...sourceFiles('scripts'), 'vite.config.ts', 'svelte.config.js'].filter(
			(file) => !file.startsWith(path.join('src', 'lib', 'demo'))
		);
		const offenders = files.filter((file) => /(from\s+|import\s*\(\s*)['"][^'"]*\/demo\//.test(read(file)));
		expect(offenders).toEqual([]);
	});

	it('the configs of the local application do not mention the demo', () => {
		expect(read('vite.config.ts')).not.toMatch(/demo/i);
		expect(read('svelte.config.js')).not.toMatch(/demo/i);
	});

	it('every swapped module exists and its stand-in offers the same exports', async () => {
		for (const [from, to] of Object.entries({ ...PAGE_SWAPS, ...WORKER_SWAPS })) {
			expect(fs.existsSync(path.join(root, from)), from).toBe(true);
			expect(to.startsWith('src/lib/demo/'), to).toBe(true);
			const real = await vi.importActual<Record<string, unknown>>(path.join(root, from));
			const standIn = await vi.importActual<Record<string, unknown>>(path.join(root, to));
			expect(Object.keys(standIn).sort(), to).toEqual(Object.keys(real).sort());
		}
	});
});

describe('demo auth methods', () => {
	const ctx = systemCtx({} as Db);

	it('cover exactly the auth methods of the local application', () => {
		expect(Object.keys(demoAuth).sort()).toEqual(Object.keys(realAuth).sort());
	});

	it('answer as signed in and never change a password', async () => {
		expect(await demoAuth['auth.status'](ctx, {})).toEqual({ passwordSet: true, authenticated: true });
		expect(await demoAuth['auth.login'](ctx, { password: 'x' })).toEqual({ authenticated: true });
		expect(await demoAuth['auth.logout'](ctx, {})).toEqual({ authenticated: true });
		await expect(demoAuth['auth.changePassword'](ctx, { currentPassword: 'a', newPassword: 'b' })).rejects.toMatchObject({
			code: 'demo_no_password'
		});
	});
});

describe('runMethod (the demo worker’s POST /api)', () => {
	const ctx = systemCtx({} as Db);

	it('returns data as the JSON the server would send', async () => {
		const at = new Date('2026-11-20T08:00:00.000Z');
		const reply = await runMethod(async (_ctx, args) => ({ args, at, big: 12n, none: undefined }), ctx, 'x.y', '{"a":1}');
		expect(reply).toEqual({ ok: true, json: '{"args":{"a":1},"at":"2026-11-20T08:00:00.000Z","big":"12"}' });
		expect(toJson(null)).toBe('null');
	});

	it('returns files, Czech errors and hides unexpected ones', async () => {
		const file = await runMethod(
			async () => new Response('abc', { headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="a.txt"' } }),
			ctx,
			'x.file',
			'{}'
		);
		expect(file.ok && 'file' in file && new TextDecoder().decode(file.file.bytes)).toBe('abc');
		expect(await runMethod(undefined, ctx, 'x.nope', '{}')).toMatchObject({ ok: false, code: 'unknown_method', status: 404 });
		const failing = async () => {
			throw new AppError('bad_thing', 'Něco je špatně.', 409);
		};
		expect(await runMethod(failing, ctx, 'x.bad', '{}')).toEqual({ ok: false, error: 'Něco je špatně.', code: 'bad_thing', status: 409 });
		const crashing = async () => {
			throw new Error('secret detail');
		};
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await runMethod(crashing, ctx, 'x.crash', '{}')).toMatchObject({ ok: false, code: 'internal', status: 500 });
		errors.mockRestore();
	});
});

describe('demo database with the fictional seed', () => {
	let db: Db;
	const now = new Date(2026, 10, 20, 10, 0, 0);

	beforeAll(async () => {
		db = await openDemoDb('memory://');
	});
	afterAll(async () => {
		await db?.close();
	});

	it('applies the same migrations as the local database', async () => {
		const onDisk = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
		expect(migrationNames()).toEqual(onDisk);
		const applied = (await db.query<{ filename: string }>('select filename from schema_migrations order by filename')).map((r) => r.filename);
		expect(applied).toEqual(onDisk);
	});

	it('seeds fictional companies whose history ends in their state', async () => {
		const result = await seedFictionalCompanies(db, { count: 300, now });
		expect(result.companies).toBe(300);
		expect(Object.values(result.stateCounts).reduce((a, b) => a + b, 0)).toBe(300);
		const wrong = await db.one<{ n: number }>(
			`select count(*)::int as n from companies c
			 where c.state <> (select h.to_state from company_state_history h where h.ico = c.ico order by h.at desc, h.id desc limit 1)`
		);
		expect(wrong!.n).toBe(0);
		const notFictional = await db.one<{ n: number }>(
			"select count(*)::int as n from companies where ico not like '99%' or name not like '%Testovací%'"
		);
		expect(notFictional!.n).toBe(0);
	});

	it('produces the same data on every visit', async () => {
		const other = await openDemoDb('memory://');
		try {
			await seedFictionalCompanies(other, { count: 300, now });
			const rows = (d: Db) => d.query('select ico, name, state, holder_type, holder_login, region_code, founded_on from companies order by ico');
			expect(await rows(other)).toEqual(await rows(db));
		} finally {
			await other.close();
		}
	});

	it('exports to Excel with the in-memory writer', async () => {
		const ctx = systemCtx(db, { now: () => now, actor: { id: null, name: 'Test' } });
		const response = (await companies['companies.export'](ctx, {})) as Response;
		expect(response.headers.get('content-disposition')).toContain('ico-export-2026-11-20.xlsx');
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(await response.arrayBuffer());
		const sheet = workbook.getWorksheet('IČO')!;
		expect(sheet.rowCount).toBe(301);
		expect(sheet.getRow(1).getCell(1).value).toBe('IČO');
		expect(String(sheet.getRow(2).getCell(1).value)).toMatch(/^99\d{6}$/);
	});
});
