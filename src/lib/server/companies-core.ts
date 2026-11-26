// Core domain functions for companies: the single state transition and the audit helper.
// Every IČO state change in the application must go through transition().
// Plain-Node importable (relative imports only).
import type { Ctx } from './context.ts';
import { inTransaction } from './context.ts';
import { AppError } from './errors.ts';
import { parseIco } from '../ico.ts';
import { isCompanyState, stateLabel } from '../states.ts';
import type { CompanyState, HolderType, HistorySource, Channel } from '../states.ts';

export interface AuditEntry {
	entity?: string;
	entityId?: string | number | null;
	/** Czech sentence for reading in the audit screen. */
	description?: string;
	/** Old and new values, export filter, row counts. Never phone numbers or request bodies. */
	details?: Record<string, unknown> | null;
}

/** Appends one row to audit_log and returns its id. Call it inside the same transaction as the change. */
export async function audit(ctx: Ctx, action: string, entry: AuditEntry = {}): Promise<number> {
	const row = await ctx.db.one<{ id: number }>(
		`insert into audit_log (at, actor_id, actor_name, action, entity, entity_id, description, details, ip, user_agent)
		 values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) returning id`,
		[
			ctx.now(),
			ctx.actor.id,
			ctx.actor.name,
			action,
			entry.entity ?? null,
			entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
			entry.description ?? null,
			entry.details ? JSON.stringify(entry.details) : null,
			ctx.ip,
			ctx.userAgent
		]
	);
	return Number(row!.id);
}

export interface TransitionExtra {
	/** State the caller saw. When it no longer matches, the transition is refused. */
	expectedFromState?: CompanyState;
	note?: string | null;
	/** Who triggered it. 'manual' (default) enforces manual_allowed / note_required and writes audit_log. */
	source?: HistorySource;
	/** New holder. Left unchanged when holderType is undefined. */
	holderType?: HolderType;
	holderLogin?: string | null;
	/** Fields below are written only when the key is present (null clears the column). */
	salesRepId?: number | null;
	cohortId?: number | null;
	channel?: Channel | null;
	ownedFrom?: string | null;
	ownershipEndsOn?: string | null;
	returnOn?: string | null;
	returnPath?: 'siebel_check' | 'robot' | null;
	quarantineUntil?: string | null;
	neverReturn?: boolean;
	/** Adds this number to rounds_count (e.g. 1 when a new round starts). */
	roundsIncrement?: number;
}

export interface TransitionResult {
	ico: string;
	fromState: CompanyState;
	toState: CompanyState;
	fromHolder: string | null;
	toHolder: string | null;
	historyId: number;
	at: Date;
}

function holderText(type: string | null, login: string | null): string | null {
	if (!type) return null;
	return login ? `${type}:${login}` : type;
}

const EXTRA_COLUMNS: [keyof TransitionExtra, string][] = [
	['salesRepId', 'sales_rep_id'],
	['cohortId', 'cohort_id'],
	['channel', 'channel'],
	['ownedFrom', 'owned_from'],
	['ownershipEndsOn', 'ownership_ends_on'],
	['returnOn', 'return_on'],
	['returnPath', 'return_path'],
	['quarantineUntil', 'quarantine_until'],
	['neverReturn', 'never_return']
];

/**
 * Moves one IČO to another state. One transaction: locks the company row, checks the
 * state_transitions table, updates the company, writes company_state_history and, for a
 * manual change, audit_log. Throws AppError when the transition is not allowed.
 */
