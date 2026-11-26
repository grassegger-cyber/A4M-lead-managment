// auth.* methods. Passwords and the second factor are handled by Supabase Auth in the browser;
// the server only sees a verified session (see handler.ts). These methods keep the audit trail.
import type { MethodMap } from '../context.ts';
import { audit } from '../companies-core.ts';

export const methods: MethodMap = {
	/** Who is logged in: { name, email }. Reaching it at all proves the session passed 2FA and the whitelist. */
	'auth.me': async (ctx) => ({ name: ctx.actor.name, email: ctx.user?.email ?? null }),

	/** Called once by the browser right after the second factor was accepted. */
	'auth.sessionStarted': async (ctx) => {
		if (ctx.actor.id) await ctx.db.run('update users set last_login_at = $2 where id = $1', [ctx.actor.id, ctx.now()]);
		await audit(ctx, 'auth.login', { entity: 'auth', description: 'Přihlášení' });
		return { ok: true };
	},

	'auth.sessionEnded': async (ctx) => {
		await audit(ctx, 'auth.logout', { entity: 'auth', description: 'Odhlášení' });
		return { ok: true };
	},

	/** Called by the browser after Supabase accepted a new password. */
	'auth.passwordChanged': async (ctx) => {
		await audit(ctx, 'auth.password_changed', { entity: 'auth', description: 'Změna hesla' });
		return { ok: true };
	}
};
