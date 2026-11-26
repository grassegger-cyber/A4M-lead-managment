<script lang="ts">
	import { call } from '$lib/api';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';

	let password = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		busy = true;
		try {
			await call('auth.login', { password });
			window.location.assign('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Přihlášení se nepodařilo.';
			busy = false;
		}
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
		<h1>Přihlášení <strong>do aplikace</strong></h1>
		<Field label="Heslo" type="password" bind:value={password} autocomplete="current-password" required {error} autofocus />
		<Button type="submit" loading={busy} fullWidth>{busy ? 'Přihlašuji…' : 'Přihlásit se'}</Button>
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
		width: min(400px, 100%);
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
</style>
