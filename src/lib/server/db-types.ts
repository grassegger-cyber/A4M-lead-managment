// Types of the database handle, shared by the PGlite layer (tests, local run) and the Postgres layer (cloud).

export type Row = Record<string, unknown>;

/** Query helpers shared by the database handle and by a transaction handle. */
export interface Queryable {
	/** Runs one statement with $1.. parameters and returns all rows. */
	query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
	/** Like query, returns the first row or null. */
	one<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
	/** Runs one statement and returns the number of affected rows. */
	run(sql: string, params?: unknown[]): Promise<number>;
	/** Runs several statements separated by semicolons (no parameters). */
	exec(sql: string): Promise<void>;
	/**
	 * Runs fn in a transaction (commit on return, rollback on throw).
	 * Called on a transaction handle it opens a savepoint instead.
	 */
	transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
	/** True for a transaction handle. Some statements (VACUUM) cannot run inside a transaction. */
	readonly inTransaction: boolean;
}

export interface Db extends Queryable {
	close(): Promise<void>;
	/** The folder holding the database, or null for an in-memory database. */
	readonly dataDir: string | null;
}
