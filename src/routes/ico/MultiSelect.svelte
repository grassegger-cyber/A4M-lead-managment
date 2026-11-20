<script lang="ts">
	/**
	 * Filter control for choosing several values: a button showing the choice and a list of
	 * checkboxes under it. Local to the IČO list (the shared Select is single-value).
	 */
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	export interface Option {
		value: string;
		label: string;
	}

	interface Props {
		label: string;
		options: Option[];
		value: string[];
		/** Text of the button when nothing is chosen. */
		placeholder?: string;
		/** Shows a quick search above the list (long lists such as districts). */
		searchable?: boolean;
		disabled?: boolean;
		/** Hides the label visually (it stays for screen readers). */
		hideLabel?: boolean;
		/** Fixed text of the button instead of the summary of the choice (e.g. "Sloupce"). */
		text?: string;
		/** Opens the list to the left of the button (for a control at the right edge). */
		alignRight?: boolean;
		/**
		 * field = label above a capsule (filter panel), chip = a filter chip with the label inside
		 * (toolbar and head).
		 */
		variant?: 'field' | 'chip';
		onchange?: (value: string[]) => void;
	}

	let {
		label,
		options,
		value = $bindable([]),
		placeholder = 'Vše',
		searchable = false,
		disabled = false,
		hideLabel = false,
		text,
		alignRight = false,
		variant = 'field',
		onchange
	}: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	let needle = $state('');
	let root: HTMLDivElement | undefined = $state();

	const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
	const visible = $derived(needle.trim() ? options.filter((o) => fold(o.label).includes(fold(needle.trim()))) : options);
	const summary = $derived.by(() => {
		if (text !== undefined) return text;
		if (!value.length) return placeholder;
		const first = options.find((o) => o.value === value[0])?.label ?? value[0];
		return value.length === 1 ? first : `${first} +${value.length - 1}`;
	});
	const chosen = $derived(value.length > 0 && text === undefined);

	function toggle(option: string, checked: boolean) {
		value = checked ? [...value.filter((v) => v !== option), option] : value.filter((v) => v !== option);
		onchange?.(value);
	}

	function clear() {
		value = [];
		onchange?.(value);
	}

	function close(focusButton = false) {
		open = false;
		needle = '';
		if (focusButton) root?.querySelector<HTMLButtonElement>('button.control')?.focus();
	}
</script>

<svelte:document
	onpointerdown={(e) => {
		if (open && root && !root.contains(e.target as Node)) close();
	}}
/>

<div
	class="multi multi-{variant}"
	bind:this={root}
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) {
			e.stopPropagation();
			close(true);
		}
	}}
	role="presentation"
>
	{#if variant === 'chip'}
		<button
			type="button"
			class="control chip"
			class:chosen
			aria-haspopup="true"
			aria-expanded={open}
			aria-labelledby="ms-label-{uid} ms-value-{uid}"
			{disabled}
			onclick={() => (open ? close() : (open = true))}
		>
			<span class="chip-key" class:visually-hidden={hideLabel} id="ms-label-{uid}">{label}</span>
			<span class="chip-value summary" id="ms-value-{uid}">{summary}</span>
			<ChevronDown size={16} />
		</button>
	{:else}
		<span class="label" class:visually-hidden={hideLabel} id="ms-label-{uid}">{label}</span>
		<button
			type="button"
			class="control field-control"
			class:chosen
			aria-haspopup="true"
			aria-expanded={open}
			aria-labelledby="ms-label-{uid} ms-value-{uid}"
			{disabled}
			onclick={() => (open ? close() : (open = true))}
		>
			<span class="summary" id="ms-value-{uid}">{summary}</span>
			<ChevronDown size={16} />
		</button>
	{/if}
	{#if open}
		<div class="pop" class:right={alignRight} role="group" aria-labelledby="ms-label-{uid}">
			{#if searchable}
				<input class="needle" type="search" placeholder="Hledat…" aria-label="Hledat v seznamu" bind:value={needle} />
			{/if}
			<ul>
				{#each visible as option (option.value)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={value.includes(option.value)}
								onchange={(e) => toggle(option.value, e.currentTarget.checked)}
							/>
							<span>{option.label}</span>
						</label>
					</li>
				{:else}
					<li class="none">Nic nenalezeno</li>
				{/each}
			</ul>
			<div class="foot">
				<button type="button" class="link" onclick={clear} disabled={!value.length}>Zrušit výběr</button>
				<button type="button" class="link" onclick={() => close(true)}>Hotovo</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.multi {
		position: relative;
		min-width: 0;
	}
	.multi-field {
		display: grid;
		gap: 6px;
	}
	.multi-chip {
		display: inline-flex;
		flex: none;
	}

	/* Label above the capsule, as on the shared Field */
	.label {
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--text-2);
	}

	/* Field: a capsule like the shared Select; fill and hairline follow the surface. */
	.field-control {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		height: var(--control-h);
		margin: 0;
		padding: 0 14px 0 16px;
		border: 1px solid var(--field-border);
		border-radius: var(--radius-control);
		background: var(--field-fill);
		color: var(--text-2);
		text-align: left;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.field-control:hover:not(:disabled) {
		border-color: var(--field-border-hover);
	}
	.field-control.chosen {
		border-color: var(--field-border-hover);
		color: var(--ink);
		font-weight: 600;
	}
	.field-control:disabled {
		background: rgb(11 27 51 / 0.04);
		border-color: var(--line-2);
		color: var(--text-disabled);
		cursor: not-allowed;
	}
	.field-control :global(svg) {
		flex: none;
		color: var(--ink);
	}

	/* Chip: the shared .chip capsule; an active filter is the brighter capsule with a firmer edge. */
	.chip.chosen {
		background: var(--control-fill-hover);
		border-color: var(--line-tag);
	}
	.chip :global(svg) {
		flex: none;
	}
	.summary {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip .summary {
		max-width: 220px;
	}

	/* List of choices: a solid sheet lying over everything below. */
	.pop {
		--field-fill: #ffffff;
		--field-border: var(--line-field);
		--text-2: var(--text-2-plate);
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: var(--z-nav);
		min-width: max(100%, 260px);
		max-width: 360px;
		background: #ffffff;
		border-radius: var(--radius-sheet);
		box-shadow:
			0 0 0 1px rgb(11 27 51 / 0.08),
			var(--pop-shadow);
		color: var(--ink);
		font-weight: 400;
		overflow: hidden;
	}
	.pop.right {
		left: auto;
		right: 0;
	}
	.needle {
		display: block;
		width: calc(100% - 16px);
		height: var(--control-h);
		margin: 8px 8px 0;
		padding: 0 16px;
		border: 1px solid var(--field-border);
		border-radius: var(--radius-control);
		background: var(--field-fill);
		color: var(--ink);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: var(--space-1);
		max-height: 280px;
		overflow: auto;
	}
	label {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: var(--control-h);
		padding: 0 12px;
		border-radius: 12px;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	label:hover {
		background: var(--row-hover);
	}
	input[type='checkbox'] {
		flex: none;
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--ink);
	}
	.none {
		padding: 12px;
		color: var(--text-2);
	}
	.foot {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1);
		border-top: 1px solid var(--line);
	}
	.link {
		height: var(--control-h);
		padding: 0 14px;
		border: 0;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-small);
		font-weight: 600;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.link:hover:not(:disabled) {
		background: rgb(11 27 51 / 0.06);
	}
	.link:disabled {
		color: var(--text-disabled);
		cursor: default;
	}
</style>
