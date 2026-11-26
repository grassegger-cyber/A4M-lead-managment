// Rules of the Excel import shared by the server (validation) and the browser (mapping UI).
// Pure functions, no database. Plain-Node importable (relative imports with .ts only).
// No limit or value mapping is fixed here: they arrive in ImportRules, read from settings.
import { parseIco } from '../ico.ts';
import type { IcoError } from '../ico.ts';
import { REGIONS } from '../regions.ts';

// ---------- target fields ----------
export const IMPORT_FIELDS = [
	'ico',
	'name',
	'subject_type',
	'legal_form_code',
	'region',
	'district',
	'nace',
	'founded_on',
	'ca_number',
	'phone',
	'robot_status',
	'owned_from',
	'operator'
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
	ico: 'IČO',
	name: 'Název',
	subject_type: 'Typ subjektu (FO/PO)',
	legal_form_code: 'Právní forma (kód)',
	region: 'Kraj',
	district: 'Okres',
	nace: 'Obor (CZ-NACE)',
	founded_on: 'Datum vzniku',
	ca_number: 'Číslo CA',
	phone: 'Telefon',
	robot_status: 'Stav z robota',
	owned_from: 'Vlastnictví od (datum)',
	operator: 'Operátor'
};

/** Fields that several Excel columns may feed at once. */
export const MULTI_COLUMN_FIELDS: readonly ImportField[] = ['phone'];
export const REQUIRED_FIELDS: readonly ImportField[] = ['ico'];
/** Fields of an existing company the import may overwrite (never ownership fields). */
export const UPDATABLE_FIELDS = [
	'name',
	'subject_type',
	'legal_form_code',
	'region',
	'district',
	'nace',
	'founded_on',
	'ca_number'
] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export function isImportField(value: unknown): value is ImportField {
	return typeof value === 'string' && (IMPORT_FIELDS as readonly string[]).includes(value);
}

// ---------- row shapes ----------
/** Mapped cell texts of one Excel row as the browser sends them. */
export interface RawRow {
	ico?: string;
	name?: string;
	subject_type?: string;
	legal_form_code?: string;
	region?: string;
	district?: string;
	nace?: string;
	founded_on?: string;
	ca_number?: string;
	robot_status?: string;
	owned_from?: string;
	operator?: string;
	/** One entry per mapped phone column (a cell may hold several numbers). */
	phones?: string[];
}

/** Normalised values ready to be written. Absent key = the row gives no value. */
export interface ParsedRow {
	name?: string;
	subject_type?: 'FO' | 'PO';
	legal_form_code?: string;
	region_code?: string;
	region_name?: string;
	district_code?: string;
	district_name?: string;
	nace_codes?: string[];
	founded_on?: string;
	ca_number?: string;
	/** What the robot found in Siebel (column "Stav z robota"). */
	robot_outcome?: RobotOutcome;
	/** Day the ownership started; the day of the import when absent. */
	owned_from?: string;
	/** Mobile operator of the first phone number of the row. */
	operator?: 'VF' | 'TM' | 'O2' | 'jiny';
	phones: string[];
}

export const ROBOT_OUTCOMES = ['owned', 'other_owner', 'missing_in_siebel'] as const;
export type RobotOutcome = (typeof ROBOT_OUTCOMES)[number];

export type RowErrorCode = IcoError | 'name_too_long' | 'row_malformed';
export type RowWarningCode =
	| 'phone_invalid'
	| 'subject_type_unknown'
	| 'legal_form_invalid'
	| 'region_unknown'
	| 'region_district_mismatch'
	| 'district_unknown'
	| 'nace_invalid'
	| 'date_invalid'
	| 'ca_too_long'
	| 'operator_unknown'
	| 'robot_status_unknown'
	| 'robot_status_skipped';

export interface RowWarning {
	code: RowWarningCode;
	field: ImportField;
	/** The cell text that was not used. */
	value: string;
}

export type RowResult =
	| { status: 'parsed'; ico: string; parsed: ParsedRow; errorCode: null; warnings: RowWarning[] }
	| { status: 'invalid_ico' | 'error'; ico: null; parsed: null; errorCode: RowErrorCode; warnings: RowWarning[] };

export const ROW_ERROR_LABELS: Record<RowErrorCode, string> = {
	ico_empty: 'IČO chybí',
	ico_format: 'IČO není číslo s nejvýše 8 číslicemi',
	ico_checksum: 'IČO má neplatnou kontrolní číslici',
	name_too_long: 'Název je delší, než dovoluje nastavení',
	row_malformed: 'Řádek nejde přečíst'
};

