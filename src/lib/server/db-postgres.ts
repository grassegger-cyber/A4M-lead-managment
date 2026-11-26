// Database layer for the cloud: a real Postgres (Supabase) reached with the "postgres" library.
// The library itself is handed in by the caller (Deno entry of the api function, or a test), so
// this file has no import that a bundler would have to resolve.
import type { Db, Queryable, Row } from './db-types.ts';

/** The part of the "postgres" library's handle that is used here. */
interface Sql {
	unsafe(query: string, params?: unknown[]): Promise<unknown[] & { count: number }> & { simple(): Promise<unknown> };
	begin<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
	savepoint<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
	end(options?: { timeout?: number }): Promise<void>;
}
export type PostgresFactory = (url: string, options: Record<string, unknown>) => unknown;

const DATE_OID = 1082;
const INT8_OID = 20;
const JSON_OID = 114;
const JSONB_OID = 3802;

/** A string is taken as JSON text already (the code stringifies itself), anything else is stringified. */
const jsonType = (oid: number) => ({
	to: oid,
	from: [oid],
	serialize: (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)),
	parse: (x: string) => JSON.parse(x)
});

function parseInt8(value: string): number | bigint {
	const n = Number(value);
	return Number.isSafeInteger(n) ? n : BigInt(value);
}

function wrap(sql: Sql, inTransaction: boolean): Queryable {
	const self: Queryable = {
		inTransaction,
		async query<T = Row>(text: string, params: unknown[] = []) {
			return [...(await sql.unsafe(text, params))] as T[];
		},
		async one<T = Row>(text: string, params: unknown[] = []) {
			const rows = await sql.unsafe(text, params);
			return rows.length ? (rows[0] as T) : null;
		},
		async run(text: string, params: unknown[] = []) {
			return (await sql.unsafe(text, params)).count ?? 0;
		},
		async exec(text: string) {
			// Simple protocol: several statements separated by semicolons, no parameters.
			await sql.unsafe(text).simple();
		},
		transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
			return inTransaction
				? sql.savepoint((sp) => fn(wrap(sp, true)))
				: sql.begin((tx) => fn(wrap(tx, true)));
		}
	};
	return self;
}

export interface PostgresOptions {
	/** Connections kept open. The api function serves one request at a time per worker. */
	max?: number;
	/** Upper limit of one statement in seconds (set on the session). */
	statementTimeoutSeconds?: number;
}

/** Opens a connection pool. Migrations are not applied here: in the cloud they are run by hand. */
export function openPostgres(postgres: PostgresFactory, url: string, options: PostgresOptions = {}): Db {
	const sql = postgres(url, {
		max: options.max ?? 2,
		idle_timeout: 20,
		connect_timeout: 15,
		// Statements are built at run time and the pooler in front of Supabase does not keep
		// prepared statements between transactions.
		prepare: false,
		onnotice: () => undefined,
		connection: {
			application_name: 'a4m-lead-management',
			statement_timeout: (options.statementTimeoutSeconds ?? 120) * 1000,
			// A request that is cut off (page reload, worker stopped) must not keep rows locked:
			// its open transaction is ended by the database, and a waiting request gives up soon
			// with an error instead of hanging.
			idle_in_transaction_session_timeout: 30_000,
			lock_timeout: 15_000,
			TimeZone: 'UTC'
		},
		types: {
			// date columns stay 'YYYY-MM-DD' strings (no time zone shifts), as in the tests' PGlite.
			date: { to: DATE_OID, from: [DATE_OID], serialize: (x: unknown) => String(x), parse: (x: string) => x },
			// bigint (count(*), identity columns) as a number while it is safe.
			bigint: { to: INT8_OID, from: [INT8_OID], serialize: (x: unknown) => String(x), parse: parseInt8 },
			json: jsonType(JSON_OID),
			jsonb: jsonType(JSONB_OID)
		}
	}) as Sql;
	return {
		...wrap(sql, false),
		dataDir: null,
		async close() {
			await sql.end({ timeout: 5 });
		}
	};
}
