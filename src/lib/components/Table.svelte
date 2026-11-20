<script lang="ts" module>
	export interface Column<Row = any> {
		/** Row property shown in the column and the sort key sent to the server. */
		key: string;
		label: string;
		sortable?: boolean;
		align?: 'left' | 'right';
		/** CSS width, e.g. '110px'. */
		width?: string;
		/**
		 * Keeps the column in view while the table scrolls sideways. Only leading columns may be
		 * pinned; give every pinned column except the last a width in px (used until the real
		 * widths are measured in the browser).
		 */
		pin?: boolean;
		/**
		 * Takes the width the other columns leave and shortens its text with an ellipsis, so the
		 * table fits its container for as long as this column keeps its minimum width.
		 */
		grow?: boolean;
		/** Plain text formatter when no cell snippet is given. */
		format?: (value: any, row: Row) => string;
	}
	export interface Sort {
		key: string;
		dir: 'asc' | 'desc';
	}
</script>

<script lang="ts" generics="Row extends Record<string, any>">
	/**
	 * Data table for server-side paging and sorting. It never sorts or pages itself:
	 * it reports the wanted sort and page, the parent loads the rows.
	 * The rows sit on a plate; the paging is a glass capsule under it, or across its bottom edge
	 * with floatingPagination.
	 */
	import type { Snippet } from 'svelte';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import Pagination from './Pagination.svelte';
	import EmptyState from './EmptyState.svelte';

	interface Props {
		columns: Column<Row>[];
		rows: Row[];
		/** Unique key of a row: property name or function. */
		rowKey: keyof Row | ((row: Row) => string | number);
		sort?: Sort | null;
		onSort?: (sort: Sort) => void;
		loading?: boolean;
		/** Custom cell content. Falls back to column.format or the raw value. */
		cell?: Snippet<[{ row: Row; column: Column<Row>; value: any }]>;
		onRowClick?: (row: Row) => void;
		/** Pagination (all four needed to show the paging). */
		page?: number;
		pageSize?: number;
		total?: number;
		onPage?: (page: number) => void;
		pageSizes?: number[];
		onPageSize?: (pageSize: number) => void;
		emptyTitle?: string;
		emptyText?: string;
		/** Accessible name of the table. */
		caption?: string;
		/** Keeps the header visible while the rows scroll. */
		stickyHeader?: boolean;
		/**
		 * Fills the height of the parent (a flex column with a set height): the rows scroll inside
		 * the table and the paging stays in view. Without it the rows scroll within maxHeight.
		 */
		fill?: boolean;
		/** CSS max-height of the scrolling area when the table does not fill its parent. */
		maxHeight?: string;
		/** Key of the row shown as selected (e.g. the one open in a detail panel). */
		activeKey?: string | number | null;
		/**
		 * The paging capsule floats across the bottom edge of the plate (thin glass) and the last
		 * rows scroll out from under it. The capsule hangs var(--pag-overhang) below the plate,
		 * inside the table's own box.
		 */
		floatingPagination?: boolean;
	}

	let {
		columns,
		rows,
		rowKey,
		sort = null,
		onSort,
		loading = false,
		cell,
		onRowClick,
		page,
		pageSize,
		total,
		onPage,
		pageSizes,
		onPageSize,
		emptyTitle = 'Žádné záznamy',
		emptyText,
		caption,
		stickyHeader = true,
		fill = false,
		maxHeight = 'calc(100vh - 280px)',
		activeKey = null,
		floatingPagination = false
	}: Props = $props();

	// Real widths of the header cells, so a pinned column sits exactly beside the one before it.
	let headRow: HTMLTableRowElement | undefined = $state();
	let measured = $state<number[]>([]);
	$effect(() => {
		const row = headRow;
		if (!row || !columns.some((c) => c.pin) || typeof ResizeObserver === 'undefined') return;
		const measure = () => {
			measured = Array.from(row.cells, (cell) => cell.getBoundingClientRect().width);
		};
		const observer = new ResizeObserver(measure);
		for (const cell of row.cells) observer.observe(cell);
		measure();
		return () => observer.disconnect();
	});

	/** Left offset of each pinned column: the widths of the pinned columns before it. */
	const pinLeft = $derived.by(() => {
		const offsets: (number | null)[] = [];
		let left = 0;
		let open = true;
		columns.forEach((column, index) => {
			if (open && column.pin) {
				offsets.push(left);
				const declared = /^(\d+(?:\.\d+)?)px$/.exec(column.width ?? '');
				const width = measured[index] ?? (declared ? Number(declared[1]) : null);
				if (width === null) open = false; // width unknown: nothing after this column can be pinned
				else left += width;
			} else {
				open = false;
				offsets.push(null);
			}
		});
		return offsets;
	});
	const lastPinned = $derived(pinLeft.reduce((last, left, index) => (left === null ? last : index), -1));

	const paged = $derived(page !== undefined && pageSize !== undefined && total !== undefined && !!onPage);
	const floating = $derived(floatingPagination && paged);
	// Height of the paging capsule (it grows when its items wrap), so the rows can scroll out from under it.
	let pagingHeight = $state(0);

	function keyOf(row: Row): string | number {
		return typeof rowKey === 'function' ? rowKey(row) : (row[rowKey] as string | number);
	}

	function toggleSort(column: Column<Row>) {
		if (!column.sortable || !onSort) return;
		const dir = sort?.key === column.key && sort.dir === 'asc' ? 'desc' : 'asc';
		onSort({ key: column.key, dir });
	}

	function ariaSort(column: Column<Row>): 'ascending' | 'descending' | 'none' | undefined {
		if (!column.sortable) return undefined;
		if (sort?.key !== column.key) return 'none';
		return sort.dir === 'asc' ? 'ascending' : 'descending';
	}

	function text(column: Column<Row>, row: Row): string {
		const value = row[column.key];
		if (column.format) return column.format(value, row);
		if (value === null || value === undefined || value === '') return '—';
		return String(value);
	}
