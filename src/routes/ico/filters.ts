// State of the IČO list (search, filters, sort, paging) and its form in the URL query.
// The URL is the single source of truth, so a filtered list can be bookmarked and the
// back button returns to the same view.

/** Filter value meaning "empty" (no rep, no cohort, operator not verified). Same token as the server. */
export const NONE = '-';

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_SORT = { key: 'ico', dir: 'asc' as const };

export interface ListState {
	q: string;
	state: string[];
	holderType: string[];
	holderLogin: string;
	subjectType: string[];
	regionCode: string[];
	districtCode: string[];
	operator: string[];
	cohortId: string[];
	channel: string[];
	salesRepId: string[];
	ownedFromFrom: string;
	ownedFromTo: string;
	ownershipEndsFrom: string;
	ownershipEndsTo: string;
	returnOnFrom: string;
	returnOnTo: string;
	quarantineUntilFrom: string;
	quarantineUntilTo: string;
	icoVerifiedFrom: string;
	icoVerifiedTo: string;
	operatorVerifiedFrom: string;
	operatorVerifiedTo: string;
	roundsMin: string;
	roundsMax: string;
	icoValid: string;
	neverReturn: string;
	sortKey: string;
	sortDir: 'asc' | 'desc';
	page: number;
	pageSize: number;
}

type ListKey = keyof ListState;

// State key → URL parameter name. Lists are comma-separated.
const LIST_PARAMS: [ListKey, string][] = [
	['state', 'state'],
	['holderType', 'holder'],
	['subjectType', 'type'],
	['regionCode', 'region'],
	['districtCode', 'district'],
	['operator', 'operator'],
	['cohortId', 'cohort'],
	['channel', 'channel'],
	['salesRepId', 'rep']
];
const TEXT_PARAMS: [ListKey, string][] = [
	['q', 'q'],
	['holderLogin', 'login'],
	['ownedFromFrom', 'ownedFrom'],
	['ownedFromTo', 'ownedTo'],
	['ownershipEndsFrom', 'endsFrom'],
	['ownershipEndsTo', 'endsTo'],
	['returnOnFrom', 'returnFrom'],
	['returnOnTo', 'returnTo'],
	['quarantineUntilFrom', 'quarFrom'],
	['quarantineUntilTo', 'quarTo'],
	['icoVerifiedFrom', 'icoVerFrom'],
	['icoVerifiedTo', 'icoVerTo'],
	['operatorVerifiedFrom', 'opVerFrom'],
	['operatorVerifiedTo', 'opVerTo'],
	['roundsMin', 'roundsMin'],
	['roundsMax', 'roundsMax'],
	['icoValid', 'valid'],
	['neverReturn', 'never']
];

/** Filters shown in the collapsible "more filters" panel (used for the badge with their count). */
export const MORE_FILTER_KEYS: ListKey[] = [
	'holderLogin',
	'regionCode',
	'districtCode',
	'operator',
	'cohortId',
	'channel',
	'salesRepId',
	'ownedFromFrom',
	'ownedFromTo',
	'ownershipEndsFrom',
	'ownershipEndsTo',
	'returnOnFrom',
	'returnOnTo',
	'quarantineUntilFrom',
	'quarantineUntilTo',
	'icoVerifiedFrom',
	'icoVerifiedTo',
	'operatorVerifiedFrom',
	'operatorVerifiedTo',
	'roundsMin',
	'roundsMax',
	'icoValid',
	'neverReturn'
];

export function emptyState(): ListState {
	return {
		q: '',
		state: [],
		holderType: [],
		holderLogin: '',
		subjectType: [],
		regionCode: [],
		districtCode: [],
		operator: [],
		cohortId: [],
		channel: [],
		salesRepId: [],
		ownedFromFrom: '',
		ownedFromTo: '',
		ownershipEndsFrom: '',
		ownershipEndsTo: '',
		returnOnFrom: '',
		returnOnTo: '',
		quarantineUntilFrom: '',
		quarantineUntilTo: '',
		icoVerifiedFrom: '',
		icoVerifiedTo: '',
		operatorVerifiedFrom: '',
		operatorVerifiedTo: '',
		roundsMin: '',
		roundsMax: '',
		icoValid: '',
		neverReturn: '',
		sortKey: DEFAULT_SORT.key,
		sortDir: DEFAULT_SORT.dir,
		page: 1,
		pageSize: DEFAULT_PAGE_SIZE
	};
}

