// Local login: one password (scrypt hash in DATA_DIR/auth.json) and sessions in the database.
// The session token is random; only its SHA-256 hash is stored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, ensurePrivateDir } from './db.ts';
import type { Queryable } from './db.ts';
import type { Session } from './context.ts';
import { AppError } from './errors.ts';

export const SESSION_COOKIE = 'a4m_lm_session';
export const SESSION_HOURS = 12;
export const MIN_PASSWORD_LENGTH = 8;

/** Methods reachable without a session. Everything else needs one, also future auth.* methods. */
export const PUBLIC_METHODS: ReadonlySet<string> = new Set(['auth.status', 'auth.setPassword', 'auth.login', 'auth.logout']);

// scrypt cost for new hashes (OWASP: N = 2^17, r = 8, p = 1). The parameters are stored with the
// hash, so an older file keeps verifying and is rewritten after the next successful login.
const SCRYPT = { N: 131072, r: 8, p: 1, keylen: 64 };

interface AuthFile {
	version: 1;
	algorithm: 'scrypt';
	N: number;
	r: number;
	p: number;
	salt: string;
	hash: string;
	createdAt: string;
}

function authFilePath(): string {
	return path.join(dataDir(), 'auth.json');
}

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number }, keylen: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		crypto.scrypt(
			password.normalize('NFKC'),
			salt,
			keylen,
			{ N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r },
			(err: Error | null, key: Buffer) => (err ? reject(err) : resolve(key))
		);
	});
}

function authFileBroken(): AppError {
	return new AppError(
		'auth_file_unreadable',
		'Soubor s otiskem hesla (auth.json) nejde přečíst nebo je poškozený. Aplikace zůstává zamčená. Postup je v docs/02-lokalni-beh.md.',
		503
	);
}

/**
 * Returns null only when the file does not exist (no password yet). A file that cannot be read
 * or parsed throws: it must never re-open the first-run setup to whoever reaches the port.
 */
function readAuthFile(): AuthFile | null {
	let text: string;
	try {
		text = fs.readFileSync(authFilePath(), 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw authFileBroken();
	}
	let file: AuthFile;
	try {
		file = JSON.parse(text) as AuthFile;
	} catch {
		throw authFileBroken();
	}
	const ok =
		file !== null &&
		typeof file === 'object' &&
		file.algorithm === 'scrypt' &&
		Number.isInteger(file.N) &&
		Number.isInteger(file.r) &&
		Number.isInteger(file.p) &&
		typeof file.salt === 'string' &&
		typeof file.hash === 'string' &&
		file.hash.length > 0;
	if (!ok) throw authFileBroken();
	return file;
}

export function isPasswordSet(): boolean {
	return readAuthFile() !== null;
}

export function validateNewPassword(password: unknown): string {
	if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
		throw new AppError('password_too_short', `Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků.`);
	}
	if (password.length > 200) throw new AppError('password_too_long', 'Heslo je příliš dlouhé.');
	return password;
}

/**
 * Stores the hash of the password. With exclusive (first run) the file is created only when it
 * does not exist yet: of two concurrent requests one wins, the other gets password_already_set.
 */
export async function writePassword(password: string, options: { exclusive?: boolean } = {}): Promise<void> {
	const salt = crypto.randomBytes(16);
	const hash = await scrypt(password, salt, SCRYPT, SCRYPT.keylen);
	const file: AuthFile = {
		version: 1,
		algorithm: 'scrypt',
		N: SCRYPT.N,
		r: SCRYPT.r,
		p: SCRYPT.p,
		salt: salt.toString('base64'),
		hash: hash.toString('base64'),
		createdAt: new Date().toISOString()
	};
	ensurePrivateDir(dataDir());
	const target = authFilePath();
	const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(file, null, '\t'), { mode: 0o600 });
	try {
		if (options.exclusive) {
			try {
				// link() fails when the target exists; the complete file appears in one step.
				fs.linkSync(tmp, target);
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
					throw new AppError('password_already_set', 'Heslo už je nastavené. Přihlaste se.', 409);
				}
				throw e;
			}
		} else {
			fs.renameSync(tmp, target);
		}
	} finally {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// renamed away
		}
	}
}

/** True when the stored hash was made with weaker parameters than new hashes get. */
export function passwordNeedsRehash(): boolean {
	const file = readAuthFile();
	return file !== null && (file.N < SCRYPT.N || file.r < SCRYPT.r || file.p < SCRYPT.p);
}

