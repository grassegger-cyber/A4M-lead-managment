// The application's own API: POST /api { method, args } → { ok, data } | { ok: false, error, code }.
import type { RequestHandler } from './$types';
import { getMethod } from '$lib/server/registry';
import { apiJson, ctxFromEvent } from '$lib/server/request';
import { isAppError } from '$lib/server/errors';
import { PUBLIC_METHODS } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	// Only JSON: a web page cannot send it to another origin without a preflight, unlike
	// text/plain or a form. A browser that says the request crosses origins is refused outright.
	const contentType = (event.request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (contentType !== 'application/json') {
		return apiJson({ ok: false, error: 'Požadavek musí být ve formátu JSON.', code: 'unsupported_media_type' }, 415);
	}
	const fetchSite = event.request.headers.get('sec-fetch-site');
	if (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none') {
		return apiJson({ ok: false, error: 'Požadavek z cizí adresy.', code: 'forbidden_origin' }, 403);
	}

	let body: { method?: unknown; args?: unknown };
	try {
		body = await event.request.json();
	} catch {
		return apiJson({ ok: false, error: 'Požadavek není platný JSON.', code: 'bad_request' }, 400);
	}
	const name = typeof body?.method === 'string' ? body.method : '';
	const method = getMethod(name);
	if (!method) return apiJson({ ok: false, error: 'Neznámá metoda.', code: 'unknown_method' }, 404);

	// Second line of defence; hooks.server.ts already rejects these.
	if (!event.locals.session && !PUBLIC_METHODS.has(name)) {
		return apiJson({ ok: false, error: 'Nejste přihlášeni.', code: 'unauthenticated' }, 401);
	}

	try {
		const ctx = await ctxFromEvent(event);
		const result = await method(ctx, body.args ?? {});
		if (result instanceof Response) return result;
		return apiJson({ ok: true, data: result ?? null });
	} catch (e) {
		if (isAppError(e)) return apiJson({ ok: false, error: e.message, code: e.code }, e.status);
		// Log the method and the error text only, never the request body.
		console.error(`[api] ${name} failed:`, e instanceof Error ? e.message : e);
		return apiJson({ ok: false, error: 'Neočekávaná chyba serveru.', code: 'internal' }, 500);
	}
};
