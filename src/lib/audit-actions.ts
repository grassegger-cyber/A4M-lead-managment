// Czech names of audit actions, entities and detail keys for the audit screen and the overview.
// Every action the server writes has a name here (checked by audit-actions.test.ts); an unknown
// code is still shown as it is, so the screen never hides a row.

export const AUDIT_ACTION_LABELS: Record<string, string> = {
	'auth.password_set': 'Nastavení hesla',
	'auth.login': 'Přihlášení',
	'auth.login_failed': 'Neúspěšné přihlášení',
	'auth.logout': 'Odhlášení',
	'auth.password_changed': 'Změna hesla',
	'auth.password_change_failed': 'Neúspěšná změna hesla',
	'company.state_change': 'Změna stavu IČO',
	'company.dates_override': 'Ruční přepsání data',
	'export.companies': 'Export IČO do Excelu',
	'export.returned_statuses': 'Soubor vrácení statusů',
	'returns.confirmed': 'Soubor vrácení statusů odeslán',
	'returns.cancelled': 'Soubor vrácení statusů zahozen',
	'import.started': 'Import založen',
	'import.validated': 'Import zkontrolován',
	'import.confirmed': 'Import potvrzen k zápisu',
	'import.applied': 'Import zapsán',
	'import.cancelled': 'Import zrušen',
	'import.rows_purged': 'Smazání řádků starých importů',
	'import.report_downloaded': 'Stažení reportu chyb importu',
	'seed.run': 'Vygenerování zkušebních dat',
	'settings.update': 'Změna nastavení',
	'settings.reset': 'Nastavení vráceno na výchozí',
	'settings.transition_update': 'Změna přechodu stavů',
	'settings.transition_create': 'Přidání přechodu stavů'
};

export const AUDIT_AREA_LABELS: Record<string, string> = {
	auth: 'Přihlášení a heslo',
	company: 'IČO',
	companies: 'IČO',
	import: 'Import',
	imports: 'Import',
	export: 'Export',
	returns: 'Lhůty a vrácení statusů',
	settings: 'Nastavení',
	seed: 'Zkušební data'
};

/** What kind of record an audit row is about (column "entity"). */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
	auth: 'Přihlášení',
	company: 'IČO',
	companies: 'Seznam IČO',
	import: 'Import č.',
	settings: 'Nastavení',
	state_transitions: 'Přechod stavů',
	seed: 'Zkušební data'
};

/** Names of the values stored in the details of an audit row. */
export const AUDIT_DETAIL_LABELS: Record<string, string> = {
	filter: 'Filtr',
	rows: 'Počet řádků',
	note: 'Poznámka',
	from_state: 'Ze stavu',
	to_state: 'Do stavu',
	fromState: 'Ze stavu',
	toState: 'Do stavu',
	from_holder: 'Původní držitel',
	to_holder: 'Nový držitel',
	reason_code: 'Kód důvodu',
	return_on: 'Datum návratu',
	quarantine_until: 'Karanténa do',
	key: 'Klíč nastavení',
	label: 'Název',
	warnings: 'Upozornění',
	filename: 'Soubor',
	sheet: 'List',
	declared_rows: 'Ohlášených řádků',
	empty_rows: 'Prázdných řádků',
	mapping: 'Mapování sloupců',
	remembered_mapping: 'Zapamatované mapování',
	mapping_remembered: 'Mapování zapamatováno',
	new: 'Nových',
	update: 'Existujících',
	updated: 'Aktualizovaných',
	unchanged: 'Beze změny',
	duplicate: 'Duplicit',
	invalid_ico: 'Neplatných IČO',
	error: 'Ostatních chyb',
	warning: 'Řádků s upozorněním',
	phones_added: 'Přidaných telefonů',
	previous_status: 'Předchozí stav importu',
	rows_deleted: 'Smazaných řádků',
	import_ids: 'Čísla importů',
	retention_days: 'Doba uchování (dny)',
	count: 'Počet',
	first_seq: 'První pořadové číslo',
	states: 'Počty podle stavu'
};

export function auditActionLabel(action: string): string {
	return AUDIT_ACTION_LABELS[action] ?? action;
}

export function auditArea(action: string): string {
	const dot = action.indexOf('.');
	return dot === -1 ? action : action.slice(0, dot);
}

export function auditAreaLabel(area: string): string {
	return AUDIT_AREA_LABELS[area] ?? area;
}

export function auditEntityLabel(entity: string | null | undefined): string {
	if (!entity) return '—';
	return AUDIT_ENTITY_LABELS[entity] ?? entity;
}

export function auditDetailLabel(key: string): string {
	return AUDIT_DETAIL_LABELS[key] ?? key;
}
