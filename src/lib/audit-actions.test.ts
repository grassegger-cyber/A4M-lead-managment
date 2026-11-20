// Every audit action the server writes must have a Czech name (the whole UI is Czech).
// The actions are read from the source: the second argument of audit(...) and the action
// passed to writeSetting(...) in the settings methods.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AUDIT_ACTION_LABELS, AUDIT_AREA_LABELS, auditActionLabel, auditArea, auditDetailLabel, auditEntityLabel } from './audit-actions.ts';
import { reasonLabel } from './reason-labels.ts';

function sourceFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.(ts|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
	});
}

/** Top-level arguments of the call whose opening parenthesis is at `open`. */
function callArguments(text: string, open: number): string[] {
	const args: string[] = [];
	let depth = 0;
	let quote: string | null = null;
	let start = open + 1;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === '\\') i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') quote = ch;
		else if (ch === '(' || ch === '{' || ch === '[') depth++;
		else if (ch === ')' || ch === '}' || ch === ']') {
			depth--;
			if (depth === 0) {
				args.push(text.slice(start, i));
				return args;
			}
		} else if (ch === ',' && depth === 1) {
			args.push(text.slice(start, i));
			start = i + 1;
		}
	}
	return args;
}

function writtenActions(): Map<string, string> {
	const found = new Map<string, string>();
	const calls: [RegExp, number][] = [
		[/\baudit\(/g, 1],
		[/\bwriteSetting\(/g, 3]
	];
	for (const file of [...sourceFiles('src'), ...sourceFiles('scripts')]) {
		const text = fs.readFileSync(file, 'utf8');
		for (const [pattern, index] of calls) {
			for (const match of text.matchAll(pattern)) {
				const argument = callArguments(text, match.index + match[0].length - 1)[index] ?? '';
				for (const literal of argument.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) found.set(literal[1], file);
			}
		}
	}
	return found;
}

describe('audit action names', () => {
	const actions = writtenActions();

	it('finds the actions in the source', () => {
		// Guards the scan itself: one action per area that writes to the log.
		for (const known of ['auth.login', 'company.state_change', 'export.companies', 'import.applied', 'seed.run', 'settings.update', 'settings.reset', 'settings.transition_create']) {
			expect([...actions.keys()], known).toContain(known);
		}
	});

	it('has a Czech name for every action and every area', () => {
		const unnamed = [...actions].filter(([action]) => !AUDIT_ACTION_LABELS[action]).map(([action, file]) => `${action} (${file})`);
		expect(unnamed).toEqual([]);
		const areas = [...new Set([...actions.keys()].map(auditArea))].filter((area) => !AUDIT_AREA_LABELS[area]);
		expect(areas).toEqual([]);
	});

	it('falls back to the code for anything unknown', () => {
		expect(auditActionLabel('export.companies')).toBe('Export IČO do Excelu');
		expect(auditActionLabel('future.action')).toBe('future.action');
		expect(auditEntityLabel('company')).toBe('IČO');
		expect(auditEntityLabel(null)).toBe('—');
		expect(auditDetailLabel('rows')).toBe('Počet řádků');
		expect(auditDetailLabel('something_new')).toBe('something_new');
	});
});

describe('reason codes', () => {
	it('are shown by a Czech name, loss reasons by their number', () => {
		expect(reasonLabel('robot_landed')).toBe('Přistálo na superuseru');
		expect(reasonLabel('loss_122')).toBe('Důvod prohry 122');
		expect(reasonLabel('manual')).toBe('Ruční změna');
		expect(reasonLabel('something_new')).toBe('something_new');
		expect(reasonLabel(null)).toBe('—');
	});
});
