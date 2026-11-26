// Local run for development (npm run dev): the same API handler over a PGlite database in memory,
// with a fixed fictional user instead of a login. Used only by the dev server (vite.config.ts);
// it is not part of the cloud function.
import { openDb } from './db.ts';
import type { Db } from './db.ts';
import { createHandler } from './handler.ts';

const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'vyvoj@example.test', aal: 'aal2' };
let db: Promise<Db> | null = null;

export function localHandler(origins: string[]): (request: Request) => Promise<Response> {
	return createHandler({
		// DEV_DATA_DIR keeps the data between runs; without it the database lives in memory.
		getDb: () => (db ??= openDb({ dir: process.env.DEV_DATA_DIR || 'memory' })),
		verifyToken: async (token) => (token === 'local-dev' ? USER : null),
		allowedEmails: new Set([USER.email]),
		allowedOrigins: new Set(origins)
	});
}
