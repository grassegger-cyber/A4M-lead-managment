<script lang="ts">
	/**
	 * Confirmation dialog, optionally with a note. onConfirm may be async: the dialog stays
	 * open and busy until it resolves, shows the error message when it throws.
	 */
	import type { Snippet } from 'svelte';
	import Dialog from './Dialog.svelte';
	import Button from './Button.svelte';
	import Field from './Field.svelte';

	interface Props {
		open: boolean;
		title: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		/** Shows a note field; the text is passed to onConfirm. */
		withNote?: boolean;
		noteRequired?: boolean;
		noteLabel?: string;
		onConfirm: (note: string) => void | Promise<void>;
		oncancel?: () => void;
		/** Extra content between the message and the note. */
		children?: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		message,
		confirmLabel = 'Potvrdit',
		cancelLabel = 'Zrušit',
		withNote = false,
		noteRequired = false,
		noteLabel = 'Poznámka',
		onConfirm,
		oncancel,
		children
	}: Props = $props();

	let note = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let noteError = $state<string | null>(null);

	$effect(() => {
		if (open) {
			note = '';
			error = null;
			noteError = null;
		}
	});

	async function confirm() {
		if (withNote && noteRequired && !note.trim()) {
			noteError = 'Poznámka je povinná.';
			return;
		}
		noteError = null;
		error = null;
		busy = true;
		try {
			await onConfirm(note.trim());
			open = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Akci se nepodařilo provést.';
		} finally {
			busy = false;
		}
	}

	function cancel() {
		open = false;
		oncancel?.();
	}
</script>

<Dialog bind:open {title} width="sm" {busy} onclose={oncancel}>
	{#if message}<p>{message}</p>{/if}
	{#if children}{@render children()}{/if}
	{#if withNote}
		<Field label={noteLabel} bind:value={note} multiline rows={3} optional={!noteRequired} error={noteError} />
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#snippet footer()}
		<Button variant="secondary" onclick={cancel} disabled={busy}>{cancelLabel}</Button>
		<Button onclick={confirm} loading={busy}>{confirmLabel}</Button>
	{/snippet}
</Dialog>

<style>
	/* Error after a failed confirm: bold ink text on a quiet ink-tinted box (no red in the palette). */
	.error {
		font-weight: 600;
		padding: 10px 14px;
		border-radius: var(--radius);
		background: rgb(11 27 51 / 0.06);
		box-shadow: inset 0 0 0 1px rgb(11 27 51 / 0.16);
	}
</style>
