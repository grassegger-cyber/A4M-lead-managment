// Shared by the import screens: shapes returned by imports.* and Czech labels of the statuses.
import type { DotStyle } from '$lib/states';

export type ImportStatus = 'uploading' | 'uploaded' | 'validated' | 'applying' | 'applied' | 'cancelled';

export interface ImportSummary {
	id: number;
	filename: string;
	sheetName: string | null;
	status: ImportStatus;
	mapping: Record<string, string[]>;
	declaredRows: number;
	emptyRows: number;
	receivedRows: number;
	validatedRows: number;
	counts: { new: number; update: number; duplicate: number; invalidIco: number; error: number; warning: number } | null;
	applied: { throughRow: number; new: number; updated: number; unchanged: number; phones: number };
	/** Column "Stav z robota": IČO per outcome; absent when the file has no such column. */
	robot?: { owned: number; otherOwner: number; missing: number; skipped: number } | null;
	createdAt: string;
	createdByName: string | null;
	uploadedAt: string | null;
	validatedAt: string | null;
	confirmedAt: string | null;
	confirmedByName: string | null;
	appliedAt: string | null;
	cancelledAt: string | null;
	rowsPurgedAt: string | null;
}

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
	uploading: 'Nahrávání nedokončeno',
	uploaded: 'Čeká na kontrolu',
	validated: 'Zkontrolováno, čeká na potvrzení',
	applying: 'Zápis nedokončen',
	applied: 'Zapsáno',
	cancelled: 'Zrušeno'
};

export const IMPORT_STATUS_DOTS: Record<ImportStatus, DotStyle> = {
	uploading: { color: 'grey', variant: 'ring' },
	uploaded: { color: 'grey', variant: 'ring' },
	validated: { color: 'accent', variant: 'ring' },
	applying: { color: 'accent', variant: 'solid' },
	applied: { color: 'ink', variant: 'solid' },
	cancelled: { color: 'fan', variant: 'solid' }
};
