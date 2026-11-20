// Reads an .xlsx file in the browser with exceljs. Nothing leaves the browser here.
import { cellText } from '$lib/import/cells';

export interface SheetData {
	name: string;
	/** rows[i] = texts of the cells of Excel row i + 1 (trailing empty cells cut). */
	rows: string[][];
}

async function loadExcelJs(): Promise<any> {
	// The package's browser build; depending on the bundler it arrives as a module or as a global.
	const mod: any = await import('exceljs');
	const lib = mod?.Workbook ? mod : mod?.default?.Workbook ? mod.default : (globalThis as any).ExcelJS;
	if (!lib?.Workbook) throw new Error('Knihovnu pro čtení Excelu se nepodařilo načíst.');
	return lib;
}

export async function readWorkbook(file: File): Promise<SheetData[]> {
	const ExcelJS = await loadExcelJs();
	const workbook = new ExcelJS.Workbook();
	try {
		await workbook.xlsx.load(await file.arrayBuffer());
	} catch {
		throw new Error('Soubor nejde přečíst. Je to sešit Excelu ve formátu .xlsx?');
	}
	const sheets: SheetData[] = [];
	for (const ws of workbook.worksheets) {
		const rows: string[][] = [];
		ws.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
			const values: unknown[] = Array.isArray(row.values) ? row.values : [];
			// row.values is 1-based (index 0 unused).
			const texts: string[] = [];
			for (let c = 1; c < values.length; c++) texts.push(cellText(values[c]));
			while (texts.length && !texts[texts.length - 1]) texts.pop();
			rows[rowNumber - 1] = texts;
		});
		// Fill the holes left by empty rows so the index stays the Excel row number.
		for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
		sheets.push({ name: String(ws.name), rows });
	}
	if (!sheets.length) throw new Error('Sešit neobsahuje žádný list.');
	return sheets;
}
