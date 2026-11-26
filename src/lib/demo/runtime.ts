// Runs one API method for the demo worker and shapes the answer the way POST /api does
// (src/routes/api/+server.ts): JSON data, a file, or an error with a Czech message and a code.
import type { Ctx, Method } from '../server/context.ts';
import { isAppError } from '../server/errors.ts';
import type { Reply } from './protocol.ts';

/** JSON text of an answer; BigInt values become strings, as in the server's apiJson(). */
export function toJson(value: unknown): string {
	return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export async function runMethod(method: Method | undefined, ctx: Ctx, name: string, argsJson: string): Promise<Reply> {
	if (!method) return { ok: false, error: 'Neznámá metoda.', code: 'unknown_method', status: 404 };
	try {
		const args = JSON.parse(argsJson) ?? {};
		const result = await method(ctx, args);
		if (result instanceof Response) {
			return {
				ok: true,
				file: {
					bytes: await result.arrayBuffer(),
					contentType: result.headers.get('content-type') ?? 'application/octet-stream',
					disposition: result.headers.get('content-disposition') ?? ''
				}
			};
		}
		return { ok: true, json: toJson(result ?? null) };
	} catch (e) {
		if (isAppError(e)) return { ok: false, error: e.message, code: e.code, status: e.status };
		// The method name and the error text only, never the arguments.
		console.error(`[demo] ${name} failed:`, e instanceof Error ? e.message : e);
		return { ok: false, error: 'Neočekávaná chyba ukázky.', code: 'internal', status: 500 };
	}
}
