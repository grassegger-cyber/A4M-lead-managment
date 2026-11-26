// Request context handed to every API method and to the core domain functions.
// Plain-Node importable (relative imports only), so scripts and tests can build one too.
import type { Queryable } from './db-types.ts';

export interface Actor {
	/** users.id of the logged-in user; null for the system (scheduler, scripts, tests). */
	id: string | null;
	name: string;
}

export interface Ctx {
	/** Database handle, or the transaction handle inside inTransaction(). */
	db: Queryable;
	/** Current time. Always use this instead of new Date() so tests can fix the clock. */
	now: () => Date;
	actor: Actor;
	/** The logged-in user of an HTTP request; absent in scripts and tests. */
	user?: { id: string; email: string };
	ip: string | null;
	userAgent: string | null;
}

export type Method = (ctx: Ctx, args: any) => Promise<unknown> | unknown;
export type MethodMap = Record<string, Method>;

export const SYSTEM_ACTOR: Actor = { id: null, name: 'Systém' };

/** Context for scripts, background work and tests. */
export function systemCtx(db: Queryable, overrides: Partial<Ctx> = {}): Ctx {
	return {
		db,
		now: () => new Date(),
		actor: SYSTEM_ACTOR,
		ip: null,
		userAgent: null,
		...overrides
	};
}

/** Runs fn with a context whose db is a transaction (savepoint when already inside one). */
export function inTransaction<T>(ctx: Ctx, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
	return ctx.db.transaction((tx) => fn({ ...ctx, db: tx }));
}
