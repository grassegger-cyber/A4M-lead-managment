// Local login: password file, sessions and the throttle, through the real auth.* methods.
// In-memory database and a temporary DATA_DIR; never touches ./data.nosync.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.ts';
import type { Db } from './db.ts';
import { LOCAL_ACTOR, systemCtx } from './context.ts';
import type { CookieJar, Ctx, Session } from './context.ts';
import { SESSION_COOKIE, SESSION_HOURS, isPasswordSet, readSession, recordLoginSuccess } from './auth.ts';
import { methods } from './methods/auth.ts';

// Throwaway values for this test only.
const PASSWORD_A = `test-A-${crypto.randomBytes(6).toString('hex')}`;
const PASSWORD_B = `test-B-${crypto.randomBytes(6).toString('hex')}`;
const WRONG = `wrong-${crypto.randomBytes(6).toString('hex')}`;

let dataDir: string;
let previousDataDir: string | undefined;
let db: Db;
let clock = new Date('2026-11-20T08:00:00Z');
const authFile = () => path.join(dataDir, 'auth.json');

function jar(): CookieJar & { value(): string | undefined } {
	const store = new Map<string, string>();
	return {
		get: (name) => store.get(name),
		set: (name, value) => void store.set(name, value),
		delete: (name) => void store.delete(name),
		value: () => store.get(SESSION_COOKIE)
	};
}

function ctxOf(cookies: CookieJar, session: Session | null = null): Ctx {
	return systemCtx(db, { now: () => clock, actor: LOCAL_ACTOR, cookies, session, ip: '127.0.0.1', userAgent: 'vitest' });
}

const call = (name: string, args: unknown, ctx: Ctx) => methods[name](ctx, args) as Promise<any>;
const sessionOf = (token: string | undefined) => readSession(db, token, clock);
const auditCount = async (action: string) =>
	(await db.one<{ n: number }>('select count(*)::int as n from audit_log where action = $1', [action]))!.n;
const outcome = (results: PromiseSettledResult<unknown>[]) => {
	const codes: Record<string, number> = {};
	for (const r of results) {
		const key = r.status === 'fulfilled' ? 'ok' : ((r.reason as { code?: string }).code ?? 'error');
		codes[key] = (codes[key] ?? 0) + 1;
	}
	return codes;
};

beforeAll(async () => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a4m-lm-authtest-'));
	previousDataDir = process.env.DATA_DIR;
	process.env.DATA_DIR = dataDir;
	db = await openDb({ dir: 'memory' });
});

