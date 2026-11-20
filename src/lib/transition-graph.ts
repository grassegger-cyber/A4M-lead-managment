// Pure checks over the state transition table, shared by the server and the settings page.
// Plain-Node importable (relative imports only).
import { STATES } from './states.ts';

export interface TransitionEdge {
	from_state: string;
	to_state: string;
	enabled: boolean;
}

/** State every new IČO starts in; reachability is measured from here. */
export const INITIAL_STATE = 'v_poolu';

export interface GraphProblems {
	/** States no enabled path from the initial state leads to. */
	unreachable: string[];
	/** States with no enabled transition to a different state. */
	deadEnds: string[];
}

export function graphProblems(edges: TransitionEdge[], states: readonly string[] = STATES): GraphProblems {
	const out = new Map<string, string[]>();
	for (const e of edges) {
		if (!e.enabled || e.from_state === e.to_state) continue;
		const list = out.get(e.from_state) ?? [];
		list.push(e.to_state);
		out.set(e.from_state, list);
	}
	const seen = new Set<string>([INITIAL_STATE]);
	const queue = [INITIAL_STATE];
	while (queue.length > 0) {
		const state = queue.shift() as string;
		for (const next of out.get(state) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return {
		unreachable: states.filter((s) => !seen.has(s)),
		deadEnds: states.filter((s) => (out.get(s) ?? []).length === 0)
	};
}

/** Problems that a change would add compared with the current table. */
export function newProblems(before: TransitionEdge[], after: TransitionEdge[]): GraphProblems {
	const a = graphProblems(before);
	const b = graphProblems(after);
	return {
		unreachable: b.unreachable.filter((s) => !a.unreachable.includes(s)),
		deadEnds: b.deadEnds.filter((s) => !a.deadEnds.includes(s))
	};
}