export async function verifyPassword(password: unknown): Promise<boolean> {
	const file = readAuthFile();
	if (!file || typeof password !== 'string') return false;
	const expected = Buffer.from(file.hash, 'base64');
	const actual = await scrypt(password, Buffer.from(file.salt, 'base64'), file, expected.length);
	return crypto.timingSafeEqual(expected, actual);
}

// ---------- throttle of failed logins (in memory, per process) ----------
const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const throttle = { failures: 0, lockedUntil: 0 };

/** Throws when logins are temporarily locked after repeated failures. */
export function assertLoginAllowed(now: Date): void {
	const wait = throttle.lockedUntil - now.getTime();
	if (wait > 0) {
		throw new AppError(
			'login_throttled',
			`Příliš mnoho neúspěšných pokusů. Zkuste to znovu za ${Math.ceil(wait / 1000)} s.`,
			429
		);
	}
}

export function recordLoginFailure(now: Date): void {
	throttle.failures += 1;
	if (throttle.failures >= FREE_ATTEMPTS) {
		const lock = Math.min(BASE_LOCK_MS * 2 ** (throttle.failures - FREE_ATTEMPTS), MAX_LOCK_MS);
		throttle.lockedUntil = now.getTime() + lock;
	}
}

export function recordLoginSuccess(): void {
	throttle.failures = 0;
	throttle.lockedUntil = 0;
}

// One password check at a time: every attempt sees the result of the one before it, so parallel
// requests cannot outrun the lock that follows FREE_ATTEMPTS failures.
const MAX_QUEUED_CHECKS = 3;
let checkQueue: Promise<unknown> = Promise.resolve();
let queuedChecks = 0;

/**
 * Verifies the password under the login throttle (used for login and for the current password
 * of a password change). Throws login_throttled (429) while locked or when too many checks wait.
 */
export async function checkPassword(password: unknown, now: () => Date): Promise<boolean> {
	if (queuedChecks >= MAX_QUEUED_CHECKS) {
		throw new AppError('login_throttled', 'Příliš mnoho pokusů najednou. Zkuste to znovu za chvíli.', 429);
	}
	queuedChecks += 1;
	const run = checkQueue.then(async () => {
		assertLoginAllowed(now());
		const ok = await verifyPassword(password);
		if (ok) recordLoginSuccess();
		else recordLoginFailure(now());
		return ok;
	});
	checkQueue = run.catch(() => undefined);
	try {
		return await run;
	} finally {
		queuedChecks -= 1;
	}
}

// ---------- sessions ----------
function hashToken(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
	db: Queryable,
	now: Date,
	meta: { ip: string | null; userAgent: string | null }
): Promise<{ token: string; expiresAt: Date }> {
	const token = crypto.randomBytes(32).toString('base64url');
	const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
	await db.run(
		'insert into sessions (token_hash, created_at, expires_at, last_seen_at, ip, user_agent) values ($1, $2, $3, $2, $4, $5)',
		[hashToken(token), now, expiresAt, meta.ip, meta.userAgent?.slice(0, 300) ?? null]
	);
	// Housekeeping: drop sessions that expired more than a day ago.
	await db.run("delete from sessions where expires_at < $1::timestamptz - interval '1 day'", [now]);
	return { token, expiresAt };
}

export async function readSession(db: Queryable, token: string | undefined, now: Date): Promise<Session | null> {
	if (!token) return null;
	const row = await db.one<{ id: number; created_at: Date; expires_at: Date; last_seen_at: Date | null }>(
		'select id, created_at, expires_at, last_seen_at from sessions where token_hash = $1 and revoked_at is null and expires_at > $2',
		[hashToken(token), now]
	);
	if (!row) return null;
	if (!row.last_seen_at || now.getTime() - row.last_seen_at.getTime() > 60_000) {
		await db.run('update sessions set last_seen_at = $2 where id = $1', [row.id, now]);
	}
	return { id: Number(row.id), createdAt: row.created_at, expiresAt: row.expires_at };
}

export async function revokeSession(db: Queryable, sessionId: number, now: Date): Promise<void> {
	await db.run('update sessions set revoked_at = $2 where id = $1 and revoked_at is null', [sessionId, now]);
}

export async function revokeAllSessions(db: Queryable, now: Date): Promise<void> {
	await db.run('update sessions set revoked_at = $1 where revoked_at is null', [now]);
}
