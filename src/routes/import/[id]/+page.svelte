<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { call } from '$lib/api';
	import { buildWorkbook, saveBlob } from '$lib/excel/write';
	import type { SheetSpec } from '$lib/excel/write';
	import { formatDateTime, formatNumber, plural } from '$lib/format';
	import { IMPORT_FIELDS, IMPORT_FIELD_LABELS } from '$lib/import/rows';
	import Button from '$lib/components/Button.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import StateDot from '$lib/components/StateDot.svelte';
	import Table from '$lib/components/Table.svelte';
	import type { Column } from '$lib/components/Table.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import Progress from '../Progress.svelte';
	import { IMPORT_STATUS_DOTS, IMPORT_STATUS_LABELS } from '../status';
	import type { ImportSummary } from '../status';

	type ProblemKind = 'invalid_ico' | 'duplicate' | 'error' | 'warning';
	interface ProblemRow {
		rowNo: number;
		ico: string | null;
		name: string | null;
		problem: string;
	}

	const id = $derived(Number(page.params.id));

	let imp = $state<ImportSummary | null>(null);
	let loadError = $state<string | null>(null);
	let working = $state<'validate' | 'apply' | null>(null);
	let workError = $state<string | null>(null);
	let confirmOpen = $state(false);
	let cancelOpen = $state(false);
	let downloading = $state(false);

	let kind = $state<ProblemKind>('invalid_ico');
	let problems = $state<ProblemRow[]>([]);
	let problemsTotal = $state(0);
	let problemsPage = $state(1);
	let problemsPageSize = $state(20);
	let problemsLoading = $state(false);

	// Differences against the database (companies that already exist) and the choice what to overwrite.
	interface DiffField {
		field: string;
		label: string;
		differs: number;
		fills: number;
		overwrite: boolean;
	}
	interface DiffItem {
		rowNo: number;
		ico: string;
		field: string;
		label: string;
		current: string;
		incoming: string;
	}
	let diff = $state<DiffField[]>([]);
	let overwrite = $state<Record<string, boolean>>({});
	let shownField = $state<string | null>(null);
	let shownItems = $state<DiffItem[]>([]);
	let shownLast = $state(0);
	let shownDone = $state(true);
	let shownLoading = $state(false);
	const diffRows = $derived(diff.filter((d) => d.differs > 0 || d.fills > 0));
	const overwriteList = $derived(diff.filter((d) => overwrite[d.field]).map((d) => d.field));
	const overwriteCount = $derived(diff.filter((d) => overwrite[d.field]).reduce((sum, d) => sum + d.differs, 0));
	const keepCount = $derived(diff.filter((d) => !overwrite[d.field]).reduce((sum, d) => sum + d.differs, 0));

	async function loadDiff() {
		if (imp?.status !== 'validated') {
			diff = [];
			return;
		}
		try {
			const res = await call<{ fields: DiffField[] }>('imports.diff', { id });
			diff = res.fields;
			overwrite = Object.fromEntries(res.fields.map((f) => [f.field, f.overwrite]));
			shownField = null;
		} catch {
			// The table is a help for the decision; the import itself works without it.
			diff = [];
		}
	}

	async function showDiff(field: string, more = false) {
		if (!more && shownField === field) {
			shownField = null;
			return;
		}
		shownLoading = true;
		try {
			const res = await call<{ items: DiffItem[]; last: number; done: boolean }>('imports.diffRows', {
				id,
				field,
				after: more ? shownLast : 0,
				limit: 50
			});
			shownItems = more ? [...shownItems, ...res.items] : res.items;
			shownLast = res.last;
			shownDone = res.done;
			shownField = field;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Rozdíly se nepodařilo načíst.');
		} finally {
			shownLoading = false;
		}
	}

	const counts = $derived(imp?.counts ?? null);
	const usable = $derived(counts ? counts.new + counts.update : 0);
	const appliedRows = $derived(imp ? imp.applied.new + imp.applied.updated + imp.applied.unchanged : 0);
	const hasProblems = $derived(!!counts && counts.duplicate + counts.invalidIco + counts.error + counts.warning > 0);
	const tabs = $derived<{ kind: ProblemKind; label: string; count: number }[]>(
		counts
			? [
					{ kind: 'invalid_ico', label: 'Neplatná IČO', count: counts.invalidIco },
					{ kind: 'duplicate', label: 'Duplicity v souboru', count: counts.duplicate },
					{ kind: 'error', label: 'Ostatní chyby', count: counts.error },
					{ kind: 'warning', label: 'Upozornění', count: counts.warning }
				]
			: []
	);
	const mappingList = $derived(
		// In the fixed order of the fields (the database returns the keys in its own order).
		IMPORT_FIELDS.filter((field) => imp?.mapping?.[field]?.length).map((field) => ({
			label: IMPORT_FIELD_LABELS[field],
			headers: imp!.mapping[field].join(', ')
		}))
	);

	const problemColumns: Column<ProblemRow>[] = [
		{ key: 'rowNo', label: 'Řádek v Excelu', width: '130px', align: 'right' },
		{ key: 'ico', label: 'IČO', width: '120px' },
		{ key: 'name', label: 'Název', width: '32%' },
		{ key: 'problem', label: 'Problém' }
	];

	onMount(() => {
		const warn = (e: BeforeUnloadEvent) => {
			if (working) e.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		void load();
		return () => window.removeEventListener('beforeunload', warn);
	});

	async function load() {
		loadError = null;
		try {
			imp = await call<ImportSummary>('imports.get', { id });
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Import se nepodařilo načíst.';
			return;
		}
		// A fully uploaded import goes straight to the check; nothing is written by it.
		if (imp.status === 'uploaded' || (imp.status === 'uploading' && imp.receivedRows === imp.declaredRows)) {
			await runValidation(false);
		} else if (imp.counts) {
			pickFirstTab();
			await loadProblems();
			await loadDiff();
		}
	}

	function pickFirstTab() {
		const first = tabs.find((t) => t.count > 0);
		if (first) kind = first.kind;
	}

	async function runValidation(restart: boolean) {
		working = 'validate';
		workError = null;
		try {
			let first = restart;
			for (;;) {
				const res = await call<{ done: boolean; import: ImportSummary }>('imports.validate', { id, restart: first });
				first = false;
				imp = res.import;
				if (res.done) break;
			}
			// The answer of the check does not carry the counts of "Stav z robota"; read the whole import.
			await refresh();
			problemsPage = 1;
			pickFirstTab();
			await loadProblems();
			await loadDiff();
		} catch (e) {
			workError = e instanceof Error ? e.message : 'Kontrola se nepodařila.';
			await refresh();
		} finally {
			working = null;
		}
	}

	/** Writes step by step; confirm is sent only by the confirmation dialog. */
	async function runApply(confirm: boolean) {
		working = 'apply';
		workError = null;
		try {
			let first = confirm;
			for (;;) {
				const res = await call<{ done: boolean; import: ImportSummary }>(
					'imports.apply',
					first ? { id, confirm: true, ...(diff.length ? { overwrite: overwriteList } : {}) } : { id }
				);
				first = false;
				imp = res.import;
				if (res.done) break;
			}
			toast.success(`Import č. ${id} je zapsaný.`);
			await loadProblems();
		} catch (e) {
			workError = e instanceof Error ? e.message : 'Zápis se přerušil.';
			await refresh();
		} finally {
			working = null;
		}
	}

	async function refresh() {
		try {
			imp = await call<ImportSummary>('imports.get', { id });
		} catch {
			// keep what is shown
		}
	}

	async function loadProblems() {
		if (!imp?.counts || imp.rowsPurgedAt) {
			problems = [];
			problemsTotal = 0;
			return;
		}
		problemsLoading = true;
		try {
			const res = await call<{ items: ProblemRow[]; total: number; pageSize: number }>('imports.rows', {
				id,
				kind,
				page: problemsPage,
				pageSize: problemsPageSize
			});
			problems = res.items;
			problemsTotal = res.total;
			problemsPageSize = res.pageSize;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Řádky se nepodařilo načíst.');
		} finally {
			problemsLoading = false;
		}
	}

	function selectKind(next: ProblemKind) {
		kind = next;
		problemsPage = 1;
		void loadProblems();
	}

	async function downloadReport() {
		downloading = true;
		try {
			const report = await call<{
				filename: string;
				summary: [string, string | number][];
				sheets: { name: string; kind: string; columns: { header: string; width: number }[] }[];
			}>('imports.reportStart', { id });
			const sheets: SheetSpec[] = [
				{ name: 'Souhrn', columns: [{ header: '', width: 44 }, { header: '', width: 28 }], rows: report.summary, labelColumn: true }
			];
			for (const sheet of report.sheets) {
				const rows: unknown[][] = [];
				let after = 0;
				for (;;) {
					const part = await call<{ rows: unknown[][]; last: number; done: boolean }>('imports.reportRows', { id, kind: sheet.kind, after });
					rows.push(...part.rows);
					after = part.last;
					if (part.done) break;
				}
				sheets.push({ name: sheet.name, columns: sheet.columns, rows });
			}
			if (imp?.status === 'validated' && diff.some((d) => d.differs > 0)) {
				const rows: unknown[][] = [];
				let after = 0;
				for (;;) {
					const part = await call<{ items: DiffItem[]; last: number; done: boolean }>('imports.diffRows', { id, after, limit: 5000 });
					rows.push(...part.items.map((i) => [i.rowNo, i.ico, i.label, i.current, i.incoming]));
					after = part.last;
					if (part.done) break;
				}
				sheets.push({
					name: 'Rozdíly proti databázi',
					columns: [
						{ header: 'Řádek v Excelu', width: 16 },
						{ header: 'IČO', width: 12 },
						{ header: 'Pole', width: 22 },
						{ header: 'V databázi', width: 40 },
						{ header: 'V souboru', width: 40 }
					],
					rows
				});
			}
			saveBlob(await buildWorkbook(sheets), report.filename);
			toast.success(`Report uložen: ${report.filename}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Report se nepodařilo stáhnout.');
		} finally {
			downloading = false;
		}
	}

	async function cancelImport() {
		imp = await call<ImportSummary>('imports.cancel', { id });
		problems = [];
		problemsTotal = 0;
		toast.info(`Import č. ${id} byl zrušen. Do databáze se nic nezapsalo.`);
	}
</script>

<svelte:head><title>Import č. {id} · Lead management A4M</title></svelte:head>

<!-- Back to the import page: a glass capsule on the backdrop, left above the title. -->
<div class="back">
	<Button variant="secondary" href="/import"><ArrowLeft size={18} /> Import Excelu</Button>
</div>

<div class="page-head">
	<h1>Import <strong>č. {id}</strong></h1>
	{#if imp}
		<div class="actions">
			{#if imp.counts && (hasProblems || diff.some((d) => d.differs > 0)) && !imp.rowsPurgedAt}
				<Button variant="secondary" onclick={downloadReport} loading={downloading}>
					{hasProblems ? 'Stáhnout report chyb (.xlsx)' : 'Stáhnout rozdíly (.xlsx)'}
				</Button>
			{/if}
			{#if ['uploading', 'uploaded', 'validated'].includes(imp.status)}
				<Button variant="secondary" onclick={() => (cancelOpen = true)} disabled={!!working}>Zrušit import</Button>
			{/if}
		</div>
	{/if}
</div>

{#if loadError}
	<div class="panel">
		<EmptyState title="Import se nepodařilo načíst" text={loadError}>
			<Button href="/import" variant="secondary">Zpět na import</Button>
		</EmptyState>
	</div>
{:else if !imp}
	<div class="panel panel-pad"><p class="text-muted">Načítám…</p></div>
{:else}
	<!-- Wide window: the file facts stay in a narrow column at the left, the check and the decision beside them. -->
	<div class="detail">
		<div class="panel panel-pad head">
			<dl class="facts">
				<dt>Soubor</dt>
				<dd>{imp.filename}{#if imp.sheetName}<span class="text-muted">&nbsp;· list {imp.sheetName}</span>{/if}</dd>
				<dt>Stav</dt>
				<dd><StateDot state={imp.status} dot={IMPORT_STATUS_DOTS[imp.status]} label={IMPORT_STATUS_LABELS[imp.status]} /></dd>
				<dt>Nahráno</dt>
				<dd class="num">{formatDateTime(imp.createdAt)}{#if imp.createdByName}&nbsp;· {imp.createdByName}{/if}</dd>
				{#if imp.confirmedAt}
					<dt>Potvrzeno</dt>
					<dd class="num">{formatDateTime(imp.confirmedAt)}{#if imp.confirmedByName}&nbsp;· {imp.confirmedByName}{/if}</dd>
				{/if}
				{#if imp.appliedAt}
					<dt>Zapsáno</dt>
					<dd class="num">{formatDateTime(imp.appliedAt)}</dd>
				{/if}
				{#if imp.cancelledAt}
					<dt>Zrušeno</dt>
					<dd class="num">{formatDateTime(imp.cancelledAt)}</dd>
				{/if}
				<dt>Mapování</dt>
				<dd class="mapping">
					{#each mappingList as m (m.label)}<span><strong>{m.label}</strong> ← {m.headers}</span>{/each}
				</dd>
			</dl>
		</div>

		<div class="work-col">
			{#if workError}<p class="alert alone" role="alert">{workError}</p>{/if}

			{#if working === 'validate' || imp.status === 'uploaded'}
				<div class="panel panel-pad work">
					<Progress label="Kontroluji řádky…" value={imp.validatedRows} max={imp.receivedRows} />
					{#if working !== 'validate'}
						<div><Button onclick={() => runValidation(false)}>Pokračovat v kontrole</Button></div>
					{:else}
						<p class="text-muted">Kontrola do databáze nic nezapisuje.</p>
					{/if}
				</div>
			{:else if imp.status === 'uploading' && imp.receivedRows === imp.declaredRows}
				<div class="panel">
					<EmptyState
						title="Kontrola se nedokončila"
						text="Všech {formatNumber(imp.receivedRows)} řádků je na serveru, ale kontrola neproběhla. Zkuste ji spustit znovu; do databáze se zatím nic nezapsalo."
					>
						<Button onclick={() => runValidation(false)}>Zkontrolovat znovu</Button>
						<Button variant="secondary" onclick={() => (cancelOpen = true)}>Zrušit import</Button>
					</EmptyState>
				</div>
			{:else if imp.status === 'uploading'}
				<div class="panel">
					<EmptyState
						title="Nahrávání nebylo dokončeno"
						text="Na server dorazilo {formatNumber(imp.receivedRows)} z {formatNumber(imp.declaredRows)} řádků. Soubor zůstal jen v prohlížeči, proto import zrušte a nahrajte ho znovu."
					>
						<Button onclick={() => (cancelOpen = true)}>Zrušit import</Button>
					</EmptyState>
				</div>
			{/if}

			{#if counts && working !== 'validate'}
				<div class="panel block">
					<h2>Výsledek kontroly</h2>
					<table class="report">
						<tbody>
							<tr>
								<th scope="row">Řádků s daty v souboru</th>
								<td class="num">{formatNumber(imp.receivedRows)}</td>
								<td class="text-muted">
									{#if imp.emptyRows}{formatNumber(imp.emptyRows)} {plural(imp.emptyRows, 'prázdný řádek byl přeskočen', 'prázdné řádky byly přeskočeny', 'prázdných řádků bylo přeskočeno')}{/if}
								</td>
							</tr>
							<tr class="good">
								<th scope="row"><StateDot state="" dot={{ color: 'ink', variant: 'solid' }} label="Nová IČO" /></th>
								<td class="num">{formatNumber(counts.new)}</td>
								<td class="text-muted">Založí se ve stavu „V poolu“ se záznamem v historii.</td>
							</tr>
							<tr class="good">
								<th scope="row"><StateDot state="" dot={{ color: 'ink', variant: 'ring' }} label="IČO, která už v databázi jsou" /></th>
								<td class="num">{formatNumber(counts.update)}</td>
								<td class="text-muted">
									Doplní se údaje o firmě a telefony.
									{#if imp.robot}Stav a vlastnictví se změní podle sloupce „Stav z robota“, počty jsou níže.{:else}Stav ani vlastnictví se
										nemění: sloupec „Stav z robota“ není v mapování tohoto importu.{/if}
								</td>
							</tr>
							<tr>
								<th scope="row"><StateDot state="" dot={{ color: 'grey', variant: 'solid' }} label="Duplicity v souboru" /></th>
								<td class="num">{formatNumber(counts.duplicate)}</td>
								<td class="text-muted">Použije se první řádek s daným IČO. Z dalších se podle nastavení převezmou jen telefony.</td>
							</tr>
							<tr>
								<th scope="row"><StateDot state="" dot={{ color: 'accent', variant: 'solid' }} label="Neplatná IČO" /></th>
								<td class="num">{formatNumber(counts.invalidIco)}</td>
								<td class="text-muted">Chybí, nejsou číslo nebo nesedí kontrolní číslice. Nezapíšou se.</td>
							</tr>
							<tr>
								<th scope="row"><StateDot state="" dot={{ color: 'accent', variant: 'ring' }} label="Ostatní chyby" /></th>
								<td class="num">{formatNumber(counts.error)}</td>
								<td class="text-muted">Řádek nejde použít z jiného důvodu. Nezapíše se.</td>
							</tr>
							<tr>
								<th scope="row"><StateDot state="" dot={{ color: 'fan', variant: 'solid' }} label="Řádky s upozorněním" /></th>
								<td class="num">{formatNumber(counts.warning)}</td>
								<td class="text-muted">Zapíšou se, jen bez vadné hodnoty (například telefon ve špatném tvaru).</td>
							</tr>
							{#if imp.robot}
								<tr>
									<th scope="row"><StateDot state="superuser" label="Robot: jsme vlastníkem" /></th>
									<td class="num">{formatNumber(imp.robot.owned)}</td>
									<td class="text-muted">Stav „Superuser“ na ochranném useru, vlastnictví od data v souboru nebo ode dne importu.</td>
								</tr>
								<tr>
									<th scope="row"><StateDot state="neni_v_siebelu" label="Robot: není v Siebelu" /></th>
									<td class="num">{formatNumber(imp.robot.missing)}</td>
									<td class="text-muted">Stav „Není v Siebelu“. IČO je potřeba v Siebelu ručně založit.</td>
								</tr>
								<tr>
									<th scope="row"><StateDot state="" dot={{ color: 'grey', variant: 'solid' }} label="Robot: jiný vlastník" /></th>
									<td class="num">{formatNumber(imp.robot.otherOwner)}</td>
									<td class="text-muted">Stav se nemění, jako držitel se zapíše „Jiný partner – nerozpoznáno“.</td>
								</tr>
								{#if imp.robot.skipped > 0}
									<tr>
										<th scope="row"><StateDot state="" dot={{ color: 'fan', variant: 'solid' }} label="Robot: nepoužito" /></th>
										<td class="num">{formatNumber(imp.robot.skipped)}</td>
										<td class="text-muted">IČO už má v databázi jiný stav (má vlastníka, je zákazník…). Stav z robota se u nich nezapíše, jsou v Upozorněních.</td>
									</tr>
								{/if}
							{/if}
						</tbody>
					</table>
				</div>

				{#if imp.status === 'validated' && diffRows.length > 0}
					<div class="panel block">
						<h2>Rozdíly proti databázi</h2>
						<p class="text-muted lead">
							U IČO, která už v databázi jsou. Chybějící údaj se doplní vždy. Kde se údaj v souboru liší od uloženého, rozhodněte, jestli ho
							přepsat. Telefony se jen přidávají.
						</p>
						<table class="diff">
							<thead>
								<tr><th>Pole</th><th class="num">Liší se</th><th class="num">Doplní se</th><th>Při rozdílu</th><th></th></tr>
							</thead>
							<tbody>
								{#each diffRows as d (d.field)}
									<tr>
										<th scope="row">{d.label}</th>
										<td class="num">{formatNumber(d.differs)}</td>
										<td class="num">{formatNumber(d.fills)}</td>
										<td>
											{#if d.differs > 0}
												<label class="choice">
													<input type="checkbox" bind:checked={overwrite[d.field]} disabled={!!working} />
													<span>{overwrite[d.field] ? 'Přepsat hodnotou ze souboru' : 'Nechat původní'}</span>
												</label>
											{:else}
												<span class="text-muted">žádný rozpor</span>
											{/if}
										</td>
										<td class="right">
											{#if d.differs > 0}
												<Button variant="ghost" onclick={() => showDiff(d.field)} disabled={shownLoading}>
													{shownField === d.field ? 'Skrýt' : 'Zobrazit rozdíly'}
												</Button>
											{/if}
										</td>
									</tr>
									{#if shownField === d.field}
										<tr class="detail">
											<td colspan="5">
												<table class="values">
													<thead><tr><th>IČO</th><th>V databázi</th><th>V souboru</th></tr></thead>
													<tbody>
														{#each shownItems as item (item.rowNo)}
															<tr><td class="num">{item.ico}</td><td>{item.current}</td><td>{item.incoming}</td></tr>
														{/each}
													</tbody>
												</table>
												{#if !shownDone}
													<Button variant="secondary" onclick={() => showDiff(d.field, true)} loading={shownLoading}>Načíst další</Button>
												{/if}
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{/if}

				{#if imp.status === 'validated'}
					<!-- The decision: one glass capsule right under the result. -->
					<div class="toolbar decide">
						<Button onclick={() => (confirmOpen = true)} disabled={!!working || usable === 0}>
							Zapsat {formatNumber(usable)} IČO do databáze
						</Button>
						<Button variant="ghost" onclick={() => runValidation(true)} disabled={!!working}>Zkontrolovat znovu</Button>
						<span class="text-muted">
							{#if usable === 0}V souboru není žádný použitelný řádek.{:else}Dokud zápis nepotvrdíte, databáze se nemění.{/if}
						</span>
					</div>
				{/if}
			{/if}

			{#if imp.status === 'applying' || working === 'apply'}
				<div class="panel block work">
					<h2>Zápis do databáze</h2>
					<Progress
						label={working === 'apply' ? 'Zapisuji…' : 'Zápis byl přerušen'}
						value={appliedRows}
						max={usable}
						unit="IČO"
					/>
					{#if working !== 'apply'}
						<p>
							Zapsaná část v databázi zůstala. Zápis naváže za posledním dokončeným krokem, nic se nezapíše dvakrát.
						</p>
						<div><Button onclick={() => runApply(false)}>Pokračovat v zápisu</Button></div>
					{:else}
						<p class="text-muted">Nezavírejte tuto stránku. Kdyby se zápis přerušil, půjde tady dokončit.</p>
					{/if}
				</div>
			{:else if imp.status === 'applied'}
				<div class="panel block">
					<h2>Zapsáno</h2>
					<table class="report">
						<tbody>
							<tr><th scope="row">Nově založená IČO</th><td class="num">{formatNumber(imp.applied.new)}</td><td></td></tr>
							<tr><th scope="row">Aktualizovaná IČO</th><td class="num">{formatNumber(imp.applied.updated)}</td><td class="text-muted">U těchto firem se změnil aspoň jeden údaj.</td></tr>
							<tr><th scope="row">Beze změny</th><td class="num">{formatNumber(imp.applied.unchanged)}</td><td class="text-muted">V databázi už byly stejné údaje.</td></tr>
							<tr><th scope="row">Nově přidané telefony</th><td class="num">{formatNumber(imp.applied.phones)}</td><td class="text-muted">Čísla, která firma už měla, se nepřidala znovu.</td></tr>
						</tbody>
					</table>
				</div>
				<div class="toolbar decide">
					<Button href="/ico?state=v_poolu" variant="secondary">Zobrazit IČO v poolu</Button>
					<Button href="/import" variant="ghost">Další import</Button>
				</div>
			{/if}

			{#if counts && hasProblems && working !== 'validate'}
				<!-- The rows table draws its own plate: heading and the problem tabs stand on the backdrop above it. -->
				<div class="problems-head">
					<h2 class="problems-title">Řádky s problémem</h2>
					{#if !imp.rowsPurgedAt}
						<div class="tabs" role="tablist" aria-label="Druh problému">
							{#each tabs as t (t.kind)}
								<button
									type="button"
									role="tab"
									aria-selected={kind === t.kind}
									class:active={kind === t.kind}
									disabled={t.count === 0}
									onclick={() => selectKind(t.kind)}
								>
									{t.label} <span class="num count">{formatNumber(t.count)}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
				{#if imp.rowsPurgedAt}
					<div class="panel panel-pad">
						<p class="text-muted">Řádky tohoto importu už byly smazány (uplynula doba držení z nastavení). Zůstaly jen počty.</p>
					</div>
				{:else}
					<Table
						columns={problemColumns}
						rows={problems}
						rowKey="rowNo"
						loading={problemsLoading}
						caption="Řádky s problémem"
						page={problemsPage}
						pageSize={problemsPageSize}
						total={problemsTotal}
						onPage={(p) => {
							problemsPage = p;
							void loadProblems();
						}}
						emptyTitle="Žádné řádky"
						stickyHeader={false}
					/>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<Confirm
	bind:open={confirmOpen}
	title="Zapsat import do databáze?"
	confirmLabel="Zapsat do databáze"
	onConfirm={() => {
		// The dialog closes at once; progress and a possible interruption are shown on the page.
		void runApply(true);
	}}
>
	{#if counts}
		<ul class="confirm-list">
			<li><strong class="num">{formatNumber(counts.new)}</strong> {plural(counts.new, 'nové IČO se založí', 'nová IČO se založí', 'nových IČO se založí')} ve stavu „V poolu“.</li>
			<li><strong class="num">{formatNumber(counts.update)}</strong> {plural(counts.update, 'existujícímu IČO', 'existujícím IČO', 'existujícím IČO')} se doplní chybějící údaje a telefony{#if imp?.robot}; stav a vlastnictví se změní podle sloupce „Stav z robota“{:else}; stav a vlastnictví zůstanou{/if}.</li>
			{#if overwriteCount + keepCount > 0}
				<li>
					Rozdílné údaje: <strong class="num">{formatNumber(overwriteCount)}</strong> se přepíše hodnotou ze souboru,
					<strong class="num">{formatNumber(keepCount)}</strong> zůstane, jak je v databázi.
				</li>
			{/if}
			<li><strong class="num">{formatNumber(counts.duplicate + counts.invalidIco + counts.error)}</strong> {plural(counts.duplicate + counts.invalidIco + counts.error, 'řádek se nezapíše', 'řádky se nezapíšou', 'řádků se nezapíše')} (duplicity, neplatná IČO, chyby).</li>
		</ul>
		<p class="text-muted">Založená IČO a jejich historii nejde hromadně vrátit zpět.</p>
	{/if}
</Confirm>

<Confirm
	bind:open={cancelOpen}
	title="Zrušit import č. {id}?"
	message="Nahrané řádky se smažou. Do databáze IČO se z tohoto importu nic nezapsalo."
	confirmLabel="Zrušit import"
	cancelLabel="Ponechat"
	onConfirm={cancelImport}
/>

<style>
	.back {
		display: flex;
		flex-shrink: 0;
	}

	/* ---------- Two columns from 1100 px: facts left, the work beside them ---------- */
	.detail {
		display: grid;
		grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.head {
		position: sticky;
		top: var(--shell-inset);
	}
	/* In the narrow column each label sits above its value. */
	.head .facts {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	.head .facts dd + dt {
		margin-top: var(--space-3);
	}
	.head .facts dt {
		margin-bottom: 2px;
	}
	.mapping {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}
	.mapping strong {
		font-weight: 600;
	}
	.work-col {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	/* Error: bold ink text on a plate with an ink hairline (no red in the palette). */
	.alert {
		padding: 14px var(--plate-pad-x);
		border-radius: var(--radius-plate);
		background: var(--plate-fill);
		box-shadow:
			inset 0 0 0 1px rgb(11 27 51 / 0.16),
			var(--plate-shadow);
		color: var(--ink);
		font-weight: 600;
	}

	/* ---------- Plates with a heading: check result, writing, written ---------- */
	.block {
		overflow: hidden;
	}
	.block h2 {
		padding: var(--plate-pad-y) var(--plate-pad-x) 14px;
	}
	.work {
		display: grid;
		gap: var(--space-3);
		width: 100%;
		max-width: 760px;
	}
	.block.work {
		padding: 0 var(--plate-pad-x) var(--plate-pad-y);
	}
	.block.work h2 {
		padding: var(--plate-pad-y) 0 0;
	}
	.lead {
		margin: -6px 0 12px;
		padding: 0 var(--plate-pad-x);
		max-width: 90ch;
	}
	table.diff {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		margin-bottom: 6px;
	}
	.diff th,
	.diff td {
		height: var(--row-h);
		padding: 6px var(--space-3);
		border-top: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}
	.diff > thead th {
		font-size: var(--text-small);
		color: var(--text-2);
		font-weight: 600;
	}
	.diff > thead th:first-child,
	.diff > tbody > tr > th {
		padding-left: var(--plate-pad-x);
		font-weight: 500;
		white-space: nowrap;
	}
	.diff > thead th:first-child {
		font-weight: 600;
	}
	.diff .num {
		text-align: right;
		width: 110px;
	}
	.diff .right {
		text-align: right;
		padding-right: var(--plate-pad-x);
	}
	.choice {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--control-h);
		cursor: pointer;
	}
	.choice input {
		width: 22px;
		height: 22px;
		accent-color: var(--ink);
	}
	.diff tr.detail > td {
		padding: 0 var(--plate-pad-x) 12px;
		height: auto;
		border-top: 0;
	}
	.diff table.values th,
	.diff table.values td {
		height: auto;
		border-top: 0;
		width: auto;
		text-align: left;
	}
	table.values {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 12px;
	}
	table.values th,
	table.values td {
		padding: 8px 12px;
		text-align: left;
		border-bottom: 1px solid var(--line, rgba(11, 27, 51, 0.08));
	}
	table.values th {
		font-size: var(--text-small);
		color: var(--text-2);
	}
	table.report {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		margin-bottom: 6px;
	}
	.report th,
	.report td {
		height: var(--row-h);
		padding: 6px var(--space-3);
		border-top: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}
	/* Same label width in every report plate, so their numbers line up. */
	.report th {
		width: 1%;
		min-width: 290px;
		padding-left: var(--plate-pad-x);
		font-weight: 500;
		white-space: nowrap;
	}
	.report td.num {
		width: 1%;
		min-width: 88px;
		padding-left: var(--space-5);
		text-align: right;
		font-weight: 600;
	}
	.report td:last-child {
		padding-left: var(--space-5);
		padding-right: var(--plate-pad-x);
	}

	/* ---------- The decision: a glass capsule under the result ---------- */
	.decide {
		align-self: flex-start;
		max-width: 100%;
		padding-right: 20px;
	}
	.decide .text-muted {
		padding: 0 var(--space-2);
	}

	/* ---------- Problem rows: heading and tabs on the backdrop, the table plate under them ---------- */
	.problems-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
		margin-top: var(--space-3);
	}
	/* The heading lines up with the text in the plates; the glass tabs stay flush with them. */
	.problems-title {
		padding-left: var(--plate-pad-x);
	}
	.count {
		margin-left: 2px;
		font-weight: 600;
	}
	.tabs > :disabled .count {
		font-weight: 500;
	}

	.confirm-list {
		margin: 0;
		padding-left: 18px;
		display: grid;
		gap: var(--space-1);
	}

	@media (max-width: 1100px) {
		.detail {
			grid-template-columns: minmax(0, 1fr);
		}
		.head {
			position: static;
		}
	}
	/* Phone width: each report row becomes label and number on one line, the explanation under them. */
	@media (max-width: 640px) {
		table.report,
		.report tbody {
			display: block;
		}
		.report tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: baseline;
			column-gap: var(--space-3);
			padding: 12px var(--plate-pad-x);
			border-top: 1px solid var(--line);
		}
		.report th,
		.report td,
		.report td.num,
		.report td:last-child {
			display: block;
			width: auto;
			min-width: 0;
			height: auto;
			padding: 0;
			border: 0;
		}
		.report th {
			white-space: normal;
		}
		.report td:last-child {
			grid-column: 1 / -1;
			padding-top: var(--space-1);
		}
		.report td:last-child:empty {
			display: none;
		}
	}
</style>
