// Login state in the browser. Passwords and the second factor (TOTP) are handled by Supabase Auth;
// this file only drives it. The real protection is on the server: without a session that passed
// 2FA the api gives nothing, whatever this file thinks.
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONFIGURED, LOCAL_MODE, LOCAL_TOKEN, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export type AuthStatus =
	| 'loading'
	| 'unconfigured'
	| 'signedOut'
	/** Password accepted, the account has no authenticator yet. */
	| 'needsEnroll'
	/** Password accepted, waiting for the code from the authenticator. */
	| 'needsCode'
	| 'ready';

export const MIN_PASSWORD_LENGTH = 12;
const ISSUER = 'A4M Lead management';

class AuthError extends Error {}

let client: SupabaseClient | null = null;
async function supabase(): Promise<SupabaseClient> {
	if (!client) {
		const { createClient } = await import('@supabase/supabase-js');
		client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'a4m-lm-auth' }
		});
	}
	return client;
}

/** Czech text for the errors Supabase Auth answers with. */
function translate(error: { message?: string; code?: string; status?: number } | null, fallback: string): string {
	const code = error?.code ?? '';
	const message = (error?.message ?? '').toLowerCase();
	if (code === 'invalid_credentials' || message.includes('invalid login')) return 'Nesprávný e-mail nebo heslo.';
	if (code === 'mfa_verification_failed' || message.includes('invalid totp')) return 'Kód nesouhlasí. Zkuste aktuální kód z aplikace.';
	if (code === 'over_request_rate_limit' || error?.status === 429) return 'Příliš mnoho pokusů. Zkuste to znovu za chvíli.';
	if (code === 'weak_password') return 'Heslo je příliš slabé. Zvolte delší nebo méně obvyklé.';
	if (code === 'same_password') return 'Nové heslo se musí lišit od současného.';
	if (message.includes('fetch') || message.includes('network')) return 'Server neodpovídá. Zkontrolujte připojení k internetu.';
	return fallback;
}

function fail(error: Parameters<typeof translate>[0], fallback: string): never {
	throw new AuthError(translate(error, fallback));
}

class Auth {
	status = $state<AuthStatus>('loading');
	email = $state<string | null>(null);
	private started: Promise<void> | null = null;

	/** Reads the stored session once per page load. */
	init(): Promise<void> {
		return (this.started ??= this.refresh());
	}

	private async refresh(): Promise<void> {
		if (!CONFIGURED) {
			this.status = 'unconfigured';
			return;
		}
		if (LOCAL_MODE) {
			this.email = 'vyvoj@example.test';
			this.status = 'ready';
			return;
		}
		const sb = await supabase();
		const { data } = await sb.auth.getSession();
		if (!data.session) {
			this.email = null;
			this.status = 'signedOut';
			return;
		}
		this.email = data.session.user.email ?? null;
		const { data: level } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
		if (level?.currentLevel === 'aal2') this.status = 'ready';
		else if (level?.nextLevel === 'aal2') this.status = 'needsCode';
		else this.status = 'needsEnroll';
	}

	/** Access token for the api, or null when nobody is logged in. */
	async token(): Promise<string | null> {
		if (LOCAL_MODE) return LOCAL_TOKEN;
		if (!CONFIGURED) return null;
		const { data } = await (await supabase()).auth.getSession();
		return data.session?.access_token ?? null;
	}

	async signIn(email: string, password: string): Promise<void> {
		const sb = await supabase();
		const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
		if (error) fail(error, 'Přihlášení se nepodařilo.');
		await this.refresh();
	}

	private async verifiedFactorId(): Promise<string> {
		const { data, error } = await (await supabase()).auth.mfa.listFactors();
		if (error) fail(error, 'Ověření se nepodařilo.');
		const factor = data.totp.find((f) => f.status === 'verified');
		if (!factor) throw new AuthError('Účet nemá nastavenou ověřovací aplikaci.');
		return factor.id;
	}

	/** Second step of the login: the six digits from the authenticator. */
	async verifyCode(code: string): Promise<void> {
		const sb = await supabase();
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: await this.verifiedFactorId(), code: code.replace(/\s/g, '') });
		if (error) fail(error, 'Ověření se nepodařilo.');
		await this.refresh();
	}

	/** First login: creates a new authenticator secret. Returns the QR code (image address) and the secret as text. */
	async startEnroll(): Promise<{ factorId: string; qr: string; secret: string }> {
		const sb = await supabase();
		// Leftovers of an enrolment that was never finished would block a new one.
		const { data: factors } = await sb.auth.mfa.listFactors();
		for (const factor of factors?.all ?? []) {
			if (factor.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: factor.id });
		}
		const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', issuer: ISSUER, friendlyName: `Authenticator ${Date.now()}` });
		if (error || !data) fail(error, 'Nastavení ověřovací aplikace se nepodařilo.');
		// The library returns the picture as an unescaped data address; characters such as # must be escaped to show.
		const prefix = 'data:image/svg+xml;utf-8,';
		const raw = data.totp.qr_code;
		const qr = raw.startsWith(prefix) ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw.slice(prefix.length))}` : raw;
		return { factorId: data.id, qr, secret: data.totp.secret };
	}

	async confirmEnroll(factorId: string, code: string): Promise<void> {
		const sb = await supabase();
		const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
		if (error) fail(error, 'Ověření se nepodařilo.');
		await this.refresh();
	}

	async changePassword(next: string): Promise<void> {
		if (LOCAL_MODE) throw new AuthError('V místním režimu se heslo nepoužívá.');
		const { error } = await (await supabase()).auth.updateUser({ password: next });
		if (error) fail(error, 'Heslo se nepodařilo změnit.');
	}

	async signOut(): Promise<void> {
		if (!LOCAL_MODE && CONFIGURED) await (await supabase()).auth.signOut();
		this.email = null;
		this.status = LOCAL_MODE ? 'ready' : 'signedOut';
	}
}

export const auth = new Auth();
