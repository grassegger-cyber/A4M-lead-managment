// Browser helper for the application's API: call('area.name', args).
import { auth } from './auth.svelte';
import { FUNCTION_REGION, LOCAL_MODE, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

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
	signal?: AbortSignal;
}

const LOGIN_CODES = new Set(['unauthenticated', 'mfa_required']);

async function post(method: string, args: unknown, options: CallOptions): Promise<Response> {
	const token = await auth.token();
	if (!token) throw new ApiError('Nejste přihlášeni.', 'unauthenticated', 401);
	const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
	if (!LOCAL_MODE) {
		headers.apikey = SUPABASE_ANON_KEY;
		// Keeps the function, and with it the data, in the EU region of the project.
		headers['x-region'] = FUNCTION_REGION;
	}
	try {
		return await fetch(LOCAL_MODE ? '/api' : `${SUPABASE_URL}/functions/v1/api`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ method, args: args ?? {} }),
			signal: options.signal
		});
	} catch (e) {
		if ((e as Error)?.name === 'AbortError') throw e;
		throw new ApiError('Server neodpovídá. Zkontrolujte připojení k internetu.', 'network', 0);
	}
}

/** Calls an API method and returns its data. Throws ApiError with a Czech message. */
export async function call<T = unknown>(method: string, args?: unknown, options: CallOptions = {}): Promise<T> {
	let response: Response;
	try {
		response = await post(method, args, options);
	} catch (e) {
		if (e instanceof ApiError && LOGIN_CODES.has(e.code)) toLogin();
		throw e;
	}
	let body: { ok?: boolean; data?: unknown; error?: string; code?: string; message?: string } | null = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	if (response.ok && body?.ok) return body.data as T;
	// The gateway in front of the function answers an expired token itself, in its own format.
	const code = body?.code ?? (response.status === 401 ? 'unauthenticated' : 'internal');
	const message =
		typeof body?.error === 'string' ? body.error : response.status === 401 ? 'Přihlášení vypršelo.' : 'Neočekávaná chyba serveru.';
	if (LOGIN_CODES.has(code)) toLogin();
	throw new ApiError(message, code, response.status);
}

function toLogin() {
	if (typeof window !== 'undefined' && window.location.pathname !== '/prihlaseni') window.location.assign('/prihlaseni');
}
