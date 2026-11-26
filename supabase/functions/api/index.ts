// The api function. All logic lives in src/lib/server and arrives here as bundle.js
// (npm run build:api). This file only connects it to the Deno runtime.
// Version 3: the one commonly run on Supabase Edge Functions. Version 4 stalled there on larger
// results (a request then hung until the platform cut it off).
import postgres from 'npm:postgres@3.4.5';
// @ts-ignore: generated file
import { createCloudHandler } from './bundle.js';

Deno.serve(createCloudHandler({ env: (name: string) => Deno.env.get(name), postgres }));
