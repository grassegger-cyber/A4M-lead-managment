// Converts setting values to the text shown in the form and back. Pure, no DOM.
// The server validates again (methods/settings.ts); this gives the user the message before the confirm.

export type ValueType = 'number' | 'text' | 'boolean' | 'list' | 'map';

export interface SettingItem {
	key: string;
	value: unknown;
	defaultValue: unknown;
	valueType: ValueType;
	label: string;
	help: string | null;
	isDefault: boolean;
	updatedAt: string | null;
}

export type Draft = string | boolean;

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lists whose default holds only numbers are edited as numbers. */
function numericList(item: Pick<SettingItem, 'defaultValue'>): boolean {
	return Array.isArray(item.defaultValue) && item.defaultValue.length > 0 && item.defaultValue.every((v) => typeof v === 'number');
}

function parseNumber(text: string): number | null {
	const cleaned = text.replace(/[\s ]/g, '').replace(',', '.');
	if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}

/** Value → what the input shows. */
export function toDraft(item: Pick<SettingItem, 'valueType'>, value: unknown): Draft {
	switch (item.valueType) {
		case 'boolean':
			return value === true;
		case 'number':
			return typeof value === 'number' ? String(value).replace('.', ',') : '';
		case 'list':
			return Array.isArray(value) ? value.map((v) => String(v)).join('\n') : '';
		case 'map':
			return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
		default:
			return typeof value === 'string' ? value : '';
	}
}

/** What the input holds → value for the API, or a Czech error. */
export function parseDraft(item: Pick<SettingItem, 'valueType' | 'defaultValue'>, draft: Draft): Parsed {
	const nullable = item.defaultValue === null;
	if (item.valueType === 'boolean') return { ok: true, value: draft === true };
	const text = typeof draft === 'string' ? draft : '';
	if (item.valueType !== 'list' && !text.trim()) {
		return nullable ? { ok: true, value: null } : { ok: false, error: 'Hodnota nesmí být prázdná.' };
	}
	switch (item.valueType) {
		case 'number': {
			const n = parseNumber(text);
			if (n === null) return { ok: false, error: 'Zadejte číslo.' };
			if (n < 0) return { ok: false, error: 'Hodnota nesmí být záporná.' };
			return { ok: true, value: n };
		}
		case 'text':
			return { ok: true, value: text.trim() };
		case 'list': {
			const lines = text
				.split('\n')
				.map((l) => l.trim())
				.filter(Boolean);
			if (new Set(lines).size !== lines.length) return { ok: false, error: 'Seznam obsahuje stejnou položku vícekrát.' };
			if (!numericList(item)) return { ok: true, value: lines };
			const numbers = lines.map(parseNumber);
			if (numbers.some((n) => n === null)) return { ok: false, error: 'Každý řádek musí být číslo.' };
			return { ok: true, value: numbers };
		}
		case 'map': {
			let value: unknown;
			try {
				value = JSON.parse(text);
			} catch {
				return { ok: false, error: 'Text není platný JSON.' };
			}
			if (!isPlainObject(value)) return { ok: false, error: 'Hodnota musí být objekt ve složených závorkách { }.' };
			return { ok: true, value };
		}
		default:
			return { ok: false, error: 'Neznámý typ nastavení.' };
	}
}

/** JSON with sorted keys, to compare two values regardless of key order. */
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/** Short human text of a value for the confirm dialog and the "default" note. */
export function displayValue(item: Pick<SettingItem, 'valueType'>, value: unknown): string {
	if (value === null || value === undefined) return 'neurčeno';
	switch (item.valueType) {
		case 'boolean':
			return value ? 'Ano' : 'Ne';
		case 'number':
			return typeof value === 'number' ? value.toLocaleString('cs-CZ', { maximumFractionDigits: 10 }) : String(value);
		case 'list':
			return Array.isArray(value) ? (value.length ? value.join(', ') : 'prázdný seznam') : String(value);
		case 'map':
			return isPlainObject(value) && Object.keys(value).length === 0 ? 'prázdné { }' : JSON.stringify(value, null, 2);
		default:
			return String(value);
	}
}

export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
	number: 'Číslo',
	text: 'Text',
	boolean: 'Ano / ne',
	list: 'Seznam',
	map: 'JSON'
};
