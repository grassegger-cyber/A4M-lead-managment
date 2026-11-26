// Access to the settings table for server code. Business rules read their numbers here, never
// from constants. The settings screen writes through methods/settings.ts; other areas may only
// remember a choice of the user through mergeSettingMap() below.
import type { Ctx } from './context.ts';
import type { Queryable } from './db-types.ts';
import { AppError } from './errors.ts';
import { audit } from './companies-core.ts';

/** Largest JSON text of a map setting (also enforced by settings.update). */
export const MAP_MAX_JSON_LENGTH = 20000;

/** Returns the value of one setting. Throws when the key does not exist. */
export async function getSetting<T = unknown>(db: Queryable, key: string): Promise<T> {
	const row = await db.one<{ value: T }>('select value from settings where key = $1', [key]);
	if (!row) throw new AppError('setting_missing', `Nastavení „${key}“ neexistuje.`, 500);
	return row.value;
}

/** Returns several settings as { key: value }. With a prefix ('limits.') returns the whole group. */
export async function getSettings(db: Queryable, keysOrPrefix: string[] | string): Promise<Record<string, unknown>> {
	const rows =
		typeof keysOrPrefix === 'string'
			? await db.query<{ key: string; value: unknown }>(
					"select key, value from settings where key like $1 || '%' order by sort_order",
					[keysOrPrefix]
				)
			: await db.query<{ key: string; value: unknown }>(
					'select key, value from settings where key = any($1::text[])',
					[keysOrPrefix]
				);
	return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Page size capped by the list.max_page_size setting. */
export async function clampPageSize(db: Queryable, requested: unknown, fallback = 50): Promise<number> {
	const setting = Number(await getSetting(db, 'list.max_page_size'));
	// A broken setting (below 1, not a number) must not empty every list: the fallback caps instead.
	const max = Number.isFinite(setting) && setting >= 1 ? Math.floor(setting) : fallback;
	const n = Math.floor(Number(requested));
	if (!Number.isFinite(n) || n < 1) return Math.min(fallback, max);
	return Math.min(n, max);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON with sorted keys, so the same content compares equal. */
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

/**
 * Merges keys into a map setting on behalf of the user (e.g. the remembered column mapping of
 * the import). Same rules as a change on the settings screen: the size cap applies and the
 * change is written to audit_log as settings.update with the old and the new value.
 * Call it inside the caller's transaction. Returns what happened; 'too_large' writes nothing.
 */
export async function mergeSettingMap(
	ctx: Ctx,
	key: string,
	patch: Record<string, unknown>,
	why: string
): Promise<'changed' | 'unchanged' | 'too_large'> {
	const row = await ctx.db.one<{ value: unknown; value_type: string; label_cs: string }>(
		'select value, value_type, label_cs from settings where key = $1 for update',
		[key]
	);
	if (!row) throw new AppError('setting_missing', `Nastavení „${key}“ neexistuje.`, 500);
	if (row.value_type !== 'map') throw new AppError('setting_invalid', `Nastavení „${key}“ není mapa.`, 500);
	const old = isPlainObject(row.value) ? row.value : {};
	const next = { ...old, ...patch };
	if (canonical(old) === canonical(next)) return 'unchanged';
	if (JSON.stringify(next).length > MAP_MAX_JSON_LENGTH) return 'too_large';
	await ctx.db.run('update settings set value = $1::jsonb, updated_at = $2, updated_by = $3 where key = $4', [
		JSON.stringify(next),
		ctx.now(),
		ctx.actor.id,
		key
	]);
	await audit(ctx, 'settings.update', {
		entity: 'settings',
		entityId: key,
		description: `Změna nastavení „${row.label_cs}“ (${why})`,
		details: { key, label: row.label_cs, old, new: next }
	});
	return 'changed';
}
