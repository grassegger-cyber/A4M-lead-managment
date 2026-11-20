// Gate for every request: local access only, same-origin for anything that can change state,
// the session, redirects for unauthenticated page requests and 401 for unauthenticated API calls.
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { DatabaseLockedError, closeDb, getDb } from '$lib/server/db';
import { PUBLIC_METHODS, SESSION_COOKIE, isPasswordSet, readSession } from '$lib/server/auth';
import { isAppError } from '$lib/server/errors';
import { apiJson } from '$lib/server/request';

const SET_PASSWORD_PATH = '/nastaveni-hesla';
const LOGIN_PATH = '/prihlaseni';
const API_ROUTE = '/api';

/** Names under which a browser on this computer reaches the server. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// adapter-node closes the HTTP listener on SIGTERM / SIGINT and then emits this event. Without
// an explicit exit the process lives on for as long as the database keeps a handle open, still
// holding the data folder. Registered once per process (this module is re-evaluated on hot reload).
const shutdownKey = Symbol.for('a4m.lead-management.shutdown');
const shutdownState = globalThis as typeof globalThis & { [shutdownKey]?: boolean };
if (!shutdownState[shutdownKey]) {
	shutdownState[shutdownKey] = true;
	(process as NodeJS.EventEmitter).on('sveltekit:shutdown', async () => {
		try {
			await closeDb();
		} catch (e) {
			console.error('[shutdown] closing the database failed:', e instanceof Error ? e.message : e);
		}
		process.exit(0);
	});
}

function redirectTo(location: string): Response {
	return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}

function plain(message: string, status: number): Response {
	return new Response(message, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
}

function hostnameOf(host: string | null): string | null {
	if (!host) return null;
	try {
		return new URL(`http://${host}`).hostname;
	} catch {
		return null;
	}
}

/**
 * The application is local: the caller must sit on this computer and must have asked for a
 * loopback name. This does not depend on how the server was started (HOST / ORIGIN variables),
 * and a foreign Host header (DNS rebinding) is refused as well.
 */
function isLocalRequest(event: RequestEvent): boolean {
	let address: string;
	try {
		address = event.getClientAddress();
	} catch {
		return false;
	}
	if (!LOOPBACK_ADDRESSES.has(address)) return false;
	if (!LOOPBACK_HOSTS.has(event.url.hostname)) return false;
	const requested = hostnameOf(event.request.headers.get('host'));
	return requested === null || LOOPBACK_HOSTS.has(requested);
}

/** True when the Origin header names this application (also under another loopback name). */
function isOwnOrigin(origin: string, url: URL): boolean {
	let from: URL;
	try {
		from = new URL(origin);
	} catch {
		return false; // includes the opaque origin "null"
	}
	if (from.origin === url.origin) return true;
	// The built server knows itself under the fixed ORIGIN (127.0.0.1); a browser may have opened
	// the same port as localhost or [::1].
	return (
		from.protocol === url.protocol &&
		from.port === url.port &&
		LOOPBACK_HOSTS.has(from.hostname) &&
		LOOPBACK_HOSTS.has(url.hostname)
	);
}

export const handle: Handle = async ({ event, resolve }) => {
	// The route is resolved by SvelteKit from the decoded path, so /%61pi is the API too.
	const isApi = event.route.id === API_ROUTE;
	const refuse = (message: string, code: string, status: number) =>
		isApi ? apiJson({ ok: false, error: message, code }, status) : plain(message, status);

	if (!isLocalRequest(event)) {
		return refuse('Aplikace je dostupná jen z tohoto počítače.', 'forbidden_remote', 403);
	}

	// Same-origin only for every request that is not a plain read. A browser sends Origin with
	// such requests; a request without it does not come from a web page.
	const method = event.request.method;
	if (method !== 'GET' && method !== 'HEAD') {
		const origin = event.request.headers.get('origin');
		if (origin !== null && !isOwnOrigin(origin, event.url)) {
			return refuse('Požadavek z cizí adresy.', 'forbidden_origin', 403);
		}
	}

	let db;
	try {
		db = await getDb();
	} catch (e) {
		if (e instanceof DatabaseLockedError) return refuse(e.message, e.code, 503);
		throw e;
	}
	event.locals.session = await readSession(db, event.cookies.get(SESSION_COOKIE), new Date());
	const path = event.url.pathname.replace(/\/+$/, '') || '/';

	if (isApi) {
		if (!event.locals.session) {
			let name = '';
			try {
				const body = await event.request.clone().json();
				name = typeof body?.method === 'string' ? body.method : '';
			} catch {
				name = '';
			}
			if (!PUBLIC_METHODS.has(name)) {
				return apiJson({ ok: false, error: 'Nejste přihlášeni.', code: 'unauthenticated' }, 401);
			}
		}
	} else {
		let passwordSet: boolean;
		try {
			passwordSet = isPasswordSet();
		} catch (e) {
			// A damaged auth.json keeps the application locked instead of offering the first-run page.
			if (isAppError(e)) return plain(e.message, e.status);
			throw e;
		}
		if (!passwordSet) {
			if (path !== SET_PASSWORD_PATH) return redirectTo(SET_PASSWORD_PATH);
		} else if (!event.locals.session) {
			if (path !== LOGIN_PATH) return redirectTo(LOGIN_PATH);
		} else if (path === LOGIN_PATH || path === SET_PASSWORD_PATH) {
			return redirectTo('/');
		}
	}

	const response = await resolve(event);
	response.headers.set('x-robots-tag', 'noindex, nofollow');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'no-referrer');
	if (!isApi && !response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'no-store');
	}
	return response;
};
