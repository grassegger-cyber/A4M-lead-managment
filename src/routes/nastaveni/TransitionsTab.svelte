<script lang="ts">
	/** Table of allowed state transitions. Every change is confirmed; graph problems are warnings only. */
	import { onMount } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { call } from '$lib/api';
	import { STATES, stateLabel } from '$lib/states';
	import { graphProblems, newProblems } from '$lib/transition-graph';
	import type { GraphProblems } from '$lib/transition-graph';
	import Button from '$lib/components/Button.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Field from '$lib/components/Field.svelte';
	import Select from '$lib/components/Select.svelte';
	import StateDot from '$lib/components/StateDot.svelte';
	import { toast } from '$lib/components/toasts.svelte';

	interface Transition {
		from_state: string;
		to_state: string;
		enabled: boolean;
		manual_allowed: boolean;
		note_required: boolean;
		label_cs: string;
	}
	type Flag = 'enabled' | 'manual_allowed' | 'note_required';

	const FLAGS: { key: Flag; arg: string; label: string; on: string; off: string }[] = [
		{ key: 'enabled', arg: 'enabled', label: 'Povoleno', on: 'Povolit přechod', off: 'Zakázat přechod' },
		{ key: 'manual_allowed', arg: 'manualAllowed', label: 'Ručně', on: 'Povolit ruční změnu', off: 'Zakázat ruční změnu' },
		{ key: 'note_required', arg: 'noteRequired', label: 'Poznámka povinná', on: 'Vyžadovat poznámku', off: 'Nevyžadovat poznámku' }
	];

	let transitions = $state<Transition[] | null>(null);
	let loadError = $state<string | null>(null);
	let fromFilter = $state('');

	let pending = $state<{ row: Transition; flag: (typeof FLAGS)[number]; value: boolean; warnings: GraphProblems } | null>(null);
	let confirmOpen = $state(false);

	let editOpen = $state(false);
	let editBusy = $state(false);
	let editError = $state<string | null>(null);
	let editRow = $state<Transition | null>(null);
	let form = $state({ from: '', to: '', label: '' });

	const stateOptions = STATES.map((s) => ({ value: s, label: stateLabel(s) }));
	const problems = $derived(transitions ? graphProblems(transitions) : { unreachable: [], deadEnds: [] });
	const shown = $derived((transitions ?? []).filter((t) => !fromFilter || t.from_state === fromFilter));
	/** Text of the state filter chip (the native select sits invisibly over the whole chip). */
	const fromLabel = $derived(fromFilter ? stateLabel(fromFilter) : 'Všechny stavy');
	const order = (state: string) => (STATES as readonly string[]).indexOf(state);
	const names = (states: string[]) => states.map((s) => stateLabel(s)).join(', ');

	async function load() {
		try {
			const data = await call<{ transitions: Transition[] }>('settings.transitions');
			transitions = data.transitions.sort(
				(a, b) => order(a.from_state) - order(b.from_state) || order(a.to_state) - order(b.to_state)
			);
			loadError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Přechody se nepodařilo načíst.';
		}
	}
	onMount(load);

	function askToggle(row: Transition, flag: (typeof FLAGS)[number]) {
		const value = !row[flag.key];
		const after = (transitions ?? []).map((t) => (t === row ? { ...t, [flag.key]: value } : t));
		pending = { row, flag, value, warnings: newProblems(transitions ?? [], after) };
		confirmOpen = true;
	}

	async function confirmToggle() {
		if (!pending) return;
		const { row, flag, value } = pending;
		await call('settings.saveTransition', { fromState: row.from_state, toState: row.to_state, [flag.arg]: value });
		row[flag.key] = value;
		toast.success(`Uloženo: ${stateLabel(row.from_state)} → ${stateLabel(row.to_state)}`);
	}

	function openEdit(row: Transition | null) {
		editRow = row;
		form = row ? { from: row.from_state, to: row.to_state, label: row.label_cs } : { from: fromFilter, to: '', label: '' };
		editError = null;
		editOpen = true;
	}

	async function saveEdit() {
		editError = null;
		if (!form.from || !form.to) {
			editError = 'Vyberte výchozí i cílový stav.';
			return;
		}
		if (!form.label.trim()) {
			editError = 'Popis přechodu nesmí být prázdný.';
			return;
		}
		if (!editRow && transitions?.some((t) => t.from_state === form.from && t.to_state === form.to)) {
			editError = 'Tento přechod už v tabulce je. Upravte ho v jeho řádku.';
			return;
		}
		editBusy = true;
		try {
			await call('settings.saveTransition', { fromState: form.from, toState: form.to, label: form.label });
			toast.success(editRow ? 'Popis přechodu uložen.' : 'Přechod přidán.');
			editOpen = false;
			await load();
		} catch (e) {
			editError = e instanceof Error ? e.message : 'Uložení se nepodařilo.';
		} finally {
			editBusy = false;
		}
	}
</script>

