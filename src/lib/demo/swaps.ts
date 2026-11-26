// Which modules the demo build replaces (paths from the project root). Read by vite.demo.config.ts
// at build time and by demo.test.ts; never part of any bundle.

/** Replaced in the demo pages. */
export const PAGE_SWAPS: Readonly<Record<string, string>> = {
	// POST /api → the same methods in the demo worker
	'src/lib/api.ts': 'src/lib/demo/api.ts',
	// the strip on top, no logout, always signed in
	'src/lib/edition.ts': 'src/lib/demo/edition.ts'
};

/** Replaced in the demo worker that runs the API methods. */
export const WORKER_SWAPS: Readonly<Record<string, string>> = {
	// no password: the visitor is always signed in
	'src/lib/server/methods/auth.ts': 'src/lib/demo/auth-methods.ts',
	// no Node streams in the browser
	'src/lib/server/xlsx-writer.ts': 'src/lib/demo/xlsx-writer.ts'
};
