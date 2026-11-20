// auth.* methods. Those listed in PUBLIC_METHODS (auth.ts) are the only ones reachable without a session.
import type { Ctx, MethodMap } from '../context.ts';
import { AppError } from '../errors.ts';
import { audit } from '../companies-core.ts';
import {
	SESSION_COOKIE,
	checkPassword,
	createSession,
	isPasswordSet,
	passwordNeedsRehash,
	recordLoginSuccess,
	revokeAllSessions,
	revokeSession,
	validateNewPassword,
	writePassword
} from '../auth.ts';

function setCookie(ctx: Ctx, token: string, expiresAt: Date) {
	ctx.cookies?.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: ctx.secure === true,
		expires: expiresAt
	});
}

export const methods: MethodMap = {
	/** { passwordSet, authenticated } */
	'auth.status': async (ctx) => ({ passwordSet: isPasswordSet(), authenticated: ctx.session !== null }),

	/** First run only: stores the password and logs in. args: { password } */
	'auth.setPassword': async (ctx, args) => {
		if (isPasswordSet()) throw new AppError('password_already_set', 'Heslo už je nastavené. Přihlaste se.', 409);
		const password = validateNewPassword(args?.password);
		// Exclusive: of two concurrent first-run requests only one sets the password.
		await writePassword(password, { exclusive: true });
		recordLoginSuccess();
		const now = ctx.now();
		// A new password ends every earlier session (e.g. after auth.json was deleted to reset it).
		await revokeAllSessions(ctx.db, now);
		// The person who sets the password is logged in right away.
		const { token, expiresAt } = await createSession(ctx.db, now, { ip: ctx.ip, userAgent: ctx.userAgent });
		setCookie(ctx, token, expiresAt);
		await audit(ctx, 'auth.password_set', { entity: 'auth', description: 'Nastaveno heslo při prvním spuštění' });
		return { passwordSet: true, authenticated: true, expiresAt };
	},

	/** args: { password } → sets the session cookie */
	'auth.login': async (ctx, args) => {
		if (!isPasswordSet()) throw new AppError('password_not_set', 'Heslo ještě není nastavené.', 409);
		if (!(await checkPassword(args?.password, ctx.now))) {
			await audit(ctx, 'auth.login_failed', { entity: 'auth', description: 'Neúspěšné přihlášení' });
			throw new AppError('login_failed', 'Nesprávné heslo.', 401);
		}
		// A hash made with weaker parameters is replaced now that the password is known to be right.
		if (passwordNeedsRehash()) await writePassword(args.password);
		const now = ctx.now();
		const { token, expiresAt } = await createSession(ctx.db, now, { ip: ctx.ip, userAgent: ctx.userAgent });
		setCookie(ctx, token, expiresAt);
		await audit(ctx, 'auth.login', { entity: 'auth', description: 'Přihlášení' });
		return { authenticated: true, expiresAt };
	},

	'auth.logout': async (ctx) => {
		if (ctx.session) {
			await revokeSession(ctx.db, ctx.session.id, ctx.now());
			await audit(ctx, 'auth.logout', { entity: 'auth', description: 'Odhlášení' });
		}
		ctx.cookies?.delete(SESSION_COOKIE, { path: '/' });
		return { authenticated: false };
	},

	/** Logged in only. args: { currentPassword, newPassword }. Ends every other session. */
	'auth.changePassword': async (ctx, args) => {
		if (!ctx.session) throw new AppError('unauthenticated', 'Nejste přihlášeni.', 401);
		if (!(await checkPassword(args?.currentPassword, ctx.now))) {
			await audit(ctx, 'auth.password_change_failed', { entity: 'auth', description: 'Neúspěšná změna hesla: současné heslo nesouhlasí' });
			throw new AppError('login_failed', 'Současné heslo nesouhlasí.', 401);
		}
		const password = validateNewPassword(args?.newPassword);
		await writePassword(password);
		const now = ctx.now();
		await revokeAllSessions(ctx.db, now);
		const { token, expiresAt } = await createSession(ctx.db, now, { ip: ctx.ip, userAgent: ctx.userAgent });
		setCookie(ctx, token, expiresAt);
		await audit(ctx, 'auth.password_changed', { entity: 'auth', description: 'Změna hesla' });
		return { changed: true };
	}
};
