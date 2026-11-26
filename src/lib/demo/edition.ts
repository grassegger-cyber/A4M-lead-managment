// The demo edition: vite.demo.config.ts puts this module in place of src/lib/edition.ts in the
// demo build only. Fictional data in the visitor's browser, no server, no login.
import type { Component } from 'svelte';
import DemoStrip from './DemoStrip.svelte';

export const isDemo: boolean = true;

export const EditionStrip: Component | null = DemoStrip;

// The swap must offer exactly what src/lib/edition.ts offers.
type Real = typeof import('../edition.ts');
const sameSurface: [keyof Real] extends [keyof typeof import('./edition.ts')] ? true : false = true;
void sameSurface;
