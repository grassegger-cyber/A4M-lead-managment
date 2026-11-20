// Request context handed to every API method and to the core domain functions.
// Plain-Node importable (relative imports only), so scripts and tests can build one too.
import type { Queryable } from './db.ts';

export interface Session {
	id: number;
	createdAt: Date;
	expiresAt: Date;
}

export interface Actor {
	/** Always null locally (single password, no users table). */
	id: string | null;
	name: string;
}

/** Cookie access for auth methods; matches the part of SvelteKit's Cookies that is used. */
export interface CookieJar {
	get(name: string): string | undefined;
	set(name: string, value: string, opts: Record<string, unknown> & { path: string }): void;
	delete(name: string, opts: Record<string, unknown> & { path: string }): void;
}

export interface Ctx {
	/** Database handle, or the transaction handle inside inTransaction(). */
	db: Queryable;
	/** Logged-in session; null only for auth.* methods called before login. */
	session: Session | null;
	/** Current time. Always use this instead of new Date() so tests can fix the clock. */
	now: () => Date;
	actor: Actor;
	ip: string | null;
	userAgent: string | null;
	/** Present for HTTP requests; absent in scripts and tests. */
	cookies?: CookieJar;
	/** True when the request came over https (decides the Secure cookie flag). */
	secure?: boolean;
}

export type Method = (ctx: Ctx, args: any) => Promise<unknown> | unknown;
export type MethodMap = Record<string, Method>;

export const LOCAL_ACTOR: Actor = { id: null, name: 'Správce' };
export const SYSTEM_ACTOR: Actor = { id: null, name: 'Systém' };

/** Context for scripts, background work and tests. */
export function systemCtx(db: Queryable, overrides: Partial<Ctx> = {}): Ctx {
	return {
		db,
		session: null,
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
