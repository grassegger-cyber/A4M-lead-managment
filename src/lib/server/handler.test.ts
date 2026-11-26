// The gate of the API: who gets in and who does not. In-memory database with the real migrations;
// the login service is replaced by a table of fictional tokens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from './db.ts';
import type { Db } from './db.ts';
import { createHandler } from './handler.ts';
import type { VerifiedUser } from './handler.ts';
import { supabaseVerifier, tokenAal } from './cloud.ts';

const ORIGIN = 'https://app.example.test';
const TOKENS: Record<string, VerifiedUser> = {
	'owner-aal2': { id: '00000000-0000-4000-8000-000000000001', email: 'Vedeni@Example.test', aal: 'aal2' },
	'owner-aal1': { id: '00000000-0000-4000-8000-000000000001', email: 'vedeni@example.test', aal: 'aal1' },
	'stranger-aal2': { id: '00000000-0000-4000-8000-000000000002', email: 'cizi@example.test', aal: 'aal2' }
};

let db: Db;
let handle: (request: Request) => Promise<Response>;

function request(token: string | null, body: unknown, headers: Record<string, string> = {}): Request {
	return new Request('https://api.example.test/functions/v1/api', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			origin: ORIGIN,
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...headers
		},
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

beforeAll(async () => {
	db = await openDb({ dir: 'memory' });
	handle = createHandler({
		getDb: async () => db,
		verifyToken: async (token) => TOKENS[token] ?? null,
		allowedEmails: new Set(['vedeni@example.test']),
		allowedOrigins: new Set([ORIGIN]),
		region: 'eu-central-1'
	});
});

afterAll(async () => {
	await db.close();
});

describe('api gate', () => {
	it('lets a whitelisted user with a 2FA session in and creates the users row once', async () => {
		const response = await handle(request('owner-aal2', { method: 'auth.me' }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, data: { name: 'vedeni@example.test', email: 'vedeni@example.test' } });
		expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
		expect(response.headers.get('x-served-region')).toBe('eu-central-1');
		await handle(request('owner-aal2', { method: 'auth.sessionStarted' }));
		const users = await db.query<{ email: string; last_login_at: Date | null }>('select email, last_login_at from users');
		expect(users).toHaveLength(1);
		expect(users[0].last_login_at).not.toBeNull();
		const log = await db.one<{ actor_id: string; actor_name: string }>(`select actor_id, actor_name from audit_log where action = 'auth.login'`);
		expect(log).toEqual({ actor_id: TOKENS['owner-aal2'].id, actor_name: 'vedeni@example.test' });
	});

	it('gives nothing without a token, with an unknown token or with a password-only session', async () => {
		for (const [token, code] of [
			[null, 'unauthenticated'],
			['made-up', 'unauthenticated'],
			['owner-aal1', 'mfa_required']
		] as const) {
			const response = await handle(request(token, { method: 'companies.list' }));
			expect(response.status).toBe(401);
			expect((await response.json()).code).toBe(code);
		}
	});

	it('refuses a logged-in person who is not on the whitelist and creates no row for them', async () => {
		const response = await handle(request('stranger-aal2', { method: 'companies.list' }));
		expect(response.status).toBe(403);
		expect((await response.json()).code).toBe('forbidden_user');
		expect((await db.one<{ n: number }>('select count(*)::int as n from users'))!.n).toBe(1);
	});

	it('refuses a deactivated user', async () => {
		await db.run('update users set active = false');
		const response = await handle(request('owner-aal2', { method: 'auth.me' }));
		expect(response.status).toBe(403);
		await db.run('update users set active = true');
	});

	it('refuses a foreign origin, a wrong content type, a wrong verb and an unknown method', async () => {
		expect((await handle(request('owner-aal2', { method: 'auth.me' }, { origin: 'https://evil.example.test' }))).status).toBe(403);
		expect((await handle(request('owner-aal2', '{"method":"auth.me"}', { 'content-type': 'text/plain' }))).status).toBe(415);
		expect((await handle(new Request('https://api.example.test/', { method: 'GET' }))).status).toBe(405);
		expect((await handle(request('owner-aal2', { method: 'auth.login' }))).status).toBe(404);
		expect((await handle(request('owner-aal2', 'not json'))).status).toBe(400);
	});

	it('answers the preflight only for the application origin', async () => {
		const preflight = (origin: string) =>
			handle(new Request('https://api.example.test/', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } }));
		const own = await preflight(ORIGIN);
		expect(own.status).toBe(204);
		expect(own.headers.get('access-control-allow-headers')).toContain('authorization');
		expect((await preflight('https://evil.example.test')).headers.get('access-control-allow-origin')).toBeNull();
	});
});

describe('every table is closed to the browser', () => {
	it('has row level security on and no policy', async () => {
		const open = await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
		expect(open.map((t) => t.tablename)).toEqual([]);
		const policies = await db.one<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`);
		expect(policies!.n).toBe(0);
	});
});

describe('token check against the login service', () => {
	const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

	it('reads the assurance level and survives rubbish', () => {
		expect(tokenAal(jwt({ aal: 'aal2' }))).toBe('aal2');
		expect(tokenAal(jwt({}))).toBe('');
		expect(tokenAal('rubbish')).toBe('');
	});

	it('accepts only what the service confirms', async () => {
		const calls: string[] = [];
		const fakeFetch = (async (url: string, init: RequestInit) => {
			calls.push(url);
			const token = String((init.headers as Record<string, string>).authorization).slice(7);
			if (token.startsWith('x.')) return new Response(JSON.stringify({ id: 'u1', email: 'vedeni@example.test' }), { status: 200 });
			return new Response('{}', { status: 401 });
		}) as unknown as typeof fetch;
		const verify = supabaseVerifier('https://project.example.test/', 'anon', fakeFetch);
		expect(await verify(jwt({ aal: 'aal2' }))).toEqual({ id: 'u1', email: 'vedeni@example.test', aal: 'aal2' });
		expect(await verify('forged')).toBeNull();
		expect(calls[0]).toBe('https://project.example.test/auth/v1/user');
	});
});
