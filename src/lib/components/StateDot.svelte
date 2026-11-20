<script lang="ts">
	/** IČO state shown as a dot with the Czech label. Unknown values render as plain text. */
	import { STATE_DOTS, isCompanyState, stateLabel } from '$lib/states';
	import type { DotStyle } from '$lib/states';

	interface Props {
		state: string | null | undefined;
		/** Show the Czech label next to the dot (default). Without it the label is a tooltip. */
		showLabel?: boolean;
		/** Custom dot for non-state uses (e.g. a setting on/off). */
		dot?: DotStyle;
		label?: string;
	}

	let { state, showLabel = true, dot, label }: Props = $props();

	const style = $derived<DotStyle>(dot ?? (isCompanyState(state) ? STATE_DOTS[state] : { color: 'fan', variant: 'ring' }));
	const text = $derived(label ?? stateLabel(state));
</script>

<span class="state" title={showLabel ? undefined : text}>
	<span class="dot {style.variant}" class:rim={style.rim} style:--dot="var(--{style.color})" aria-hidden="true"></span>
	{#if showLabel}<span>{text}</span>{:else}<span class="visually-hidden">{text}</span>{/if}
</span>

<style>
	.state {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
	}
	.dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--dot);
	}
	.dot.rim {
		box-shadow: inset 0 0 0 1px var(--dot-rim);
	}
	.dot.ring {
		background: transparent;
		box-shadow: inset 0 0 0 2px var(--dot);
	}
	/* Filled dot with an ink ring around it */
	.dot.double {
		width: 8px;
		height: 8px;
		margin: 0 1px;
		box-shadow:
			0 0 0 1.5px var(--white),
			0 0 0 3px var(--ink);
	}
</style>
