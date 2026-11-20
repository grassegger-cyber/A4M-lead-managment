// The lock that keeps a data folder to one process, and the owner-only folder permissions.
// Works in temporary folders only; never touches ./data.nosync.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DatabaseLockedError, openDb } from './db.ts';

const run = promisify(execFile);
let root: string;

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'a4m-lm-dbtest-'));
});

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

const lockOf = (dir: string) => `${dir}.lock`;
const readPid = (dir: string) => JSON.parse(fs.readFileSync(lockOf(dir), 'utf8')).pid as number;

describe('data folder lock', () => {
	it('is held while the database is open and removed on close', async () => {
		const dir = path.join(root, 'one', 'pglite');
		const db = await openDb({ dir });
		expect(readPid(dir)).toBe(process.pid);
		expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
		expect(fs.statSync(lockOf(dir)).mode & 0o777).toBe(0o600);
		// The same folder cannot be opened a second time, not even by this process.
		await expect(openDb({ dir })).rejects.toBeInstanceOf(DatabaseLockedError);
		await db.run('create table lock_probe (id integer primary key)');
		await db.close();
		expect(fs.existsSync(lockOf(dir))).toBe(false);
		// After a clean close the folder opens again and the data are there.
		const again = await openDb({ dir });
		expect(await again.query('select * from lock_probe')).toEqual([]);
		await again.close();
	});

	it('refuses a folder another running process holds and says which one', async () => {
		const dir = path.join(root, 'two', 'pglite');
		fs.mkdirSync(path.dirname(dir), { recursive: true });
		// The parent of the test worker is certainly alive and is not this process.
		fs.writeFileSync(lockOf(dir), JSON.stringify({ pid: process.ppid }));
		const error = await openDb({ dir }).catch((e) => e);
		expect(error).toBeInstanceOf(DatabaseLockedError);
		expect(error.message).toContain(`PID ${process.ppid}`);
		expect(error.message).toContain(lockOf(dir));
		// Nothing was opened or taken over.
		expect(readPid(dir)).toBe(process.ppid);
		expect(fs.existsSync(path.join(dir, 'PG_VERSION'))).toBe(false);
	});

	it('takes over a lock left by a process that no longer runs', async () => {
		const dir = path.join(root, 'three', 'pglite');
		fs.mkdirSync(path.dirname(dir), { recursive: true });
		const { stdout } = await run(process.execPath, ['-e', 'console.log(process.pid)']);
		const deadPid = Number(stdout.trim());
		expect(deadPid).toBeGreaterThan(0);
		fs.writeFileSync(lockOf(dir), JSON.stringify({ pid: deadPid }));
		const db = await openDb({ dir });
		expect(readPid(dir)).toBe(process.pid);
		await db.close();
		// An unreadable lock file is stale as well.
		fs.writeFileSync(lockOf(dir), 'not json');
		const again = await openDb({ dir });
		expect(readPid(dir)).toBe(process.pid);
		await again.close();
	});

	it('stops a second process (like npm run seed) while this one has the database open', async () => {
		const dir = path.join(root, 'four', 'pglite');
		const db = await openDb({ dir });
		await db.run('create table lock_probe (id integer primary key)');
		await db.run('insert into lock_probe values (1)');
		const script = `
			import { openDb } from './src/lib/server/db.ts';
			try {
				const db = await openDb({ dir: process.argv[1] });
				await db.run('insert into lock_probe values (2)');
				await db.close();
				console.log('OPENED');
			} catch (e) {
				console.log(e.code === 'database_locked' ? 'LOCKED' : 'ERROR ' + e.message);
			}`;
		const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script, dir], { cwd: process.cwd() });
		expect(stdout.trim()).toBe('LOCKED');
		await db.run('insert into lock_probe values (3)');
		expect((await db.query<{ id: number }>('select id from lock_probe order by id')).map((r) => r.id)).toEqual([1, 3]);
		await db.close();
	});

	it('is not used for an in-memory database', async () => {
		const db = await openDb({ dir: 'memory' });
		expect(db.dataDir).toBeNull();
		expect(db.inTransaction).toBe(false);
		await db.transaction(async (tx) => {
			expect(tx.inTransaction).toBe(true);
		});
		await db.close();
	});
});
