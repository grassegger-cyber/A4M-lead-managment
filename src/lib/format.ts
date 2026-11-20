// Czech formatting helpers (dates DD. MM. RRRR, numbers with Czech separators).

type DateInput = string | Date | null | undefined;

function toParts(value: DateInput): { y: number; m: number; d: number; date: Date | null } | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'string') {
		// Plain date 'YYYY-MM-DD' is formatted as written, without time zone conversion.
		const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (plain) return { y: Number(plain[1]), m: Number(plain[2]), d: Number(plain[3]), date: null };
	}
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), date };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 05. 03. 2026 */
export function formatDate(value: DateInput, empty = '—'): string {
	const p = toParts(value);
	if (!p) return empty;
	return `${pad(p.d)}. ${pad(p.m)}. ${p.y}`;
}

/** 05. 03. 2026 14:07 */
export function formatDateTime(value: DateInput, empty = '—'): string {
	const p = toParts(value);
	if (!p) return empty;
	if (!p.date) return formatDate(value, empty);
	return `${pad(p.d)}. ${pad(p.m)}. ${p.y} ${pad(p.date.getHours())}:${pad(p.date.getMinutes())}`;
}

/** Local calendar date as 'YYYY-MM-DD' (for date inputs and date columns). */
export function toIsoDate(value: Date): string {
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Parses 'D. M. RRRR' (spaces optional) or 'YYYY-MM-DD' into 'YYYY-MM-DD'; null when invalid. */
export function parseCzechDate(input: string): string | null {
	const text = input.trim();
	let y: number, m: number, d: number;
	const cz = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(text);
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (cz) [d, m, y] = [Number(cz[1]), Number(cz[2]), Number(cz[3])];
	else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
	else return null;
	const date = new Date(Date.UTC(y, m - 1, d));
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
	return `${y}-${pad(m)}-${pad(d)}`;
}

const numberFormat = new Intl.NumberFormat('cs-CZ');

/** 12 345 (non-breaking spaces as in Czech typography) */
export function formatNumber(value: number | string | null | undefined, empty = '—'): string {
	if (value === null || value === undefined || value === '') return empty;
	const n = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(n)) return empty;
	return numberFormat.format(n);
}

/** 12,5 % */
export function formatPercent(value: number | null | undefined, digits = 0, empty = '—'): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return empty;
	return `${value.toLocaleString('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}

/** +420 000 123 456 */
export function formatPhone(value: string | null | undefined, empty = '—'): string {
	if (!value) return empty;
	const m = /^\+420(\d{3})(\d{3})(\d{3})$/.exec(value);
	return m ? `+420 ${m[1]} ${m[2]} ${m[3]}` : value;
}

/** Czech plural: plural(5, 'řádek', 'řádky', 'řádků') */
export function plural(count: number, one: string, few: string, many: string): string {
	const n = Math.abs(count);
	if (n === 1) return one;
	if (n >= 2 && n <= 4) return few;
	return many;
}