</script>

<div
	class="table-wrap"
	class:loading
	class:fill
	class:floating
	class:empty={rows.length === 0}
	aria-busy={loading || undefined}
	style:--pag-h={floating && pagingHeight ? `${pagingHeight}px` : undefined}
>
	<div class="plate">
		<div class="scroll" style:max-height={fill ? undefined : maxHeight}>
			<table>
				{#if caption}<caption class="visually-hidden">{caption}</caption>{/if}
				<thead class:sticky={stickyHeader}>
					<tr bind:this={headRow}>
						{#each columns as column, index (column.key)}
							<th
								scope="col"
								class:right={column.align === 'right'}
								class:pinned={pinLeft[index] !== null}
								class:pin-edge={index === lastPinned}
								class:grow={column.grow}
								style:width={column.width}
								style:min-width={column.width}
								style:left={pinLeft[index] !== null ? `${pinLeft[index]}px` : undefined}
								aria-sort={ariaSort(column)}
							>
								{#if column.sortable && onSort}
									<button type="button" class="sort" class:active={sort?.key === column.key} onclick={() => toggleSort(column)}>
										<span>{column.label}</span>
										{#if sort?.key === column.key}
											{#if sort.dir === 'asc'}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
										{:else}
											<ChevronsUpDown size={14} class="idle" />
										{/if}
									</button>
								{:else}
									{column.label}
								{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row (keyOf(row))}
						<tr
							class:clickable={!!onRowClick}
							class:active={activeKey !== null && keyOf(row) === activeKey}
							aria-current={activeKey !== null && keyOf(row) === activeKey ? 'true' : undefined}
							onclick={onRowClick ? () => onRowClick(row) : undefined}
							onkeydown={onRowClick
								? (e) => {
										if (e.key === 'Enter') onRowClick(row);
									}
								: undefined}
							tabindex={onRowClick ? 0 : undefined}
						>
							{#each columns as column, index (column.key)}
								<td
									class:right={column.align === 'right'}
									class:pinned={pinLeft[index] !== null}
									class:pin-edge={index === lastPinned}
									class:grow={column.grow}
									style:left={pinLeft[index] !== null ? `${pinLeft[index]}px` : undefined}
								>
									{#if cell}{@render cell({ row, column, value: row[column.key] })}{:else}{text(column, row)}{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if rows.length === 0}
			<div class="none">
				{#if loading}
					<p class="loading-text">Načítám…</p>
				{:else}
					<EmptyState title={emptyTitle} text={emptyText} />
				{/if}
			</div>
		{/if}
	</div>
	{#if page !== undefined && pageSize !== undefined && total !== undefined && onPage}
		<div class="paging" bind:offsetHeight={pagingHeight}>
			<Pagination {page} {pageSize} {total} {onPage} {pageSizes} {onPageSize} disabled={loading} {floating} />
		</div>
	{/if}
</div>

<style>
	.table-wrap {
		min-width: 0;
	}
	/* Fills a flex-column parent: the rows scroll inside, the paging stays at the bottom. */
	.table-wrap.fill {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}
	.plate {
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
		background: var(--plate-fill-table);
	}
	.fill .plate {
		flex: 1 1 auto;
		min-height: 0;
	}
	/* The scroll box scrolls in both directions, so the sticky header, the pinned columns and the
	   horizontal scrollbar all stay within reach. */
	.scroll {
		overflow: auto;
	}
	.fill .scroll {
		flex: 1 1 auto;
		min-height: 0;
	}
	/* Without rows the header keeps its own height and the empty state follows right under it. */
	.fill.empty .scroll {
		flex: 0 0 auto;
	}

	/* Paging under the plate (default) or across its bottom edge (floating): the plate ends
	   --pag-overhang above the bottom of the table box and the capsule sits on that bottom, so
	   the last rows scroll out from under it. */
	.paging {
		flex: none;
		display: flex;
		justify-content: center;
		margin-top: var(--space-3);
	}
	.floating {
		position: relative;
		padding-bottom: var(--pag-overhang);
	}
	.floating .scroll {
		padding-bottom: calc(var(--pag-h) - var(--pag-overhang) + var(--space-2));
	}
	.floating.empty .scroll {
		padding-bottom: 0;
	}
	.floating .none {
		padding-bottom: calc(var(--pag-h) - var(--pag-overhang));
	}
	.floating .paging {
		position: absolute;
		left: var(--space-2);
		right: var(--space-2);
		bottom: 0;
		z-index: calc(var(--z-sticky) + 2);
		margin: 0;
		pointer-events: none;
	}
	.floating .paging > :global(*) {
		pointer-events: auto;
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-body);
	}
	thead.sticky th {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
	}
	th {
		height: var(--control-h);
		padding: 0 var(--cell-x);
		background: var(--row-bg);
		box-shadow: inset 0 -1px 0 var(--line-strong);
		color: var(--text-2);
		font-size: var(--text-caps);
		font-weight: 600;
		line-height: 1.2;
		text-align: left;
		/* A long label breaks into two lines instead of widening its column. */
		white-space: normal;
	}
	th[aria-sort='ascending'],
	th[aria-sort='descending'] {
		color: var(--ink);
	}
	/* The growing column takes what is left; its cells never widen it (ellipsis). */
	th.grow {
		width: 100%;
		min-width: 200px;
	}
	td.grow {
		max-width: 0;
	}
	th:first-child,
	td:first-child {
		padding-left: var(--cell-edge);
	}
	th:last-child,
	td:last-child {
		padding-right: var(--cell-edge);
	}
	td {
		height: var(--row-h);
		padding: 0 var(--cell-x);
		border-bottom: 1px solid var(--line);
		background: var(--row-bg);
		vertical-align: middle;
		white-space: nowrap;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	/* Pinned columns stay at the left edge while the others scroll under them. */
	.pinned {
		position: sticky;
		z-index: 1;
	}
	thead.sticky th.pinned {
		z-index: calc(var(--z-sticky) + 1);
	}
	td.pin-edge {
		box-shadow: inset -1px 0 0 var(--line-2);
	}
	th.pin-edge {
		box-shadow:
			inset 0 -1px 0 var(--line-strong),
			inset -1px 0 0 var(--line-2);
	}
	.right {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tbody tr:hover td {
		background: var(--row-hover);
	}
	/* Selected row: yellow tint */
	tbody tr.active td {
		background: var(--row-selected);
	}
	tbody tr.active:hover td {
		background: var(--row-selected-hover);
	}
	tbody tr.clickable {
		cursor: pointer;
	}
	/* Keyboard focus on a row: the ring is drawn on its cells (pinned cells would cover an outline). */
	tbody tr.clickable:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}
	tbody tr.clickable:focus-visible td {
		background: var(--row-hover);
		box-shadow:
			inset 0 2px 0 var(--ink),
			inset 0 -2px 0 var(--ink),
			inset 0 4px 0 var(--accent),
			inset 0 -4px 0 var(--accent);
	}
	tbody tr.clickable.active:focus-visible td {
		background: var(--row-selected);
	}
	tbody tr.clickable:focus-visible td:first-child {
		box-shadow:
			inset 2px 0 0 var(--ink),
			inset 0 2px 0 var(--ink),
			inset 0 -2px 0 var(--ink),
			inset 4px 0 0 var(--accent),
			inset 0 4px 0 var(--accent),
			inset 0 -4px 0 var(--accent);
	}
	tbody tr.clickable:focus-visible td:last-child {
		box-shadow:
			inset -2px 0 0 var(--ink),
			inset 0 2px 0 var(--ink),
			inset 0 -2px 0 var(--ink),
			inset -4px 0 0 var(--accent),
			inset 0 4px 0 var(--accent),
			inset 0 -4px 0 var(--accent);
	}
	.sort {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: var(--control-h);
		margin: 0 -6px;
		padding: 0 6px;
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		font: inherit;
		color: inherit;
		text-align: inherit;
	}
	.sort:hover,
	.sort.active {
		color: var(--ink);
	}
	.sort :global(.idle) {
		color: var(--icon-quiet);
	}
	.right .sort {
		flex-direction: row-reverse;
	}
	/* The header touches the top edge of the scroll box: keep the focus ring inside the button. */
	.sort:focus-visible {
		outline-offset: -2px;
		box-shadow: inset 0 0 0 4px var(--accent) !important;
	}
	.loading tbody {
		opacity: 0.5;
	}
	.loading-text {
		padding: var(--space-5) var(--cell-edge);
		color: var(--text-2);
	}
</style>
