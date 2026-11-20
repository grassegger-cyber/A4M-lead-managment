// Turns an Excel cell value (as exceljs returns it) into the plain text the import works with.
// Pure, used in the browser. No number or date is ever guessed from formatting.

const pad = (n: number) => String(n).padStart(2, '0');

export function cellText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return '';
		// Whole numbers (IČO, phone) without exponent or decimals.
		return Number.isInteger(value) ? value.toFixed(0) : String(value);
	}
	if (typeof value === 'boolean') return value ? 'ano' : 'ne';
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return '';
		// exceljs gives date cells as UTC midnight of the calendar day shown in Excel.
		return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
	}
	if (typeof value === 'object') {
		const v = value as Record<string, unknown>;
		if (Array.isArray(v.richText)) {
			return cellText(v.richText.map((part) => String((part as { text?: unknown })?.text ?? '')).join(''));
		}
		if ('result' in v) return cellText(v.result); // formula: its last computed value
		if ('formula' in v || 'sharedFormula' in v) return '';
		if ('text' in v) return cellText(v.text); // hyperlink
		if ('error' in v) return '';
	}
	return '';
}

/** Column letter for a 0-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
	let n = index + 1;
	let s = '';
	while (n > 0) {
		const r = (n - 1) % 26;
		s = String.fromCharCode(65 + r) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}
