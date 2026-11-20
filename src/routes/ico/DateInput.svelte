<script lang="ts">
	/**
	 * Date field typed the Czech way (DD. MM. RRRR). The bound value is 'YYYY-MM-DD' or ''.
	 * A native date input would follow the browser language, not the Czech format.
	 */
	import Field from '$lib/components/Field.svelte';
	import { formatDate, parseCzechDate } from '$lib/format';

	interface Props {
		label: string;
		/** ISO date 'YYYY-MM-DD', or '' when empty. */
		value: string;
		hint?: string;
		optional?: boolean;
		disabled?: boolean;
		hideLabel?: boolean;
		placeholder?: string;
		/** Called after the user finished typing a valid date or cleared the field. */
		onchange?: (value: string) => void;
		/** True while the typed text is not a valid date. */
		invalid?: boolean;
	}

	let {
		label,
		value = $bindable(''),
		hint,
		optional = false,
		disabled = false,
		hideLabel = false,
		placeholder = 'DD. MM. RRRR',
		onchange,
		invalid = $bindable(false)
	}: Props = $props();

	let text = $state('');
	let error = $state<string | null>(null);
	let lastValue: string | null = null;

	// Follow changes of the value made from outside (URL, reset).
	$effect(() => {
		if (value !== lastValue) {
			lastValue = value;
			text = value ? formatDate(value, '') : '';
			error = null;
			invalid = false;
		}
	});

	function commit() {
		const trimmed = text.trim();
		if (!trimmed) {
			error = null;
			invalid = false;
			if (value !== '') {
				value = '';
				lastValue = '';
				onchange?.('');
			}
			return;
		}
		const iso = parseCzechDate(trimmed);
		if (!iso) {
			error = 'Zadejte datum jako DD. MM. RRRR.';
			invalid = true;
			return;
		}
		error = null;
		invalid = false;
		text = formatDate(iso, '');
		if (iso !== value) {
			value = iso;
			lastValue = iso;
			onchange?.(iso);
		}
	}
</script>

<Field {label} {hint} {error} {optional} {hideLabel}>
	{#snippet children({ id, describedby, invalid: fieldInvalid })}
		<input
			{id}
			type="text"
			inputmode="numeric"
			autocomplete="off"
			{placeholder}
			bind:value={text}
			{disabled}
			aria-describedby={describedby}
			aria-invalid={fieldInvalid ? true : undefined}
			onblur={commit}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					commit();
				}
			}}
		/>
	{/snippet}
</Field>