export const ROW_WARNING_LABELS: Record<RowWarningCode, string> = {
	phone_invalid: 'Telefon nemá platný tvar, nepoužije se',
	subject_type_unknown: 'Neznámý typ subjektu, nepoužije se',
	legal_form_invalid: 'Kód právní formy nemá tři číslice, nepoužije se',
	region_unknown: 'Neznámý kraj, nepoužije se',
	region_district_mismatch: 'Kraj neodpovídá okresu, použije se kraj podle okresu',
	district_unknown: 'Neznámý okres, nepoužije se',
	nace_invalid: 'Kód oboru nemá platný tvar, nepoužije se',
	date_invalid: 'Datum nejde přečíst, nepoužije se',
	ca_too_long: 'Číslo CA je příliš dlouhé, nepoužije se',
	operator_unknown: 'Neznámý operátor, nepoužije se',
	robot_status_unknown: 'Neznámý stav z robota, IČO se zapíše bez něj',
	robot_status_skipped: 'IČO už má v databázi jiný stav, stav z robota se nepoužije'
};

export type RowStatus = 'pending' | 'parsed' | 'new' | 'update' | 'duplicate' | 'invalid_ico' | 'error';

// ---------- rules (from settings) ----------
export interface ImportRules {
	/** Prefix put before a number written without one, e.g. '+420'. */
	phoneDefaultPrefix: string;
	/** Number of digits of a number written without a prefix. */
	phoneNationalDigits: number;
	/** Characters that separate several numbers in one cell. */
	phoneSeparators: string;
	nameMaxLength: number;
	/** { FO: [texts], PO: [texts] }, texts lower-case without diacritics. */
	subjectTypeValues: Record<string, string[]>;
	/** { owned: [texts], other_owner: [texts], missing_in_siebel: [texts] }, texts normalised like headers. */
	robotStatusValues: Record<string, string[]>;
	/** { VF: [texts], TM: [texts], O2: [texts], jiny: [texts] }, texts normalised like headers. */
	operatorValues: Record<string, string[]>;
}

/** Builds the rules from the 'import.*' settings; throws when a key is missing or malformed. */
export function rulesFromSettings(settings: Record<string, unknown>): ImportRules {
	const text = (key: string): string => {
		const v = settings[key];
		if (typeof v !== 'string' || !v) throw new Error(`Setting ${key} must be a non-empty text`);
		return v;
	};
	const num = (key: string): number => {
		const v = Number(settings[key]);
		if (!Number.isFinite(v) || v < 1) throw new Error(`Setting ${key} must be a positive number`);
		return Math.floor(v);
	};
	const prefix = text('import.phone_default_prefix').replace(/\s/g, '');
	if (!/^\+[0-9]{1,4}$/.test(prefix)) throw new Error('Setting import.phone_default_prefix must look like +420');
	const map = settings['import.subject_type_values'];
	const subjectTypeValues: Record<string, string[]> = {};
	if (map && typeof map === 'object' && !Array.isArray(map)) {
		for (const [type, values] of Object.entries(map as Record<string, unknown>)) {
			subjectTypeValues[type] = Array.isArray(values) ? values.map((v) => normText(String(v))) : [];
		}
	}
	const robotMap = settings['import.robot_status_values'];
	const robotStatusValues: Record<string, string[]> = {};
	if (robotMap && typeof robotMap === 'object' && !Array.isArray(robotMap)) {
		for (const [outcome, values] of Object.entries(robotMap as Record<string, unknown>)) {
			robotStatusValues[outcome] = Array.isArray(values) ? values.map((v) => normText(String(v))) : [];
		}
	}
	const operatorMap = settings['import.operator_values'];
	const operatorValues: Record<string, string[]> = {};
	if (operatorMap && typeof operatorMap === 'object' && !Array.isArray(operatorMap)) {
		for (const [operator, values] of Object.entries(operatorMap as Record<string, unknown>)) {
			operatorValues[operator] = Array.isArray(values) ? values.map((v) => normText(String(v))) : [];
		}
	}
	return {
		operatorValues,
		robotStatusValues,
		phoneDefaultPrefix: prefix,
		phoneNationalDigits: num('import.phone_national_digits'),
		phoneSeparators: text('import.phone_separators'),
		nameMaxLength: num('import.name_max_length'),
		subjectTypeValues
	};
}

