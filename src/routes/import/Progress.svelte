<script lang="ts">
	/** Progress meter with a text line: "12 000 z 90 000 řádků". */
	import { formatNumber } from '$lib/format';

	interface Props {
		label: string;
		value: number;
		max: number;
		unit?: string;
	}

	let { label, value, max, unit = 'řádků' }: Props = $props();
	const pct = $derived(max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0);
</script>

<div class="progress">
	<div class="line">
		<span class="what">{label}</span>
		<span class="num">{formatNumber(value)} z {formatNumber(max)} {unit} · {pct} %</span>
	</div>
	<div class="track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
		<span class="fill" style:clip-path="inset(0 {100 - pct}% 0 0 round 6px)"></span>
	</div>
</div>

<style>
	.progress {
		display: grid;
		gap: 10px;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-3);
	}
	.what {
		font-weight: 600;
	}
	/* Same meter as the superuser occupancy on Přehled: a rounded ink bar on a faint ink track. */
	.track {
		height: 12px;
		border-radius: 6px;
		background: rgb(11 27 51 / 0.09);
		overflow: hidden;
	}
	/* The bar is full width and clipped to the share, so the change animates without relayout. */
	.fill {
		display: block;
		height: 100%;
		border-radius: 6px;
		background: var(--ink);
		transition: clip-path var(--dur-fast) var(--ease-out);
	}
</style>
