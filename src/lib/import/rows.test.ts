import { describe, expect, it } from 'vitest';
import { icoFromPrefix } from '../ico.ts';
import {
	guessMapping,
	parseImportDate,
	parseImportIco,
	parsePhone,
	rulesFromSettings,
	sanitizeRawRow,
	splitPhones,
	validateRow
} from './rows.ts';
import type { ImportRules } from './rows.ts';

const rules: ImportRules = {
	phoneDefaultPrefix: '+420',
	phoneNationalDigits: 9,
	phoneSeparators: ',;/|',
	nameMaxLength: 60,
	subjectTypeValues: { FO: ['fo', 'fyzicka osoba'], PO: ['po', 'pravnicka osoba'] }
};
const ICO = icoFromPrefix(9960001); // fictional range
const ICO_SHORT = icoFromPrefix('0012345'); // starts with zeros

describe('parseImportIco', () => {
	it('pads 1–7 digits with leading zeros before the check', () => {
		expect(parseImportIco(String(Number(ICO_SHORT)))).toEqual({ ok: true, ico: ICO_SHORT });
		expect(parseImportIco(` ${ICO.slice(0, 4)} ${ICO.slice(4)} `)).toEqual({ ok: true, ico: ICO });
		expect(parseImportIco(`${Number(ICO_SHORT)}.0`)).toEqual({ ok: true, ico: ICO_SHORT });
	});
	it('reports empty, malformed, too long and wrong check digit', () => {
		expect(parseImportIco('')).toEqual({ ok: false, error: 'ico_empty' });
		expect(parseImportIco(undefined)).toEqual({ ok: false, error: 'ico_empty' });
		expect(parseImportIco('12A45678')).toEqual({ ok: false, error: 'ico_format' });
		expect(parseImportIco(ICO + '1')).toEqual({ ok: false, error: 'ico_format' }); // never cut to 8
		const wrong = ICO.slice(0, 7) + ((Number(ICO[7]) + 1) % 10);
		expect(parseImportIco(wrong)).toEqual({ ok: false, error: 'ico_checksum' });
	});
});

describe('phones', () => {
	it('normalises the usual ways of writing a number', () => {
		expect(parsePhone('000 123 456', rules)).toBe('+420000123456');
		expect(parsePhone('+420 000 123 456', rules)).toBe('+420000123456');
		expect(parsePhone('00420000123456', rules)).toBe('+420000123456');
		expect(parsePhone('420000123456', rules)).toBe('+420000123456');
		expect(parsePhone('(000) 123-456', rules)).toBe('+420000123456');
		expect(parsePhone('+421000123456', rules)).toBe('+421000123456');
	});
	it('rejects what cannot be a number', () => {
		for (const bad of ['12345', '0001234567', 'nemá', '+420 000 12', '000 123 45a', '+4200001234567', '']) {
			expect(parsePhone(bad, rules), bad).toBeNull();
		}
	});
	it('splits several numbers in one cell', () => {
		expect(splitPhones('000 111 222; 000333444 / 000555666', rules.phoneSeparators)).toEqual(['000 111 222', '000333444', '000555666']);
		expect(splitPhones('  ', rules.phoneSeparators)).toEqual([]);
	});
});

describe('parseImportDate', () => {
	it('reads ISO and Czech dates', () => {
		expect(parseImportDate('2021-03-05')).toBe('2021-03-05');
		expect(parseImportDate('5. 3. 2021')).toBe('2021-03-05');
		expect(parseImportDate('05.03.2021')).toBe('2021-03-05');
		expect(parseImportDate('5/3/2021')).toBe('2021-03-05');
	});
	it('rejects impossible dates and loose text', () => {
		for (const bad of ['31. 2. 2021', '2021', 'loni', '2021-13-01']) expect(parseImportDate(bad), bad).toBeNull();
	});
});

