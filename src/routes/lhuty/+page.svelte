<script lang="ts">
	/**
	 * Ownership deadlines of the IČO held on the protective login: how many have to go back to the
	 * operator and by when, the file of returned statuses, and the confirmation that it was sent.
	 */
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import { call } from '$lib/api';
	import { buildWorkbook, saveBlob } from '$lib/excel/write';
	import { formatDate, formatDateTime, formatNumber } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toast } from '$lib/components/toasts.svelte';

	interface Bucket {
		key: string;
		label: string;
		from: string | null;
		to: string | null;
		count: number;
		extendable: number;
	}
	interface FileRow {
		id: number;
		created_at: string;
		created_by_name: string | null;
		total: number;
		extend_count: number;
		blank_count: number;
		confirmed_at: string | null;
		extended_count: number | null;
		cancelled_at: string | null;
	}
	interface Overview {
		today: string;
		reserveDays: number;
		buckets: Bucket[];
		files: FileRow[];
	}

	let overview = $state<Overview | null>(null);
	let error = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let confirmFile = $state<FileRow | null>(null);
	let confirmOpen = $state(false);

	const held = $derived(overview ? overview.buckets.reduce((sum, b) => sum + b.count, 0) : 0);
	const openFiles = $derived(overview ? overview.files.filter((f) => !f.confirmed_at && !f.cancelled_at) : []);

	async function load() {
		error = null;
		try {
			overview = await call<Overview>('returns.overview');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Lhůty se nepodařilo načíst.';
		}
	}
	onMount(load);

	/** Period of ends of ownership a bucket covers, for reading. */
	function range(b: Bucket): string {
		if (b.from && b.to) return `konec vlastnictví ${formatDate(b.from)} – ${formatDate(b.to)}`;
		if (b.to) return `konec vlastnictví do ${formatDate(b.to)}`;
		return `konec vlastnictví od ${formatDate(b.from)}`;
	}

	async function makeFile(b: Bucket) {
		busy = b.key;
		try {
			const file = await call<{
				id: number;
				filename: string;
				sheet: string;
				headers: [string, string];
				rows: [string, string][];
				extendCount: number;
				blankCount: number;
			}>('returns.file', { endsFrom: b.from, endsTo: b.to });
			const blob = await buildWorkbook([
				{ name: file.sheet, columns: [{ header: file.headers[0], width: 16 }, { header: file.headers[1], width: 24 }], rows: file.rows, textOnly: true }
			]);
			saveBlob(blob, file.filename);
			toast.success(
				file.blankCount
					? `Soubor č. ${file.id} je stažený. ${formatNumber(file.blankCount)} IČO už prodloužení využilo, status u nich doplňte ručně.`
					: `Soubor č. ${file.id} je stažený: ${formatNumber(file.extendCount)} IČO k prodloužení.`
			);
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Soubor se nepodařilo připravit.');
		} finally {
			busy = null;
		}
	}

	async function confirmSent() {
		if (!confirmFile) return;
		const res = await call<{ extended: number }>('returns.confirm', { id: confirmFile.id });
		toast.success(`Potvrzeno. Konec vlastnictví posunut u ${formatNumber(res.extended)} IČO.`);
		await load();
	}

	async function discard(file: FileRow) {
		try {
			await call('returns.cancel', { id: file.id });
			await load();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Soubor se nepodařilo zahodit.');
		}
	}

	function fileState(f: FileRow): string {
		if (f.cancelled_at) return 'Zahozen';
		if (f.confirmed_at) return `Odeslán ${formatDate(f.confirmed_at)} · prodlouženo ${formatNumber(f.extended_count ?? 0)}`;
		return 'Čeká na potvrzení odeslání';
	}
</script>

<svelte:head><title>Lhůty · Lead management A4M</title></svelte:head>

