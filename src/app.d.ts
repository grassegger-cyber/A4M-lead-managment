import type { Session } from '$lib/server/context';

declare global {
	namespace App {
		interface Locals {
			session: Session | null;
		}
	}
}

export {};
