// Collects every methods/<area>.ts file into one method table. Adding an area needs no edit here.
import type { Method, MethodMap } from './context.ts';

const modules = import.meta.glob<{ methods?: MethodMap }>(['./methods/*.ts', '!./methods/*.test.ts'], {
	eager: true
});

const table = new Map<string, Method>();
for (const [file, mod] of Object.entries(modules)) {
	if (!mod.methods) throw new Error(`${file} must export "methods"`);
	for (const [name, fn] of Object.entries(mod.methods)) {
		if (!/^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
			throw new Error(`${file}: method name "${name}" must look like "area.name"`);
		}
		if (table.has(name)) throw new Error(`Method "${name}" is defined twice (${file})`);
		table.set(name, fn);
	}
}

export function getMethod(name: string): Method | undefined {
	return table.get(name);
}

export function listMethods(): string[] {
	return [...table.keys()].sort();
}
