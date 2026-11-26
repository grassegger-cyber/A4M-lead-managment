// Builds an .xlsx file in the browser with exceljs and hands it to the user. The data come from
// the api; the file never exists on the server.

export interface SheetColumn {
	header: string;
	width?: number;
	/** Row values are objects: the key of this column. */
	key?: string;
	/** Values are 'YYYY-MM-DD' strings and become real Excel dates shown as DD. MM. RRRR. */
	date?: boolean;
}

export interface SheetSpec {
	name: string;
	columns: SheetColumn[];
	/** Either arrays in column order, or objects read by column key. */
	rows: (unknown[] | Record<string, unknown>)[];
	/** No bold header row, first column bold instead (label – value sheets). */
	labelColumn?: boolean;
}

async function loadExcelJs(): Promise<any> {
	const mod: any = await import('exceljs');
	const lib = mod?.Workbook ? mod : mod?.default?.Workbook ? mod.default : (globalThis as any).ExcelJS;
	if (!lib?.Workbook) throw new Error('Knihovnu pro zápis Excelu se nepodařilo načíst.');
	return lib;
}

const toDate = (value: unknown) => (typeof value === 'string' && value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : null);

export async function buildWorkbook(sheets: SheetSpec[]): Promise<Blob> {
	const ExcelJS = await loadExcelJs();
	const workbook = new ExcelJS.Workbook();
	workbook.created = new Date();
	for (const spec of sheets) {
		const sheet = workbook.addWorksheet(spec.name, spec.labelColumn ? {} : { views: [{ state: 'frozen', ySplit: 1 }] });
		sheet.columns = spec.columns.map((column) => ({
			...(spec.labelColumn ? {} : { header: column.header }),
			width: column.width,
			style: column.date ? { numFmt: 'dd". "mm". "yyyy' } : {}
		}));
		if (spec.labelColumn) sheet.getColumn(1).font = { bold: true };
		else sheet.getRow(1).font = { bold: true };
		for (const row of spec.rows) {
			const values = Array.isArray(row) ? row : spec.columns.map((column) => (column.key ? row[column.key] : undefined));
			sheet.addRow(values.map((value, i) => (spec.columns[i]?.date ? toDate(value) : (value ?? ''))));
		}
	}
	const buffer = await workbook.xlsx.writeBuffer();
	return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
