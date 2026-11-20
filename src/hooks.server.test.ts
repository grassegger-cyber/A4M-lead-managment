// The request gate (hooks.server.ts) together with the real POST /api endpoint.
// A temporary DATA_DIR holds the database and auth.json; ./data.nosync is never touched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from './hooks.server';
import { POST } from './routes/api/+server';
import { closeDb } from '$lib/server/db';
import { SESSION_COOKIE } from '$lib/server/auth';

const ORIGIN = 'http://127.0.0.1:5180';
const PASSWORD = `test-${crypto.randomBytes(8).toString('hex')}`;

let dataDir: string;
let previousDataDir: string | undefined;

interface Options {
	method?: string;
	/** Path as the browser sent it (may be percent-encoded). */
	path?: string;
	/** Route SvelteKit resolved from the decoded path. */
	route?: string | null;
	headers?: Record<string, string>;
	body?: unknown;
	rawBody?: string;
	cookie?: string;
	address?: string;
	base?: string;
}

/** Runs one request through the hook; the API route is answered by the real endpoint. */
async function send(options: Options = {}): Promise<{ status: number; json: any; text: string; response: Response; cookie: string | undefined }> {
	const method = options.method ?? 'POST';
	const base = options.base ?? ORIGIN;
	const url = new URL((options.path ?? '/api') + '', base);
	const isBodyMethod = method !== 'GET' && method !== 'HEAD';
	const headers = new Headers({ host: url.host, ...(isBodyMethod ? { 'content-type': 'application/json' } : {}), ...options.headers });
	const body = !isBodyMethod ? undefined : (options.rawBody ?? JSON.stringify(options.body ?? {}));
	const store = new Map<string, string>();
	if (options.cookie) store.set(SESSION_COOKIE, options.cookie);
	const route = options.route === undefined ? '/api' : options.route;
	const event = {
		url,
		request: new Request(url, { method, headers, body }),
		cookies: {
			get: (name: string) => store.get(name),
			set: (name: string, value: string) => void store.set(name, value),
			delete: (name: string) => void store.delete(name)
		},
		locals: {},
		params: {},
		route: { id: route },
		getClientAddress: () => options.address ?? '127.0.0.1'
	} as unknown as RequestEvent;
	const response = await handle({
		event,
		resolve: async (e) => (route === '/api' && method === 'POST' ? POST(e as never) : new Response('page', { status: 200 }))
	});
	const text = await response.clone().text();
	let json: any = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: response.status, json, text, response, cookie: store.get(SESSION_COOKIE) };
}

beforeAll(() => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a4m-lm-hooktest-'));
	previousDataDir = process.env.DATA_DIR;
	process.env.DATA_DIR = dataDir;
});

