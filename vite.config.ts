import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// Keep the database and Excel libraries out of the server bundle: PGlite loads its .wasm and
	// extension files next to its own code. (node_modules is a symlink to node_modules.nosync, so
	// Vite does not recognise these as dependencies on its own.)
	ssr: { external: ['@electric-sql/pglite', 'exceljs'] },
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
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60000,
		hookTimeout: 60000
	}
});
