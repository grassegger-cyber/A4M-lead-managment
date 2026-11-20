<script lang="ts">
	/**
	 * Server-side pagination controls in a glass capsule. page is 1-based.
	 * floating: thin glass with a text halo, for a capsule that lies over table rows
	 * (Table places it across the bottom edge of its plate, see floatingPagination).
	 */
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronsLeft from '@lucide/svelte/icons/chevrons-left';
	import ChevronsRight from '@lucide/svelte/icons/chevrons-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { formatNumber } from '$lib/format';

	interface Props {
		page: number;
		pageSize: number;
		total: number;
		onPage: (page: number) => void;
		/** Offer a page size choice when given together with onPageSize. */
		pageSizes?: number[];
		onPageSize?: (pageSize: number) => void;
		disabled?: boolean;
		/** Thin glass for a capsule that floats over content. */
		floating?: boolean;
	}

	let { page, pageSize, total, onPage, pageSizes, onPageSize, disabled = false, floating = false }: Props = $props();

	const uid = $props.id();
	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const to = $derived(Math.min(total, page * pageSize));

	/** Goes to the page typed into the field; anything that is not a page number is put back. */
	function jump(input: HTMLInputElement) {
		const text = input.value.replace(/\s/g, '');
		const wanted = /^\d+$/.test(text) ? Number(text) : Number.NaN;
		const target = Number.isFinite(wanted) ? Math.min(pages, Math.max(1, wanted)) : page;
		input.value = String(target);
		if (target !== page) onPage(target);
	}
</script>

<nav class="pagination" class:floating aria-label="Stránkování">
	<span class="range num">
		{formatNumber(from)}–{formatNumber(to)} z {formatNumber(total)}
	</span>
	{#if pageSizes && onPageSize}
		<label class="size">
			<span class="size-label">Na stránku</span>
			<span class="select">
				<select value={pageSize} {disabled} onchange={(e) => onPageSize(Number(e.currentTarget.value))}>
					{#each pageSizes as size (size)}<option value={size}>{size}</option>{/each}
				</select>
				<span class="arrow" aria-hidden="true"><ChevronDown size={16} /></span>
			</span>
		</label>
	{/if}
	<span class="pages">
		<button type="button" aria-label="První stránka" disabled={disabled || page <= 1} onclick={() => onPage(1)}>
			<ChevronsLeft size={18} />
		</button>
		<button type="button" aria-label="Předchozí stránka" disabled={disabled || page <= 1} onclick={() => onPage(page - 1)}>
			<ChevronLeft size={18} />
		</button>
		<label class="jump" for="page-{uid}">Strana</label>
		<input
			id="page-{uid}"
			class="num"
			type="text"
			inputmode="numeric"
			autocomplete="off"
			value={String(page)}
			disabled={disabled || pages <= 1}
			onchange={(e) => jump(e.currentTarget)}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					jump(e.currentTarget);
				}
			}}
		/>
		<span class="num">z {formatNumber(pages)}</span>
		<button type="button" aria-label="Další stránka" disabled={disabled || page >= pages} onclick={() => onPage(page + 1)}>
			<ChevronRight size={18} />
		</button>
		<button type="button" aria-label="Poslední stránka" disabled={disabled || page >= pages} onclick={() => onPage(pages)}>
			<ChevronsRight size={18} />
		</button>
	</span>
</nav>

<style>
	/* A glass capsule on the backdrop; .floating is the thin version that lies over table rows. */
	.pagination {
		--control-fill: rgb(255 255 255 / 0.42);
		--control-fill-hover: rgb(255 255 255 / 0.97);
		--control-border: var(--line-2);
		--field-fill: rgb(255 255 255 / 0.6);
		--field-border: var(--line-2);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 6px var(--space-3);
		width: fit-content;
		max-width: 100%;
		padding: 5px 5px 5px var(--space-4);
		border: 1px solid var(--glass-rim);
		border-radius: var(--radius-float);
		background: var(--glass-fill);
		-webkit-backdrop-filter: var(--glass-blur);
		backdrop-filter: var(--glass-blur);
		box-shadow: var(--glass-light), var(--glass-shadow-sm);
		color: var(--ink);
		font-size: var(--text-body);
		white-space: nowrap;
	}
	.pagination.floating {
		border-color: var(--glass-thin-rim);
		background: var(--glass-thin-fill);
		-webkit-backdrop-filter: var(--glass-thin-blur);
		backdrop-filter: var(--glass-thin-blur);
		box-shadow: var(--glass-thin-light), var(--glass-thin-shadow);
		text-shadow: var(--glass-halo);
	}
	.pages,
	.size {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.size {
		gap: 6px;
	}
	.size-label {
		color: var(--text-2);
	}
	.select {
		position: relative;
		display: inline-flex;
	}
	.arrow {
		position: absolute;
		right: 11px;
		top: 50%;
		display: flex;
		margin-top: -8px;
		pointer-events: none;
	}
	select,
	input,
	button {
		height: var(--control-h);
		margin: 0;
		border: 1px solid var(--control-border);
		color: var(--ink);
		font: inherit;
	}
	select {
		padding: 0 32px 0 14px;
		border-radius: var(--radius-control);
		background: var(--control-fill);
		font-weight: 600;
		-webkit-appearance: none;
		appearance: none;
		cursor: pointer;
	}
	input {
		width: 52px;
		padding: 0 6px;
		border-color: var(--field-border);
		border-radius: var(--radius-control);
		background: var(--field-fill);
		font-weight: 600;
		text-align: center;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		padding: 0;
		border-radius: 50%;
		background: var(--control-fill);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	select:hover:not(:disabled),
	button:hover:not(:disabled) {
		background: var(--control-fill-hover);
	}
	button:disabled,
	select:disabled,
	input:disabled {
		border-color: rgb(11 27 51 / 0.08);
		background: rgb(255 255 255 / 0.18);
		color: var(--text-disabled);
		cursor: not-allowed;
	}
	.jump {
		margin-left: var(--space-1);
	}
</style>