<div class="page">
	<div class="page-head">
		<div>
			<h1>Lhůty <strong>vlastnictví</strong></h1>
			{#if overview}
				<p class="text-muted">
					{formatNumber(held)} IČO držíme na ochranném useru. Soubor se statusy má odejít nejpozději {overview.reserveDays} dní před koncem
					vlastnictví.
				</p>
			{/if}
		</div>
	</div>

	{#if error}
		<div class="panel">
			<EmptyState title="Lhůty se nepodařilo načíst" text={error}><Button variant="secondary" onclick={load}>Zkusit znovu</Button></EmptyState>
		</div>
	{:else if !overview}
		<p class="text-muted">Načítám…</p>
	{:else if held === 0}
		<div class="panel">
			<EmptyState
				title="Žádné IČO na ochranném useru"
				text="Lhůty se začnou počítat, jakmile import se sloupcem „Stav z robota“ zapíše IČO s hodnotou ANO."
			/>
		</div>
	{:else}
		<div class="panel">
			<table class="plain">
				<thead>
					<tr><th>Kdy odeslat</th><th class="right">IČO</th><th class="right">Lze prodloužit</th><th></th></tr>
				</thead>
				<tbody>
					{#each overview.buckets as b (b.key)}
						<tr class:overdue={b.key === 'overdue' && b.count > 0}>
							<th scope="row">
								{b.label}
								<span class="text-muted sub">{range(b)}</span>
							</th>
							<td class="right num">{formatNumber(b.count)}</td>
							<td class="right num">{formatNumber(b.extendable)}</td>
							<td class="right">
								<Button variant="secondary" onclick={() => makeFile(b)} disabled={b.count === 0 || busy !== null} loading={busy === b.key}>
									<Download size={18} /> Soubor se statusy
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<h2>Připravené soubory</h2>
		<div class="panel">
			{#if overview.files.length === 0}
				<EmptyState title="Zatím žádný soubor" text="Stažený soubor se tu objeví a po nahrání operátorovi u něj potvrdíte odeslání." />
			{:else}
				<table class="plain">
					<thead>
						<tr><th>Č.</th><th>Vytvořen</th><th class="right">IČO</th><th class="right">K prodloužení</th><th>Stav</th><th></th></tr>
					</thead>
					<tbody>
						{#each overview.files as f (f.id)}
							<tr>
								<td class="num">{f.id}</td>
								<td>{formatDateTime(f.created_at)} <span class="text-muted">· {f.created_by_name ?? '—'}</span></td>
								<td class="right num">{formatNumber(f.total)}</td>
								<td class="right num">{formatNumber(f.extend_count)}</td>
								<td>{fileState(f)}</td>
								<td class="right actions">
									{#if !f.confirmed_at && !f.cancelled_at}
										<Button
											onclick={() => {
												confirmFile = f;
												confirmOpen = true;
											}}>Potvrdit odeslání</Button
										>
										<Button variant="secondary" onclick={() => discard(f)}>Zahodit</Button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
		{#if openFiles.length > 0}
			<p class="text-muted note">
				Konec vlastnictví se posune až po potvrzení odeslání. Potvrzujte jen soubor, který jste operátorovi opravdu nahráli; IČO, kterým jste v
				Excelu status „Prodloužit“ přepsali, by aplikace prodloužila také.
			</p>
		{/if}
	{/if}
</div>

<Confirm
	bind:open={confirmOpen}
	title="Potvrdit odeslání souboru"
	message={confirmFile
		? `Soubor č. ${confirmFile.id} jste nahráli operátorovi? U ${formatNumber(confirmFile.extend_count)} IČO se konec vlastnictví posune a prodloužení se označí jako využité. Nejde to vzít zpět.`
		: ''}
	confirmLabel="Ano, odesláno"
	onConfirm={confirmSent}
/>

<style>
	.page {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4);
		align-content: start;
	}
	h2 {
		margin-top: var(--space-3);
	}
	table.plain {
		width: 100%;
		border-collapse: collapse;
	}
	table.plain th,
	table.plain td {
		padding: 14px 20px;
		text-align: left;
		border-bottom: 1px solid var(--line, rgba(11, 27, 51, 0.08));
		vertical-align: middle;
	}
	table.plain thead th {
		font-size: var(--text-small);
		color: var(--text-2);
		font-weight: 600;
	}
	table.plain tbody tr:last-child th,
	table.plain tbody tr:last-child td {
		border-bottom: 0;
	}
	table.plain tbody th {
		font-weight: 600;
	}
	.sub {
		display: block;
		font-weight: 400;
		font-size: var(--text-small);
	}
	.right {
		text-align: right !important;
	}
	.actions {
		white-space: nowrap;
	}
	.actions :global(.btn + .btn) {
		margin-left: var(--space-2);
	}
	tr.overdue th {
		color: var(--danger, #b3261e);
	}
	.note {
		max-width: 80ch;
	}
</style>
