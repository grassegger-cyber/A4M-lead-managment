// Bundles the server code (src/lib/server/cloud.ts) into one file for the Supabase function.
import { build } from 'esbuild';

await build({
	entryPoints: ['src/lib/server/cloud.ts'],
	outfile: 'supabase/functions/api/bundle.js',
	bundle: true,
	format: 'esm',
	platform: 'neutral',
	target: 'es2022',
	legalComments: 'none',
	logLevel: 'info'
});
