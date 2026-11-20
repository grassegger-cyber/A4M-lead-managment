// Builds the method context from a SvelteKit request.
import type { RequestEvent } from '@sveltejs/kit';
import type { Ctx } from './context.ts';
import { LOCAL_ACTOR } from './context.ts';
import { getDb } from './db.ts';

export async function ctxFromEvent(event: RequestEvent): Promise<Ctx> {
	let ip: string | null = null;
	try {
		ip = event.getClientAddress();
	} catch {
		ip = null;
	}
	return {
		db: await getDb(),
		session: event.locals.session ?? null,
		now: () => new Date(),
		actor: LOCAL_ACTOR,
		ip,
		userAgent: event.request.headers.get('user-agent')?.slice(0, 300) ?? null,
		cookies: event.cookies,
		secure: event.url.protocol === 'https:'
	};
}

/** JSON body of an API answer; BigInt values (rare, very large counters) become strings. */
export function apiJson(body: unknown, status = 200): Response {
	const text = JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
	return new Response(text, {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
	});
}
