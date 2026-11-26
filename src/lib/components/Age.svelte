<script lang="ts">
	/**
	 * How old a piece of information is: a small clock that tells the date on hover and to a
	 * screen reader. Grey when the information was never verified.
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
</script>

<span class="age" class:unknown={!date} title={text} aria-label={text} role="img"><Clock size={16} /></span>

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
	.age:hover {
		background: var(--nav-hover-fill, rgba(11, 27, 51, 0.06));
		color: var(--ink);
	}
	.age.unknown {
		color: #b6bcc6;
	}
</style>
