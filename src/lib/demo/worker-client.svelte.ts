// Page side of the demo worker (demo build only): starts it, sends it API calls and the reset,
// and keeps the state of the demo database for the strip and the loading screen.
import type { DemoPhase, FromWorker, Reply, ToWorker } from './protocol.ts';

export const demo = $state<{ phase: DemoPhase; detail: string | null; seededMs: number | null }>({
	phase: 'starting',
	detail: null,
	seededMs: null
});

let worker: Worker | null = null;
/** The worker itself broke (it did not load or crashed); a database it could not open is no reason. */
let broken = false;
let nextId = 1;
const waiting = new Map<number, (reply: Reply) => void>();

const unavailable = (detail: string): Reply => ({
	ok: false,
	error: `Ukázku se nepodařilo spustit: ${detail}`,
	code: 'demo_unavailable',
	status: 503
});

function fail(detail: string): void {
	broken = true;
	demo.phase = 'failed';
	demo.detail = detail;
	for (const answer of waiting.values()) answer(unavailable(detail));
	waiting.clear();
}

function onMessage(event: MessageEvent<FromWorker>): void {
	const message = event.data;
	if (message.type === 'phase') {
		demo.phase = message.phase;
		demo.detail = message.detail ?? null;
		if (message.seededMs !== undefined) {
			demo.seededMs = message.seededMs;
			console.info(`[demo] fictional data created in ${message.seededMs} ms`);
		}
		return;
	}
	const answer = waiting.get(message.id);
	if (!answer) return;
	waiting.delete(message.id);
	answer(message.reply);
}

/** Starts the worker (once per page load). */
export function startDemo(): Worker | null {
	if (worker) return worker;
	if (typeof Worker === 'undefined' || typeof indexedDB === 'undefined') {
		fail('tento prohlížeč neumí spustit databázi ukázky.');
		return null;
	}
	worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'a4m-lm-demo' });
	worker.addEventListener('message', onMessage);
	worker.addEventListener('error', (event) => fail(event.message || 'databáze ukázky se nespustila.'));
	return worker;
}

function send(message: ToWorker): Promise<Reply> {
	const target = startDemo();
	if (!target || broken) return Promise.resolve(unavailable(demo.detail ?? ''));
	return new Promise((resolve) => {
		waiting.set(message.id, resolve);
		target.postMessage(message);
	});
}

/** Runs an API method in the worker. argsJson is the JSON text of the arguments. */
export function callMethod(method: string, argsJson: string): Promise<Reply> {
	return send({ type: 'call', id: nextId++, method, args: argsJson });
}

/** Throws the visitor's demo data away and creates the fictional data again. */
export async function resetDemoData(): Promise<void> {
	demo.phase = 'resetting';
	const reply = await send({ type: 'reset', id: nextId++ });
	if (!reply.ok) throw new Error(reply.error);
}
