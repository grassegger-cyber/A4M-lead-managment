<script lang="ts">
	/**
	 * Form field with label, hint and error wired through aria-describedby.
	 * Without children it renders its own <input> (or <textarea> with multiline).
	 * With children the snippet receives { id, describedby, invalid } for a custom control.
	 */
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'value' | 'children'> {
		label: string;
		value?: string | number | null;
		id?: string;
		hint?: string;
		error?: string | null;
		optional?: boolean;
		multiline?: boolean;
		rows?: number;
		/** Hides the label visually (it stays for screen readers), e.g. in a toolbar. */
		hideLabel?: boolean;
		children?: Snippet<[{ id: string; describedby: string | undefined; invalid: boolean }]>;
	}

	const uid = $props.id();

	let {
		label,
		value = $bindable(''),
		id,
		hint,
		error,
		optional = false,
		multiline = false,
		rows = 3,
		hideLabel = false,
		children,
		type = 'text',
		...rest
	}: Props = $props();

	const fieldId = $derived(id ?? `field-${uid}`);
	const describedby = $derived(
		[hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field" class:invalid={!!error}>
	<label for={fieldId} class:visually-hidden={hideLabel}>
		{label}
		{#if optional}<span class="optional">nepovinné</span>{/if}
	</label>
	{#if children}
		{@render children({ id: fieldId, describedby, invalid: !!error })}
	{:else if multiline}
		<textarea
			id={fieldId}
			{rows}
			bind:value
			aria-describedby={describedby}
			aria-invalid={error ? true : undefined}
			placeholder={rest.placeholder}
			disabled={rest.disabled}
			required={rest.required}
			maxlength={rest.maxlength}
			name={rest.name}
		></textarea>
	{:else}
		<input id={fieldId} {type} bind:value aria-describedby={describedby} aria-invalid={error ? true : undefined} {...rest} />
	{/if}
	{#if error}
		<p class="error" id="{fieldId}-error">{error}</p>
	{:else if hint}
		<p class="hint" id="{fieldId}-hint">{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 6px;
		min-width: 0;
	}
	label {
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--text-2);
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.optional {
		font-weight: 400;
		font-size: var(--text-caps);
	}
	.hint {
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--text-2);
	}
	/* Error: bold ink text under the field (no red in the palette) */
	.error {
		font-size: var(--text-small);
		line-height: 1.4;
		font-weight: 600;
		color: var(--ink);
	}
	/* 44 px capsule; fill and hairline follow the surface (see --field-* in app.css). */
	.field :global(input:not([type='checkbox']):not([type='radio'])),
	.field :global(textarea),
	.field :global(select) {
		width: 100%;
		min-width: 0;
		height: var(--control-h);
		margin: 0;
		padding: 0 16px;
		border: 1px solid var(--field-border);
		border-radius: var(--radius-control);
		background: var(--field-fill);
		font-size: var(--text-body);
		color: var(--ink);
		-webkit-appearance: none;
		appearance: none;
		transition:
			border-color var(--dur-fast) var(--ease-out),
			background-color var(--dur-fast) var(--ease-out);
	}
	.field :global(textarea) {
		height: auto;
		min-height: var(--control-h);
		padding: 10px 16px;
		border-radius: var(--radius-sheet);
		resize: vertical;
		line-height: 1.45;
	}
	.field :global(input:hover:not(:disabled)),
	.field :global(textarea:hover:not(:disabled)),
	.field :global(select:hover:not(:disabled)) {
		border-color: var(--field-border-hover);
	}
	.field.invalid :global(input:not([type='checkbox']):not([type='radio'])),
	.field.invalid :global(textarea),
	.field.invalid :global(select) {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	.field :global(input:disabled),
	.field :global(textarea:disabled),
	.field :global(select:disabled) {
		background: rgb(11 27 51 / 0.04);
		border-color: var(--line-2);
		color: var(--text-disabled);
		cursor: not-allowed;
	}
</style>
