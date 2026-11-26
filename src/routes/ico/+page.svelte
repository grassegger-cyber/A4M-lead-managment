<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Download from '@lucide/svelte/icons/download';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { call } from '$lib/api';
	import { buildWorkbook, saveBlob } from '$lib/excel/write';
	import type { SheetColumn } from '$lib/excel/write';
	import {
		CHANNELS,
		CHANNEL_LABELS,
		HOLDER_LABELS,
		holderDetail,
		HOLDER_TYPES,
		OPERATORS,
		OPERATOR_LABELS,
		STATES,
		STATE_LABELS,
		SUBJECT_TYPES,
		SUBJECT_TYPE_LABELS
	} from '$lib/states';
	import type { Channel, HolderType, Operator, SubjectType } from '$lib/states';
	import { REGIONS } from '$lib/regions';
	import { normalizeIco } from '$lib/ico';
	import { formatDate, formatNumber, formatPhone } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Field from '$lib/components/Field.svelte';
	import Select from '$lib/components/Select.svelte';
	import Table from '$lib/components/Table.svelte';
	import type { Column, Sort } from '$lib/components/Table.svelte';
	import StateDot from '$lib/components/StateDot.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import MultiSelect from './MultiSelect.svelte';
	import DateInput from './DateInput.svelte';
	import IcoDetail from './IcoDetail.svelte';
	import { MORE_FILTER_KEYS, NONE, countActive, emptyState, parseQuery, toApiArgs, toQuery } from './filters';
	import type { ListState } from './filters';

	interface Row {
		ico: string;
		name: string | null;
		subject_type: string | null;
		state: string;
		holder_type: string;
		holder_login: string | null;
		region_name: string | null;
		district_name: string | null;
		sales_rep_name: string | null;
		cohort_code: string | null;
		channel: string | null;
		ownership_ends_on: string | null;
		return_on: string | null;
		quarantine_until: string | null;
		never_return: boolean;
		rounds_count: number;
		primary_phone: string | null;
		operators: string[];
		phone_count: number;
	}
	interface ListResult {
		rows: Row[];
		total: number;
		page: number;
		pageSize: number;
	}
	interface Options {
		reps: { id: number; name: string; siebel_login: string | null; active: boolean }[];
		cohorts: { id: number; code: string }[];
		holderLogins: { holder_type: string; holder_login: string; count: number }[];
		maxPageSize: number;
	}

	/** URL parameter naming the IČO whose detail is open next to the list. */
	const DETAIL_PARAM = 'detail';
	/** Narrower than this the detail does not fit beside the list and opens as a page. */
	const SPLIT_MIN_WIDTH = 1180;
	const COLUMNS_STORAGE_KEY = 'ico-list-columns';

	let form = $state<ListState>(parseQuery(page.url.searchParams));
	let result = $state<ListResult | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let options = $state<Options | null>(null);
	let showMore = $state(countActive(parseQuery(page.url.searchParams), MORE_FILTER_KEYS) > 0);
	let exportOpen = $state(false);

	let controller: AbortController | null = null;
	let lastNavigated: string | null = null;
	let lastLoaded: string | null = null;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	const activeCount = $derived(countActive(form));
	const moreCount = $derived(countActive(form, MORE_FILTER_KEYS));
	const sort = $derived<Sort>({ key: form.sortKey, dir: form.sortDir });
	const pageSizes = $derived([25, 50, 100, 200].filter((n) => n <= (options?.maxPageSize ?? 200)));
	const detailIco = $derived(normalizeIco(page.url.searchParams.get(DETAIL_PARAM) ?? '') ?? '');

	const stateOptions = STATES.map((value) => ({ value, label: STATE_LABELS[value] }));
	const holderOptions = HOLDER_TYPES.map((value) => ({ value, label: HOLDER_LABELS[value] }));
	const subjectOptions = [
		...SUBJECT_TYPES.map((value) => ({ value, label: `${value} · ${SUBJECT_TYPE_LABELS[value]}` })),
		{ value: NONE, label: 'Neurčeno' }
	];
	const regionOptions = [...REGIONS.map((r) => ({ value: r.code, label: r.name })), { value: NONE, label: 'Bez kraje' }];
	const operatorOptions = [
		...OPERATORS.map((value) => ({ value, label: OPERATOR_LABELS[value] })),
		{ value: NONE, label: 'Neověřeno' }
	];
	const channelOptions = [
		...CHANNELS.map((value) => ({ value, label: CHANNEL_LABELS[value] })),
		{ value: NONE, label: 'Bez kanálu' }
	];
	const districtOptions = $derived(
		REGIONS.filter((r) => !form.regionCode.filter((c) => c !== NONE).length || form.regionCode.includes(r.code))
			.flatMap((r) => r.districts.map((d) => ({ value: d.code, label: d.name })))
			.sort((a, b) => a.label.localeCompare(b.label, 'cs'))
	);
	const cohortOptions = $derived([
		...(options?.cohorts ?? []).map((c) => ({ value: String(c.id), label: c.code })),
		{ value: NONE, label: 'Bez dávky' }
	]);
	const repOptions = $derived([
		...(options?.reps ?? []).map((r) => ({ value: String(r.id), label: r.active ? r.name : `${r.name} (neaktivní)` })),
		{ value: NONE, label: 'Bez OZ' }
	]);
	const loginOptions = $derived(
		(options?.holderLogins ?? []).map((h) => ({
			value: h.holder_login,
			label: `${h.holder_login} · ${HOLDER_LABELS[h.holder_type as HolderType] ?? h.holder_type} (${formatNumber(h.count)})`
		}))
	);

	// IČO and name are always shown and stay in view. The other columns can be switched on and
	// off; the default set fits a laptop screen, everything else is in the detail and the export.
	const FIXED_COLUMNS: Column<Row>[] = [
		{ key: 'ico', label: 'IČO', sortable: true, width: '108px', pin: true },
		{ key: 'name', label: 'Název', sortable: true, pin: true, grow: true }
	];
	const OPTIONAL_COLUMNS: (Column<Row> & { on: boolean })[] = [
		{ key: 'state', label: 'Stav', sortable: true, on: true },
		{ key: 'holder_type', label: 'Držitel', sortable: true, on: true },
		{ key: 'sales_rep_name', label: 'Přiřazený OZ', on: false },
		{ key: 'ownership_ends_on', label: 'Konec vlastnictví', sortable: true, on: true },
		{ key: 'return_on', label: 'Návrat', sortable: true, on: true },
		{ key: 'quarantine_until', label: 'Karanténa do', sortable: true, on: true },
		{ key: 'primary_phone', label: 'Telefon', on: true },
		{ key: 'operators', label: 'Operátor', on: false },
		{ key: 'cohort_code', label: 'Dávka', on: false },
		{ key: 'channel', label: 'Kanál', sortable: true, on: false },
		{ key: 'rounds_count', label: 'Kol', sortable: true, align: 'right', on: false },
		{ key: 'region_name', label: 'Kraj', sortable: true, on: false },
		{ key: 'district_name', label: 'Okres', sortable: true, on: false }
	];
	const columnOptions = OPTIONAL_COLUMNS.map((c) => ({ value: c.key, label: c.label }));
	let shownColumns = $state<string[]>(OPTIONAL_COLUMNS.filter((c) => c.on).map((c) => c.key));
	// With the detail open the list keeps only what identifies the row.
	const columns = $derived<Column<Row>[]>([
		...FIXED_COLUMNS,
		...OPTIONAL_COLUMNS.filter((c) => (detailIco ? c.key === 'state' : shownColumns.includes(c.key)))
	]);

	$effect(() => {
		// The choice of columns is a preference of this browser, not part of the link.
		try {
			const stored = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) ?? 'null');
			if (Array.isArray(stored)) shownColumns = OPTIONAL_COLUMNS.map((c) => c.key).filter((key) => stored.includes(key));
		} catch {
			// storage unavailable or damaged: the default columns stay
		}
	});

	function saveColumns() {
		try {
			localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(shownColumns));
		} catch {
			// storage unavailable: the choice lasts until the page is left
		}
	}

	// The URL drives the list: every change of the filter part of the query string reloads the rows.
	$effect(() => {
		const fromUrl = parseQuery(page.url.searchParams);
		const query = toQuery(fromUrl);
		untrack(() => {
			// Do not overwrite what the user is typing with the state we navigated to ourselves.
			if (query !== lastNavigated) {
				form = fromUrl;
				if (countActive(fromUrl, MORE_FILTER_KEYS) > 0) showMore = true;
			}
			lastNavigated = query;
			// Opening or closing the detail changes the URL too, but not the list.
			if (query !== lastLoaded) {
				lastLoaded = query;
				load(fromUrl);
			}
			try {
				sessionStorage.setItem('ico-list-url', query ? `/ico?${query}` : '/ico');
			} catch {
				// storage unavailable: the detail page links to the plain list
			}
		});
	});

	$effect(() => {
		call<Options>('companies.filterOptions')
			.then((o) => (options = o))
			.catch((e) => toast.error(e instanceof Error ? e.message : 'Hodnoty filtrů se nepodařilo načíst.'));
		return () => {
			controller?.abort();
			clearTimeout(searchTimer);
		};
	});

	async function load(state: ListState) {
		controller?.abort();
		const current = (controller = new AbortController());
		loading = true;
		try {
			const data = await call<ListResult>('companies.list', toApiArgs(state), { signal: current.signal });
			if (current.signal.aborted) return;
			result = data;
			error = null;
		} catch (e) {
			if (current.signal.aborted || (e as Error)?.name === 'AbortError') return;
			error = e instanceof Error ? e.message : 'Seznam se nepodařilo načíst.';
		} finally {
			if (controller === current) loading = false;
		}
	}

	/** Address of the list for a filter query, keeping (or changing) the open detail. */
	function listUrl(query: string, detail: string = detailIco): string {
		const params = new URLSearchParams(query);
		if (detail) params.set(DETAIL_PARAM, detail);
		const text = params.toString().replace(/%2C/g, ',');
		return text ? `/ico?${text}` : '/ico';
	}

	/** Writes the form to the URL; the effect above then loads the data. */
	function apply({ keepPage = false, replace = false } = {}) {
		clearTimeout(searchTimer);
		if (!keepPage) form.page = 1;
		const query = toQuery(form);
		lastNavigated = query;
		goto(listUrl(query), { replaceState: replace, keepFocus: true, noScroll: true });
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => apply({ replace: true }), 300);
	}

	function reset() {
		const fresh = emptyState();
		fresh.pageSize = form.pageSize;
		fresh.sortKey = form.sortKey;
		fresh.sortDir = form.sortDir;
		form = fresh;
		apply();
	}

	function onRegionChange() {
		// Keep only districts that belong to the chosen regions.
		const allowed = new Set(districtOptions.map((d) => d.value));
		form.districtCode = form.districtCode.filter((code) => allowed.has(code));
		apply();
	}

	async function runExport() {
		// Step 1 writes the audit row; the rows are handed out only for that logged export.
		const args = toApiArgs(form);
		const start = await call<{ exportId: number; filename: string; sheetName: string; columns: SheetColumn[] }>('companies.exportStart', args);
		const rows: Record<string, unknown>[] = [];
		let after = '';
		for (;;) {
			const part = await call<{ rows: Record<string, unknown>[]; last: string; done: boolean }>('companies.exportRows', {
				...args,
				exportId: start.exportId,
				after
			});
			rows.push(...part.rows);
			after = part.last;
			if (part.done) break;
		}
		saveBlob(await buildWorkbook([{ name: start.sheetName, columns: start.columns, rows }]), start.filename);
		toast.success(`Export je stažený: ${start.filename}`);
	}

	/** Opens the detail next to the list; on a narrow window, where it would not fit, as a page. */
	function openDetail(ico: string) {
		if (window.innerWidth < SPLIT_MIN_WIDTH) {
			goto(`/ico/${ico}`);
			return;
		}
		// Replace while a detail is open, so "back" leaves the detail instead of walking through every row.
		goto(listUrl(toQuery(parseQuery(page.url.searchParams)), ico), { keepFocus: true, noScroll: true, replaceState: !!detailIco });
	}

	function closeDetail() {
		goto(listUrl(toQuery(parseQuery(page.url.searchParams)), ''), { keepFocus: true, noScroll: true });
	}

	function operatorsText(row: Row): string {
		if (!row.phone_count) return '—';
		const labels = row.operators.map((op) => OPERATOR_LABELS[op as Operator] ?? 'Neověřeno');
		return [...new Set(labels)].join(', ');
	}
