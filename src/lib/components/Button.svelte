<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		/**
		 * primary = the yellow capsule (one per screen), secondary = a capsule that follows its
		 * surface (glass on the backdrop, light inside glass, white on a plate), ghost = text only
		 */
		variant?: 'primary' | 'secondary' | 'ghost';
		/** sm keeps the 44 px height and only narrows the sides. */
		size?: 'md' | 'sm';
		/** Disables the button and marks it busy; say what happens in the label ("Ukládám…"). */
		loading?: boolean;
		fullWidth?: boolean;
		/** Renders a link styled as a button. */
		href?: string;
		children: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		fullWidth = false,
		href,
		type = 'button',
		disabled,
		children,
		...rest
	}: Props = $props();
</script>

{#if href}
	<a {href} class="btn {variant} {size}" class:full={fullWidth}>{@render children()}</a>
{:else}
	<button
		{type}
		class="btn {variant} {size}"
		class:full={fullWidth}
		class:loading
		disabled={disabled || loading}
		aria-busy={loading || undefined}
		{...rest}
	>
		{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		height: var(--control-h);
		padding: 0 18px;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		font-family: var(--font);
		font-size: var(--text-body);
		font-weight: 600;
		line-height: 1;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out),
			transform var(--dur-fast) var(--ease-out);
	}
	.btn :global(svg) {
		flex: none;
	}
	.btn:active:not(:disabled) {
		transform: scale(0.98);
	}
	.sm {
		padding: 0 14px;
	}
	.full {
		width: 100%;
	}
	.primary {
		background: var(--accent);
		border-color: rgb(11 27 51 / 0.14);
		color: var(--ink);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.55),
			0 8px 18px -10px rgb(11 27 51 / 0.45);
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.secondary {
		background: var(--control-fill);
		border-color: var(--control-border);
		color: var(--ink);
		-webkit-backdrop-filter: var(--control-blur);
		backdrop-filter: var(--control-blur);
		box-shadow: var(--control-shadow);
	}
	.secondary:hover:not(:disabled) {
		background: var(--control-fill-hover);
	}
	.ghost {
		background: transparent;
		color: var(--ink);
		padding: 0 14px;
	}
	.ghost:hover:not(:disabled) {
		background: rgb(11 27 51 / 0.06);
	}
	.btn:disabled:not(.loading) {
		color: var(--text-disabled);
		box-shadow: none;
		cursor: not-allowed;
	}
	.primary:disabled:not(.loading) {
		background: rgb(11 27 51 / 0.08);
		border-color: transparent;
	}
	.secondary:disabled:not(.loading) {
		background: rgb(255 255 255 / 0.18);
		border-color: rgb(11 27 51 / 0.08);
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}
	.ghost:disabled:not(.loading) {
		background: transparent;
	}
	.loading {
		cursor: progress;
	}
</style>
