<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import { call } from '$lib/api';
	import { formatDateTime, formatNumber, plural } from '$lib/format';
	import { cellText, columnLetter } from '$lib/import/cells';
	import { guessMapping, headerKey, isEmptyRawRow } from '$lib/import/rows';
	import type { ImportField, RawRow } from '$lib/import/rows';
	import Button from '$lib/components/Button.svelte';
	import Select from '$lib/components/Select.svelte';
	import Field from '$lib/components/Field.svelte';
	import Table from '$lib/components/Table.svelte';
	import type { Column } from '$lib/components/Table.svelte';
	import StateDot from '$lib/components/StateDot.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import Progress from './Progress.svelte';
	import { readWorkbook } from './excel';
	import type { SheetData } from './excel';
	import { IMPORT_STATUS_DOTS, IMPORT_STATUS_LABELS } from './status';
	import type { ImportSummary } from './status';

	interface FieldInfo {
		key: ImportField;
		label: string;
		required: boolean;
		multiple: boolean;
	}
	interface Config {
		fields: FieldInfo[];
		aliases: Record<string, string[]>;
		remembered: Record<string, string>;
		uploadBatchRows: number;
		previewRows: number;
		maxRows: number;
	}

	let config = $state<Config | null>(null);
	let configError = $state<string | null>(null);

	// ---------- step 1: file ----------
	let step = $state<'file' | 'mapping' | 'uploading'>('file');
	let fileInput = $state<HTMLInputElement | null>(null);
	let fileName = $state('');
	let reading = $state(false);
	let fileError = $state<string | null>(null);
	let dragging = $state(false);
	// Not reactive on purpose: a sheet can hold 90 000 rows.
	let sheets: SheetData[] = [];
	let sheetNames = $state<string[]>([]);
	let sheetIndex = $state('0');
	let headerRowInput = $state<string | number>('1');

	// ---------- step 2: mapping ----------
	let headers = $state<string[]>([]);
	let columnFields = $state<(ImportField | '')[]>([]);
	let samples = $state<string[][]>([]);
	let dataRows = $state(0);
	let emptyRows = $state(0);
	let preview = $state<{ rowNo: number; row: RawRow }[]>([]);

	// ---------- step 3: upload ----------
	let importId = $state<number | null>(null);
	let sent = $state(0);
	let uploadError = $state<string | null>(null);
	let uploading = $state(false);
	let cursor = 0; // index into the sheet rows where the next batch starts

	// ---------- history ----------
	let history = $state<ImportSummary[]>([]);
	let historyTotal = $state(0);
	let historyPage = $state(1);
	let historyPageSize = $state(20);
	let historyLoading = $state(true);
	let historyError = $state<string | null>(null);

	const fields = $derived(config?.fields ?? []);
	const fieldOptions = $derived(fields.map((f) => ({ value: f.key, label: f.required ? `${f.label} (povinné)` : f.label })));
	const usedFields = $derived(new Set(columnFields.filter(Boolean)));
	const missingRequired = $derived(fields.filter((f) => f.required && !usedFields.has(f.key)));
	const mappedFields = $derived(fields.filter((f) => usedFields.has(f.key)));
	const tooManyRows = $derived(!!config && dataRows > config.maxRows);

	const currentRows = (): string[][] => sheets[Number(sheetIndex)]?.rows ?? [];
	const headerRow = (): number => {
		const n = Math.floor(Number(headerRowInput));
		return Number.isFinite(n) && n >= 1 ? n : 1;
	};

	onMount(() => {
		void loadConfig();
		void loadHistory();
		const warn = (e: BeforeUnloadEvent) => {
			if (uploading) e.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	async function loadConfig() {
		try {
			config = await call<Config>('imports.config');
		} catch (e) {
			configError = e instanceof Error ? e.message : 'Nastavení importu se nepodařilo načíst.';
		}
	}

	async function loadHistory() {
		historyLoading = true;
		historyError = null;
		try {
			const res = await call<{ items: ImportSummary[]; total: number; page: number; pageSize: number }>('imports.list', {
				page: historyPage,
				pageSize: historyPageSize
			});
			history = res.items;
			historyTotal = res.total;
			historyPageSize = res.pageSize;
		} catch (e) {
			historyError = e instanceof Error ? e.message : 'Historii importů se nepodařilo načíst.';
		} finally {
			historyLoading = false;
		}
	}

	async function chooseFile(file: File | null | undefined) {
		if (!file || !config) return;
		fileError = null;
		if (!/\.xlsx$/i.test(file.name)) {
			fileError = 'Vyberte soubor ve formátu .xlsx. Starší formát .xls nebo .csv nejdřív v Excelu uložte jako .xlsx.';
			return;
		}
		reading = true;
		fileName = file.name;
		try {
			sheets = await readWorkbook(file);
			sheetNames = sheets.map((s) => s.name);
			// Start on the sheet with the most rows.
			let best = 0;
			sheets.forEach((s, i) => {
				if (s.rows.length > sheets[best].rows.length) best = i;
			});
			sheetIndex = String(best);
			headerRowInput = '1';
			analyse(true);
			step = 'mapping';
		} catch (e) {
			fileError = e instanceof Error ? e.message : 'Soubor se nepodařilo přečíst.';
			sheets = [];
		} finally {
			reading = false;
			if (fileInput) fileInput.value = '';
		}
	}

	/** Reads headers, guesses the mapping (when asked) and counts the rows of the chosen sheet. */
	function analyse(guess: boolean) {
		if (!config) return;
		const rows = currentRows();
		const head = headerRow();
		let width = rows[head - 1]?.length ?? 0;
		for (let i = head; i < rows.length; i++) if (rows[i].length > width) width = rows[i].length;
		const raw = rows[head - 1] ?? [];
		headers = Array.from({ length: width }, (_, c) => raw[c] ?? '');
		if (guess) columnFields = guessMapping(headers, config.aliases, config.remembered);
		const sampleList: string[][] = headers.map(() => []);
		let data = 0;
		let empty = 0;
		for (let i = head; i < rows.length; i++) {
			const row = rows[i];
			if (!row.length || row.every((v) => !v)) {
				empty++;
				continue;
			}
			data++;
			for (let c = 0; c < width; c++) {
				if (sampleList[c].length < 3 && row[c] && !sampleList[c].includes(row[c])) sampleList[c].push(row[c]);
			}
		}
		samples = sampleList;
		dataRows = data;
		emptyRows = empty;
		refreshPreview();
	}

	/** Mapped values of one sheet row. */
	function toRaw(row: string[]): RawRow {
		const raw: RawRow = {};
		const phones: string[] = [];
		for (let c = 0; c < columnFields.length; c++) {
			const field = columnFields[c];
			const value = cellText(row[c]);
			if (!field || !value) continue;
			if (field === 'phone') phones.push(value);
			else raw[field] = value;
		}
		if (phones.length) raw.phones = phones;
		return raw;
	}

	function refreshPreview() {
		if (!config) return;
		const rows = currentRows();
		const list: { rowNo: number; row: RawRow }[] = [];
		for (let i = headerRow(); i < rows.length && list.length < config.previewRows; i++) {
			if (!rows[i].length || rows[i].every((v) => !v)) continue;
			list.push({ rowNo: i + 1, row: toRaw(rows[i]) });
		}
		preview = list;
	}

	function setField(index: number, value: string) {
		const field = value as ImportField | '';
		const info = fields.find((f) => f.key === field);
		const next = [...columnFields];
		// A field with a single column moves to the newly chosen column.
		if (field && info && !info.multiple) {
			for (let c = 0; c < next.length; c++) if (next[c] === field) next[c] = '';
		}
		next[index] = field;
		columnFields = next;
		refreshPreview();
	}

	function reset() {
		sheets = [];
		sheetNames = [];
		fileName = '';
		headers = [];
		columnFields = [];
		preview = [];
		importId = null;
		sent = 0;
		cursor = 0;
		uploadError = null;
		step = 'file';
	}

	const headerLabel = (index: number) => headers[index] || `Sloupec ${columnLetter(index)}`;

	async function startUpload() {
		if (!config || missingRequired.length || tooManyRows || !dataRows) return;
		const mapping: Record<string, string[]> = {};
		const headerMap: Record<string, string> = {};
		columnFields.forEach((field, c) => {
			if (field) (mapping[field] ??= []).push(headerLabel(c));
			if (headers[c] && headerKey(headers[c])) headerMap[headers[c]] = field || '-';
		});
		step = 'uploading';
		uploading = true;
		uploadError = null;
		try {
			const imp = await call<ImportSummary>('imports.start', {
				filename: fileName,
				sheetName: sheetNames[Number(sheetIndex)],
				declaredRows: dataRows,
				emptyRows,
				mapping,
				headerMap
			});
			importId = imp.id;
			sent = 0;
			cursor = headerRow();
			await sendBatches();
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Nahrávání se nepodařilo.';
			uploading = false;
			if (importId === null) step = 'mapping';
		}
	}

	/** Sends the remaining rows in batches. After an error it can be called again and carries on. */
	async function sendBatches() {
		if (!config || importId === null) return;
		uploading = true;
		uploadError = null;
		const rows = currentRows();
		try {
			while (cursor < rows.length) {
				const batch: { rowNo: number; data: RawRow }[] = [];
				let next = cursor;
				while (next < rows.length && batch.length < config.uploadBatchRows) {
					const row = rows[next];
					if (row.length && !row.every((v) => !v)) batch.push({ rowNo: next + 1, data: toRaw(row) });
					next++;
				}
				if (batch.length) {
					const res = await call<{ receivedRows: number }>('imports.appendRows', { id: importId, rows: batch });
					sent = res.receivedRows;
				}
				cursor = next;
			}
			uploading = false;
			await goto(`/import/${importId}`);
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Nahrávání se přerušilo.';
			uploading = false;
		}
	}

	async function cancelUpload() {
		if (importId === null) return reset();
		try {
			await call('imports.cancel', { id: importId });
			toast.info(`Import č. ${importId} byl zrušen.`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Import se nepodařilo zrušit.');
		}
		reset();
		void loadHistory();
	}

	const historyColumns: Column<ImportSummary>[] = [
		{ key: 'id', label: 'Č.', width: '56px', align: 'right' },
		{ key: 'filename', label: 'Soubor' },
		{ key: 'createdAt', label: 'Nahráno', width: '150px' },
		{ key: 'createdByName', label: 'Kdo', width: '100px' },
		{ key: 'status', label: 'Stav', width: '250px' },
		{ key: 'receivedRows', label: 'Řádků', align: 'right', width: '72px' },
		{ key: 'new', label: 'Nová IČO', align: 'right', width: '88px' },
		{ key: 'update', label: 'Existující', align: 'right', width: '88px' },
		{ key: 'duplicate', label: 'Duplicity', align: 'right', width: '88px' },
		{ key: 'invalidIco', label: 'Neplatná IČO', align: 'right', width: '96px' }
	];

	function historyCell(row: ImportSummary, key: string): string {
		switch (key) {
			case 'createdAt':
				return formatDateTime(row.createdAt);
			case 'createdByName':
				return row.createdByName ?? '—';
			case 'receivedRows':
				return formatNumber(row.receivedRows);
			case 'new':
				return row.status === 'applied' ? formatNumber(row.applied.new) : formatNumber(row.counts?.new);
			case 'update':
				return formatNumber(row.counts?.update);
			case 'duplicate':
				return formatNumber(row.counts?.duplicate);
			case 'invalidIco':
				return formatNumber(row.counts?.invalidIco);
			default:
				return String((row as unknown as Record<string, unknown>)[key] ?? '—');
		}
	}
</script>

<svelte:head><title>Import Excelu · Lead management A4M</title></svelte:head>

<div class="page-head">
	<div class="title">
		<h1>Import <strong>Excelu</strong></h1>
		<p class="sub">Master databáze IČO</p>
	</div>
	{#if step !== 'file'}
		<div class="actions">
			<Button variant="secondary" onclick={step === 'uploading' ? cancelUpload : reset} disabled={uploading}>
				{step === 'uploading' ? 'Zrušit import' : 'Vybrat jiný soubor'}
			</Button>
		</div>
	{/if}
</div>

<!-- Where the wizard stands: a quiet row on the backdrop (it is not a control, so not glass). -->
<ol class="steps" aria-label="Postup importu">
	<li class:current={step === 'file'} class:done={step !== 'file'}><span class="n">1</span> Soubor</li>
	<li class:current={step === 'mapping'} class:done={step === 'uploading'}><span class="n">2</span> Mapování sloupců</li>
	<li class:current={step === 'uploading'}><span class="n">3</span> Nahrání</li>
	<li><span class="n">4</span> Kontrola a report</li>
	<li><span class="n">5</span> Potvrzení a zápis</li>
</ol>

{#if configError}
	<div class="panel panel-pad"><p class="alert" role="alert">{configError}</p></div>
{:else if step === 'file'}
	<!-- Drop area: a plate with a dashed frame inside; the frame darkens while a file is dragged over it. -->
	<div
		class="panel drop"
		class:dragging
		role="group"
		aria-label="Výběr souboru"
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragging = false;
			void chooseFile(e.dataTransfer?.files?.[0]);
		}}
	>
		<span class="drop-icon"><FileSpreadsheet size={28} /></span>
		<div class="drop-text">
			<p class="drop-title">Vyberte kmenový Excel (.xlsx)</p>
			<p class="text-muted">
				Soubor se přečte v prohlížeči. Na server se pošlou jen sloupce, které v dalším kroku namapujete. Do databáze se nic nezapíše,
				dokud zápis nepotvrdíte.
			</p>
			{#if reading}<p class="text-muted note">Čtení velkého souboru (desítky tisíc řádků) může trvat i půl minuty.</p>{/if}
		</div>
		<input
			bind:this={fileInput}
			type="file"
			accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
			class="visually-hidden"
			id="import-file"
			onchange={(e) => void chooseFile(e.currentTarget.files?.[0])}
		/>
		<Button onclick={() => fileInput?.click()} loading={reading} disabled={!config}>
			{reading ? 'Čtu soubor…' : 'Vybrat soubor'}
		</Button>
		{#if fileError}<p class="alert file-error" role="alert">{fileError}</p>{/if}
	</div>
{:else if step === 'mapping'}
	<div class="panel panel-pad file-bar">
		<dl class="facts">
			<dt>Soubor</dt>
			<dd>{fileName}</dd>
			<dt>Řádků s daty</dt>
			<dd class="num">
				{formatNumber(dataRows)}
				{#if emptyRows}<span class="text-muted"> · {formatNumber(emptyRows)} {plural(emptyRows, 'prázdný řádek se přeskočí', 'prázdné řádky se přeskočí', 'prázdných řádků se přeskočí')}</span>{/if}
			</dd>
		</dl>
		<div class="file-controls">
			{#if sheetNames.length > 1}
				<Select
					label="List"
					bind:value={sheetIndex}
					options={sheetNames.map((name, i) => ({ value: String(i), label: name }))}
					onchange={() => analyse(true)}
				/>
			{/if}
			<Field
				label="Řádek se záhlavím"
				type="number"
				min="1"
				bind:value={headerRowInput}
				oninput={() => analyse(true)}
				style="width: 140px"
			/>
		</div>
	</div>

	<div class="panel block">
		<div class="block-head">
			<h2>Sloupce souboru</h2>
			<p class="text-muted lead">
				Ke každému sloupci vyberte pole, do kterého patří. Návrh vychází z názvů záhlaví a z minulého importu; mapování se zapamatuje.
				Telefon může mít víc sloupců, ostatní pole jeden.
			</p>
		</div>
		<div class="scroll-x">
			<table class="map">
				<thead>
					<tr>
						<th scope="col" style:width="64px">Sloupec</th>
						<th scope="col">Záhlaví v souboru</th>
						<th scope="col">Ukázka hodnot</th>
						<th scope="col" style:width="280px">Pole v databázi</th>
					</tr>
				</thead>
				<tbody>
					{#each headers as header, c (c)}
						<tr class:unused={!columnFields[c]}>
							<td class="num text-muted">{columnLetter(c)}</td>
							<td class="strong">{header || '(bez záhlaví)'}</td>
							<td class="sample">{samples[c]?.join(' · ') || '—'}</td>
							<td>
								<Select
									label="Pole pro sloupec {headerLabel(c)}"
									hideLabel
									value={columnFields[c]}
									options={fieldOptions}
									placeholder="Nepoužívat"
									onchange={(v) => setField(c, v)}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div class="panel block">
		<div class="block-head">
			<h2>Náhled prvních řádků</h2>
			{#if !mappedFields.length}
				<p class="text-muted lead">Náhled se ukáže, až namapujete aspoň jeden sloupec.</p>
			{:else}
				<p class="text-muted lead">Hodnoty tak, jak odejdou ke kontrole. IČO bez úvodních nul se při kontrole doplní.</p>
			{/if}
		</div>
		{#if mappedFields.length}
			<div class="scroll-x">
				<table class="map preview">
					<thead>
						<tr>
							<th scope="col" class="right" style:width="72px">Řádek</th>
							{#each mappedFields as f (f.key)}<th scope="col">{f.label}</th>{/each}
						</tr>
					</thead>
					<tbody>
						{#each preview as item (item.rowNo)}
							<tr>
								<td class="num right text-muted">{item.rowNo}</td>
								{#each mappedFields as f (f.key)}
									<td>
										{#if f.key === 'phone'}{item.row.phones?.join(' · ') ?? '—'}{:else}{item.row[f.key] ?? '—'}{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>

	<!-- The next step floats on glass at the bottom of the window while the long mapping scrolls under it. -->
	<div class="toolbar submit">
		{#if missingRequired.length}
			<p class="alert" role="alert">Chybí sloupec pro pole: {missingRequired.map((f) => f.label).join(', ')}.</p>
		{:else if !dataRows}
			<p class="alert" role="alert">Pod záhlavím není žádný řádek s daty.</p>
		{:else if tooManyRows && config}
			<p class="alert" role="alert">
				Soubor má {formatNumber(dataRows)} řádků, nejvýše lze nahrát {formatNumber(config.maxRows)} (Nastavení → import).
			</p>
		{/if}
		<Button onclick={startUpload} disabled={!!missingRequired.length || !dataRows || tooManyRows}>
			Nahrát {formatNumber(dataRows)} {plural(dataRows, 'řádek', 'řádky', 'řádků')} ke kontrole
		</Button>
		<span class="text-muted">Do databáze se zatím nic nezapíše.</span>
	</div>
{:else}
	<div class="panel panel-pad upload">
		<Progress label={uploading ? 'Nahrávám řádky ke kontrole…' : 'Nahrávání stojí'} value={sent} max={dataRows} />
		{#if uploadError}
			<p class="alert" role="alert">{uploadError}</p>
			<div class="row-actions">
				{#if importId !== null}
					<Button onclick={sendBatches}>Pokračovat v nahrávání</Button>
				{/if}
				<Button variant="secondary" onclick={cancelUpload}>Zrušit import</Button>
			</div>
		{:else}
			<p class="text-muted">Nezavírejte tuto stránku, dokud nahrávání neskončí. Potom se otevře kontrola.</p>
		{/if}
	</div>
{/if}

{#if step === 'file'}
	<!-- The history table draws its own plate, so its heading stands on the backdrop above it. -->
	<h2 class="history-head">Historie importů</h2>
	{#if historyError}
		<p class="alert alone" role="alert">{historyError}</p>
	{:else}
		<Table
			columns={historyColumns}
			rows={history}
			rowKey="id"
			loading={historyLoading}
			caption="Historie importů"
			onRowClick={(row) => goto(`/import/${row.id}`)}
			page={historyPage}
			pageSize={historyPageSize}
			total={historyTotal}
			onPage={(p) => {
				historyPage = p;
				void loadHistory();
			}}
			emptyTitle="Zatím žádný import"
			emptyText="Nahraný soubor se tu objeví s počty řádků a stavem."
			stickyHeader={false}
		>
			{#snippet cell({ row, column })}
				{#if column.key === 'status'}
					<StateDot state={row.status} dot={IMPORT_STATUS_DOTS[row.status]} label={IMPORT_STATUS_LABELS[row.status]} />
				{:else if column.key === 'filename'}
					<a href="/import/{row.id}" onclick={(e) => e.stopPropagation()}>{row.filename}</a>
				{:else}
					<span class="num">{historyCell(row, column.key)}</span>
				{/if}
			{/snippet}
		</Table>
	{/if}
{/if}

<style>
	/* ---------- Page head: title with its one-line description beside it ---------- */
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

	/* ---------- Steps: current = ink circle and bold label, done = quiet ink, ahead = outlined ---------- */
	.steps {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) 0;
		list-style: none;
		margin: 0;
		padding: 0 0 0 var(--plate-pad-x);
		color: var(--text-2);
		font-weight: 500;
	}
	.steps li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.steps li + li::before {
		content: '';
		width: 24px;
		height: 1px;
		margin: 0 var(--space-3);
		background: var(--line-tag);
	}
	.steps .n {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		font-size: var(--text-caps);
		font-weight: 600;
		box-shadow: inset 0 0 0 1px var(--line-tag);
	}
	.steps .done {
		color: var(--ink);
	}
	.steps .done .n {
		background: rgb(11 27 51 / 0.1);
		box-shadow: none;
	}
	.steps .current {
		color: var(--ink);
		font-weight: 600;
	}
	.steps .current .n {
		background: var(--ink);
		color: var(--white);
		box-shadow: 0 2px 6px -2px rgb(11 27 51 / 0.5);
	}

	/* ---------- Step 1: drop area ---------- */
	.drop {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4) var(--space-5);
		padding: 28px 32px;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	/* The dashed frame that says "drop here", 8 px inside the plate (radius 22 - 8 = 14). */
	.drop::before {
		content: '';
		position: absolute;
		inset: var(--space-2);
		border: 1.5px dashed var(--line-tag);
		border-radius: 14px;
		pointer-events: none;
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.drop.dragging {
		background: var(--accent-50);
	}
	.drop.dragging::before {
		border-color: var(--ink);
	}
	.drop-icon {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--ink);
	}
	.drop-text {
		flex: 1 1 320px;
		display: grid;
		gap: var(--space-1);
		max-width: 760px;
	}
	.drop-title {
		font-size: var(--text-lead);
		font-weight: 600;
	}
	.note {
		margin-top: var(--space-1);
	}
	.file-error {
		flex-basis: 100%;
	}

	/* Error: bold ink text on a quiet ink-tinted box (no red in the palette), as in the confirm dialog. */
	.alert {
		padding: 10px 14px;
		border-radius: var(--radius);
		background: rgb(11 27 51 / 0.06);
		box-shadow: inset 0 0 0 1px rgb(11 27 51 / 0.16);
		color: var(--ink);
		font-weight: 600;
	}
	/* Standing alone on the backdrop it becomes a plate with an ink hairline. */
	.alert.alone {
		padding: 14px var(--plate-pad-x);
		border-radius: var(--radius-plate);
		background: var(--plate-fill);
		box-shadow:
			inset 0 0 0 1px rgb(11 27 51 / 0.16),
			var(--plate-shadow);
	}

	/* ---------- Step 2: file facts, mapping and preview plates ---------- */
	.file-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.file-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	/* The row count keeps its digits together, the note after it may wrap. */
	.file-bar dd.num {
		white-space: normal;
	}
	.block {
		overflow: hidden;
	}
	.block-head {
		display: grid;
		gap: 6px;
		padding: var(--plate-pad-y) var(--plate-pad-x) 14px;
	}
	.lead {
		max-width: 820px;
	}
	/* Positioned, so the visually hidden labels of the selects stay inside the scroll box. */
	.scroll-x {
		position: relative;
		overflow-x: auto;
	}
	table.map {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
	}
	.map th {
		height: var(--control-h);
		padding: 0 var(--space-4);
		background: var(--row-bg);
		box-shadow:
			inset 0 1px 0 var(--line),
			inset 0 -1px 0 var(--line-strong);
		color: var(--text-2);
		font-size: var(--text-caps);
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
	}
	.map td {
		height: var(--row-h);
		padding: 4px var(--space-4);
		border-bottom: 1px solid var(--line);
		vertical-align: middle;
	}
	.map th:first-child,
	.map td:first-child {
		padding-left: var(--plate-pad-x);
	}
	.map th:last-child,
	.map td:last-child {
		padding-right: var(--plate-pad-x);
	}
	.map tbody tr:last-child td {
		border-bottom: 0;
	}
	.map .strong {
		font-weight: 600;
	}
	.map tr.unused .strong,
	.map tr.unused .sample {
		color: var(--text-2);
		font-weight: 400;
	}
	.map .sample {
		color: var(--text-2);
		max-width: 420px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map.preview td {
		white-space: nowrap;
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.right {
		text-align: right;
	}

	/* The next step: a glass capsule that stays at the bottom of the window. */
	.submit {
		position: sticky;
		bottom: var(--shell-inset);
		z-index: var(--z-sticky);
		align-self: flex-start;
		max-width: 100%;
		padding-right: 20px;
	}
	.submit .alert {
		flex-basis: 100%;
	}
	.submit .text-muted {
		padding: 0 var(--space-2);
	}

	/* ---------- Step 3: upload ---------- */
	.upload {
		display: grid;
		gap: var(--space-3);
		width: 100%;
		max-width: 760px;
	}
	.row-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* ---------- History ---------- */
	.history-head {
		padding-left: var(--plate-pad-x);
		margin-top: var(--space-3);
	}

	/* Narrow window: the steps wrap into rows, so the connecting lines go. */
	@media (max-width: 859.98px) {
		.steps {
			gap: var(--space-2) var(--space-4);
		}
		.steps li + li::before {
			display: none;
		}
	}
</style>
