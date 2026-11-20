import { describe, expect, it } from 'vitest';
import { icoCheckDigit, icoFromPrefix, isValidIco, normalizeIco, parseIco } from './ico.ts';

describe('normalizeIco', () => {
	it('pads short input with leading zeros', () => {
		expect(normalizeIco('123')).toBe('00000123');
		expect(normalizeIco(99000015)).toBe('99000015');
		expect(normalizeIco(' 9900 0015 ')).toBe('99000015');
	});
	it('rejects input that cannot be an IČO', () => {
		expect(normalizeIco('123456789')).toBeNull();
		expect(normalizeIco('12a45678')).toBeNull();
		expect(normalizeIco('')).toBeNull();
		expect(normalizeIco(null)).toBeNull();
		expect(normalizeIco(12.5)).toBeNull();
		expect(normalizeIco(-5)).toBeNull();
	});
});

describe('isValidIco', () => {
	it('accepts numbers with a correct check digit', () => {
		// weights 8..2: 9*8+9*7+0+0+0+0+1*2 = 137; 137 % 11 = 5; (11 - 5) % 10 = 6
		expect(icoCheckDigit('9900001')).toBe(6);
		expect(isValidIco('99000016')).toBe(true);
		// remainder 0 gives check digit 1, remainder 1 gives 0
		expect(isValidIco(icoFromPrefix('0000011'))).toBe(true);
	});
	it('rejects a wrong check digit, wrong length and all zeros', () => {
		expect(isValidIco('99000017')).toBe(false);
		expect(isValidIco('9900001')).toBe(false);
		expect(isValidIco('00000000')).toBe(false);
		expect(isValidIco('abcdefgh')).toBe(false);
	});
	it('every prefix produced by icoFromPrefix is valid', () => {
		for (let i = 0; i < 2000; i++) expect(isValidIco(icoFromPrefix(9900000 + i))).toBe(true);
	});
});

describe('parseIco', () => {
	it('reports the kind of error', () => {
		expect(parseIco('')).toEqual({ ok: false, error: 'ico_empty' });
		expect(parseIco('123456789')).toEqual({ ok: false, error: 'ico_format' });
		expect(parseIco('99000017')).toEqual({ ok: false, error: 'ico_checksum' });
		expect(parseIco(99000016)).toEqual({ ok: true, ico: '99000016' });
	});
});
