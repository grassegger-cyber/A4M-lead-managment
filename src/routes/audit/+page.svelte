<script lang="ts">
	/** Read-only audit log: filters, server-side paging, detail of one entry. */
	import { onMount } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { call } from '$lib/api';
	import { formatDateTime, parseCzechDate } from '$lib/format';
	import { auditActionLabel, auditArea, auditAreaLabel, auditDetailLabel, auditEntityLabel } from '$lib/audit-actions';
	import Button from '$lib/components/Button.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Table from '$lib/components/Table.svelte';
	import type { Column } from '$lib/components/Table.svelte';

	interface AuditRow {
		id: number;
		at: string;
		actor_name: string | null;
		action: string;
		entity: string | null;
		entity_id: string | null;
		description: string | null;
		details: Record<string, unknown> | null;
	}

	const columns: Column<AuditRow>[] = [
		{ key: 'at', label: 'Kdy', width: '150px' },
		{ key: 'actor_name', label: 'Kdo', width: '120px' },
		{ key: 'action', label: 'Akce', width: '240px' },
		{ key: 'description', label: 'Popis', grow: true },
		{ key: 'entity_id', label: 'Záznam', width: '220px' }
	];

	let rows = $state<AuditRow[]>([]);
	let total = $state(0);
	let page = $state(1);
	let pageSize = $state(50);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let actions = $state<{ action: string; count: number }[]>([]);
	let text = $state('');
	let area = $state('');
	let action = $state('');
	let fromText = $state('');
	let toText = $state('');
	let dateErrors = $state<{ from?: string; to?: string }>({});

	let detail = $state<AuditRow | null>(null);
	let detailOpen = $state(false);

	const areaOptions = $derived(
		[...new Set(actions.map((a) => auditArea(a.action)))].sort().map((a) => ({ value: a, label: auditAreaLabel(a) }))
	);
	const actionOptions = $derived(
		actions
			.filter((a) => !area || auditArea(a.action) === area)
			.map((a) => ({ value: a.action, label: auditActionLabel(a.action) }))
			.sort((a, b) => a.label.localeCompare(b.label, 'cs'))
	);
	const areaText = $derived(areaOptions.find((o) => o.value === area)?.label ?? 'Všechny oblasti');
	const actionText = $derived(actionOptions.find((o) => o.value === action)?.label ?? 'Všechny akce');
	const filtered = $derived(!!(text.trim() || area || action || fromText.trim() || toText.trim()));

	let request = 0;
	async function load(toPage = page) {
		dateErrors = {};
		const from = fromText.trim() ? parseCzechDate(fromText) : null;
		const to = toText.trim() ? parseCzechDate(toText) : null;
		if (fromText.trim() && !from) dateErrors.from = 'Zadejte datum jako DD. MM. RRRR.';
		if (toText.trim() && !to) dateErrors.to = 'Zadejte datum jako DD. MM. RRRR.';
		if (from && to && from > to) dateErrors.to = 'Datum „do“ je dřív než datum „od“.';
		if (dateErrors.from || dateErrors.to) return;

		const mine = ++request;
		loading = true;
		try {
			const data = await call<{ rows: AuditRow[]; total: number; page: number; pageSize: number }>('audit.list', {
				page: toPage,
				pageSize,
				text: text.trim() || undefined,
				area: !action && area ? area : undefined,
				action: action || undefined,
				from: from ?? undefined,
				to: to ?? undefined
			});
			if (mine !== request) return;
			rows = data.rows;
			total = data.total;
			page = data.page;
			pageSize = data.pageSize;
			error = null;
		} catch (e) {
			if (mine !== request) return;
			error = e instanceof Error ? e.message : 'Audit se nepodařilo načíst.';
		} finally {
			if (mine === request) loading = false;
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	function loadSoon() {
		clearTimeout(timer);
		timer = setTimeout(() => load(1), 300);
	}

	function reset() {
		text = area = action = fromText = toText = '';
		load(1);
	}

	onMount(() => {
		load(1);
		call<{ action: string; count: number }[]>('audit.actions')
			.then((list) => (actions = list))
			.catch(() => {
				// The filter lists stay empty; the table itself reports load errors.
			});
		return () => clearTimeout(timer);
	});

	function show(row: AuditRow) {
		detail = row;
		detailOpen = true;
	}

	const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
	function printValue(value: unknown): string {
		if (value === null || value === undefined) return 'neurčeno';
		if (typeof value === 'boolean') return value ? 'Ano' : 'Ne';
		if (typeof value === 'object') return JSON.stringify(value, null, 2);
		return String(value);
	}
	/** A change of a value carries the old and the new one ("new" alone is a count of an import). */
	const hasValuePair = (details: Record<string, unknown>) => 'old' in details;
	/** Details other than the old/new pair, which is shown on its own. */
	function otherDetails(details: Record<string, unknown>): [string, unknown][] {
		const pair = hasValuePair(details);
		return Object.entries(details).filter(([key]) => !(pair && (key === 'old' || key === 'new')));
	}
</script>

<svelte:head><title>Audit změn · Lead management A4M</title></svelte:head>

<!-- The page fills the window: title, filters and paging stay in view, only the rows scroll. -->
<div class="page">
	<div class="page-head">
		<div class="title">
			<h1>Audit <strong>změn</strong></h1>
			<p class="sub">Jen ke čtení</p>
		</div>
	</div>

	<form
		class="toolbar"
		onsubmit={(e) => {
			e.preventDefault();
			load(1);
		}}
	>
		<label class="search">
			<Search size={18} />
			<span class="visually-hidden">Hledat</span>
			<input type="search" placeholder="Popis, záznam, klíč nastavení…" bind:value={text} oninput={loadSoon} />
		</label>
		<!-- The chips and buttons move to a second row together when the window is too narrow for one. -->
		<div class="filters">
			<label class="chip pick">
				<span class="chip-key">Oblast</span>
				<span class="chip-value" aria-hidden="true">{areaText}</span>
				<ChevronDown size={16} />
				<select
					bind:value={area}
					onchange={() => {
						action = '';
						load(1);
					}}
				>
					<option value="">Všechny oblasti</option>
					{#each areaOptions as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="chip pick">
				<span class="chip-key">Akce</span>
				<span class="chip-value" aria-hidden="true">{actionText}</span>
				<ChevronDown size={16} />
				<select bind:value={action} onchange={() => load(1)}>
					<option value="">Všechny akce</option>
					{#each actionOptions as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			<label class="chip date" class:invalid={!!dateErrors.from}>
				<span class="chip-key">Od</span>
				<input
					placeholder="DD. MM. RRRR"
					inputmode="numeric"
					bind:value={fromText}
					onchange={() => load(1)}
					aria-invalid={dateErrors.from ? true : undefined}
					aria-describedby={dateErrors.from ? 'audit-od-chyba' : undefined}
				/>
			</label>
			<label class="chip date" class:invalid={!!dateErrors.to}>
				<span class="chip-key">Do</span>
				<input
					placeholder="DD. MM. RRRR"
					inputmode="numeric"
					bind:value={toText}
					onchange={() => load(1)}
					aria-invalid={dateErrors.to ? true : undefined}
					aria-describedby={dateErrors.to ? 'audit-do-chyba' : undefined}
				/>
			</label>
			<div class="buttons">
				<Button type="submit" variant="secondary">Hledat</Button>
				{#if filtered}<Button variant="ghost" onclick={reset}>Zrušit filtry</Button>{/if}
			</div>
		</div>
	</form>

	{#if dateErrors.from || dateErrors.to}
		<!-- Date errors under the capsule; each names its field and is tied to it by aria-describedby. -->
		<div class="date-errors">
			{#if dateErrors.from}<p id="audit-od-chyba"><span class="key">Od</span> {dateErrors.from}</p>{/if}
			{#if dateErrors.to}<p id="audit-do-chyba"><span class="key">Do</span> {dateErrors.to}</p>{/if}
		</div>
	{/if}

	{#if error}
		<div class="panel panel-pad load-error" role="alert">
			<p><strong>Audit se nepodařilo načíst.</strong> {error}</p>
		</div>
	{/if}

	<div class="list">
		<Table
			{columns}
			{rows}
			rowKey="id"
			{loading}
			{page}
			{pageSize}
			{total}
			pageSizes={[50, 100, 200]}
			onPage={(p) => load(p)}
			onPageSize={(n) => {
				pageSize = n;
				load(1);
			}}
			onRowClick={show}
			caption="Záznamy auditu"
			emptyTitle={filtered ? 'Filtru neodpovídá žádný záznam' : 'Audit je prázdný'}
			emptyText={filtered ? 'Upravte nebo zrušte filtry.' : 'Záznamy přibývají s každou změnou, exportem a přihlášením.'}
			fill
			floatingPagination
		>
			{#snippet cell({ row, column, value })}
				{#if column.key === 'at'}
					<span class="num">{formatDateTime(value)}</span>
				{:else if column.key === 'action'}
					<span class="action">{auditActionLabel(row.action)}</span>
				{:else if column.key === 'entity_id'}
					<span class="entity" title={value ?? undefined}>{value ?? '—'}</span>
				{:else}
					{value ?? '—'}
				{/if}
			{/snippet}
		</Table>
	</div>
</div>

<Dialog bind:open={detailOpen} title="Záznam auditu" width="md">
	{#if detail}
		<dl class="facts">
			<dt>Kdy</dt>
			<dd class="num">{formatDateTime(detail.at)}</dd>
			<dt>Kdo</dt>
			<dd>{detail.actor_name ?? '—'}</dd>
			<dt>Akce</dt>
			<dd>{auditActionLabel(detail.action)}</dd>
			<dt>Popis</dt>
			<dd>{detail.description ?? '—'}</dd>
			<dt>Záznam</dt>
			<dd>{auditEntityLabel(detail.entity)}{detail.entity_id ? ` ${detail.entity_id}` : ''}</dd>
			{#if isObject(detail.details)}
				{#if hasValuePair(detail.details)}
					<dt>Původní hodnota</dt>
					<dd><pre>{printValue(detail.details.old)}</pre></dd>
					<dt>Nová hodnota</dt>
					<dd><pre>{printValue(detail.details.new)}</pre></dd>
				{/if}
				{#each otherDetails(detail.details) as [key, value] (key)}
					<dt>{auditDetailLabel(key)}</dt>
					<dd><pre>{printValue(value)}</pre></dd>
				{/each}
			{/if}
		</dl>
	{/if}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (detailOpen = false)}>Zavřít</Button>
	{/snippet}
</Dialog>

<style>
	/* ---------- Full-window page ---------- */
	.page {
		height: var(--page-h);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-4);
		min-width: 0;
	}
	.sub {
		color: var(--text-2);
	}
	.list {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* ---------- Toolbar: search capsule, filter chips, buttons ---------- */
	.search {
		flex: 1 1 240px;
		min-width: 200px;
		display: flex;
		align-items: center;
		gap: 10px;
		height: var(--control-h);
		padding: 0 16px;
		border: 1px solid var(--field-border);
		border-radius: var(--radius-control);
		background: var(--field-fill);
		color: var(--text-2);
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.search:hover {
		border-color: var(--field-border-hover);
	}
	.search :global(svg) {
		flex: none;
	}
	/* The ring sits on the capsule, not on the bare input inside it. */
	.search:focus-within {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
		box-shadow: 0 0 0 2px var(--accent);
	}
	.search input,
	.date input {
		min-width: 0;
		height: 40px;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--ink);
	}
	.search input {
		flex: 1;
	}
	.search input:focus-visible,
	.date input:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}
	/* Filter chips: the native select lies invisibly over the whole chip, the chip shows its value. */
	.pick {
		position: relative;
	}
	.pick .chip-value {
		max-width: 190px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pick select {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: 0;
		border-radius: inherit;
		opacity: 0;
		appearance: none;
		cursor: pointer;
	}
	.pick:has(select:focus-visible),
	.date:focus-within {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
		box-shadow: 0 0 0 2px var(--accent);
	}
	.pick select:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}
	/* Date chip: the key, then the typed date */
	.date {
		padding-right: 14px;
		cursor: text;
	}
	.date input {
		width: 104px;
	}
	.date.invalid {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	.filters {
		flex: 0 1 auto;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		min-width: 0;
	}
	.buttons {
		display: flex;
		gap: var(--space-2);
	}
	.date-errors {
		flex-shrink: 0;
		display: grid;
		gap: 2px;
		padding-left: var(--plate-pad-x);
		font-size: var(--text-small);
		font-weight: 600;
	}
	.date-errors .key {
		margin-right: 6px;
		color: var(--text-2);
	}
	.load-error {
		flex-shrink: 0;
	}

	/* ---------- Rows ---------- */
	.action {
		font-weight: 500;
	}
	.entity {
		display: inline-block;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: bottom;
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 220px;
		overflow-y: auto;
	}

	/* Narrow window: the page scrolls, the table keeps a fixed height and scrolls inside. */
	@media (max-width: 859.98px) {
		.page {
			height: auto;
		}
		.list {
			flex: none;
			height: 560px;
		}
	}
</style>
