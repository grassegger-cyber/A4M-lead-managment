// Excel writer of the demo build, in place of src/lib/server/xlsx-writer.ts (which needs Node
// streams). Same workbook, built in memory in the browser and written out at the end.
import type ExcelJS from 'exceljs';
import type { XlsxWriter } from '../server/xlsx-writer.ts';

async function loadExcelJs(): Promise<typeof ExcelJS> {
	// The package's browser build; depending on the bundler it arrives as a module or as a global.
	const mod: any = await import('exceljs');
	return mod?.Workbook ? mod : mod?.default?.Workbook ? mod.default : (globalThis as any).ExcelJS;
}

export async function createXlsxWriter(): Promise<XlsxWriter> {
	const lib = await loadExcelJs();
	const book = new lib.Workbook();
	// The streaming writer commits rows and sheets as it goes. The in-memory workbook keeps
	// everything until the end, so a sheet's commit() has nothing to do (rows have their own no-op).
	const workbook = {
		addWorksheet(name: string, options?: Partial<ExcelJS.AddWorksheetOptions>) {
			return Object.assign(book.addWorksheet(name, options), { commit() {} });
		}
	} as unknown as ExcelJS.stream.xlsx.WorkbookWriter;
	return {
		workbook,
		async finish() {
			return new Uint8Array(await book.xlsx.writeBuffer());
		}
	};
}
