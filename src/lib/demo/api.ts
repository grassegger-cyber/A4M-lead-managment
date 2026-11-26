// Browser API helper of the demo build: the same exports as src/lib/api.ts, but the methods run in
// the demo worker in this browser instead of behind POST /api. vite.demo.config.ts puts this
// module in place of $lib/api in the demo pages only.
import { callMethod } from './worker-client.svelte.ts';
import type { Reply } from './protocol.ts';

export class ApiError extends Error {
	code: string;
	status: number;
	constructor(message: string, code: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
	}
}

export interface CallOptions {
	/** Accepted for the same signature as src/lib/api.ts; the demo does not fetch. */
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

function aborted(): DOMException {
	return new DOMException('The operation was aborted.', 'AbortError');
}

/** Sends the call as the browser would post it (JSON) and gives up waiting when signal aborts. */
function run(method: string, args: unknown, signal?: AbortSignal): Promise<Reply> {
	if (signal?.aborted) return Promise.reject(aborted());
	const reply = callMethod(method, JSON.stringify(args ?? {}));
	if (!signal) return reply;
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(aborted());
		signal.addEventListener('abort', onAbort, { once: true });
		reply.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

/** Calls an API method and returns its data. Throws ApiError with a Czech message. */
export async function call<T = unknown>(method: string, args?: unknown, options: CallOptions = {}): Promise<T> {
	const reply = await run(method, args, options.signal);
	if (!reply.ok) throw new ApiError(reply.error, reply.code, reply.status);
	if ('file' in reply) throw new ApiError('Metoda vrací soubor. Použijte download().', 'not_json', 200);
	return JSON.parse(reply.json) as T;
}

function filenameFrom(disposition: string, fallback: string): string {
	const utf = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
	if (utf) {
		try {
			return decodeURIComponent(utf[1]);
		} catch {
			// fall through
		}
	}
	const plain = /filename="([^"]+)"/i.exec(disposition);
	return plain ? plain[1] : fallback;
}

/** Calls an API method that returns a file and saves it through the browser. Returns the file name. */
export async function download(method: string, args?: unknown, fallbackName = 'soubor'): Promise<string> {
	const reply = await run(method, args);
	if (!reply.ok) throw new ApiError(reply.error, reply.code, reply.status);
	if (!('file' in reply)) throw new ApiError('Metoda nevrátila soubor.', 'not_file', 200);
	const name = filenameFrom(reply.file.disposition, fallbackName);
	const url = URL.createObjectURL(new Blob([reply.file.bytes], { type: reply.file.contentType }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
	return name;
}

// vite.demo.config.ts swaps $lib/api for this module, so it must offer what the real one offers.
type Real = typeof import('../api.ts');
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameSurface: Same<keyof Real, keyof typeof import('./api.ts')> & Same<Real['call'], typeof call> & Same<Real['download'], typeof download> = true;
void sameSurface;
