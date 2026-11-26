// The method table of the api: every methods/<area>.ts file is listed here by hand, because the
// same code is bundled for the cloud function (no Vite there). A new area needs one line below.
import type { Method, MethodMap } from './context.ts';
import { methods as audit } from './methods/audit.ts';
import { methods as auth } from './methods/auth.ts';
import { methods as companies } from './methods/companies.ts';
import { methods as dashboard } from './methods/dashboard.ts';
import { methods as imports } from './methods/imports.ts';
import { methods as returns } from './methods/returns.ts';
import { methods as settings } from './methods/settings.ts';
import { methods as system } from './methods/system.ts';

const areas: Record<string, MethodMap> = { audit, auth, companies, dashboard, imports, returns, settings, system };

const table = new Map<string, Method>();
for (const [area, methods] of Object.entries(areas)) {
	for (const [name, fn] of Object.entries(methods)) {
		if (!/^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
			throw new Error(`${area}: method name "${name}" must look like "area.name"`);
		}
		if (table.has(name)) throw new Error(`Method "${name}" is defined twice (${area})`);
		table.set(name, fn);
	}
}

export function getMethod(name: string): Method | undefined {
	return table.get(name);
}

export function listMethods(): string[] {
	return [...table.keys()].sort();
}
