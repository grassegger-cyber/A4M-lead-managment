// Web Worker of the demo build: the application's "server" in the visitor's browser. It opens the
// demo database (PGlite in IndexedDB), fills it with fictional companies on the first visit and runs
// the same API methods as POST /api (src/lib/server/registry.ts), signed in as the demo visitor.
// Nothing leaves the browser.
import { getMethod } from '../server/registry.ts';
import type { Actor, Ctx, Session } from '../server/context.ts';
import type { Db } from '../server/db.ts';
import { seedFictionalCompanies } from '../server/seed-core.ts';
import { deleteDemoDb, openDemoDb } from './db.ts';
import type { FromWorker, Reply, ToWorker } from './protocol.ts';
import { runMethod } from './runtime.ts';

/** How many fictional companies every visitor starts with. */
const DEMO_COMPANIES = 5000;
/** Two tabs must not open the database at once: each would overwrite the other's changes. */
const LOCK_NAME = 'a4m-lm-demo-database';
const LOCK_NOTICE_MS = 1500;

const DEMO_ACTOR: Actor = { id: null, name: 'Návštěvník ukázky' };

interface WorkerScope {
	postMessage(message: FromWorker, transfer?: Transferable[]): void;
	addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void;
	navigator: { userAgent: string; locks?: LockManager };
}
const scope = globalThis as unknown as WorkerScope;

function post(message: FromWorker, transfer: Transferable[] = []): void {
	scope.postMessage(message, transfer);
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/** Waits for the database lock and keeps it for the life of this worker (the tab). */
function holdLock(): Promise<void> {
	const locks = scope.navigator.locks;
	if (!locks) return Promise.resolve();
	return new Promise((acquired, failed) => {
		const notice = setTimeout(() => post({ type: 'phase', phase: 'locked' }), LOCK_NOTICE_MS);
		locks
			.request(LOCK_NAME, () => {
				clearTimeout(notice);
				acquired();
				return new Promise<never>(() => {});
			})
			.catch(failed);
	});
}

/** Opens the database, seeding it when it holds no company yet. fresh = delete it first. */
async function prepare(fresh: boolean, previous?: Promise<Db>): Promise<Db> {
	if (previous) {
		const old = await previous.catch(() => null);
		await old?.close().catch(() => undefined);
	}
	if (fresh) await deleteDemoDb();
	const db = await openDemoDb();
	const { n } = (await db.one<{ n: number }>('select count(*)::int as n from companies'))!;
	let seededMs: number | undefined;
	if (n === 0) {
		post({ type: 'phase', phase: fresh ? 'resetting' : 'seeding' });
		const started = performance.now();
		await seedFictionalCompanies(db, { count: DEMO_COMPANIES });
		seededMs = Math.round(performance.now() - started);
	}
	post({ type: 'phase', phase: 'ready', seededMs });
	return db;
}

function watch(opening: Promise<Db>): Promise<Db> {
	opening.catch((e) => {
		console.error('[demo] the database did not open:', errorText(e));
		post({ type: 'phase', phase: 'failed', detail: errorText(e) });
	});
	return opening;
}

let database: Promise<Db> = watch(holdLock().then(() => prepare(false)));
/** Calls still running; a reset lets them finish before it closes the database. */
const running = new Set<Promise<unknown>>();

function ctxFor(db: Db): Ctx {
	const now = new Date();
	const session: Session = { id: 0, createdAt: now, expiresAt: new Date(now.getTime() + 24 * 3600_000) };
	return {
		db,
		session,
		now: () => new Date(),
		actor: DEMO_ACTOR,
		ip: null,
		userAgent: scope.navigator.userAgent.slice(0, 300),
		secure: true
	};
}

const unavailable: Reply = {
	ok: false,
	error: 'Ukázková data nejsou k dispozici. Zkuste „Obnovit ukázková data“ nebo načtěte stránku znovu.',
	code: 'demo_unavailable',
	status: 503
};

scope.addEventListener('message', async (event) => {
	const message = event.data;
	if (message.type === 'reset') {
		post({ type: 'phase', phase: 'resetting' });
		const previous = database;
		const unfinished = [...running];
		database = watch(Promise.allSettled(unfinished).then(() => prepare(true, previous)));
		let reply: Reply;
		try {
			await database;
			reply = { ok: true, json: 'null' };
		} catch (e) {
			reply = { ok: false, error: errorText(e), code: 'demo_reset_failed', status: 500 };
		}
		post({ type: 'reply', id: message.id, reply });
		return;
	}

	let reply: Reply;
	const work = database.then((db) => runMethod(getMethod(message.method), ctxFor(db), message.method, message.args));
	running.add(work);
	try {
		reply = await work;
	} catch {
		reply = unavailable;
	} finally {
		running.delete(work);
	}
	post({ type: 'reply', id: message.id, reply }, reply.ok && 'file' in reply ? [reply.file.bytes] : []);
});
