<script lang="ts">
	/**
	 * How old a piece of information is: a small clock that shows the date at once on hover or
	 * focus (and tells it to a screen reader). Grey when the information was never verified.
	 * The bubble is positioned against the window, so a table cell cannot cut it off.
	 */
	import Clock from '@lucide/svelte/icons/clock';
	import { formatDate } from '$lib/format';

	interface Props {
		/** What was done, e.g. "Stav ověřen", "Telefon přidán". */
		label: string;
		date: string | Date | null | undefined;
		/** Text when there is no date. */
		empty?: string;
	}
	let { label, date, empty = 'neověřeno' }: Props = $props();
	const text = $derived(date ? `${label} ${formatDate(date)}` : `${label}: ${empty}`);

	let anchor = $state<HTMLElement | null>(null);
	let tip = $state<{ x: number; y: number } | null>(null);

	function show() {
		if (!anchor) return;
		const box = anchor.getBoundingClientRect();
		tip = { x: box.left + box.width / 2, y: box.top };
	}
	function hide() {
		tip = null;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<span
	class="age"
	class:unknown={!date}
	bind:this={anchor}
	role="img"
	aria-label={text}
	tabindex="0"
	onmouseenter={show}
	onmouseleave={hide}
	onfocus={show}
	onblur={hide}><Clock size={16} /></span
>{#if tip}<span class="bubble" style:left="{tip.x}px" style:top="{tip.y}px" aria-hidden="true">{text}</span>{/if}

<style>
	.age {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin-left: 2px;
		border-radius: 50%;
		color: var(--ink);
		vertical-align: middle;
		cursor: help;
		flex: none;
	}
	.age:hover,
	.age:focus-visible {
		background: var(--nav-hover-fill, rgba(11, 27, 51, 0.06));
		outline: none;
	}
	.age.unknown {
		color: #b6bcc6;
	}
	.bubble {
		position: fixed;
		z-index: 1000;
		transform: translate(-50%, calc(-100% - 6px));
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--ink, #0b1b33);
		color: #fff;
		font-size: var(--text-small, 14px);
		font-weight: 500;
		white-space: nowrap;
		pointer-events: none;
		box-shadow: 0 6px 20px rgba(11, 27, 51, 0.18);
	}
</style>
