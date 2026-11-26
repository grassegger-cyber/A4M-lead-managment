import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import type { Connect, Plugin } from 'vite';

/**
 * Local run without Supabase: the dev (and preview) server answers POST /api itself, from a
 * database of fictional data in memory. Active only when no Supabase address is configured.
 */
function localApi(): Plugin {
	const middleware: Connect.NextHandleFunction = async (req, res, next) => {
		if (req.url?.split('?')[0] !== '/api') return next();
		try {
			const { localHandler } = await import('./src/lib/server/local-dev.ts');
			const origin = `http://${req.headers.host}`;
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const headers = new Headers();
			for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
			const response = await localHandler([origin])(
				new Request(`${origin}/api`, {
					method: req.method,
					headers,
					body: req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : Buffer.concat(chunks)
				})
			);
			res.statusCode = response.status;
			response.headers.forEach((value, key) => res.setHeader(key, value));
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (e) {
			console.error('[local api]', e);
			res.statusCode = 500;
			res.end('local api failed');
		}
	};
	const enabled = () => !process.env.VITE_SUPABASE_URL;
	return {
		name: 'a4m-local-api',
		configureServer(server) {
			if (enabled()) server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			if (enabled()) server.middlewares.use(middleware);
		}
	};
}

export default defineConfig({
	plugins: [localApi(), sveltekit()],
	server: {
		port: 5180,
		host: '127.0.0.1',
		strictPort: true,
		// node_modules is a symlink to node_modules.nosync; allow the dev server to serve font files from it.
		fs: { allow: ['node_modules.nosync'] },
		// Vite ignores only "node_modules" by name. The real folders carry the .nosync suffix, and
		// without fsevents the watcher falls back to polling every file in them (a full CPU core).
		// .svelte-kit.nosync is left to SvelteKit, which watches its "generated" part.
		watch: {
			ignored: ['**/node_modules.nosync/**', '**/build.nosync/**', '**/data.nosync/**', '**/node_modules 2/**']
		}
	},
	preview: { port: 5180, host: '127.0.0.1', strictPort: true },
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60000,
		hookTimeout: 60000
	}
});
