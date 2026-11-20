import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Output folders carry the .nosync suffix so iCloud does not upload them.
		outDir: '.svelte-kit.nosync',
		adapter: adapter({ out: 'build.nosync' })
	}
};

export default config;
