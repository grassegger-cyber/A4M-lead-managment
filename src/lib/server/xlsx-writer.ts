// Streaming Excel writer for large exports: rows are committed as they are written and the file
// is collected from a Node stream. The demo build (vite.demo.config.ts) puts
// src/lib/demo/xlsx-writer.ts in its place, which has no Node streams.
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

export interface XlsxWriter {
	/** Add sheets and rows here; commit each row and each sheet once it is complete. */
	workbook: ExcelJS.stream.xlsx.WorkbookWriter;
	/** Commits the workbook and returns the finished .xlsx file. */
	finish(): Promise<Uint8Array>;
}

export async function createXlsxWriter(): Promise<XlsxWriter> {
	const stream = new PassThrough();
	const chunks: Buffer[] = [];
	stream.on('data', (chunk: Buffer) => chunks.push(chunk));
	const finished = new Promise<void>((resolve, reject) => {
		stream.on('end', () => resolve());
		stream.on('error', reject);
	});
	const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
	return {
		workbook,
		async finish() {
			await workbook.commit();
			await finished;
			return new Uint8Array(Buffer.concat(chunks));
		}
	};
}
