// Browser helper for the application's API: call('area.name', args) and download('area.name', args).

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
	/** Pass SvelteKit's fetch when calling from a load function. */
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

async function post(method: string, args: unknown, options: CallOptions): Promise<Response> {
	const doFetch = options.fetch ?? fetch;
	try {
		return await doFetch('/api', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ method, args: args ?? {} }),
			credentials: 'same-origin',
			signal: options.signal
		});
	} catch (e) {
		if ((e as Error)?.name === 'AbortError') throw e;
		throw new ApiError('Server neodpovídá. Zkontrolujte, že aplikace běží.', 'network', 0);
	}
}

function handleUnauthenticated(method: string, code: string) {
	if (code === 'unauthenticated' && !method.startsWith('auth.') && typeof window !== 'undefined') {
		window.location.assign('/prihlaseni');
	}
}

async function readError(method: string, response: Response): Promise<never> {
	let message = 'Neočekávaná chyba serveru.';
	let code = 'internal';
	try {
		const body = await response.json();
		if (typeof body?.error === 'string') message = body.error;
		if (typeof body?.code === 'string') code = body.code;
	} catch {
		// keep the generic message
	}
	handleUnauthenticated(method, code);
	throw new ApiError(message, code, response.status);
}

/** Calls an API method and returns its data. Throws ApiError with a Czech message. */
export async function call<T = unknown>(method: string, args?: unknown, options: CallOptions = {}): Promise<T> {
	const response = await post(method, args, options);
	const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
	if (!isJson) {
		if (!response.ok) throw new ApiError('Neočekávaná chyba serveru.', 'internal', response.status);
		throw new ApiError('Metoda vrací soubor. Použijte download().', 'not_json', response.status);
	}
	if (!response.ok) return readError(method, response);
	const body = await response.json();
	if (!body?.ok) {
		handleUnauthenticated(method, body?.code ?? '');
		throw new ApiError(body?.error ?? 'Neočekávaná chyba serveru.', body?.code ?? 'internal', response.status);
	}
	return body.data as T;
}

function filenameFrom(response: Response, fallback: string): string {
	const header = response.headers.get('content-disposition') ?? '';
	const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
	if (utf) {
		try {
			return decodeURIComponent(utf[1]);
		} catch {
			// fall through
		}
	}
	const plain = /filename="([^"]+)"/i.exec(header);
	return plain ? plain[1] : fallback;
}

/** Calls an API method that returns a file and saves it through the browser. Returns the file name. */
export async function download(method: string, args?: unknown, fallbackName = 'soubor'): Promise<string> {
	const response = await post(method, args, {});
	const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
	if (!response.ok || isJson) {
		if (isJson && response.ok) {
			const body = await response.json();
			throw new ApiError(body?.error ?? 'Metoda nevrátila soubor.', body?.code ?? 'not_file', response.status);
		}
		return readError(method, response);
	}
	const name = filenameFrom(response, fallbackName);
	const url = URL.createObjectURL(await response.blob());
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
	return name;
}
