// Entry of the cloud api function (Supabase Edge Function, Deno). scripts/build-api.mjs bundles
// this file into supabase/functions/api/bundle.js; index.ts there hands in the environment and
// the "postgres" library. Nothing here may import Node modules.
import { openPostgres } from './db-postgres.ts';
import type { PostgresFactory } from './db-postgres.ts';
import type { Db } from './db-types.ts';
import { createHandler } from './handler.ts';
import type { VerifiedUser } from './handler.ts';

export interface CloudOptions {
	env(name: string): string | undefined;
	postgres: PostgresFactory;
	fetch?: typeof fetch;
}

function list(value: string | undefined): Set<string> {
	return new Set(
		(value ?? '')
			.split(/[\s,;]+/)
			.map((item) => item.trim())
			.filter(Boolean)
	);
}

/** Reads the assurance level from a token the login service has just accepted as genuine. */
export function tokenAal(token: string): string {
	try {
		const payload = token.split('.')[1] ?? '';
		const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
		const text = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
		const aal = JSON.parse(text)?.aal;
		return typeof aal === 'string' ? aal : '';
	} catch {
		return '';
	}
}

/** Asks Supabase Auth whether the token is valid (signature, expiry, session not ended). */
export function supabaseVerifier(supabaseUrl: string, anonKey: string, doFetch: typeof fetch) {
	return async (token: string): Promise<VerifiedUser | null> => {
		const response = await doFetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
			headers: { apikey: anonKey, authorization: `Bearer ${token}` }
		});
		if (response.status === 401 || response.status === 403) return null;
		if (!response.ok) throw new Error(`auth service answered ${response.status}`);
		const user = (await response.json()) as { id?: unknown; email?: unknown };
		if (typeof user?.id !== 'string' || typeof user?.email !== 'string' || !user.email) return null;
		return { id: user.id, email: user.email, aal: tokenAal(token) };
	};
}

export function createCloudHandler(options: CloudOptions): (request: Request) => Promise<Response> {
	const env = (name: string): string => {
		const value = options.env(name);
		if (!value) throw new Error(`Missing environment variable ${name}`);
		return value;
	};
	let db: Db | null = null;
	let handler: ((request: Request) => Promise<Response>) | null = null;
	return async (request) => {
		try {
			handler ??= createHandler({
				// The connection is opened on first use and kept while the worker lives.
				getDb: async () => (db ??= openPostgres(options.postgres, options.env('DATABASE_URL') || env('SUPABASE_DB_URL'))),
				verifyToken: supabaseVerifier(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), options.fetch ?? fetch),
				allowedEmails: new Set([...list(env('ALLOWED_EMAILS'))].map((email) => email.toLowerCase())),
				allowedOrigins: list(env('ALLOWED_ORIGINS')),
				region: options.env('SB_REGION') ?? null
			});
		} catch (e) {
			console.error('[api] configuration:', e instanceof Error ? e.message : e);
			return new Response(JSON.stringify({ ok: false, error: 'Server není nastavený.', code: 'not_configured' }), {
				status: 503,
				headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
			});
		}
		return handler(request);
	};
}
