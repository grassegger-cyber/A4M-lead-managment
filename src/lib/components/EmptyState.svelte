<script lang="ts">
	/** Calm placeholder for "nothing here yet" and "nothing matches". Sits on a plate (it has no surface of its own). */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		text?: string;
		/** Optional actions (buttons) under the text. */
		children?: Snippet;
	}

	let { title, text, children }: Props = $props();
</script>

<div class="empty">
	<p class="title">{title}</p>
	{#if text}<p class="text">{text}</p>{/if}
	{#if children}<div class="actions">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: start;
		gap: 6px;
		padding: var(--space-6) var(--plate-pad-x);
	}
	.title {
		font-size: var(--text-lead);
		line-height: 1.3;
		font-weight: 700;
	}
	.text {
		color: var(--text-2);
		max-width: 60ch;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: 10px;
	}
</style>
