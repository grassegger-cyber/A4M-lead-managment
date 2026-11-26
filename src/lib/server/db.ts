// Database layer: PGlite (Postgres in-process) stored in DATA_DIR/pglite.
// Migrations are the plain SQL files in supabase/migrations, applied once each in filename order.
// This file must stay importable by plain Node (scripts/seed.ts): relative imports only.
import { PGlite, types } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Db, Queryable, Row } from './db-types.ts';
export type { Db, Queryable, Row } from './db-types.ts';

interface RawExecutor {
	query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
	exec(sql: string): Promise<unknown>;
}

/** Folder for all local data (database, auth.json). Never inside git: *.nosync is ignored. */
export function dataDir(): string {
	return path.resolve(process.env.DATA_DIR || './data.nosync');
}

export function migrationsDir(): string {
	return path.resolve(process.env.MIGRATIONS_DIR || './supabase/migrations');
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

async function migrate(db: Queryable, dir: string): Promise<string[]> {
	await db.exec(
		`create table if not exists schema_migrations (
			filename text primary key,
			applied_at timestamptz not null default now()
		)`
	);
	const done = new Set((await db.query<{ filename: string }>('select filename from schema_migrations')).map((r) => r.filename));
	const files = fs.existsSync(dir)
		? fs.readdirSync(dir).filter((f: string) => f.endsWith('.sql')).sort()
		: [];
	const applied: string[] = [];
	for (const file of files) {
		if (done.has(file)) continue;
		const sql = fs.readFileSync(path.join(dir, file), 'utf8');
		try {
			await db.transaction(async (tx) => {
				await tx.exec(sql);
				await tx.run('insert into schema_migrations (filename) values ($1)', [file]);
			});
		} catch (e) {
			throw new Error(`Migration ${file} failed: ${(e as Error).message}`, { cause: e });
		}
		applied.push(file);
	}
	return applied;
}

export interface OpenOptions {
	/** Folder for the PGlite files. Use 'memory' for an in-memory database (tests). */
	dir?: string;
	migrations?: string;
}

/** Creates a folder that only the owner of the process can enter (personal data live below it). */
export function ensurePrivateDir(dir: string): void {
	const target = path.resolve(dir);
	fs.mkdirSync(target, { recursive: true, mode: 0o700 });
	// Never narrow a folder that is plainly not ours alone (DATA_DIR set to the home folder or the root).
	if (target === path.resolve(os.homedir()) || target === path.parse(target).root) return;
	try {
		fs.chmodSync(target, 0o700);
	} catch {
		// A folder owned by someone else cannot be tightened from here; opening it fails on its own.
	}
}

// ---------- one process per data folder ----------
// PGlite takes no lock of its own. Two processes on one folder each keep their own in-memory
// state and silently overwrite each other's rows, so the folder is guarded by a lock file
// (<folder>.lock) holding the pid of the process that has it open.

/** Thrown when another running process has the data folder open. The message is Czech, for the owner. */
export class DatabaseLockedError extends Error {
	code = 'database_locked';
	constructor(dir: string, lockPath: string, pid: number) {
		super(
			`Databázi ve složce ${dir} už používá jiný běžící proces (PID ${pid}). ` +
				'Nejdřív ho zastavte: před příkazem npm run seed zastavte aplikaci, aplikaci nespouštějte dvakrát. ' +
				`Pokud žádný takový proces neběží, smažte soubor ${lockPath}.`
		);
		this.name = 'DatabaseLockedError';
	}
}

const locksKey = Symbol.for('a4m.lead-management.db-locks');
type GlobalWithLocks = typeof globalThis & { [locksKey]?: Set<string> };

/** Lock files held by this process. On globalThis so a hot reload of this module keeps them. */
function heldLocks(): Set<string> {
	const g = globalThis as GlobalWithLocks;
	if (!g[locksKey]) {
		const held = new Set<string>();
		g[locksKey] = held;
		// A process that ends without close() must not leave its lock behind.
		process.on('exit', () => {
			for (const lockPath of held) removeLockFile(lockPath);
		});
	}
	return g[locksKey]!;
}

function removeLockFile(lockPath: string): void {
	try {
		fs.unlinkSync(lockPath);
	} catch {
		// already gone
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM: the process exists but belongs to someone else.
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function readLockPid(lockPath: string): number | null {
	try {
		const pid = Number(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid);
		return Number.isInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Takes the lock of a data folder or throws DatabaseLockedError. Returns the path of the lock file. */
function acquireLock(dir: string): string {
	const lockPath = `${dir}.lock`;
	const held = heldLocks();
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			// 'wx' creates the file only when it does not exist, so of two starting processes one wins.
			fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }), {
				flag: 'wx',
				mode: 0o600
			});
			held.add(lockPath);
			return lockPath;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
		}
		let owner = readLockPid(lockPath);
		if (owner === null) {
			// Another process may be between creating the file and writing its pid: look once more.
			sleepSync(150);
			owner = readLockPid(lockPath);
		}
		const ownedHere = owner === process.pid && held.has(lockPath);
		if (ownedHere || (owner !== null && owner !== process.pid && isProcessAlive(owner))) {
			throw new DatabaseLockedError(dir, lockPath, owner as number);
		}
		// Stale: the owner is gone (or an earlier process had the pid this one has now).
		removeLockFile(lockPath);
	}
	throw new Error(`Could not take the database lock ${lockPath}`);
}

