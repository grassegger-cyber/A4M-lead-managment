// Messages between the demo page and the demo worker that runs the API methods (demo build only).

/** Where the demo database is: starting up, being filled, waiting for another tab, usable, broken. */
export type DemoPhase = 'starting' | 'seeding' | 'resetting' | 'locked' | 'ready' | 'failed';

/** Answer of one API method, as the server would send it over POST /api. */
export type Reply =
	/** data as JSON text (the server's JSON body), so dates and big numbers arrive as strings */
	| { ok: true; json: string }
	/** a file download */
	| { ok: true; file: { bytes: ArrayBuffer; contentType: string; disposition: string } }
	| { ok: false; error: string; code: string; status: number };

export type ToWorker =
	/** args is the JSON text of the arguments, as the browser would post it */
	| { type: 'call'; id: number; method: string; args: string }
	/** throws the visitor's database away and fills a new one */
	| { type: 'reset'; id: number };

export type FromWorker =
	| { type: 'phase'; phase: DemoPhase; detail?: string; seededMs?: number }
	| { type: 'reply'; id: number; reply: Reply };
