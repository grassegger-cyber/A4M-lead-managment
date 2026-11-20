import { describe, expect, it } from 'vitest';
import { cellText, columnLetter } from './cells.ts';

describe('cellText', () => {
	it('keeps whole numbers as digits and trims text', () => {
		expect(cellText(1234567)).toBe('1234567');
		expect(cellText(420000123456)).toBe('420000123456');
		expect(cellText('  Testovací   firma 00001 ')).toBe('Testovací firma 00001');
		expect(cellText(null)).toBe('');
		expect(cellText(1.5)).toBe('1.5');
	});
	it('reads dates, rich text, formulas and hyperlinks', () => {
		expect(cellText(new Date(Date.UTC(2021, 2, 5)))).toBe('2021-03-05');
		expect(cellText({ richText: [{ text: 'Testovací ' }, { text: 'firma' }] })).toBe('Testovací firma');
		expect(cellText({ formula: 'A1', result: 99000013 })).toBe('99000013');
		expect(cellText({ formula: 'A1' })).toBe('');
		expect(cellText({ text: 'odkaz', hyperlink: 'https://example.invalid' })).toBe('odkaz');
		expect(cellText({ error: '#N/A' })).toBe('');
	});
});

describe('columnLetter', () => {
	it('counts like Excel', () => {
		expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
	});
});