afterAll(async () => {
	await db.close();
	if (previousDataDir === undefined) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = previousDataDir;
	fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('first run', () => {
	it('sets the password once, logs in and refuses a replay', async () => {
		expect(await call('auth.status', {}, ctxOf(jar()))).toEqual({ passwordSet: false, authenticated: false });
		await expect(call('auth.setPassword', { password: 'short' }, ctxOf(jar()))).rejects.toMatchObject({ code: 'password_too_short' });
		await expect(call('auth.login', { password: PASSWORD_A }, ctxOf(jar()))).rejects.toMatchObject({ code: 'password_not_set' });

		const cookies = jar();
		const result = await call('auth.setPassword', { password: PASSWORD_A }, ctxOf(cookies));
		expect(result).toMatchObject({ passwordSet: true, authenticated: true });
		expect(await sessionOf(cookies.value())).not.toBeNull();
		expect(fs.statSync(authFile()).mode & 0o777).toBe(0o600);
		expect(fs.statSync(dataDir).mode & 0o777).toBe(0o700);
		// Only the hash is stored, with the current cost parameters.
		const stored = JSON.parse(fs.readFileSync(authFile(), 'utf8'));
		expect(stored).toMatchObject({ algorithm: 'scrypt', N: 131072, r: 8, p: 1 });
		expect(fs.readFileSync(authFile(), 'utf8')).not.toContain(PASSWORD_A);
		expect(fs.readdirSync(dataDir)).toEqual(['auth.json']);

		await expect(call('auth.setPassword', { password: PASSWORD_B }, ctxOf(jar()))).rejects.toMatchObject({
			code: 'password_already_set',
			status: 409
		});
		expect(await auditCount('auth.password_set')).toBe(1);
	});

	it('lets only one of two concurrent first-run requests win', async () => {
		fs.rmSync(authFile());
		const [a, b] = [jar(), jar()];
		const results = await Promise.allSettled([
			call('auth.setPassword', { password: PASSWORD_A }, ctxOf(a)),
			call('auth.setPassword', { password: PASSWORD_B }, ctxOf(b))
		]);
		expect(outcome(results)).toEqual({ ok: 1, password_already_set: 1 });
		const winner = results[0].status === 'fulfilled' ? PASSWORD_A : PASSWORD_B;
		const loser = winner === PASSWORD_A ? PASSWORD_B : PASSWORD_A;
		// The loser got no session and its password does not work.
		expect(await sessionOf((results[0].status === 'fulfilled' ? b : a).value())).toBeNull();
		await expect(call('auth.login', { password: loser }, ctxOf(jar()))).rejects.toMatchObject({ code: 'login_failed' });
		expect(await call('auth.login', { password: winner }, ctxOf(jar()))).toMatchObject({ authenticated: true });
		expect(fs.readdirSync(dataDir)).toEqual(['auth.json']);
	});

	it('ends earlier sessions when the password is set again after a reset', async () => {
		const before = jar();
		fs.rmSync(authFile());
		await call('auth.setPassword', { password: PASSWORD_A }, ctxOf(before));
		expect(await sessionOf(before.value())).not.toBeNull();
		// The documented reset: delete auth.json, set a new password.
		fs.rmSync(authFile());
		const after = jar();
		await call('auth.setPassword', { password: PASSWORD_A }, ctxOf(after));
		expect(await sessionOf(before.value())).toBeNull();
		expect(await sessionOf(after.value())).not.toBeNull();
	});
});

describe('login and sessions', () => {
	it('logs in, expires and logs out', async () => {
		recordLoginSuccess();
		const cookies = jar();
		await call('auth.login', { password: PASSWORD_A }, ctxOf(cookies));
		const token = cookies.value();
		const session = await sessionOf(token);
		expect(session).not.toBeNull();
		expect(await readSession(db, 'not-a-token', clock)).toBeNull();
		// Past the lifetime the same token is no longer a session.
		expect(await readSession(db, token, new Date(clock.getTime() + (SESSION_HOURS * 3600 + 1) * 1000))).toBeNull();
		expect(await call('auth.status', {}, ctxOf(cookies, session))).toEqual({ passwordSet: true, authenticated: true });
		await call('auth.logout', {}, ctxOf(cookies, session));
		expect(cookies.value()).toBeUndefined();
		expect(await sessionOf(token)).toBeNull();
	});

	it('locks after five failures, also for the right password, and opens again after the wait', async () => {
		recordLoginSuccess();
		const failedBefore = await auditCount('auth.login_failed');
		for (let i = 0; i < 5; i++) {
			await expect(call('auth.login', { password: WRONG }, ctxOf(jar()))).rejects.toMatchObject({ code: 'login_failed', status: 401 });
		}
		await expect(call('auth.login', { password: PASSWORD_A }, ctxOf(jar()))).rejects.toMatchObject({ code: 'login_throttled', status: 429 });
		expect(await auditCount('auth.login_failed')).toBe(failedBefore + 5);
		clock = new Date(clock.getTime() + 31_000);
		expect(await call('auth.login', { password: PASSWORD_A }, ctxOf(jar()))).toMatchObject({ authenticated: true });
	});

	it('does not let parallel attempts outrun the lock', async () => {
		recordLoginSuccess();
		const failedBefore = await auditCount('auth.login_failed');
		const burst = () =>
			Promise.allSettled(Array.from({ length: 40 }, () => call('auth.login', { password: WRONG }, ctxOf(jar()))));
		// Only a few checks may wait at a time; everything else is turned away at once.
		expect(outcome(await burst())).toEqual({ login_failed: 3, login_throttled: 37 });
		// The second burst reaches the fifth failure and the lock: the right password at its end is refused too.
		const second = await Promise.allSettled([
			...Array.from({ length: 2 }, () => call('auth.login', { password: WRONG }, ctxOf(jar()))),
			call('auth.login', { password: PASSWORD_A }, ctxOf(jar()))
		]);
		expect(outcome(second)).toEqual({ login_failed: 2, login_throttled: 1 });
		expect(await auditCount('auth.login_failed')).toBe(failedBefore + 5);
		clock = new Date(clock.getTime() + 16 * 60_000);
	});
});

describe('password change', () => {
	it('needs a session and the current password, audits a failure and ends other sessions', async () => {
		recordLoginSuccess();
		const [mine, other] = [jar(), jar()];
		await call('auth.login', { password: PASSWORD_A }, ctxOf(mine));
		await call('auth.login', { password: PASSWORD_A }, ctxOf(other));
		const session = await sessionOf(mine.value());
		await expect(call('auth.changePassword', { currentPassword: PASSWORD_A, newPassword: PASSWORD_B }, ctxOf(jar()))).rejects.toMatchObject({
			code: 'unauthenticated'
		});
		const failedBefore = await auditCount('auth.password_change_failed');
		await expect(
			call('auth.changePassword', { currentPassword: WRONG, newPassword: PASSWORD_B }, ctxOf(mine, session))
		).rejects.toMatchObject({ code: 'login_failed' });
		expect(await auditCount('auth.password_change_failed')).toBe(failedBefore + 1);

		const oldToken = mine.value();
		expect(await call('auth.changePassword', { currentPassword: PASSWORD_A, newPassword: PASSWORD_B }, ctxOf(mine, session))).toEqual({
			changed: true
		});
		expect(await sessionOf(oldToken)).toBeNull();
		expect(await sessionOf(other.value())).toBeNull();
		expect(await sessionOf(mine.value())).not.toBeNull();
		await expect(call('auth.login', { password: PASSWORD_A }, ctxOf(jar()))).rejects.toMatchObject({ code: 'login_failed' });
		expect(await call('auth.login', { password: PASSWORD_B }, ctxOf(jar()))).toMatchObject({ authenticated: true });
	});
});

describe('password file', () => {
	it('keeps the application locked when the file is damaged or unreadable', async () => {
		const good = fs.readFileSync(authFile(), 'utf8');
		try {
			for (const broken of ['', '{"version":1', '{"algorithm":"scrypt"}', 'null']) {
				fs.writeFileSync(authFile(), broken);
				expect(() => isPasswordSet(), JSON.stringify(broken)).toThrowError(expect.objectContaining({ code: 'auth_file_unreadable', status: 503 }));
				// The first-run setup must not open again, and no password logs in.
				await expect(call('auth.setPassword', { password: PASSWORD_A }, ctxOf(jar()))).rejects.toMatchObject({ status: 503 });
				await expect(call('auth.login', { password: PASSWORD_B }, ctxOf(jar()))).rejects.toMatchObject({ status: 503 });
			}
			if (process.getuid?.() !== 0) {
				fs.writeFileSync(authFile(), good);
				fs.chmodSync(authFile(), 0o000);
				expect(() => isPasswordSet()).toThrowError(expect.objectContaining({ code: 'auth_file_unreadable' }));
			}
		} finally {
			fs.chmodSync(authFile(), 0o600);
			fs.writeFileSync(authFile(), good);
		}
		expect(isPasswordSet()).toBe(true);
	});

	it('replaces a hash made with weaker parameters after the next successful login', async () => {
		recordLoginSuccess();
		const salt = crypto.randomBytes(16);
		const weak = { N: 16384, r: 8, p: 1 };
		const hash = crypto.scryptSync(PASSWORD_B.normalize('NFKC'), salt, 64, { ...weak, maxmem: 256 * weak.N * weak.r });
		fs.writeFileSync(
			authFile(),
			JSON.stringify({ version: 1, algorithm: 'scrypt', ...weak, salt: salt.toString('base64'), hash: hash.toString('base64'), createdAt: clock.toISOString() }),
			{ mode: 0o600 }
		);
		await expect(call('auth.login', { password: WRONG }, ctxOf(jar()))).rejects.toMatchObject({ code: 'login_failed' });
		expect(JSON.parse(fs.readFileSync(authFile(), 'utf8')).N).toBe(16384);
		expect(await call('auth.login', { password: PASSWORD_B }, ctxOf(jar()))).toMatchObject({ authenticated: true });
		expect(JSON.parse(fs.readFileSync(authFile(), 'utf8')).N).toBe(131072);
		expect(await call('auth.login', { password: PASSWORD_B }, ctxOf(jar()))).toMatchObject({ authenticated: true });
	});
});
