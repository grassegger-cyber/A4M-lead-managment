// The api function. All logic lives in src/lib/server and arrives here as bundle.js
// (npm run build:api). This file only connects it to the Deno runtime.
import postgres from 'npm:postgres@4.1.1';
// @ts-ignore: generated file
import { createCloudHandler } from './bundle.js';

Deno.serve(createCloudHandler({ env: (name: string) => Deno.env.get(name), postgres }));
