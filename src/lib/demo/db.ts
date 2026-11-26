// Database of the demo build: PGlite in the visitor's browser, kept in IndexedDB, only fictional
// data. Mirrors openDb() in src/lib/server/db.ts without its Node parts (data folder, lock file):
// the same migrations from supabase/migrations, applied once each in filename order, the same
// extensions and the same query helpers.
import { PGlite, types } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import type { Db, Queryable, Row } from '../server/db.ts';

const NAME = 'a4m-lm-demo';
/** Where PGlite keeps the demo database: IndexedDB of this site in this browser. */
export const DEMO_DATA_DIR = `idb://${NAME}`;
/** The IndexedDB database PGlite creates for DEMO_DATA_DIR. */
const IDB_DATABASE = `/pglite/${NAME}`;

/** supabase/migrations/*.sql, bundled into the demo at build time. */
const MIGRATIONS = import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true });

interface RawExecutor {
	query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
	exec(sql: string): Promise<unknown>;
}

let savepointSeq = 0;

function wrap(
	raw: RawExecutor,
	begin: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
	inTransaction = false
): Queryable {
	return {
		inTransaction,
		async query<T = Row>(sql: string, params: unknown[] = []) {
			return (await raw.query(sql, params)).rows as T[];
		},
		async one<T = Row>(sql: string, params: unknown[] = []) {
			const rows = (await raw.query(sql, params)).rows as T[];
			return rows.length ? rows[0] : null;
		},
		async run(sql: string, params: unknown[] = []) {
			return (await raw.query(sql, params)).affectedRows ?? 0;
		},
		async exec(sql: string) {
			await raw.exec(sql);
		},
		transaction: begin
	};
}

function wrapTx(raw: RawExecutor): Queryable {
	const self: Queryable = wrap(
		raw,
		async (fn) => {
			const name = `sp_${++savepointSeq}`;
			await raw.exec(`savepoint ${name}`);
			try {
				const result = await fn(self);
				await raw.exec(`release savepoint ${name}`);
				return result;
			} catch (e) {
				await raw.exec(`rollback to savepoint ${name}`);
				throw e;
			}
		},
		true
	);
	return self;
}

/** File names of the bundled migrations in the order they are applied. */
export function migrationNames(): string[] {
	return Object.keys(MIGRATIONS)
		.map((file) => file.slice(file.lastIndexOf('/') + 1))
		.sort();
}

async function migrate(db: Queryable): Promise<void> {
	await db.exec(
		`create table if not exists schema_migrations (
			filename text primary key,
			applied_at timestamptz not null default now()
		)`
	);
	const done = new Set((await db.query<{ filename: string }>('select filename from schema_migrations')).map((r) => r.filename));
	for (const file of migrationNames()) {
		if (done.has(file)) continue;
		const sql = MIGRATIONS[`/supabase/migrations/${file}`];
		try {
			await db.transaction(async (tx) => {
				await tx.exec(sql);
				await tx.run('insert into schema_migrations (filename) values ($1)', [file]);
			});
		} catch (e) {
			throw new Error(`Migration ${file} failed: ${(e as Error).message}`, { cause: e });
		}
	}
}

/** Opens the demo database (tests pass 'memory://') and applies pending migrations. */
export async function openDemoDb(dataDir: string = DEMO_DATA_DIR): Promise<Db> {
	const pg = await PGlite.create({
		dataDir,
		extensions: { pg_trgm, unaccent },
		// date columns stay 'YYYY-MM-DD' strings (no time zone shifts); timestamptz becomes Date.
		parsers: { [types.DATE]: (value: string) => value }
	});
	const base = wrap(pg as unknown as RawExecutor, async (fn) => {
		try {
			return await pg.transaction((tx) => fn(wrapTx(tx as unknown as RawExecutor)));
		} finally {
			// PGlite writes its files to IndexedDB after every query, but not after a COMMIT: without
			// this, a change made in a transaction would be lost when the tab is closed or reloaded.
			await pg.syncToFs();
		}
	});
	try {
		await migrate(base);
	} catch (e) {
		await pg.close().catch(() => undefined);
		throw e;
	}
	return {
		...base,
		dataDir,
		close: () => pg.close()
	};
}

/** Deletes the visitor's demo database. The database must be closed first. */
export function deleteDemoDb(): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.deleteDatabase(IDB_DATABASE);
		let stuck: ReturnType<typeof setTimeout> | undefined;
		request.onsuccess = () => {
			clearTimeout(stuck);
			resolve();
		};
		request.onerror = () => {
			clearTimeout(stuck);
			reject(request.error ?? new Error('Deleting the demo database failed'));
		};
		// Still open somewhere: wait a while for it to close, then give up with a message.
		request.onblocked = () => {
			stuck ??= setTimeout(
				() => reject(new Error('Ukázková data teď nejde smazat. Zavřete ostatní záložky s ukázkou a zkuste to znovu.')),
				10_000
			);
		};
	});
}
