<script lang="ts">
	/** Labelled <select>. options: [{ value, label }]; placeholder adds an empty first option. */
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Field from './Field.svelte';

	export interface SelectOption {
		value: string | number;
		label: string;
		disabled?: boolean;
	}

	interface Props {
		label: string;
		value?: string | number | null;
		options: SelectOption[];
		/** Text of the empty option (value ''). Omit to force a choice. */
		placeholder?: string;
		id?: string;
		hint?: string;
		error?: string | null;
		optional?: boolean;
		disabled?: boolean;
		hideLabel?: boolean;
		onchange?: (value: string) => void;
	}

	let {
		label,
		value = $bindable(''),
		options,
		placeholder,
		id,
		hint,
		error,
		optional = false,
		disabled = false,
		hideLabel = false,
		onchange
	}: Props = $props();
</script>

<Field {label} {id} {hint} {error} {optional} {hideLabel}>
	{#snippet children({ id: fieldId, describedby, invalid })}
		<div class="wrap">
			<select
				id={fieldId}
				bind:value
				{disabled}
				aria-describedby={describedby}
				aria-invalid={invalid ? true : undefined}
				onchange={(e) => onchange?.(e.currentTarget.value)}
			>
				{#if placeholder !== undefined}<option value="">{placeholder}</option>{/if}
				{#each options as option (option.value)}
					<option value={option.value} disabled={option.disabled}>{option.label}</option>
				{/each}
			</select>
			<span class="arrow" aria-hidden="true"><ChevronDown size={16} /></span>
		</div>
	{/snippet}
</Field>

<style>
	.wrap {
		position: relative;
	}
	select {
		appearance: none;
		padding-right: 40px !important;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	select:disabled {
		cursor: not-allowed;
	}
	.arrow {
		position: absolute;
		right: 14px;
		top: 50%;
		display: flex;
		margin-top: -8px;
		pointer-events: none;
		color: var(--ink);
	}
</style>