export function parseQuery(params: URLSearchParams): ListState {
	const s = emptyState();
	const target = s as unknown as Record<string, unknown>;
	for (const [key, name] of LIST_PARAMS) {
		const raw = params.get(name);
		target[key] = raw ? [...new Set(raw.split(',').map((v) => v.trim()).filter(Boolean))] : [];
	}
	for (const [key, name] of TEXT_PARAMS) target[key] = (params.get(name) ?? '').trim();
	s.sortKey = params.get('sort') || DEFAULT_SORT.key;
	s.sortDir = params.get('dir') === 'desc' ? 'desc' : 'asc';
	const page = Number(params.get('page'));
	s.page = Number.isInteger(page) && page >= 1 ? page : 1;
	const size = Number(params.get('size'));
	s.pageSize = Number.isInteger(size) && size >= 1 ? size : DEFAULT_PAGE_SIZE;
	return s;
}

/** Query string without the leading '?'. Default values are left out to keep the URL short. */
export function toQuery(s: ListState): string {
	const params = new URLSearchParams();
	const source = s as unknown as Record<string, unknown>;
	const q = s.q.trim();
	if (q) params.set('q', q);
	for (const [key, name] of LIST_PARAMS) {
		const list = source[key] as string[];
		if (list.length) params.set(name, list.join(','));
	}
	for (const [key, name] of TEXT_PARAMS) {
		if (key === 'q') continue;
		const value = String(source[key] ?? '').trim();
		if (value) params.set(name, value);
	}
	if (s.sortKey !== DEFAULT_SORT.key || s.sortDir !== DEFAULT_SORT.dir) {
		params.set('sort', s.sortKey);
		params.set('dir', s.sortDir);
	}
	if (s.page > 1) params.set('page', String(s.page));
	if (s.pageSize !== DEFAULT_PAGE_SIZE) params.set('size', String(s.pageSize));
	// Commas read better unescaped and are safe in a query string.
	return params.toString().replace(/%2C/g, ',');
}

/** Arguments for companies.list / companies.export. */
export function toApiArgs(s: ListState) {
	return {
		search: s.q.trim(),
		filter: {
			state: s.state,
			holderType: s.holderType,
			holderLogin: s.holderLogin,
			subjectType: s.subjectType,
			regionCode: s.regionCode,
			districtCode: s.districtCode,
			operator: s.operator,
			cohortId: s.cohortId,
			channel: s.channel,
			salesRepId: s.salesRepId,
			ownedFromFrom: s.ownedFromFrom,
			ownedFromTo: s.ownedFromTo,
			ownershipEndsFrom: s.ownershipEndsFrom,
			ownershipEndsTo: s.ownershipEndsTo,
			returnOnFrom: s.returnOnFrom,
			returnOnTo: s.returnOnTo,
			quarantineUntilFrom: s.quarantineUntilFrom,
			quarantineUntilTo: s.quarantineUntilTo,
			icoVerifiedFrom: s.icoVerifiedFrom,
			icoVerifiedTo: s.icoVerifiedTo,
			operatorVerifiedFrom: s.operatorVerifiedFrom,
			operatorVerifiedTo: s.operatorVerifiedTo,
			roundsMin: s.roundsMin,
			roundsMax: s.roundsMax,
			icoValid: s.icoValid,
			neverReturn: s.neverReturn
		},
		sort: { key: s.sortKey, dir: s.sortDir },
		page: s.page,
		pageSize: s.pageSize
	};
}

function isSet(value: unknown): boolean {
	return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim() !== '';
}

/** Number of active filters among the given keys (default: search and all filters). */
export function countActive(s: ListState, keys?: ListKey[]): number {
	const all: ListKey[] = keys ?? [...LIST_PARAMS.map(([k]) => k), ...TEXT_PARAMS.map(([k]) => k)];
	const source = s as unknown as Record<string, unknown>;
	return all.filter((key) => isSet(source[key])).length;
}

/** "superuser:TEST" from the history → { type, login }. */
export function splitHolder(text: string | null | undefined): { type: string; login: string | null } | null {
	if (!text) return null;
	const at = text.indexOf(':');
	return at === -1 ? { type: text, login: null } : { type: text.slice(0, at), login: text.slice(at + 1) };
}
