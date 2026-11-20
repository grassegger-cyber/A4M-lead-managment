<script lang="ts">
	/** Password change. Uses the scaffold method auth.changePassword (needs the current password). */
	import { call } from '$lib/api';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import { toast } from '$lib/components/toasts.svelte';

	let current = $state('');
	let next = $state('');
	let repeat = $state('');
	let busy = $state(false);
	let errors = $state<{ current?: string; next?: string; repeat?: string }>({});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errors = {};
		if (!current) errors.current = 'Zadejte současné heslo.';
		if (!next) errors.next = 'Zadejte nové heslo.';
		else if (next === current) errors.next = 'Nové heslo se musí lišit od současného.';
		if (repeat !== next) errors.repeat = 'Hesla se neshodují.';
		if (Object.keys(errors).length > 0) return;
		busy = true;
		try {
			await call('auth.changePassword', { currentPassword: current, newPassword: next });
			current = next = repeat = '';
			toast.success('Heslo je změněné. Ostatní přihlášení byla ukončena.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Heslo se nepodařilo změnit.';
			const code = (err as { code?: string })?.code;
			if (code === 'login_failed') errors.current = message;
			else errors.next = message;
		} finally {
			busy = false;
		}
	}
</script>

<!-- One plate: heading and explanation, then the form with fields as white capsules. -->
<div class="panel panel-pad account">
	<h2>Změna hesla</h2>
	<p class="text-muted">
		Aplikace má jedno heslo. Po změně zůstanete přihlášeni v tomto prohlížeči, všechna ostatní přihlášení skončí. Změna se
		zapíše do auditu.
	</p>
	<form onsubmit={submit} novalidate>
		<Field label="Současné heslo" type="password" autocomplete="current-password" bind:value={current} error={errors.current} />
		<Field label="Nové heslo" type="password" autocomplete="new-password" bind:value={next} error={errors.next} />
		<Field label="Nové heslo znovu" type="password" autocomplete="new-password" bind:value={repeat} error={errors.repeat} />
		<div class="submit"><Button type="submit" loading={busy}>{busy ? 'Ukládám…' : 'Změnit heslo'}</Button></div>
	</form>
</div>

<style>
	.account {
		width: 100%;
		max-width: 520px;
		display: grid;
		gap: 10px;
	}
	form {
		display: grid;
		gap: var(--space-4);
		margin-top: var(--space-3);
	}
	.submit {
		padding-top: var(--space-1);
	}
</style>
