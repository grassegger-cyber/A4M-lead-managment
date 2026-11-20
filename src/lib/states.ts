// IČO states: values exactly as in the specification, Czech labels and dot styles for the UI.

export const STATES = [
	'v_poolu',
	've_filtru',
	'u_robota_ocisteni',
	'superuser',
	'login_oz',
	'vraceno',
	'odvlastneno',
	'plovak',
	'karantena',
	'ztraceno',
	'zakaznik',
	'neaktivni_ico'
] as const;

export type CompanyState = (typeof STATES)[number];

export const STATE_LABELS: Record<CompanyState, string> = {
	v_poolu: 'V poolu',
	ve_filtru: 'Ve filtru',
	u_robota_ocisteni: 'U robota (očištění)',
	superuser: 'Superuser',
	login_oz: 'Login OZ',
	vraceno: 'Vráceno',
	odvlastneno: 'Odvlastněno',
	plovak: 'Plovák',
	karantena: 'Karanténa',
	ztraceno: 'Ztraceno',
	zakaznik: 'Zákazník',
	neaktivni_ico: 'Neaktivní IČO'
};

/**
 * Dot look: colour (CSS variable name without --: a palette colour or `state-<state>`), fill style,
 * and `rim`, a hairline ink edge that keeps a light dot visible on white.
 */
export interface DotStyle {
	color: 'ink' | 'accent' | 'grey' | 'fan' | 'muted' | `state-${CompanyState}`;
	variant: 'solid' | 'ring' | 'double';
	rim?: boolean;
}

export const STATE_DOTS: Record<CompanyState, DotStyle> = {
	v_poolu: { color: 'state-v_poolu', variant: 'solid', rim: true },
	ve_filtru: { color: 'state-ve_filtru', variant: 'solid', rim: true },
	u_robota_ocisteni: { color: 'state-u_robota_ocisteni', variant: 'solid', rim: true },
	superuser: { color: 'state-superuser', variant: 'solid', rim: true },
	login_oz: { color: 'state-login_oz', variant: 'solid' },
	vraceno: { color: 'state-vraceno', variant: 'solid' },
	odvlastneno: { color: 'state-odvlastneno', variant: 'solid' },
	plovak: { color: 'state-plovak', variant: 'solid', rim: true },
	karantena: { color: 'state-karantena', variant: 'solid' },
	ztraceno: { color: 'state-ztraceno', variant: 'solid', rim: true },
	zakaznik: { color: 'state-zakaznik', variant: 'solid' },
	neaktivni_ico: { color: 'state-neaktivni_ico', variant: 'solid' }
};

export function isCompanyState(value: unknown): value is CompanyState {
	return typeof value === 'string' && (STATES as readonly string[]).includes(value);
}

export function stateLabel(value: string | null | undefined): string {
	if (!value) return '—';
	return isCompanyState(value) ? STATE_LABELS[value] : value;
}

export const HOLDER_TYPES = ['superuser', 'login_oz', 'pool', 'jiny_partner', 'neznamo'] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];

export const HOLDER_LABELS: Record<HolderType, string> = {
	superuser: 'Superuser',
	login_oz: 'Login OZ',
	pool: 'Pool',
	jiny_partner: 'Jiný partner',
	neznamo: 'Neznámo'
};

export const CHANNELS = ['operatorka', 'cold_call'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
	operatorka: 'Operátorka',
	cold_call: 'Cold call OZ'
};

export const SUBJECT_TYPES = ['FO', 'PO'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
	FO: 'Fyzická osoba',
	PO: 'Právnická osoba'
};

export const OPERATORS = ['VF', 'O2', 'TM', 'jiny'] as const;
export type Operator = (typeof OPERATORS)[number];
export const OPERATOR_LABELS: Record<Operator, string> = {
	VF: 'Vodafone',
	O2: 'O2',
	TM: 'T-Mobile',
	jiny: 'Jiný'
};

export const HISTORY_SOURCES = [
	'import',
	'robot',
	'siebel',
	'semaphore',
	'loss_rule',
	'allocation',
	'manual',
	'system'
] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];
export const HISTORY_SOURCE_LABELS: Record<HistorySource, string> = {
	import: 'Import',
	robot: 'Robot',
	siebel: 'Siebel',
	semaphore: 'Semafor',
	loss_rule: 'Důvod prohry',
	allocation: 'Přidělení',
	manual: 'Ručně',
	system: 'Systém'
};
