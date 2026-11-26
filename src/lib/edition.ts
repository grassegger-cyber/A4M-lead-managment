// Which edition a build carries: here always the full local application with its server and login.
// Only the demo build (npm run build:demo, vite.demo.config.ts) puts src/lib/demo/edition.ts in
// place of this module; npm run dev, npm run build and the tests never load anything from the demo.
import type { Component } from 'svelte';

/** True only in the demo build (fictional data in the visitor's browser, no server, no login). */
export const isDemo: boolean = false;

/** Strip shown above every page. The local application has none. */
export const EditionStrip: Component | null = null;
