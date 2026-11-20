// settings.* methods: business rule settings and the state transition table.
// Every write is validated, done in one transaction and recorded in audit_log with old and new value.
import type { Ctx, MethodMap } from '../context.ts';
import { inTransaction } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit } from '../companies-core.ts';
import { MAP_MAX_JSON_LENGTH } from '../settings-core.ts';
import { isCompanyState, stateLabel } from '../../states.ts';
import { graphProblems, newProblems } from '../../transition-graph.ts';
import type { TransitionEdge } from '../../transition-graph.ts';

export type ValueType = 'number' | 'text' | 'boolean' | 'list' | 'map';

interface SettingRow {
	key: string;
	value: unknown;
	default_value: unknown;
	value_type: ValueType;
	group_key: string;
	label_cs: string;
	help_cs: string | null;
	sort_order: number;
	updated_at: Date | null;
}

interface TransitionRow extends TransitionEdge {
	manual_allowed: boolean;
	note_required: boolean;
	label_cs: string;
	updated_at: Date | null;
}

/** Czech names of the setting groups (UI text only; the groups themselves come from the table). */
const GROUP_LABELS: Record<string, string> = {
	limits: 'Limity',
	ownership: 'Vlastnictví',
	pools: 'Pooly',
	ares: 'ARES',
	checkmobi: 'CheckMobi',
	prefilter: 'Předfiltr',
	cohort: 'Dávka',
	tasks: 'Úkoly',
	review: 'Revize',
	semaphore: 'Semafor',
	loss: 'Důvody prohry',
	rotation: 'Rotace',
	allocation: 'Přidělování leadů',
	raynet: 'Raynet',
	metrics: 'Měření',
	logs: 'Logy',
	jobs: 'Úlohy',
	list: 'Seznamy',
	retention: 'Uchovávání dat',
	backup: 'Zálohy',
	import: 'Import z Excelu'
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** JSON with sorted object keys, so two maps with the same content compare equal. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

const invalid = (message: string) => new AppError('setting_invalid', message, 400);

/**
 * Technical bounds of number settings. Not business values: below these the code that reads
 * the setting cannot work (a page of 0 rows, a batch of half a row).
 */
const NUMBER_RULES: Record<string, { min?: number; integer?: boolean }> = {
	'list.max_page_size': { min: 1, integer: true },
	'import.upload_batch_rows': { min: 1, integer: true },
	'import.validate_chunk_rows': { min: 1, integer: true },
	'import.apply_chunk_rows': { min: 1, integer: true },
	'import.max_rows': { min: 1, integer: true },
	'import.preview_rows': { min: 1, integer: true },
	'import.phone_national_digits': { min: 1, integer: true },
	'import.name_max_length': { min: 1, integer: true }
};

/**
 * Checks a new value against the type of the setting (and, when the key is given, against the
 * technical bounds of that key) and returns it normalised.
 * null ("not decided") is accepted only for settings whose default is null.
 */
export function validateSettingValue(
	row: Pick<SettingRow, 'value_type' | 'default_value'> & { key?: string },
	value: unknown
): unknown {
	if (value === null || value === undefined) {
		if (row.default_value === null) return null;
		throw invalid('Hodnota nesmí být prázdná.');
	}
	switch (row.value_type) {
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('Hodnota musí být číslo.');
			if (value < 0) throw invalid('Hodnota nesmí být záporná.');
			{
				const rule = row.key ? NUMBER_RULES[row.key] : undefined;
				if (rule?.integer && !Number.isInteger(value)) throw invalid('Hodnota musí být celé číslo.');
				if (rule?.min !== undefined && value < rule.min) throw invalid(`Hodnota musí být aspoň ${rule.min}.`);
			}
			return value;
		case 'text': {
			if (typeof value !== 'string') throw invalid('Hodnota musí být text.');
			const text = value.trim();
			if (!text) {
				if (row.default_value === null) return null;
				throw invalid('Hodnota nesmí být prázdná.');
			}
			if (text.length > 500) throw invalid('Text je příliš dlouhý (nejvýše 500 znaků).');
			return text;
		}
		case 'boolean':
			if (typeof value !== 'boolean') throw invalid('Hodnota musí být ano, nebo ne.');
			return value;
		case 'list': {
			if (!Array.isArray(value)) throw invalid('Hodnota musí být seznam.');
			if (value.length > 500) throw invalid('Seznam je příliš dlouhý (nejvýše 500 položek).');
			const defaults = Array.isArray(row.default_value) ? row.default_value : [];
			const numeric = defaults.length > 0 && defaults.every((d) => typeof d === 'number');
			const items = value.map((item) => {
				if (numeric) {
					if (typeof item !== 'number' || !Number.isFinite(item)) throw invalid('Položky seznamu musí být čísla.');
					return item;
				}
				if (typeof item === 'number' && Number.isFinite(item)) return item;
				if (typeof item !== 'string' || !item.trim()) throw invalid('Položky seznamu musí být neprázdné texty nebo čísla.');
				return item.trim();
			});
			if (new Set(items.map((i) => JSON.stringify(i))).size !== items.length) {
				throw invalid('Seznam obsahuje stejnou položku vícekrát.');
			}
			return items;
		}
		case 'map':
			if (!isPlainObject(value)) throw invalid('Hodnota musí být objekt JSON ve složených závorkách.');
			if (JSON.stringify(value).length > MAP_MAX_JSON_LENGTH) throw invalid('Objekt JSON je příliš velký.');
			return value;
		default:
			throw invalid('Neznámý typ nastavení.');
	}
}

async function lockSetting(ctx: Ctx, key: unknown): Promise<SettingRow> {
	if (typeof key !== 'string' || !key) throw new AppError('setting_unknown', 'Chybí klíč nastavení.', 400);
	const row = await ctx.db.one<SettingRow>(
		`select key, value, default_value, value_type, group_key, label_cs, help_cs, sort_order, updated_at
		 from settings where key = $1 for update`,
		[key]
	);
	if (!row) throw new AppError('setting_unknown', `Nastavení „${key}“ neexistuje.`, 404);
	return row;
}

async function writeSetting(ctx: Ctx, row: SettingRow, value: unknown, action: string, description: string) {
	await ctx.db.run('update settings set value = $1::jsonb, updated_at = $2, updated_by = $3 where key = $4', [
		JSON.stringify(value),
		ctx.now(),
		ctx.actor.id,
		row.key
	]);
	await audit(ctx, action, {
		entity: 'settings',
		entityId: row.key,
		description,
		details: { key: row.key, label: row.label_cs, old: row.value, new: value }
	});
	return { key: row.key, value, changed: true, updatedAt: ctx.now() };
}

async function allTransitions(ctx: Ctx): Promise<TransitionRow[]> {
	return ctx.db.query<TransitionRow>(
		`select from_state, to_state, enabled, manual_allowed, note_required, label_cs, updated_at
		 from state_transitions order by from_state, to_state`
	);
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') throw new AppError('transition_invalid', `Pole „${name}“ musí být ano, nebo ne.`, 400);
	return value;
}

export const methods: MethodMap = {
	/** { groups: [{ key, label, items: [{ key, value, defaultValue, valueType, label, help, isDefault, updatedAt }] }] } */
	'settings.list': async (ctx) => {
		const rows = await ctx.db.query<SettingRow>(
			`select key, value, default_value, value_type, group_key, label_cs, help_cs, sort_order, updated_at
			 from settings order by sort_order, key`
		);
		const groups: { key: string; label: string; items: unknown[] }[] = [];
		for (const row of rows) {
			let group = groups.find((g) => g.key === row.group_key);
			if (!group) {
				group = { key: row.group_key, label: GROUP_LABELS[row.group_key] ?? row.group_key, items: [] };
				groups.push(group);
			}
			group.items.push({
				key: row.key,
				value: row.value,
				defaultValue: row.default_value,
				valueType: row.value_type,
				label: row.label_cs,
				help: row.help_cs,
				isDefault: same(row.value, row.default_value),
				updatedAt: row.updated_at
			});
		}
		return { groups };
	},

	/** args: { key, value } */
	'settings.update': async (ctx, args) =>
		inTransaction(ctx, async (tx) => {
			const row = await lockSetting(tx, args?.key);
			const value = validateSettingValue(row, args?.value);
			if (same(value, row.value)) return { key: row.key, value: row.value, changed: false, updatedAt: row.updated_at };
			return writeSetting(tx, row, value, 'settings.update', `Změna nastavení „${row.label_cs}“`);
		}),

	/** args: { key } — puts the default value back */
	'settings.reset': async (ctx, args) =>
		inTransaction(ctx, async (tx) => {
			const row = await lockSetting(tx, args?.key);
			if (same(row.default_value, row.value)) {
				return { key: row.key, value: row.value, changed: false, updatedAt: row.updated_at };
			}
			return writeSetting(tx, row, row.default_value, 'settings.reset', `Nastavení „${row.label_cs}“ vráceno na výchozí hodnotu`);
		}),

	/** { transitions: [...], problems: { unreachable, deadEnds } } */
	'settings.transitions': async (ctx) => {
		const transitions = await allTransitions(ctx);
		return { transitions, problems: graphProblems(transitions) };
	},

	/**
	 * Changes one row of the transition table, or adds a new pair.
	 * args: { fromState, toState, enabled?, manualAllowed?, noteRequired?, label? }
	 * An unreachable state or a dead end is reported as a warning; the change is still saved.
	 */
	'settings.saveTransition': async (ctx, args) =>
		inTransaction(ctx, async (tx) => {
			const from = args?.fromState;
			const to = args?.toState;
			if (!isCompanyState(from) || !isCompanyState(to)) {
				throw new AppError('transition_invalid', 'Neznámý výchozí nebo cílový stav.', 400);
			}
			const enabled = optionalBoolean(args?.enabled, 'Povoleno');
			const manualAllowed = optionalBoolean(args?.manualAllowed, 'Ručně');
			const noteRequired = optionalBoolean(args?.noteRequired, 'Poznámka povinná');
			let label: string | undefined;
			if (args?.label !== undefined) {
				if (typeof args.label !== 'string' || !args.label.trim()) {
					throw new AppError('transition_invalid', 'Popis přechodu nesmí být prázdný.', 400);
				}
				const text: string = args.label.trim();
				if (text.length > 300) throw new AppError('transition_invalid', 'Popis je příliš dlouhý (nejvýše 300 znaků).', 400);
				label = text;
			}

			const before = await allTransitions(tx);
			const old = await tx.db.one<TransitionRow>(
				`select from_state, to_state, enabled, manual_allowed, note_required, label_cs, updated_at
				 from state_transitions where from_state = $1 and to_state = $2 for update`,
				[from, to]
			);
			if (!old && !label) throw new AppError('transition_invalid', 'Nový přechod potřebuje popis.', 400);
			const next = {
				enabled: enabled ?? old?.enabled ?? true,
				manual_allowed: manualAllowed ?? old?.manual_allowed ?? true,
				note_required: noteRequired ?? old?.note_required ?? false,
				label_cs: label ?? old?.label_cs ?? ''
			};
			const pair = `${stateLabel(from)} → ${stateLabel(to)}`;
			if (old) {
				const unchanged =
					old.enabled === next.enabled &&
					old.manual_allowed === next.manual_allowed &&
					old.note_required === next.note_required &&
					old.label_cs === next.label_cs;
				if (unchanged) return { changed: false, created: false, warnings: { unreachable: [], deadEnds: [] } };
				await tx.db.run(
					`update state_transitions set enabled = $3, manual_allowed = $4, note_required = $5, label_cs = $6,
						updated_at = $7, updated_by = $8 where from_state = $1 and to_state = $2`,
					[from, to, next.enabled, next.manual_allowed, next.note_required, next.label_cs, tx.now(), tx.actor.id]
				);
			} else {
				await tx.db.run(
					`insert into state_transitions (from_state, to_state, enabled, manual_allowed, note_required, label_cs, updated_at, updated_by)
					 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
					[from, to, next.enabled, next.manual_allowed, next.note_required, next.label_cs, tx.now(), tx.actor.id]
				);
			}
			const warnings = newProblems(before, await allTransitions(tx));
			const pick = (r: TransitionRow | typeof next) => ({
				enabled: r.enabled,
				manualAllowed: r.manual_allowed,
				noteRequired: r.note_required,
				label: r.label_cs
			});
			await audit(tx, old ? 'settings.transition_update' : 'settings.transition_create', {
				entity: 'state_transitions',
				entityId: `${from}>${to}`,
				description: old ? `Změna přechodu ${pair}` : `Přidán přechod ${pair}`,
				details: { fromState: from, toState: to, old: old ? pick(old) : null, new: pick(next), warnings }
			});
			return { changed: true, created: !old, warnings };
		})
};