export async function transition(
	ctx: Ctx,
	icoInput: string,
	toState: CompanyState,
	reason: string | null,
	extra: TransitionExtra = {}
): Promise<TransitionResult> {
	const parsed = parseIco(icoInput);
	if (!parsed.ok) throw new AppError('ico_invalid', 'Neplatné IČO.');
	const ico = parsed.ico;
	if (!isCompanyState(toState)) throw new AppError('state_unknown', `Neznámý stav „${toState}“.`);
	const source: HistorySource = extra.source ?? 'manual';
	const note = extra.note?.trim() || null;

	return inTransaction(ctx, async (tx) => {
		const company = await tx.db.one<{
			state: CompanyState;
			holder_type: string | null;
			holder_login: string | null;
			cohort_id: number | null;
		}>('select state, holder_type, holder_login, cohort_id from companies where ico = $1 for update', [ico]);
		if (!company) throw new AppError('company_not_found', `IČO ${ico} v databázi není.`, 404);

		const fromState = company.state;
		if (extra.expectedFromState && extra.expectedFromState !== fromState) {
			throw new AppError(
				'state_changed',
				`IČO ${ico} už není ve stavu „${stateLabel(extra.expectedFromState)}“, ale „${stateLabel(fromState)}“.`,
				409
			);
		}

		const rule = await tx.db.one<{ enabled: boolean; manual_allowed: boolean; note_required: boolean }>(
			'select enabled, manual_allowed, note_required from state_transitions where from_state = $1 and to_state = $2',
			[fromState, toState]
		);
		if (!rule || !rule.enabled) {
			throw new AppError(
				'transition_forbidden',
				`Přechod „${stateLabel(fromState)}“ → „${stateLabel(toState)}“ není povolený.`,
				409
			);
		}
		if (source === 'manual') {
			if (!rule.manual_allowed) {
				throw new AppError(
					'transition_not_manual',
					`Přechod „${stateLabel(fromState)}“ → „${stateLabel(toState)}“ nejde provést ručně.`,
					409
				);
			}
			if (rule.note_required && !note) {
				throw new AppError('note_required', 'Tento přechod vyžaduje poznámku.');
			}
		}

		const sets: string[] = ['state = $2'];
		const params: unknown[] = [ico, toState];
		const set = (column: string, value: unknown) => {
			params.push(value);
			sets.push(`${column} = $${params.length}`);
		};
		let toHolderType = company.holder_type;
		let toHolderLogin = company.holder_login;
		if (extra.holderType !== undefined) {
			toHolderType = extra.holderType;
			toHolderLogin = extra.holderLogin ?? null;
			set('holder_type', toHolderType);
			set('holder_login', toHolderLogin);
		}
		for (const [key, column] of EXTRA_COLUMNS) {
			if (key in extra && extra[key] !== undefined) set(column, extra[key]);
		}
		if (extra.roundsIncrement) {
			params.push(extra.roundsIncrement);
			sets.push(`rounds_count = rounds_count + $${params.length}`);
		}
		await tx.db.run(`update companies set ${sets.join(', ')} where ico = $1`, params);

		const at = tx.now();
		const fromHolder = holderText(company.holder_type, company.holder_login);
		const toHolder = holderText(toHolderType, toHolderLogin);
		const cohortId = 'cohortId' in extra && extra.cohortId !== undefined ? extra.cohortId : company.cohort_id;
		const history = await tx.db.one<{ id: number }>(
			`insert into company_state_history
				(ico, at, from_state, to_state, from_holder, to_holder, reason_code, note, cohort_id, source, actor_id, actor_name)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
			[ico, at, fromState, toState, fromHolder, toHolder, reason, note, cohortId, source, tx.actor.id, tx.actor.name]
		);

		if (source === 'manual') {
			await audit(tx, 'company.state_change', {
				entity: 'company',
				entityId: ico,
				description: `IČO ${ico}: ${stateLabel(fromState)} → ${stateLabel(toState)}`,
				details: { from_state: fromState, to_state: toState, from_holder: fromHolder, to_holder: toHolder, reason_code: reason, note }
			});
		}

		return { ico, fromState, toState, fromHolder, toHolder, historyId: Number(history!.id), at };
	});
}

/**
 * Writes the first history row for a newly inserted company (no previous state).
 * Importers call this right after the insert so that no company exists without history.
 */
export async function recordInitialState(
	ctx: Ctx,
	ico: string,
	source: HistorySource,
	reason: string | null = null,
	note: string | null = null
): Promise<void> {
	await ctx.db.run(
		`insert into company_state_history
			(ico, at, from_state, to_state, from_holder, to_holder, reason_code, note, cohort_id, source, actor_id, actor_name)
		 select ico, $2, null, state,
			null, case when holder_login is null then holder_type else holder_type || ':' || holder_login end,
			$3, $4, cohort_id, $5, $6, $7
		 from companies where ico = $1`,
		[ico, ctx.now(), reason, note, source, ctx.actor.id, ctx.actor.name]
	);
}
