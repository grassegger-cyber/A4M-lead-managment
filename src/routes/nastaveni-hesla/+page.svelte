<script lang="ts">
	import { call } from '$lib/api';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';

	const MIN_LENGTH = 8;

	let password = $state('');
	let repeat = $state('');
	let error = $state<string | null>(null);
	let repeatError = $state<string | null>(null);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		repeatError = null;
		if (password.length < MIN_LENGTH) {
			error = `Heslo musí mít aspoň ${MIN_LENGTH} znaků.`;
			return;
		}
		if (password !== repeat) {
			repeatError = 'Hesla se neshodují.';
			return;
		}
		busy = true;
		try {
			await call('auth.setPassword', { password });
			window.location.assign('/');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Heslo se nepodařilo nastavit.';
			busy = false;
		}
	}
</script>

<svelte:head><title>Nastavení hesla · Lead management A4M</title></svelte:head>

<main class="auth">
	<form class="glass card" onsubmit={submit}>
		<div class="brand">
			<!-- The logo is drawn for dark grounds: it sits unchanged on an ink tile. -->
			<span class="logo-tile"><img src="/a4m-logo.png" alt="A4M" width="118" height="28" /></span>
		</div>
		<h1>Nastavení <strong>hesla</strong></h1>
		<p class="text-muted">
			Aplikace běží jen na tomto počítači. Zvolte heslo, kterým se budete přihlašovat. Uloží se jen jeho otisk, ne heslo samotné.
		</p>
		<Field
			label="Nové heslo"
			type="password"
			bind:value={password}
			autocomplete="new-password"
			required
			minlength={MIN_LENGTH}
			hint="Aspoň {MIN_LENGTH} znaků."
			{error}
		/>
		<Field label="Heslo znovu" type="password" bind:value={repeat} autocomplete="new-password" required error={repeatError} />
		<Button type="submit" loading={busy} fullWidth>{busy ? 'Ukládám…' : 'Nastavit heslo a přihlásit'}</Button>
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
	.logo-tile {
		flex: none;
		display: flex;
		align-items: center;
		height: var(--control-h);
		padding: 0 14px;
		border-radius: 12px;
		background: var(--ink);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.12),
			0 1px 2px rgb(11 27 51 / 0.18),
			0 6px 14px -8px rgb(11 27 51 / 0.4);
	}
	.logo-tile img {
		display: block;
		height: 22px;
		width: auto;
	}
	/* Title, then the explanation right under it. */
	h1 {
		margin-bottom: calc(-1 * var(--space-2));
	}
</style>
