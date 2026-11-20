// IČO helpers shared by server and browser.

/**
 * Normalises raw input to an 8-digit IČO string with leading zeros.
 * Accepts numbers and strings with spaces; returns null when it cannot be an IČO.
 */
export function normalizeIco(input: unknown): string | null {
	if (input === null || input === undefined) return null;
	let text: string;
	if (typeof input === 'number') {
		if (!Number.isInteger(input) || input < 0) return null;
		text = String(input);
	} else {
		text = String(input).replace(/[\s ]/g, '');
	}
	if (!/^[0-9]{1,8}$/.test(text)) return null;
	return text.padStart(8, '0');
}

/** Check digit for the first seven digits (weights 8..2, modulo 11). */
export function icoCheckDigit(firstSeven: string): number {
	let sum = 0;
	for (let i = 0; i < 7; i++) sum += Number(firstSeven[i]) * (8 - i);
	return (11 - (sum % 11)) % 10;
}

/** True for an 8-digit string with a valid check digit. */
export function isValidIco(ico: string): boolean {
	if (!/^[0-9]{8}$/.test(ico)) return false;
	if (ico === '00000000') return false;
	return icoCheckDigit(ico) === Number(ico[7]);
}

export type IcoError = 'ico_empty' | 'ico_format' | 'ico_checksum';

export const ICO_ERROR_LABELS: Record<IcoError, string> = {
	ico_empty: 'IČO chybí',
	ico_format: 'IČO musí mít nejvýše 8 číslic',
	ico_checksum: 'IČO má neplatnou kontrolní číslici'
};

/** Normalises and validates in one step. */
export function parseIco(input: unknown): { ok: true; ico: string } | { ok: false; error: IcoError } {
	if (input === null || input === undefined || String(input).trim() === '') {
		return { ok: false, error: 'ico_empty' };
	}
	const ico = normalizeIco(input);
	if (!ico) return { ok: false, error: 'ico_format' };
	if (!isValidIco(ico)) return { ok: false, error: 'ico_checksum' };
	return { ok: true, ico };
}

/** Builds a valid IČO from a seven-digit prefix (used by the fictional seed). */
export function icoFromPrefix(firstSeven: string | number): string {
	const prefix = String(firstSeven).padStart(7, '0');
	if (!/^[0-9]{7}$/.test(prefix)) throw new Error('IČO prefix must have seven digits');
	return prefix + icoCheckDigit(prefix);
}
