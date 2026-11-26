// The application's own API, independent of where it runs (Supabase function, local dev server):
// POST { method, args } → { ok, data } | { ok: false, error, code }.
// Login is checked once here, before any method runs. There is no public method.
import type { Ctx } from './context.ts';
import type { Queryable } from './db-types.ts';
import { AppError, isAppError } from './errors.ts';
import { getMethod } from './registry.ts';

export interface VerifiedUser {
	id: string;
	email: string;
	/** Authenticator assurance level of this session: 'aal2' means the second factor was verified. */
	aal: string;
}

export interface HandlerDeps {
	getDb(): Promise<Queryable>;
	/** Verifies the bearer token with the login service. Returns null when it is missing or invalid. */
	verifyToken(token: string): Promise<VerifiedUser | null>;
	/** E-mails (lower case) that may use the application. */
	allowedEmails: ReadonlySet<string>;
	/** Origins of the web application allowed to call the API from a browser. */
	allowedOrigins: ReadonlySet<string>;
	now?: () => Date;
	/** Region the function ran in, reported back in a header (EU check). */
	region?: string | null;
}

const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info, x-region';

function corsHeaders(deps: HandlerDeps, request: Request): Record<string, string> {
	const origin = request.headers.get('origin');
	const headers: Record<string, string> = { vary: 'Origin' };
	if (origin && deps.allowedOrigins.has(origin)) {
		headers['access-control-allow-origin'] = origin;
		headers['access-control-allow-methods'] = 'POST, OPTIONS';
		headers['access-control-allow-headers'] = ALLOWED_HEADERS;
		headers['access-control-expose-headers'] = 'x-served-region';
		headers['access-control-max-age'] = '600';
	}
	return headers;
}

function json(body: unknown, status: number, extra: Record<string, string>): Response {
	// BigInt values (rare, very large counters) become strings.
	const text = JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
	return new Response(text, {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff',
			...extra
		}
	});
}

function clientIp(request: Request): string | null {
	const forwarded = request.headers.get('x-forwarded-for');
	return forwarded ? forwarded.split(',')[0].trim().slice(0, 60) || null : null;
}

/**
 * Finds the whitelist row of a verified user. A person whose e-mail is on the list of allowed
 * e-mails gets the row on the first login that passed 2FA; nobody else ever gets one.
 */
async function resolveUser(db: Queryable, deps: HandlerDeps, user: VerifiedUser, now: Date) {
	const email = user.email.toLowerCase();
	type UserRow = { id: string; email: string; first_name: string | null; last_name: string | null; active: boolean };
	let row = await db.one<UserRow>('select id, email, first_name, last_name, active from users where id = $1', [user.id]);
	if (!row && deps.allowedEmails.has(email)) {
		await db.run('insert into users (id, email, created_at) values ($1, $2, $3) on conflict do nothing', [user.id, email, now]);
		row = await db.one<UserRow>('select id, email, first_name, last_name, active from users where id = $1', [user.id]);
	}
	// The row must still match the verified e-mail and the e-mail must still be allowed.
	if (!row || !row.active || row.email !== email || !deps.allowedEmails.has(email)) return null;
	return row;
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
	const now = deps.now ?? (() => new Date());
	return async (request) => {
		const cors = corsHeaders(deps, request);
		if (deps.region) cors['x-served-region'] = deps.region;
		const fail = (error: string, code: string, status: number) => json({ ok: false, error, code }, status, cors);

		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
		if (request.method !== 'POST') return fail('Nepodporovaný požadavek.', 'method_not_allowed', 405);
		// A browser must come from the application itself; a request without Origin is not from a web page.
		const origin = request.headers.get('origin');
		if (origin !== null && !deps.allowedOrigins.has(origin)) return fail('Požadavek z cizí adresy.', 'forbidden_origin', 403);
		const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		if (contentType !== 'application/json') return fail('Požadavek musí být ve formátu JSON.', 'unsupported_media_type', 415);

		let name = '';
		try {
			const authorization = request.headers.get('authorization') ?? '';
			const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
			const verified = token ? await deps.verifyToken(token) : null;
			if (!verified) return fail('Nejste přihlášeni.', 'unauthenticated', 401);
			// A session with the password only gets nothing, also when the account has a factor.
			if (verified.aal !== 'aal2') return fail('Přihlášení není dokončené: chybí ověřovací kód.', 'mfa_required', 401);

			const db = await deps.getDb();
			const row = await resolveUser(db, deps, verified, now());
			if (!row) return fail('Tento účet nemá do aplikace přístup.', 'forbidden_user', 403);

			let body: { method?: unknown; args?: unknown };
			try {
				body = await request.json();
			} catch {
				return fail('Požadavek není platný JSON.', 'bad_request', 400);
			}
			name = typeof body?.method === 'string' ? body.method : '';
			const method = getMethod(name);
			if (!method) return fail('Neznámá metoda.', 'unknown_method', 404);

			const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ');
			const ctx: Ctx = {
				db,
				now,
				actor: { id: row.id, name: fullName || row.email },
				user: { id: row.id, email: row.email },
				ip: clientIp(request),
				userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null
			};
			const result = await method(ctx, body.args ?? {});
			return json({ ok: true, data: result ?? null }, 200, cors);
		} catch (e) {
			if (isAppError(e)) return fail(e.message, (e as AppError).code, (e as AppError).status);
			// Log the method and the error text only, never the request body.
			console.error(`[api] ${name || '(before method)'} failed:`, e instanceof Error ? e.message : e);
			return fail('Neočekávaná chyba serveru.', 'internal', 500);
		}
	};
}
