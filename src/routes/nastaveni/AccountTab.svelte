<script lang="ts">
	/** Password change. The session already passed 2FA, so the current password is not asked again. */
	import { call } from '$lib/api';
	import { auth, MIN_PASSWORD_LENGTH } from '$lib/auth.svelte';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import { toast } from '$lib/components/toasts.svelte';

	let next = $state('');
	let repeat = $state('');
	let busy = $state(false);
	let errors = $state<{ next?: string; repeat?: string }>({});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		errors = {};
		if (next.length < MIN_PASSWORD_LENGTH) errors.next = `Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků.`;
		if (repeat !== next) errors.repeat = 'Hesla se neshodují.';
		if (Object.keys(errors).length > 0) return;
		busy = true;
		try {
			await auth.changePassword(next);
			await call('auth.passwordChanged').catch(() => undefined);
			next = repeat = '';
			toast.success('Heslo je změněné.');
		} catch (err) {
			errors.next = err instanceof Error ? err.message : 'Heslo se nepodařilo změnit.';
		} finally {
			busy = false;
		}
	}
</script>

<!-- One plate: heading and explanation, then the form with fields as white capsules. -->
<div class="panel panel-pad account">
	<h2>Změna hesla</h2>
	<p class="text-muted">
		Přihlášeni jste jako {auth.email ?? '—'}. Heslo platí jen pro váš účet; při přihlášení se k němu vždy zadává i kód z ověřovací
		aplikace. Změna se zapíše do auditu.
	</p>
	<form onsubmit={submit} novalidate>
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
