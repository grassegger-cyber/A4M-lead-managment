// Writes DATA_DIR/ukazka-kmen.xlsx: a made-up "master list" Excel for trying the import out.
// Usage: npm run sample-excel [-- --rows 3000]
// Runs on plain Node (type stripping): relative imports with .ts extensions.
//
// Everything is fictional: names carry "Testovací" and a number, phones use the non-existent
// prefix +420 000, IČO come from the 99xxxxxx range used by the seed (valid check digit; the
// range is believed to be unassigned, NOT verified) and, for the "missing leading zeros" case,
// from 0099xxxx (also NOT verified to be unassigned).
//
// Deliberate problems in the file: wrong check digit, IČO stored as a number without leading
// zeros, IČO too long / not a number / missing, duplicates inside the file, IČO that already are
// in a seeded database (seed numbers 1–250), malformed phones, unknown region and type, empty rows.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../src/lib/server/db.ts';
import { icoFromPrefix } from '../src/lib/ico.ts';
import { REGIONS } from '../src/lib/regions.ts';

function parseArgs(argv: string[]): { rows: number } {
	let rows = 3000;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--rows') rows = Number(argv[++i]);
		else if (argv[i].startsWith('--rows=')) rows = Number(argv[i].slice(7));
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	if (!Number.isInteger(rows) || rows < 500 || rows > 35000) throw new Error('--rows must be a whole number between 500 and 35000');
	return { rows };
}

// Deterministic random numbers: the same file on every run.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = mulberry32(20261120);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const pad5 = (n: number) => String(n).padStart(5, '0');

const FIRST_NAMES = ['Jan', 'Petr', 'Eva', 'Jana', 'Tomáš', 'Lucie', 'Martin', 'Hana', 'Pavel', 'Alena'];
const FORMS = ['s.r.o.', 's.r.o.', 's.r.o.', 'a.s.', 'v.o.s.', 'z.s.'];
const NACE = ['01110', '10710', '41200', '43210', '45200', '46900', '47110', '49410', '56100', '62010', '68200', '69200'];

type Cell = string | number | Date | null;
interface Line {
	ico: Cell;
	name: Cell;
	type: Cell;
	region: Cell;
	district: Cell;
	phone1: Cell;
	phone2: Cell;
	nace: Cell;
	founded: Cell;
	note: Cell;
}

