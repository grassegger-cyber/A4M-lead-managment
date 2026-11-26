import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Output folders carry the .nosync suffix so iCloud does not upload them.
		outDir: '.svelte-kit.nosync',
		// A static application: every address is served by the same page and the router runs in the browser.
		adapter: adapter({ pages: 'build.nosync', assets: 'build.nosync', fallback: 'index.html' }),
		// Content Security Policy written into the page itself: scripts only from the application,
		// connections only to the application's own Supabase project.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self'],
				// Only the application's own Supabase project (known at build time).
				'connect-src': ['self', process.env.VITE_SUPABASE_URL || 'https://*.supabase.co'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