function releaseLock(lockPath: string): void {
	const held = heldLocks();
	if (!held.has(lockPath)) return;
	held.delete(lockPath);
	removeLockFile(lockPath);
}

async function openTestPostgres(adminUrl: string, migrations: string): Promise<Db> {
	const { default: postgres } = await import('postgres');
	const { openPostgres } = await import('./db-postgres.ts');
	const name = `lm_test_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
	const admin = openPostgres(postgres as never, adminUrl, { max: 1 });
	await admin.exec(`create database ${name}`);
	const url = new URL(adminUrl);
	url.pathname = `/${name}`;
	const db = openPostgres(postgres as never, url.toString(), { max: 1 });
	try {
		await migrate(db, migrations);
	} catch (e) {
		await db.close();
		await admin.close();
		throw e;
	}
	return {
		...db,
		async close() {
			await db.close();
			await admin.exec(`drop database if exists ${name} with (force)`);
			await admin.close();
		}
	};
}

/** Opens a database and applies pending migrations. Prefer getDb() in app code. */
export async function openDb(options: OpenOptions = {}): Promise<Db> {
	const inMemory = options.dir === 'memory';
	// Tests can run against a real Postgres (the engine of the cloud) instead of PGlite:
	// TEST_PG_URL=postgres://… npm test. Every call gets a database of its own.
	if (inMemory && process.env.TEST_PG_URL) return openTestPostgres(process.env.TEST_PG_URL, options.migrations ?? migrationsDir());
	const dir = inMemory ? null : path.resolve(options.dir ?? path.join(dataDir(), 'pglite'));
	let lockPath: string | null = null;
	if (dir) {
		// The default location sits in the data root, which also holds auth.json: owner only.
		if (options.dir === undefined) ensurePrivateDir(dataDir());
		ensurePrivateDir(dir);
		lockPath = acquireLock(dir);
	}
	try {
		const pg = await PGlite.create({
			dataDir: dir ?? undefined,
			extensions: { pg_trgm, unaccent },
			// date columns stay 'YYYY-MM-DD' strings (no time zone shifts); timestamptz becomes Date.
			parsers: { [types.DATE]: (value: string) => value }
		});
		const base = wrap(pg as unknown as RawExecutor, (fn) =>
			pg.transaction((tx) => fn(wrapTx(tx as unknown as RawExecutor)))
		) as Queryable;
		try {
			await migrate(base, options.migrations ?? migrationsDir());
		} catch (e) {
			await pg.close().catch(() => undefined);
			throw e;
		}
		const held = lockPath;
		return {
			...base,
			dataDir: dir,
			async close() {
				try {
					await pg.close();
				} finally {
					if (held) releaseLock(held);
				}
			}
		};
	} catch (e) {
		if (lockPath) releaseLock(lockPath);
		throw e;
	}
}

// One connection per process. Kept on globalThis so Vite hot reload does not open
// the same data folder twice (PGlite allows a single connection per folder; other processes
// are kept out by the lock file above).
const globalKey = Symbol.for('a4m.lead-management.db');
type GlobalWithDb = typeof globalThis & { [globalKey]?: Promise<Db> };

export function getDb(): Promise<Db> {
	const g = globalThis as GlobalWithDb;
	if (!g[globalKey]) {
		g[globalKey] = openDb().catch((e) => {
			delete g[globalKey];
			throw e;
		});
	}
	return g[globalKey]!;
}

/** Closes the shared connection (used by scripts before exit). */
export async function closeDb(): Promise<void> {
	const g = globalThis as GlobalWithDb;
	const pending = g[globalKey];
	if (!pending) return;
	delete g[globalKey];
	await (await pending).close();
}