{#if loadError}
	<div class="panel">
		<EmptyState title="Přechody se nepodařilo načíst" text={loadError}>
			<Button variant="secondary" onclick={load}>Zkusit znovu</Button>
		</EmptyState>
	</div>
{:else if !transitions}
	<div class="panel panel-pad"><p class="text-muted">Načítám…</p></div>
{:else}
	{#if problems.unreachable.length > 0 || problems.deadEnds.length > 0}
		<div class="panel warning" role="status">
			<p class="label-caps">Upozornění k tabulce</p>
			{#if problems.unreachable.length > 0}
				<p>Do těchto stavů se z poolu nedá žádnou povolenou cestou dostat: <strong>{names(problems.unreachable)}</strong>.</p>
			{/if}
			{#if problems.deadEnds.length > 0}
				<p>Z těchto stavů nevede žádný povolený přechod dál: <strong>{names(problems.deadEnds)}</strong>.</p>
			{/if}
		</div>
	{/if}

	<!-- Filter, count and the add button on one glass capsule above the table plate. -->
	<div class="toolbar">
		<label class="chip pick">
			<span class="chip-key">Ze stavu</span>
			<span class="chip-value" aria-hidden="true">{fromLabel}</span>
			<ChevronDown size={16} />
			<select bind:value={fromFilter}>
				<option value="">Všechny stavy</option>
				{#each stateOptions as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
		</label>
		<span class="text-muted count">{shown.length} z {transitions.length} přechodů</span>
		<div class="spacer"></div>
		<Button variant="secondary" onclick={() => openEdit(null)}>Přidat přechod</Button>
	</div>

	<!-- One plate: what the table means, then the table; only its rows scroll. -->
	<div class="panel list">
		<p class="intro">
			Tabulka říká, mezi kterými stavy smí IČO přejít. Zakázaný přechod aplikace odmítne. Řádky se nemažou, jen zakazují,
			aby v auditu zůstalo vidět, co platilo.
		</p>
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Ze stavu</th>
						<th scope="col">Do stavu</th>
						<th scope="col">Kdy k přechodu dochází</th>
						{#each FLAGS as flag (flag.key)}<th scope="col" class="flag">{flag.label}</th>{/each}
						<th scope="col"><span class="visually-hidden">Akce</span></th>
					</tr>
				</thead>
				<tbody>
					{#each shown as row, index (row.from_state + '>' + row.to_state)}
						<tr class:off={!row.enabled} class:first={index === 0 || shown[index - 1].from_state !== row.from_state}>
							<td><StateDot state={row.from_state} /></td>
							<td><StateDot state={row.to_state} /></td>
							<td class="desc">{row.label_cs}</td>
							{#each FLAGS as flag (flag.key)}
								<td class="flag">
									<button
										type="button"
										class="toggle"
										class:on={row[flag.key]}
										aria-pressed={row[flag.key]}
										aria-label="{flag.label}: {stateLabel(row.from_state)} → {stateLabel(row.to_state)}"
										onclick={() => askToggle(row, flag)}
									>
										<span class="dot" aria-hidden="true"></span>{row[flag.key] ? 'Ano' : 'Ne'}
									</button>
								</td>
							{/each}
							<td class="right"><Button size="sm" variant="ghost" onclick={() => openEdit(row)}>Upravit popis</Button></td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if shown.length === 0}
				<EmptyState title="Z tohoto stavu nevede žádný přechod" text="Přidejte ho tlačítkem Přidat přechod." />
			{/if}
		</div>
	</div>
{/if}

<Confirm
	bind:open={confirmOpen}
	title={pending ? (pending.value ? pending.flag.on : pending.flag.off) + '?' : ''}
	confirmLabel={pending ? (pending.value ? pending.flag.on : pending.flag.off) : 'Potvrdit'}
	onConfirm={confirmToggle}
>
	{#if pending}
		<p class="pair">
			<StateDot state={pending.row.from_state} /> <span aria-hidden="true">→</span>
			<StateDot state={pending.row.to_state} />
		</p>
		<p class="text-muted">{pending.row.label_cs}</p>
		<dl class="facts change">
			<dt>{pending.flag.label}</dt>
			<dd>{pending.value ? 'Ne' : 'Ano'} → <strong>{pending.value ? 'Ano' : 'Ne'}</strong></dd>
		</dl>
		{#if pending.warnings.unreachable.length > 0 || pending.warnings.deadEnds.length > 0}
			<div class="warning inline" role="alert">
				<p class="label-caps">Pozor</p>
				{#if pending.warnings.unreachable.length > 0}
					<p>Po této změně se IČO z poolu nedostane do stavu: <strong>{names(pending.warnings.unreachable)}</strong>.</p>
				{/if}
				{#if pending.warnings.deadEnds.length > 0}
					<p>Po této změně nepovede žádný přechod ze stavu: <strong>{names(pending.warnings.deadEnds)}</strong>.</p>
				{/if}
				<p>Změnu lze přesto uložit.</p>
			</div>
		{/if}
		<p class="text-muted">Změna platí hned a zapíše se do auditu.</p>
	{/if}
</Confirm>

<Dialog bind:open={editOpen} title={editRow ? 'Upravit popis přechodu' : 'Přidat přechod'} width="sm" busy={editBusy}>
	<div class="form">
		{#if editRow}
			<p class="pair"><StateDot state={editRow.from_state} /> <span aria-hidden="true">→</span> <StateDot state={editRow.to_state} /></p>
		{:else}
			<Select label="Ze stavu" bind:value={form.from} options={stateOptions} placeholder="Vyberte stav" />
			<Select label="Do stavu" bind:value={form.to} options={stateOptions} placeholder="Vyberte stav" />
		{/if}
		<Field label="Kdy k přechodu dochází" bind:value={form.label} multiline rows={2} maxlength={300} />
		{#if !editRow}
			<p class="text-muted">Nový přechod je povolený, ruční změna povolená, poznámka nepovinná. Upravíte to v tabulce.</p>
		{/if}
		{#if editError}<p class="error" role="alert">{editError}</p>{/if}
	</div>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (editOpen = false)} disabled={editBusy}>Zrušit</Button>
		<Button onclick={saveEdit} loading={editBusy}>{editRow ? 'Uložit popis' : 'Přidat přechod'}</Button>
	{/snippet}
</Dialog>


<style>
	/* ---------- Table warnings: a pale yellow plate ---------- */
	.warning {
		flex-shrink: 0;
		display: grid;
		gap: var(--space-1);
		padding: 14px var(--plate-pad-x);
		background: var(--accent-50);
	}
	/* The same warning inside the confirm dialog */
	.warning.inline {
		margin: var(--space-1) 0;
		padding: 12px 16px;
		border-radius: var(--radius);
		box-shadow: inset 0 0 0 1px rgb(11 27 51 / 0.1);
	}

	/* ---------- Toolbar: state filter chip, count, add button ---------- */
	/* The native select lies invisibly over the whole chip: a click anywhere opens it, the chip shows its value. */
	.pick {
		position: relative;
	}
	.pick .chip-value {
		max-width: 200px;
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
	.pick:has(select:focus-visible) {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
		box-shadow: 0 0 0 2px var(--accent);
	}
	.pick select:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}
	.count {
		padding: 0 var(--space-2);
		white-space: nowrap;
	}
	.spacer {
		flex: 1;
	}

	/* ---------- Table plate: fills the rest of the window, rows scroll under a sticky header ---------- */
	.list {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--plate-fill-table);
	}
	.intro {
		flex: none;
		max-width: 800px;
		padding: 18px var(--cell-edge) 14px;
		color: var(--text-2);
	}
	.scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
	}
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
	}
	thead th {
		position: sticky;
		top: 0;
		z-index: var(--z-sticky);
	}
	th {
		height: var(--control-h);
		padding: 0 var(--cell-x);
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
	td {
		height: var(--row-h);
		padding: 0 var(--cell-x);
		border-bottom: 1px solid var(--line);
		background: var(--row-bg);
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	th:first-child,
	td:first-child {
		padding-left: var(--cell-edge);
	}
	th:last-child,
	td:last-child {
		padding-right: var(--cell-edge);
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	/* A new "from" state starts a group: a slightly stronger rule above it. */
	tr.first:not(:first-child) td {
		box-shadow: inset 0 1px 0 var(--line-strong);
	}
	tbody tr:hover td {
		background: var(--row-hover);
	}
	td.desc {
		white-space: normal;
		min-width: 200px;
		padding-top: 6px;
		padding-bottom: 6px;
	}
	tr.off td.desc,
	tr.off td:nth-child(-n + 2) {
		color: var(--text-2);
	}
	/* Flag columns stay as narrow as their switches; a two-word heading takes two lines. */
	.flag {
		width: 1%;
	}
	th.flag {
		white-space: normal;
		line-height: 1.2;
	}
	.right {
		text-align: right;
	}

	/* Yes/no switch per flag: a capsule button; on = filled ink dot and bold text. */
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		height: var(--control-h);
		min-width: 76px;
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		background: none;
		color: var(--text-2);
		font-weight: 500;
		transition:
			background-color var(--dur-fast) var(--ease-out),
			border-color var(--dur-fast) var(--ease-out);
	}
	.toggle:hover {
		border-color: var(--control-border);
		background: var(--control-fill);
	}
	.toggle .dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1.5px var(--text-2);
	}
	.toggle.on {
		color: var(--ink);
		font-weight: 600;
	}
	.toggle.on .dot {
		background: var(--ink);
		box-shadow: none;
	}

	/* ---------- Dialog content ---------- */
	.pair {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	.change {
		margin: var(--space-1) 0;
	}
	.form {
		display: grid;
		gap: var(--space-4);
	}
	/* Error in the dialog: bold ink text on a quiet ink-tinted box, like the confirm dialog's. */
	.error {
		font-weight: 600;
		padding: 10px 14px;
		border-radius: var(--radius);
		background: rgb(11 27 51 / 0.06);
		box-shadow: inset 0 0 0 1px rgb(11 27 51 / 0.16);
	}

	@media (max-width: 859.98px) {
		.list {
			flex: none;
			height: 560px;
		}
	}
</style>