// ---------- text helpers ----------
/** Lower case, no diacritics, anything but letters and digits becomes one space. */
export function normText(input: unknown): string {
	return String(input ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function clean(input: unknown): string {
	if (input === null || input === undefined) return '';
	return String(input).replace(/\s+/g, ' ').trim();
}

// ---------- IČO ----------
/**
 * IČO of an import row: 1–7 digits are padded with leading zeros to 8 (Excel drops them when
 * the cell is a number), then the check digit is verified. More than 8 digits is an error,
 * nothing is cut off.
 */
export function parseImportIco(input: unknown): { ok: true; ico: string } | { ok: false; error: IcoError } {
	let text = clean(input).replace(/\s/g, '');
	// A numeric cell exported as text may read '1234567.0'.
	if (/^[0-9]+\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
	return parseIco(text);
}

// ---------- phones ----------
/** Splits one cell into separate numbers. */
export function splitPhones(cell: unknown, separators: string): string[] {
	const text = clean(cell);
	if (!text) return [];
	const set = new Set(separators.split(''));
	const parts: string[] = [];
	let current = '';
	for (const ch of text) {
		if (set.has(ch) || ch === '\n') {
			parts.push(current);
			current = '';
		} else current += ch;
	}
	parts.push(current);
	return parts.map((p) => p.trim()).filter(Boolean);
}

/** Converts one number to the stored form '+420123456789'; null when it cannot be a phone number. */
export function parsePhone(input: unknown, rules: ImportRules): string | null {
	let text = clean(input);
	if (!text) return null;
	if (/[a-zA-Z]/.test(text)) return null;
	text = text.replace(/[\s\-().]/g, '');
	// '00' opens an international number, unless the text is exactly a national number.
	if (text.startsWith('00') && text.length !== rules.phoneNationalDigits) text = '+' + text.slice(2);
	const prefixDigits = rules.phoneDefaultPrefix.slice(1);
	let result: string;
	if (text.startsWith('+')) {
		result = text;
	} else if (!/^[0-9]+$/.test(text)) {
		return null;
	} else if (text.length === rules.phoneNationalDigits) {
		result = rules.phoneDefaultPrefix + text;
	} else if (text.startsWith(prefixDigits) && text.length === prefixDigits.length + rules.phoneNationalDigits) {
		result = '+' + text;
	} else {
		return null;
	}
	// A country code never starts with zero.
	if (!/^\+[1-9][0-9]{7,14}$/.test(result)) return null;
	// A number with the default prefix must have exactly the national length.
	if (result.startsWith(rules.phoneDefaultPrefix) && result.length !== rules.phoneDefaultPrefix.length + rules.phoneNationalDigits) {
		return null;
	}
	return result;
}

// ---------- dates ----------
/** 'YYYY-MM-DD', 'D. M. YYYY', 'D.M.YYYY' or 'D/M/YYYY' → 'YYYY-MM-DD'; null when invalid. */
export function parseImportDate(input: unknown): string | null {
	const text = clean(input);
	let y: number, m: number, d: number;
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
	const cz = /^(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})$/.exec(text);
	if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
	else if (cz) [d, m, y] = [Number(cz[1]), Number(cz[2]), Number(cz[3])];
	else return null;
	const date = new Date(Date.UTC(y, m - 1, d));
	if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
	if (y < 1000) return null;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${y}-${pad(m)}-${pad(d)}`;
}

// ---------- regions and districts ----------
const regionKey = (name: string) =>
	normText(name)
		.replace(/\b(kraj|hlavni mesto|hl m|okres)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
const REGION_BY_NAME = new Map(REGIONS.map((r) => [regionKey(r.name), r]));
const DISTRICT_BY_CODE = new Map(REGIONS.flatMap((r) => r.districts.map((d) => [d.code, { ...d, region: r }] as const)));
const DISTRICT_BY_NAME = new Map(
	REGIONS.flatMap((r) => r.districts.map((d) => [regionKey(d.name), { ...d, region: r }] as const))
);

export function findRegion(input: unknown): { code: string; name: string } | null {
	const text = clean(input);
	if (!text) return null;
	const r = REGION_BY_CODE.get(text) ?? REGION_BY_NAME.get(regionKey(text));
	return r ? { code: r.code, name: r.name } : null;
}

export function findDistrict(input: unknown): { code: string; name: string; region: { code: string; name: string } } | null {
	const text = clean(input);
	if (!text) return null;
	const d = DISTRICT_BY_CODE.get(text) ?? DISTRICT_BY_NAME.get(regionKey(text));
	return d ? { code: d.code, name: d.name, region: { code: d.region.code, name: d.region.name } } : null;
}

/** District code → code of its region, for checks done in SQL. */
export const DISTRICT_REGION_CODES: Record<string, string> = Object.fromEntries(
	REGIONS.flatMap((r) => r.districts.map((d) => [d.code, r.code]))
);

// ---------- one row ----------
const RAW_TEXT_KEYS = [
	'ico',
	'name',
	'subject_type',
	'legal_form_code',
	'region',
	'district',
	'nace',
	'founded_on',
	'ca_number',
	'robot_status',
	'owned_from',
	'operator'
] as const;
export const RAW_CELL_MAX = 500;
export const RAW_PHONE_CELLS_MAX = 20;
const CA_MAX = 50;

/** Keeps only the known keys of an incoming row and clips over-long texts. Null when not an object. */
export function sanitizeRawRow(input: unknown): RawRow | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const source = input as Record<string, unknown>;
	const row: RawRow = {};
	for (const key of RAW_TEXT_KEYS) {
		const v = source[key];
		if (v === null || v === undefined) continue;
		if (typeof v !== 'string' && typeof v !== 'number') return null;
		const text = clean(v).slice(0, RAW_CELL_MAX);
		if (text) row[key] = text;
	}
	if (source.phones !== undefined && source.phones !== null) {
		if (!Array.isArray(source.phones)) return null;
		const phones: string[] = [];
		for (const p of source.phones.slice(0, RAW_PHONE_CELLS_MAX)) {
			if (typeof p !== 'string' && typeof p !== 'number') return null;
			const text = clean(p).slice(0, RAW_CELL_MAX);
			if (text) phones.push(text);
		}
		if (phones.length) row.phones = phones;
	}
	return row;
}

/** True when the row carries no value at all. */
export function isEmptyRawRow(row: RawRow): boolean {
	return RAW_TEXT_KEYS.every((k) => !row[k]) && !(row.phones && row.phones.length);
}

/** Checks and normalises one row. Never trusts what the browser already checked. */
export function validateRow(input: unknown, rules: ImportRules): RowResult {
	const raw = sanitizeRawRow(input);
	if (!raw) return { status: 'error', ico: null, parsed: null, errorCode: 'row_malformed', warnings: [] };

	const warnings: RowWarning[] = [];
	const warn = (code: RowWarningCode, field: ImportField, value: string) => warnings.push({ code, field, value });

	const ico = parseImportIco(raw.ico);
	if (!ico.ok) return { status: 'invalid_ico', ico: null, parsed: null, errorCode: ico.error, warnings: [] };

	const parsed: ParsedRow = { phones: [] };

	if (raw.name) {
		if (raw.name.length > rules.nameMaxLength) {
			return { status: 'error', ico: null, parsed: null, errorCode: 'name_too_long', warnings: [] };
		}
		parsed.name = raw.name;
	}

	if (raw.subject_type) {
		const key = normText(raw.subject_type);
		const hit = (['FO', 'PO'] as const).find((type) => (rules.subjectTypeValues[type] ?? []).includes(key));
		if (hit) parsed.subject_type = hit;
		else warn('subject_type_unknown', 'subject_type', raw.subject_type);
	}

	if (raw.legal_form_code) {
		const code = raw.legal_form_code.replace(/\.0+$/, '');
		if (/^[0-9]{3}$/.test(code)) parsed.legal_form_code = code;
		else warn('legal_form_invalid', 'legal_form_code', raw.legal_form_code);
	}

	// Region and district are stored as a pair that belongs together: the district decides.
	const district = raw.district ? findDistrict(raw.district) : null;
	if (raw.district) {
		if (district) {
			parsed.district_code = district.code;
			parsed.district_name = district.name;
			parsed.region_code = district.region.code;
			parsed.region_name = district.region.name;
		} else warn('district_unknown', 'district', raw.district);
	}
	if (raw.region) {
		const r = findRegion(raw.region);
		if (!r) warn('region_unknown', 'region', raw.region);
		else if (district && district.region.code !== r.code) warn('region_district_mismatch', 'region', raw.region);
		else {
			parsed.region_code = r.code;
			parsed.region_name = r.name;
		}
	}

	if (raw.nace) {
		const codes: string[] = [];
		for (const part of raw.nace.split(/[\s,;/|]+/).filter(Boolean)) {
			const code = part.replace(/\./g, '');
			if (/^[0-9]{2,6}$/.test(code)) {
				if (!codes.includes(code)) codes.push(code);
			} else warn('nace_invalid', 'nace', part);
		}
		if (codes.length) parsed.nace_codes = codes;
	}

	if (raw.founded_on) {
		const date = parseImportDate(raw.founded_on);
		if (date) parsed.founded_on = date;
		else warn('date_invalid', 'founded_on', raw.founded_on);
	}

	if (raw.ca_number) {
		if (raw.ca_number.length <= CA_MAX) parsed.ca_number = raw.ca_number;
		else warn('ca_too_long', 'ca_number', raw.ca_number.slice(0, CA_MAX) + '…');
	}

	if (raw.robot_status) {
		const key = normText(raw.robot_status);
		const hit = ROBOT_OUTCOMES.find((outcome) => (rules.robotStatusValues[outcome] ?? []).includes(key));
		if (hit) parsed.robot_outcome = hit;
		else warn('robot_status_unknown', 'robot_status', raw.robot_status);
	}

	if (raw.operator) {
		const key = normText(raw.operator);
		const hit = (['VF', 'TM', 'O2', 'jiny'] as const).find((op) => (rules.operatorValues?.[op] ?? []).includes(key));
		if (hit) parsed.operator = hit;
		else warn('operator_unknown', 'operator', raw.operator);
	}

	if (raw.owned_from) {
		const date = parseImportDate(raw.owned_from);
		if (date) parsed.owned_from = date;
		else warn('date_invalid', 'owned_from', raw.owned_from);
	}

	for (const cell of raw.phones ?? []) {
		for (const part of splitPhones(cell, rules.phoneSeparators)) {
			const phone = parsePhone(part, rules);
			if (!phone) warn('phone_invalid', 'phone', part);
			else if (!parsed.phones.includes(phone)) parsed.phones.push(phone);
		}
	}

	return { status: 'parsed', ico: ico.ico, parsed, errorCode: null, warnings };
}

// ---------- column mapping guess ----------
/** Header text → key used to remember and to guess the mapping. */
export function headerKey(header: unknown): string {
	return normText(header);
}

/**
 * Guesses the target field of each column. Order: remembered mapping (exact header), alias list
 * from settings (exact, then with a trailing number such as "Telefon 2"). A single-column field
 * is given to the first matching column only. Returns '' for columns left unmapped.
 */
export function guessMapping(
	headers: string[],
	aliases: Record<string, string[]>,
	remembered: Record<string, string>
): (ImportField | '')[] {
	const aliasToField = new Map<string, ImportField>();
	for (const [field, names] of Object.entries(aliases ?? {})) {
		if (!isImportField(field) || !Array.isArray(names)) continue;
		for (const name of names) {
			const key = normText(name);
			if (key && !aliasToField.has(key)) aliasToField.set(key, field);
		}
	}
	// A header that reads exactly like the name of a field in the application is that field, also
	// when the list of aliases in the settings does not know it.
	for (const field of IMPORT_FIELDS) {
		const key = normText(IMPORT_FIELD_LABELS[field]);
		if (key && !aliasToField.has(key)) aliasToField.set(key, field);
	}
	const used = new Set<ImportField>();
	const result: (ImportField | '')[] = headers.map(() => '');
	const take = (index: number, field: ImportField) => {
		if (result[index]) return;
		if (!MULTI_COLUMN_FIELDS.includes(field) && used.has(field)) return;
		result[index] = field;
		used.add(field);
	};
	const keys = headers.map(headerKey);
	// 1. remembered ('-' = the column was not used last time). A column whose header is an exact
	//    alias of a field is offered again all the same: every unmapped column is remembered as
	//    '-', also one whose field did not exist yet at the time (e.g. "Stav z robota").
	const skipped = new Set<number>();
	keys.forEach((key, i) => {
		const saved = key ? remembered?.[key] : undefined;
		if (saved === '-' && !aliasToField.has(key)) skipped.add(i);
		else if (isImportField(saved)) take(i, saved);
	});
	// 2. exact alias, 3. alias followed by a number
	keys.forEach((key, i) => {
		if (skipped.has(i) || !key) return;
		const field = aliasToField.get(key);
		if (field) take(i, field);
	});
	keys.forEach((key, i) => {
		if (skipped.has(i) || !key) return;
		const base = key.replace(/\s*[0-9]+$/, '').trim();
		const field = base !== key ? aliasToField.get(base) : undefined;
		if (field && MULTI_COLUMN_FIELDS.includes(field)) take(i, field);
	});
	return result;
}
