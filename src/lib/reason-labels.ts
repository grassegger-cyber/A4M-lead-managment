// Czech names of the machine reason codes stored with history rows (reason_code) and with ended
// assignments of sales reps (end_reason). A code without a name is shown as it is.
// Names of the loss reasons themselves are data of the loss rules (step 7), not of this file.

export const REASON_LABELS: Record<string, string> = {
	manual: 'Ruční změna',
	import_new: 'Nové IČO z importu',
	seed_import: 'Zkušební data',
	cohort_build: 'Zařazeno do dávky',
	robot_uploaded: 'Nahráno do robota',
	robot_landed: 'Přistálo na superuseru',
	robot_rejected: 'Robot nepřevzal',
	semaphore_green: 'Zelená',
	release_red: 'Uvolnění po červené',
	statuses_returned: 'Vráceno se statusy',
	quarantine_expired: 'Karanténa uplynula',
	ares_dissolved: 'ARES: IČO zaniklo',
	deal_won: 'Vyhraná příležitost',
	rotation: 'Rotace na jiného obchodníka'
};

export function reasonLabel(code: string | null | undefined): string {
	if (!code) return '—';
	const loss = /^loss_(\d+)$/.exec(code);
	if (loss) return `Důvod prohry ${loss[1]}`;
	return REASON_LABELS[code] ?? code;
}
