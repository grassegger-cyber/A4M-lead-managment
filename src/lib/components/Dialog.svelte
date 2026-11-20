<script lang="ts">
	/**
	 * Modal dialog on the native <dialog>: a glass frame with the title and the buttons, the content
	 * on a solid sheet inside. Bind `open`; Esc and the close button set it to false.
	 */
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		open: boolean;
		title: string;
		/** Body of the dialog. */
		children: Snippet;
		/** Buttons row. */
		footer?: Snippet;
		width?: 'sm' | 'md' | 'lg';
		/** Blocks closing (Esc, close button) while an action runs. */
		busy?: boolean;
		onclose?: () => void;
	}

	let { open = $bindable(false), title, children, footer, width = 'md', busy = false, onclose }: Props = $props();

	const uid = $props.id();
	let element: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!element) return;
		if (open && !element.open) element.showModal();
		if (!open && element.open) element.close();
	});

	function close() {
		if (busy) return;
		open = false;
		onclose?.();
	}
</script>

<dialog
	bind:this={element}
	class="glass {width}"
	aria-labelledby="dialog-{uid}"
	oncancel={(e) => {
		e.preventDefault();
		close();
	}}
	onclose={() => {
		if (open) close();
	}}
>
	{#if open}
		<header>
			<h2 id="dialog-{uid}">{title}</h2>
			<button type="button" class="close" aria-label="Zavřít" disabled={busy} onclick={close}><X size={18} /></button>
		</header>
		<div class="body sheet">{@render children()}</div>
		{#if footer}<footer>{@render footer()}</footer>{/if}
	{/if}
</dialog>

<style>
	dialog {
		width: min(560px, calc(100vw - 32px));
		max-width: calc(100vw - 32px);
		max-height: calc(var(--vh) - 64px);
		padding: var(--space-2);
		border-radius: var(--radius-panel);
		box-shadow: var(--glass-light), var(--pop-shadow);
		color: var(--ink);
		overflow: hidden;
	}
	dialog.sm {
		width: min(420px, calc(100vw - 32px));
	}
	dialog.lg {
		width: min(880px, calc(100vw - 32px));
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		animation: dialog-in 180ms var(--ease-out);
	}
	dialog[open]::backdrop {
		animation: scrim-in 180ms var(--ease-out);
	}
	@keyframes dialog-in {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.985);
		}
	}
	@keyframes scrim-in {
		from {
			opacity: 0;
		}
	}
	header {
		flex: none;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2);
		padding-left: var(--space-3);
	}
	h2 {
		padding-top: 11px;
	}
	.close {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--ink);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.close:hover:not(:disabled) {
		background: rgb(255 255 255 / 0.6);
	}
	.close:disabled {
		color: var(--text-disabled);
		cursor: not-allowed;
	}
	.body {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		display: grid;
		align-content: start;
		gap: var(--space-4);
		padding: 20px;
	}
	footer {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