describe('validateRow', () => {
	it('normalises a complete row', () => {
		const res = validateRow(
			{
				ico: String(Number(ICO_SHORT)),
				name: '  Testovací firma 00001   s.r.o. ',
				subject_type: 'Právnická osoba',
				legal_form_code: '112',
				region: 'Jihomoravský',
				district: 'Brno-město',
				nace: '62.01, 47110',
				founded_on: '1. 2. 2020',
				ca_number: 'CA-TEST-1',
				phones: ['000 111 222; 000111222', '+420000333444']
			},
			rules
		);
		expect(res.status).toBe('parsed');
		expect(res.ico).toBe(ICO_SHORT);
		expect(res.warnings).toEqual([]);
		expect(res.parsed).toEqual({
			name: 'Testovací firma 00001 s.r.o.',
			subject_type: 'PO',
			legal_form_code: '112',
			region_code: '116',
			region_name: 'Jihomoravský kraj',
			district_code: expect.any(String),
			district_name: 'Brno-město',
			nace_codes: ['6201', '47110'],
			founded_on: '2020-02-01',
			ca_number: 'CA-TEST-1',
			phones: ['+420000111222', '+420000333444']
		});
	});
	it('takes the region from the district when the row gives none', () => {
		const res = validateRow({ ico: ICO, district: 'Kladno' }, rules);
		expect(res.parsed?.region_name).toBe('Středočeský kraj');
	});
	it('keeps region and district as a pair: the district decides, a contradicting region is a warning', () => {
		const res = validateRow({ ico: ICO, region: 'Zlínský kraj', district: 'Praha' }, rules);
		expect(res.status).toBe('parsed');
		expect(res.parsed).toMatchObject({ region_code: '19', region_name: 'Hlavní město Praha', district_code: '3100', district_name: 'Praha' });
		expect(res.warnings).toEqual([{ code: 'region_district_mismatch', field: 'region', value: 'Zlínský kraj' }]);
		// A matching pair and an unknown district with a known region raise no mismatch.
		expect(validateRow({ ico: ICO, region: 'Středočeský kraj', district: 'Kladno' }, rules).warnings).toEqual([]);
		const unknown = validateRow({ ico: ICO, region: 'Zlínský kraj', district: 'Atlantida' }, rules);
		expect(unknown.parsed).toMatchObject({ region_code: '141' });
		expect(unknown.parsed?.district_code).toBeUndefined();
		expect(unknown.warnings.map((w) => w.code)).toEqual(['district_unknown']);
	});
	it('keeps the row and drops a bad value with a warning', () => {
		const res = validateRow(
			{ ico: ICO, subject_type: 'spolek?', region: 'Atlantida', founded_on: 'loni', phones: ['12345', '000111222'] },
			rules
		);
		expect(res.status).toBe('parsed');
		expect(res.parsed).toEqual({ phones: ['+420000111222'] });
		expect(res.warnings.map((w) => w.code).sort()).toEqual(['date_invalid', 'phone_invalid', 'region_unknown', 'subject_type_unknown']);
		expect(res.warnings.find((w) => w.code === 'phone_invalid')?.value).toBe('12345');
	});
	it('rejects rows without a usable IČO', () => {
		expect(validateRow({ name: 'Testovací firma 00002 s.r.o.' }, rules)).toMatchObject({ status: 'invalid_ico', errorCode: 'ico_empty' });
		expect(validateRow({ ico: '123456789' }, rules)).toMatchObject({ status: 'invalid_ico', errorCode: 'ico_format' });
		expect(validateRow({ ico: '12345678' }, rules)).toMatchObject({ status: 'invalid_ico', errorCode: 'ico_checksum' });
	});
	it('reports other errors', () => {
		expect(validateRow({ ico: ICO, name: 'x'.repeat(61) }, rules)).toMatchObject({ status: 'error', errorCode: 'name_too_long' });
		expect(validateRow('not a row', rules)).toMatchObject({ status: 'error', errorCode: 'row_malformed' });
		expect(validateRow({ ico: ICO, phones: 'not a list' }, rules)).toMatchObject({ status: 'error', errorCode: 'row_malformed' });
	});
});

describe('sanitizeRawRow', () => {
	it('keeps known keys only and clips long cells', () => {
		const row = sanitizeRawRow({ ico: 123, name: 'a'.repeat(900), secret: 'x', phones: ['1', '', 2] });
		expect(Object.keys(row!).sort()).toEqual(['ico', 'name', 'phones']);
		expect(row!.ico).toBe('123');
		expect(row!.name!.length).toBe(500);
		expect(row!.phones).toEqual(['1', '2']);
	});
});

describe('rulesFromSettings', () => {
	it('reads the import.* keys and normalises the subject type texts', () => {
		const r = rulesFromSettings({
			'import.phone_default_prefix': '+420',
			'import.phone_national_digits': 9,
			'import.phone_separators': ',;',
			'import.name_max_length': 300,
			'import.subject_type_values': { FO: ['Fyzická osoba'], PO: ['PO'] }
		});
		expect(r.subjectTypeValues).toEqual({ FO: ['fyzicka osoba'], PO: ['po'] });
	});
	it('refuses a broken prefix', () => {
		expect(() =>
			rulesFromSettings({
				'import.phone_default_prefix': '420',
				'import.phone_national_digits': 9,
				'import.phone_separators': ',',
				'import.name_max_length': 300
			})
		).toThrow();
	});
});

describe('guessMapping', () => {
	const aliases = { ico: ['ico', 'ic'], name: ['nazev', 'firma'], phone: ['telefon', 'mobil'], region: ['kraj'] };
	it('matches headers without diacritics, numbered phone columns and leaves the rest', () => {
		expect(guessMapping(['IČO', 'Název', 'Telefon', 'Telefon 2', 'Mobil', 'Poznámka', 'Kraj'], aliases, {})).toEqual([
			'ico', 'name', 'phone', 'phone', 'phone', '', 'region'
		]);
	});
	it('gives a single-column field to the first match only', () => {
		expect(guessMapping(['Firma', 'Název'], aliases, {})).toEqual(['name', '']);
	});
	it('prefers the remembered mapping, including "do not use"', () => {
		expect(guessMapping(['Identifikátor', 'Název', 'Telefon'], aliases, { identifikator: 'ico', telefon: '-' })).toEqual(['ico', 'name', '']);
	});
});