</script>

<svelte:head><title>Seznam IČO · Lead management A4M</title></svelte:head>

<svelte:window
	onkeydown={(e) => {
		// Esc closes the detail, unless a dialog or an open list of choices handles the key itself.
		if (e.key === 'Escape' && detailIco && !e.defaultPrevented && !document.querySelector('dialog[open]')) closeDetail();
	}}
/>

<div class="list-page" class:split={!!detailIco}>
	<div class="page-head head">
		<div class="title">
			<div class="title-row">
				<h1>Seznam <strong>IČO</strong></h1>
				<p class="count" aria-live="polite">
					{#if result}
						<strong class="num">{formatNumber(result.total)}</strong> IČO {activeCount ? 'odpovídá filtru' : 'celkem'}{#if activeCount}<span>&nbsp;· aktivní filtry: {activeCount}</span>{/if}
					{:else if !error}
						<span>Načítám…</span>
					{/if}
				</p>
			</div>
		</div>
		<div class="actions">
			{#if !detailIco}
				<MultiSelect
					variant="chip"
					label="Zobrazené sloupce"
					hideLabel
					alignRight
					text={`Sloupce (${shownColumns.length + FIXED_COLUMNS.length})`}
					options={columnOptions}
					bind:value={shownColumns}
					onchange={saveColumns}
				/>
			{/if}
			<Button variant="secondary" onclick={() => (exportOpen = true)} disabled={!result || result.total === 0}>
				<Download size={18} /> Export do Excelu
			</Button>
		</div>
	</div>

	<form
		class="filters"
		onsubmit={(e) => {
			e.preventDefault();
			apply();
		}}
	>
		<div class="toolbar">
			<label class="search">
				<Search size={18} />
				<span class="visually-hidden">Hledat</span>
				<input
					type="search"
					placeholder="IČO, název nebo telefon"
					autocomplete="off"
					bind:value={form.q}
					oninput={onSearchInput}
				/>
			</label>
			<MultiSelect variant="chip" label="Stav" options={stateOptions} bind:value={form.state} onchange={() => apply()} />
			<MultiSelect variant="chip" label="Typ subjektu" options={subjectOptions} bind:value={form.subjectType} onchange={() => apply()} />
			<MultiSelect variant="chip" label="Držitel" options={holderOptions} bind:value={form.holderType} onchange={() => apply()} />
			<Button variant="secondary" aria-expanded={showMore} aria-controls="more-filters" onclick={() => (showMore = !showMore)}>
				<SlidersHorizontal size={18} />
				{showMore ? 'Méně filtrů' : 'Další filtry'}{#if moreCount}<span class="badge">{moreCount}</span>{/if}
			</Button>
			<Button variant="ghost" onclick={reset} disabled={activeCount === 0}>Zrušit filtry</Button>
		</div>

		{#if showMore}
			<div class="more glass" id="more-filters">
				<Select
					label="Login držitele"
					placeholder="Vše"
					options={loginOptions}
					bind:value={form.holderLogin}
					onchange={() => apply()}
				/>
				<MultiSelect label="Přiřazený OZ" options={repOptions} bind:value={form.salesRepId} onchange={() => apply()} />
				<MultiSelect label="Dávka" options={cohortOptions} bind:value={form.cohortId} onchange={() => apply()} />
				<MultiSelect label="Kanál" options={channelOptions} bind:value={form.channel} onchange={() => apply()} />
				<MultiSelect label="Kraj" options={regionOptions} bind:value={form.regionCode} onchange={onRegionChange} />
				<MultiSelect label="Okres" options={districtOptions} searchable bind:value={form.districtCode} onchange={() => apply()} />
				<MultiSelect label="Operátor" options={operatorOptions} bind:value={form.operator} onchange={() => apply()} />
				<Select
					label="Platnost IČO"
					placeholder="Vše"
					options={[
						{ value: 'yes', label: 'Platné' },
						{ value: 'no', label: 'Neplatné' },
						{ value: 'unknown', label: 'Neověřeno' }
					]}
					bind:value={form.icoValid}
					onchange={() => apply()}
				/>
				<div class="range" role="group" aria-label="Vlastnictví od">
					<span class="range-label">Vlastnictví od</span>
					<DateInput label="Vlastnictví od: od" hideLabel placeholder="od" bind:value={form.ownedFromFrom} onchange={() => apply()} />
					<DateInput label="Vlastnictví od: do" hideLabel placeholder="do" bind:value={form.ownedFromTo} onchange={() => apply()} />
				</div>
				<div class="range" role="group" aria-label="Konec vlastnictví">
					<span class="range-label">Konec vlastnictví</span>
					<DateInput label="Konec vlastnictví: od" hideLabel placeholder="od" bind:value={form.ownershipEndsFrom} onchange={() => apply()} />
					<DateInput label="Konec vlastnictví: do" hideLabel placeholder="do" bind:value={form.ownershipEndsTo} onchange={() => apply()} />
				</div>
				<div class="range" role="group" aria-label="Datum návratu">
					<span class="range-label">Datum návratu</span>
					<DateInput label="Datum návratu: od" hideLabel placeholder="od" bind:value={form.returnOnFrom} onchange={() => apply()} />
					<DateInput label="Datum návratu: do" hideLabel placeholder="do" bind:value={form.returnOnTo} onchange={() => apply()} />
				</div>
				<div class="range" role="group" aria-label="Karanténa do">
					<span class="range-label">Karanténa do</span>
					<DateInput label="Karanténa do: od" hideLabel placeholder="od" bind:value={form.quarantineUntilFrom} onchange={() => apply()} />
					<DateInput label="Karanténa do: do" hideLabel placeholder="do" bind:value={form.quarantineUntilTo} onchange={() => apply()} />
				</div>
				<div class="range" role="group" aria-label="IČO ověřeno v ARES">
					<span class="range-label">IČO ověřeno (ARES)</span>
					<DateInput label="IČO ověřeno: od" hideLabel placeholder="od" bind:value={form.icoVerifiedFrom} onchange={() => apply()} />
					<DateInput label="IČO ověřeno: do" hideLabel placeholder="do" bind:value={form.icoVerifiedTo} onchange={() => apply()} />
				</div>
				<div class="range" role="group" aria-label="Operátor ověřen">
					<span class="range-label">Operátor ověřen</span>
					<DateInput label="Operátor ověřen: od" hideLabel placeholder="od" bind:value={form.operatorVerifiedFrom} onchange={() => apply()} />
					<DateInput label="Operátor ověřen: do" hideLabel placeholder="do" bind:value={form.operatorVerifiedTo} onchange={() => apply()} />
				</div>
				<div class="range" role="group" aria-label="Počet kol">
					<span class="range-label">Počet kol</span>
					<Field label="Počet kol: od" hideLabel placeholder="od" type="number" min="0" max="99" bind:value={form.roundsMin} onchange={() => apply()} />
					<Field label="Počet kol: do" hideLabel placeholder="do" type="number" min="0" max="99" bind:value={form.roundsMax} onchange={() => apply()} />
				</div>
				<Select
					label="Trvalé vyřazení"
					placeholder="Vše"
					options={[
						{ value: 'yes', label: 'Jen trvale vyřazená' },
						{ value: 'no', label: 'Bez trvale vyřazených' }
					]}
					bind:value={form.neverReturn}
					onchange={() => apply()}
				/>
				<p class="format-hint text-muted">Data se zadávají ve tvaru DD. MM. RRRR.</p>
			</div>
		{/if}
	</form>

	<div class="work">
		<div class="table-cell">
			{#if error}
				<div class="plate">
					<EmptyState title="Seznam se nepodařilo načíst" text={error}>
						<Button variant="secondary" onclick={() => load(form)}>Zkusit znovu</Button>
					</EmptyState>
				</div>
			{:else}
				<Table
					{columns}
					rows={result?.rows ?? []}
					rowKey="ico"
					fill
					floatingPagination
					activeKey={detailIco || null}
					{sort}
					onSort={(next) => {
						form.sortKey = next.key;
						form.sortDir = next.dir;
						apply();
					}}
					{loading}
					onRowClick={(row) => openDetail(row.ico)}
					page={result?.page ?? form.page}
					pageSize={result?.pageSize ?? form.pageSize}
					total={result?.total ?? 0}
					onPage={(next) => {
						form.page = next;
						apply({ keepPage: true });
					}}
					{pageSizes}
					onPageSize={(size) => {
						form.pageSize = size;
						apply();
					}}
					caption="Seznam IČO"
					emptyTitle={activeCount ? 'Filtru neodpovídá žádné IČO' : 'Databáze je prázdná'}
					emptyText={activeCount
						? 'Zkuste filtr uvolnit nebo zrušit.'
						: 'Nahrajte kmenový Excel na stránce Import.'}
				>
					{#snippet cell({ row, column, value })}
						{@const current = row.ico === detailIco}
						{#if column.key === 'ico'}
							<a
								class="ico num"
								class:current
								href="/ico/{row.ico}"
								onclick={(e) => {
									// A plain click opens the detail next to the list; with a modifier key the link opens the page.
									e.stopPropagation();
									if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
									e.preventDefault();
									openDetail(row.ico);
								}}>{row.ico}</a
							>
						{:else if column.key === 'name'}
							<span class="name" title={row.name ?? undefined}>
								<span class="name-text" class:current>{row.name ?? 'Bez názvu'}</span>
								{#if row.subject_type}
									<span class="tag" title={SUBJECT_TYPE_LABELS[row.subject_type as SubjectType] ?? undefined}>{row.subject_type}</span>
								{/if}
							</span>
						{:else if column.key === 'state'}
							<StateDot state={row.state} />
						{:else if column.key === 'holder_type'}
							{HOLDER_LABELS[row.holder_type as HolderType] ?? row.holder_type}{#if holderDetail(row.holder_type, row.holder_login)}<span class="text-muted">&nbsp;· {holderDetail(row.holder_type, row.holder_login)}</span>{/if}
						{:else if column.key === 'channel'}
							{#if value}{CHANNEL_LABELS[value as Channel] ?? value}{:else}<span class="none">—</span>{/if}
						{:else if column.key === 'ownership_ends_on' || column.key === 'return_on'}
							{@const text = formatDate(value)}
							<span class="num" class:none={text === '—'}>{text}</span>
						{:else if column.key === 'quarantine_until'}
							{@const text = formatDate(value)}
							{#if row.never_return}<span class="tag">Trvale</span>{:else}<span class="num" class:none={text === '—'}>{text}</span>{/if}
						{:else if column.key === 'primary_phone'}
							{@const text = formatPhone(value)}
							<span class="num" class:none={text === '—'}>{text}</span>{#if row.phone_count > 1}<span class="text-muted">&nbsp;+{row.phone_count - 1}</span>{/if}
						{:else if column.key === 'operators'}
							{@const text = operatorsText(row)}
							<span class:none={text === '—'}>{text}</span>
						{:else if column.key === 'rounds_count'}
							{formatNumber(value)}
						{:else if value === null || value === undefined || value === ''}
							<span class="none">—</span>
						{:else}
							{value}
						{/if}
					{/snippet}
				</Table>
			{/if}
		</div>

		{#if detailIco}
			<aside class="glass inspector" aria-label="Detail IČO {detailIco}">
				{#key detailIco}
					<IcoDetail ico={detailIco} embedded onchanged={() => load(form)} onclose={closeDetail} />
				{/key}
			</aside>
		{/if}
	</div>
</div>

<Confirm
	bind:open={exportOpen}
	title="Export do Excelu"
	message={`Exportovat ${formatNumber(result?.total ?? 0)} IČO ${activeCount ? 'podle aktuálního filtru' : '(celou databázi)'}? Soubor obsahuje telefony. Export se zapíše do auditu.`}
	confirmLabel="Exportovat"
	onConfirm={runExport}
/>

<style>
	/* The page fills the window: head and toolbar stay, the rows scroll inside the table plate and
	   the detail inside its sheet. */
	.list-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		height: var(--page-h);
		min-height: 560px;
	}

	/* Head: title with the count on its baseline, view and output actions on the right. Raised above
	   the toolbar and the table so the column chooser opens over them. */
	.head {
		position: relative;
		z-index: calc(var(--z-sticky) + 4);
	}
	.title {
		min-width: 0;
	}
	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-4);
	}
	.count {
		color: var(--text-2);
	}
	.count strong {
		color: var(--ink);
	}

	/* Toolbar capsule with the filters; raised above the table so the lists of choices and the
	   panel with more filters lie over the rows. */
	.filters {
		position: relative;
		z-index: calc(var(--z-sticky) + 3);
		flex-shrink: 0;
	}
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
		cursor: text;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.search:hover {
		border-color: var(--field-border-hover);
	}
	/* The ring sits on the capsule, not on the bare input inside it. */
	.search:focus-within {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
		box-shadow: 0 0 0 2px var(--accent);
	}
	.search :global(svg) {
		flex: none;
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: 40px;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--ink);
		-webkit-appearance: none;
		appearance: none;
	}
	.search input:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}
	/* The browser's clear button, drawn in the palette */
	.search input::-webkit-search-cancel-button {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		margin: 0 0 0 6px;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233d4a63' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M18 6 6 18M6 6l12 12'/%3E%3C/svg%3E")
			center / 16px no-repeat;
		cursor: pointer;
	}
	.toolbar :global(.btn[aria-expanded='true']) {
		background: var(--control-fill-hover);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--ink);
		color: var(--white);
		font-size: var(--text-caps);
		font-weight: 600;
	}

	/* More filters: a glass panel lying over the list under the toolbar. White fields, so they read
	   clearly over the rows behind the glass. */
	.more {
		--field-fill: #ffffff;
		--field-border: var(--line-field);
		--field-border-hover: rgb(11 27 51 / 0.38);
		position: absolute;
		top: calc(100% + var(--space-2));
		left: 0;
		right: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-4) var(--space-3);
		align-items: start;
		padding: var(--space-4);
		background: var(--glass-fill-strong);
		box-shadow: var(--glass-light), var(--pop-shadow);
	}
	.range {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		align-items: start;
	}
	/* Two dates side by side: a little less inner space, so a typed DD. MM. RRRR stays whole. */
	.more .range :global(.field input[type='text']) {
		padding: 0 10px;
	}
	.range-label {
		grid-column: 1 / -1;
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--text-2);
	}
	.format-hint {
		grid-column: 1 / -1;
		font-size: var(--text-small);
	}
	/* The visually hidden label of each input must not take a grid row. */
	.range :global(.field) {
		gap: 0;
	}

	/* Work area: the table plate, and the inspector beside it when a detail is open. */
	.work {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		gap: var(--space-4);
	}
	.split .work {
		grid-template-columns: minmax(0, 1fr) 360px;
	}
	.table-cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.inspector {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		padding: var(--space-2);
	}

	/* Cells */
	.ico {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h);
		font-weight: 600;
		text-decoration: none;
	}
	.ico:hover {
		text-decoration: underline;
	}
	.ico.current {
		font-weight: 700;
	}
	.name {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.name-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name-text.current {
		font-weight: 600;
	}
	.name .tag {
		flex: none;
	}
	.none {
		color: var(--text-3);
	}

	@media (max-width: 1366px) {
		.split .work {
			grid-template-columns: minmax(0, 1fr) 320px;
		}
	}
	/* A window too narrow for both (a link with the detail opened elsewhere): the detail alone. */
	@media (max-width: 1179px) {
		.split > .head,
		.split > .filters,
		.split .table-cell {
			display: none;
		}
		.split .work {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	/* Narrow window: the page grows and scrolls as a whole, the table keeps a height of its own. */
	@media (max-width: 859.98px) {
		.list-page {
			height: auto;
			min-height: 0;
		}
		.head {
			padding-left: var(--space-3);
		}
		.toolbar {
			border-radius: var(--radius-float);
		}
		.search {
			flex-basis: 100%;
		}
		.more {
			position: static;
			margin-top: var(--space-3);
		}
		.work {
			display: flex;
			flex-direction: column;
		}
		.table-cell {
			flex: none;
			height: 560px;
		}
		.inspector {
			flex: none;
		}
	}
</style>