let phoneSeq = 0;
/** A fictional number in one of the ways people write them. */
function phone(): string {
	const digits = '000' + String(100000 + (phoneSeq++ % 900000));
	switch (int(0, 3)) {
		case 0:
			return digits;
		case 1:
			return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
		case 2:
			return `+420${digits}`;
		default:
			return `+420 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
	}
}

function founded(): Cell {
	const y = int(1995, 2026);
	const m = int(1, 12);
	const d = int(1, 28);
	const r = rand();
	if (r < 0.15) return null;
	if (r < 0.6) return new Date(Date.UTC(y, m - 1, d));
	return `${d}. ${m}. ${y}`;
}

/** A regular row for sequence number n (name and type follow the number). */
function company(n: number, ico: string, asNumber: boolean): Line {
	const isFo = rand() < 0.35;
	const region = pick(REGIONS);
	const district = pick(region.districts);
	return {
		ico: asNumber ? Number(ico) : ico,
		name: isFo ? `${pick(FIRST_NAMES)} Testovací ${pad5(n)}` : `Testovací firma ${pad5(n)} ${pick(FORMS)}`,
		type: isFo ? pick(['FO', 'Fyzická osoba', 'OSVČ']) : pick(['PO', 'Právnická osoba']),
		region: rand() < 0.5 ? region.name : region.name.replace(/ kraj$/, ''),
		district: rand() < 0.8 ? district.name : null,
		phone1: phone(),
		phone2: rand() < 0.3 ? phone() : null,
		nace: rand() < 0.7 ? pick(NACE) : null,
		founded: founded(),
		note: rand() < 0.1 ? 'smyšlený řádek' : null
	};
}

const EMPTY: Line = { ico: null, name: null, type: null, region: null, district: null, phone1: null, phone2: null, nace: null, founded: null, note: null };

async function main() {
	const { rows: target } = parseArgs(process.argv.slice(2));
	const lines: Line[] = [];
	const scale = target / 3000;
	const count = (n: number) => Math.max(1, Math.round(n * scale));

	// 1. Regular new companies (seed range 99, numbers from 60001 so they do not meet seeded ones).
	const regular = target - count(250) - count(40) - count(30) - count(25) - count(20) - count(15) - count(11) - count(12);
	for (let i = 0; i < regular; i++) {
		const n = 60001 + i;
		// Most IČO are numeric cells, as Excel stores them; some are text.
		lines.push(company(n, icoFromPrefix(`99${pad5(n)}`), rand() < 0.8));
	}
	// 2. IČO already in a seeded database (seed numbers 1–250): new phone, sometimes no name.
	for (let i = 1; i <= count(250); i++) {
		const line = company(i, icoFromPrefix(`99${pad5(i)}`), true);
		if (rand() < 0.5) line.name = null;
		line.note = 'IČO už v databázi je (po npm run seed)';
		lines.push(line);
	}
	// 3. IČO starting with zeros stored as a number: Excel dropped the zeros, the import puts them back.
	for (let i = 1; i <= count(40); i++) {
		const line = company(70000 + i, icoFromPrefix(`0099${String(i).padStart(3, '0')}`), true);
		line.note = 'IČO bez úvodních nul';
		lines.push(line);
	}
	// 4. Wrong check digit.
	for (let i = 1; i <= count(30); i++) {
		const good = icoFromPrefix(`99${pad5(80000 + i)}`);
		// Any last digit but the right one.
		const wrong = (Number(good[7]) + int(1, 9)) % 10;
		const line = company(80000 + i, good.slice(0, 7) + wrong, true);
		line.note = 'chybná kontrolní číslice';
		lines.push(line);
	}
	// 5. Duplicates inside the file: an IČO from part 1 again, with another phone.
	for (let i = 0; i < count(25); i++) {
		const n = 60001 + int(0, regular - 1);
		const line = company(n, icoFromPrefix(`99${pad5(n)}`), true);
		line.name = `Testovací firma ${pad5(n)} (duplicitní řádek)`;
		line.note = 'duplicita v souboru';
		lines.push(line);
	}
	// 6. Malformed phones (the company itself is fine).
	const BAD_PHONES = ['12345', '000 123', 'nemá telefon', '+420 000 12 34', '0001234567890', 'viz web'];
	for (let i = 1; i <= count(20); i++) {
		const line = company(81000 + i, icoFromPrefix(`99${pad5(81000 + i)}`), true);
		line.phone1 = pick(BAD_PHONES);
		line.note = 'vadný telefon';
		lines.push(line);
	}
	// 7. Other trouble with the IČO: missing, too long, not a number.
	for (let i = 1; i <= count(11); i++) {
		const line = company(82000 + i, '', false);
		line.ico = pick([null, null, `99${pad5(82000 + i)}123`, 'neuvedeno', 'CZ-TEST']);
		line.note = 'IČO chybí nebo nejde přečíst';
		lines.push(line);
	}
	// 8. Unknown region or subject type (the row is used, the value is skipped).
	for (let i = 1; i <= count(12); i++) {
		const line = company(83000 + i, icoFromPrefix(`99${pad5(83000 + i)}`), true);
		if (i % 2) line.region = 'Testovací kraj';
		else line.type = 'neurčeno';
		line.note = 'neznámá hodnota';
		lines.push(line);
	}

	// Shuffle (Fisher–Yates) so the problems are spread over the file, then put in empty rows.
	for (let i = lines.length - 1; i > 0; i--) {
		const j = int(0, i);
		[lines[i], lines[j]] = [lines[j], lines[i]];
	}
	for (let i = 0; i < count(15); i++) lines.splice(int(1, lines.length - 1), 0, EMPTY);

	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Kmen');
	sheet.columns = [
		{ header: 'IČO', key: 'ico', width: 12 },
		{ header: 'Název firmy', key: 'name', width: 38 },
		{ header: 'Typ subjektu', key: 'type', width: 18 },
		{ header: 'Kraj', key: 'region', width: 24 },
		{ header: 'Okres', key: 'district', width: 20 },
		{ header: 'Telefon', key: 'phone1', width: 20 },
		{ header: 'Telefon 2', key: 'phone2', width: 20 },
		{ header: 'CZ-NACE', key: 'nace', width: 10 },
		{ header: 'Datum vzniku', key: 'founded', width: 14 },
		{ header: 'Poznámka', key: 'note', width: 36 }
	];
	sheet.getRow(1).font = { bold: true };
	sheet.getColumn('founded').numFmt = 'dd.mm.yyyy';
	for (const line of lines) sheet.addRow(line);

	const dir = dataDir();
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'ukazka-kmen.xlsx');
	await workbook.xlsx.writeFile(file);
	console.log(`Written ${lines.length} rows (plus the header) to ${file}`);
	console.log('Fictional data only. The file is ignored by git (*.xlsx, *.nosync).');
}

main().catch((e) => {
	console.error(e instanceof Error ? e.message : e);
	process.exitCode = 1;
});
