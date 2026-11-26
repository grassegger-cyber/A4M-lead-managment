// auth.* methods of the demo build. The demo has no server and no password: every visitor is
// signed in. vite.demo.config.ts puts this module in place of src/lib/server/methods/auth.ts in
// the demo worker only; the normal build, the dev server and the tests never contain it.
import type { MethodMap } from '../server/context.ts';
import { AppError } from '../server/errors.ts';

const signedIn = { passwordSet: true, authenticated: true };

export const methods: MethodMap = {
	'auth.status': async () => signedIn,
	// The sign-in and password pages lead straight to the overview in the demo; these answers keep
	// a form that is sent anyway harmless.
	'auth.setPassword': async () => signedIn,
	'auth.login': async () => ({ authenticated: true }),
	// Logout is hidden in the demo; signing out of it is not possible.
	'auth.logout': async () => ({ authenticated: true }),
	'auth.changePassword': async () => {
		throw new AppError('demo_no_password', 'Ukázka nemá heslo, proto ho tady nejde změnit.', 409);
	}
};
