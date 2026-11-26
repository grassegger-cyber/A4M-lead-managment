<script lang="ts">
	import { call } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';

	let email = $state('');
	let password = $state('');
	let code = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);
	let enrol = $state<{ factorId: string; qr: string; secret: string } | null>(null);

	const step = $derived(auth.status === 'needsCode' ? 'code' : auth.status === 'needsEnroll' ? 'enrol' : 'password');

	// First login: prepare the QR code as soon as the password was accepted.
	$effect(() => {
		if (auth.status === 'needsEnroll' && !enrol && !busy) void prepareEnrol();
	});

	async function prepareEnrol() {
		busy = true;
		error = null;
		try {
			enrol = await auth.startEnroll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Nastavení ověřovací aplikace se nepodařilo.';
		} finally {
			busy = false;
		}
	}

	async function run(action: () => Promise<void>, fallback: string) {
		error = null;
		busy = true;
		try {
			await action();
			if (auth.status === 'ready') {
				// The login is written to the audit log by the server; the layout then opens the overview.
				await call('auth.sessionStarted').catch(() => undefined);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : fallback;
		} finally {
			busy = false;
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (step === 'password') void run(() => auth.signIn(email, password), 'Přihlášení se nepodařilo.');
		else if (step === 'code') void run(() => auth.verifyCode(code), 'Ověření se nepodařilo.');
		else if (enrol) void run(() => auth.confirmEnroll(enrol!.factorId, code), 'Ověření se nepodařilo.');
	}

	async function startOver() {
		await auth.signOut();
		password = code = '';
		enrol = null;
		error = null;
	}
</script>

<svelte:head><title>Přihlášení · Lead management A4M</title></svelte:head>

<main class="auth">
	<form class="glass card" onsubmit={submit}>
		<div class="brand">
			<!-- The gold A4M logo, unchanged and without a background (Thomas, 20. 11. 2026). The line beside it names the app. -->
			<span class="logo-tile"><img src="/a4m-logo.png" alt="" width="118" height="28" /></span>
			<p>A4M · Lead management</p>
		</div>
		{#if step === 'password'}
			<h1>Přihlášení <strong>do aplikace</strong></h1>
			<Field label="E-mail" type="email" bind:value={email} autocomplete="username" required autofocus />
			<Field label="Heslo" type="password" bind:value={password} autocomplete="current-password" required {error} />
			<Button type="submit" loading={busy} fullWidth>{busy ? 'Přihlašuji…' : 'Pokračovat'}</Button>
		{:else if step === 'code'}
			<h1>Ověřovací <strong>kód</strong></h1>
			<p class="text-muted">Opište šestimístný kód z ověřovací aplikace v telefonu.</p>
			<Field
				label="Kód z aplikace"
				bind:value={code}
				inputmode="numeric"
				autocomplete="one-time-code"
				maxlength={7}
				required
				{error}
				autofocus
			/>
			<Button type="submit" loading={busy} fullWidth>{busy ? 'Ověřuji…' : 'Přihlásit se'}</Button>
			<button type="button" class="link" onclick={startOver}>Přihlásit se jiným účtem</button>
		{:else}
			<h1>Nastavení <strong>dvoufázového ověření</strong></h1>
			<p class="text-muted">
				Bez něj se do aplikace nedostanete. V telefonu otevřete ověřovací aplikaci (Google Authenticator, Microsoft Authenticator,
				1Password…), naskenujte kód a opište šest číslic, které ukáže.
			</p>
			{#if enrol}
				<img class="qr" src={enrol.qr} alt="QR kód pro ověřovací aplikaci" width="192" height="192" />
				<p class="secret">Nejde skenovat? Zadejte do aplikace ručně: <code>{enrol.secret}</code></p>
				<Field
					label="Kód z aplikace"
					bind:value={code}
					inputmode="numeric"
					autocomplete="one-time-code"
					maxlength={7}
					required
					{error}
				/>
				<Button type="submit" loading={busy} fullWidth>{busy ? 'Ověřuji…' : 'Dokončit a přihlásit'}</Button>
			{:else if error}
				<p class="failed" role="alert">{error}</p>
				<Button type="button" onclick={prepareEnrol} loading={busy} fullWidth>Zkusit znovu</Button>
			{/if}
			<button type="button" class="link" onclick={startOver}>Přihlásit se jiným účtem</button>
		{/if}
	</form>
</main>

<style>
	/* One glass panel in the middle of the window; the app backdrop shows around it. */
	.auth {
		min-height: var(--vh);
		display: grid;
		place-items: center;
		padding: var(--space-4);
	}
	.card {
		display: grid;
		gap: var(--space-4);
		width: min(440px, 100%);
		padding: var(--space-5);
	}
	.brand {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		margin-bottom: var(--space-3);
	}
	.brand p {
		color: var(--text-2);
		font-size: var(--text-small);
		font-weight: 500;
	}
	.logo-tile {
		flex: none;
		display: flex;
		align-items: center;
		height: var(--control-h);
	}
	.logo-tile img {
		display: block;
		height: 22px;
		width: auto;
	}
	h1 {
		margin-bottom: var(--space-1);
	}
	.qr {
		justify-self: center;
		border-radius: 12px;
		background: #fff;
		padding: 8px;
	}
	.secret {
		font-size: var(--text-small);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.failed {
		color: var(--danger, #b3261e);
	}
	.link {
		justify-self: center;
		min-height: var(--control-h);
		padding: 0 var(--space-3);
		border: 0;
		background: none;
		color: var(--text-2);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
