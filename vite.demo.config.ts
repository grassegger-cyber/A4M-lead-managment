// Build of the shareable demo: npm run build:demo → build-demo.nosync/ (static files for
// Cloudflare Pages). The same screens as the local application, but there is no server: the API
// methods, the migrations and the fictional seed run in the visitor's browser (PGlite in IndexedDB,
// inside a Web Worker); every visitor sees only his own changes.
//
// This file is the only place that brings in src/lib/demo. It passes its own SvelteKit options, so
// svelte.config.js and vite.config.ts (npm run dev, npm run build, npm start, npm test) stay as
// they are and never load anything from the demo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adapterStatic from '@sveltejs/adapter-static';
import type { Adapter } from '@sveltejs/kit';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';
import { PAGE_SWAPS, WORKER_SWAPS } from './src/lib/demo/swaps.ts';

const root = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
const OUT = 'build-demo.nosync';

/** The swap table with real absolute paths, as Vite reports resolved modules. */
function absolute(table: Readonly<Record<string, string>>): Record<string, string> {
	const real = (relative: string) => fs.realpathSync(path.join(root, relative));
	return Object.fromEntries(Object.entries(table).map(([from, to]) => [real(from), real(to)]));
}

/** Resolves an import as usual, then hands out the demo module where the table names one. */
function swapModules(name: string, table: Readonly<Record<string, string>>): Plugin {
	const swaps = absolute(table);
	return {
		name,
		enforce: 'pre',
		async resolveId(source, importer, options) {
			// The server half of the build is never deployed; it keeps the real modules.
			if (!importer || options?.ssr) return null;
			const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
			if (!resolved || resolved.external) return null;
			return swaps[resolved.id.split('?')[0]] ?? null;
		}
	};
}

/**
 * The demo leaves out every .ts route module (moduleExtensions below): today these are only the
 * server parts (+layout.server.ts, api/+server.ts), which a static host cannot run. A universal
 * +page.ts or +layout.ts would silently go missing, and a .js route module would be kept, so both
 * stop the build here.
 */
function checkRouteModules(dir: string): void {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) checkRouteModules(full);
		else if (/^\+.*\.(js|ts)$/.test(entry.name) && !/^\+(server|(page|layout)\.server)\.ts$/.test(entry.name)) {
			throw new Error(`${path.relative(root, full)}: the demo build (vite.demo.config.ts) does not handle this route module.`);
		}
	}
}
checkRouteModules(path.join(root, 'src/routes'));

/** Headers for Cloudflare Pages: kept out of search engines like the local app, hashed files cached. */
const HEADERS = `/*
  X-Robots-Tag: noindex, nofollow
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer

/_app/immutable/*
  Cache-Control: public, max-age=31536000, immutable
`;

/** adapter-static with the SPA fallback, plus the _headers file. */
function demoAdapter(): Adapter {
	const inner = adapterStatic({ pages: OUT, assets: OUT, fallback: 'index.html', precompress: false });
	return {
		...inner,
		name: 'adapter-static (A4M demo)',
		async adapt(builder) {
			await inner.adapt(builder);
			fs.writeFileSync(path.join(root, OUT, '_headers'), HEADERS);
			// Cloudflare Pages serves index.html for unknown paths (deep links such as /ico?detail=…)
			// only when there is no top-level 404.html.
			if (fs.existsSync(path.join(root, OUT, '404.html'))) throw new Error(`${OUT}/404.html would switch off the SPA fallback`);
		}
	};
}

export default defineConfig({
	plugins: [
		swapModules('a4m-demo-page-swaps', PAGE_SWAPS),
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: demoAdapter(),
			// Separate from .svelte-kit.nosync, so a demo build never touches what npm run dev uses.
			outDir: '.svelte-kit-demo.nosync',
			// No server route modules (see checkRouteModules).
			moduleExtensions: ['.js'],
			// No server hooks either: src/hooks.server.ts guards the local server. This path does not exist.
			files: { hooks: { server: 'src/lib/demo/no-server-hooks' } }
		})
	],
	worker: {
		format: 'es',
		plugins: () => [swapModules('a4m-demo-worker-swaps', WORKER_SWAPS)]
	},
	// Same as vite.config.ts for the (unused) server half of the build.
	ssr: { external: ['@electric-sql/pglite', 'exceljs'] }
});