afterAll(async () => {
	await closeDb();
	if (previousDataDir === undefined) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = previousDataDir;
	fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('before a password exists', () => {
	it('sends every page to the first-run page and answers the public methods only', async () => {
		const page = await send({ method: 'GET', path: '/ico', route: '/ico' });
		expect(page.status).toBe(303);
		expect(page.response.headers.get('location')).toBe('/nastaveni-hesla');
		expect((await send({ method: 'GET', path: '/nastaveni-hesla', route: '/nastaveni-hesla' })).status).toBe(200);
		expect((await send({ body: { method: 'auth.status' } })).json).toEqual({ ok: true, data: { passwordSet: false, authenticated: false } });
		expect((await send({ body: { method: 'companies.list' } })).status).toBe(401);
		// The database of this test lives in the temporary folder, guarded by its lock file.
		expect(fs.existsSync(path.join(dataDir, 'pglite.lock'))).toBe(true);
	});
});

describe('same origin', () => {
	const foreign = { origin: 'http://127.0.0.1:4321' };

	it('refuses a foreign Origin on the API', async () => {
		const result = await send({ headers: foreign, body: { method: 'auth.status' } });
		expect(result.status).toBe(403);
		expect(result.json).toMatchObject({ ok: false, code: 'forbidden_origin' });
		expect((await send({ headers: { origin: 'null' }, body: { method: 'auth.status' } })).status).toBe(403);
		expect((await send({ headers: { origin: 'https://127.0.0.1:5180' }, body: { method: 'auth.status' } })).status).toBe(403);
	});

	it('treats a percent-encoded path of the API route as the API', async () => {
		// SvelteKit resolves the route from the decoded path: /%61pi reaches the same endpoint.
		for (const encoded of ['/%61pi', '/a%70i', '/%61%70%69']) {
			const result = await send({ path: encoded, headers: foreign, body: { method: 'auth.status' } });
			expect(result.status, encoded).toBe(403);
			expect(result.json, encoded).toMatchObject({ code: 'forbidden_origin' });
			// Without a session the encoded path answers like the API (401 JSON), not like a page (redirect).
			expect((await send({ path: encoded, body: { method: 'companies.list' } })).status, encoded).toBe(401);
		}
	});

	it('checks the Origin of every request that is not a plain read, on any path', async () => {
		expect((await send({ path: '/ico', route: '/ico', headers: foreign })).status).toBe(403);
		expect((await send({ method: 'OPTIONS', headers: foreign })).status).toBe(403);
		expect((await send({ method: 'DELETE', path: '/cokoli', route: null, headers: foreign })).status).toBe(403);
		// A read from elsewhere is not a state change; it only meets the login gate.
		expect((await send({ method: 'GET', path: '/ico', route: '/ico', headers: foreign })).status).toBe(303);
	});

	it('accepts the own origin, also under another loopback name', async () => {
		for (const origin of [ORIGIN, 'http://localhost:5180', 'http://[::1]:5180']) {
			expect((await send({ headers: { origin }, body: { method: 'auth.status' } })).status, origin).toBe(200);
		}
		// Another port of the same computer is another origin.
		expect((await send({ headers: { origin: 'http://localhost:5181' }, body: { method: 'auth.status' } })).status).toBe(403);
	});

	it('answers JSON requests only and refuses what the browser marks as cross-site', async () => {
		const plain = await send({ headers: { 'content-type': 'text/plain' }, rawBody: JSON.stringify({ method: 'auth.status' }) });
		expect(plain.status).toBe(415);
		// A form body names no method the gate could let through without a session.
		expect((await send({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, rawBody: 'method=auth.status' })).status).toBe(401);
		for (const site of ['cross-site', 'same-site']) {
			const result = await send({ headers: { 'sec-fetch-site': site }, body: { method: 'auth.status' } });
			expect(result.status, site).toBe(403);
		}
		expect((await send({ headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' }, body: { method: 'auth.status' } })).status).toBe(200);
	});
});

describe('local access only', () => {
	it('refuses a caller from another computer and a foreign host name', async () => {
		const remote = await send({ address: '192.168.1.20', body: { method: 'auth.status' } });
		expect(remote.status).toBe(403);
		expect(remote.json).toMatchObject({ code: 'forbidden_remote' });
		expect((await send({ method: 'GET', path: '/prihlaseni', route: '/prihlaseni', address: '10.0.0.5' })).status).toBe(403);
		// DNS rebinding: the request arrives locally but asks for somebody else's name.
		expect((await send({ headers: { host: 'attacker.example:5180' }, body: { method: 'auth.status' } })).status).toBe(403);
		expect((await send({ base: 'http://attacker.example:5180', body: { method: 'auth.status' } })).status).toBe(403);
		for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
			expect((await send({ address, body: { method: 'auth.status' } })).status, address).toBe(200);
		}
	});
});

describe('session', () => {
	let cookie: string | undefined;

	it('logs in through the endpoint and then reaches the other methods', async () => {
		const first = await send({ headers: { origin: ORIGIN }, body: { method: 'auth.setPassword', args: { password: PASSWORD } } });
		expect(first.json).toMatchObject({ ok: true, data: { authenticated: true } });
		cookie = first.cookie;
		expect(cookie).toBeTruthy();

		const list = await send({ cookie, body: { method: 'companies.list', args: {} } });
		expect(list.status).toBe(200);
		expect(list.json).toMatchObject({ ok: true, data: { total: 0, rows: [] } });
		expect((await send({ cookie, body: { method: 'no.such' } })).status).toBe(404);
		expect((await send({ cookie, rawBody: '{broken' })).status).toBe(400);
		// With a session too: only JSON, so a page of another origin cannot post without a preflight.
		for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
			const result = await send({ cookie, headers: { 'content-type': type }, rawBody: JSON.stringify({ method: 'settings.list' }) });
			expect(result.status, type).toBe(415);
		}
		expect((await send({ cookie, headers: { 'sec-fetch-site': 'cross-site' }, body: { method: 'settings.list' } })).status).toBe(403);
	});

	it('keeps every method but the public ones behind the session', async () => {
		for (const method of ['companies.list', 'companies.export', 'settings.list', 'audit.list', 'imports.list', 'dashboard.overview', 'auth.changePassword']) {
			const result = await send({ body: { method, args: {} } });
			expect(result.status, method).toBe(401);
			expect(result.json, method).toMatchObject({ ok: false, code: 'unauthenticated' });
		}
		expect((await send({ cookie: 'not-a-session', body: { method: 'companies.list' } })).status).toBe(401);
		// A session does not lift the origin check.
		expect((await send({ cookie, headers: { origin: 'http://127.0.0.1:4321' }, body: { method: 'companies.list' } })).status).toBe(403);
		expect((await send({ cookie, path: '/%61pi', headers: { origin: 'http://127.0.0.1:4321' }, body: { method: 'settings.list' } })).status).toBe(403);
	});

	it('gates the pages by the session', async () => {
		const anonymous = await send({ method: 'GET', path: '/ico', route: '/ico' });
		expect(anonymous.status).toBe(303);
		expect(anonymous.response.headers.get('location')).toBe('/prihlaseni');
		const page = await send({ method: 'GET', path: '/ico', route: '/ico', cookie });
		expect(page.status).toBe(200);
		expect(page.response.headers.get('x-frame-options')).toBe('DENY');
		expect(page.response.headers.get('cache-control')).toBe('no-store');
		expect((await send({ method: 'GET', path: '/prihlaseni', route: '/prihlaseni', cookie })).response.headers.get('location')).toBe('/');
	});

	it('ends with logout', async () => {
		expect((await send({ cookie, body: { method: 'auth.logout' } })).json).toMatchObject({ ok: true });
		expect((await send({ cookie, body: { method: 'companies.list' } })).status).toBe(401);
	});

	it('stays locked when the password file is damaged', async () => {
		const file = path.join(dataDir, 'auth.json');
		const good = fs.readFileSync(file, 'utf8');
		fs.writeFileSync(file, '{');
		try {
			const page = await send({ method: 'GET', path: '/', route: '/' });
			expect(page.status).toBe(503);
			expect(page.text).toContain('auth.json');
			const api = await send({ body: { method: 'auth.setPassword', args: { password: PASSWORD } } });
			expect(api.status).toBe(503);
			expect(api.json).toMatchObject({ ok: false, code: 'auth_file_unreadable' });
		} finally {
			fs.writeFileSync(file, good);
		}
	});
});
