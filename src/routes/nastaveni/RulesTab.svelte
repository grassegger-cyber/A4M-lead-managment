<script lang="ts">
	/** Business rule settings grouped by area. Every save and reset goes through a confirm dialog. */
	import { onMount } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import { call } from '$lib/api';
	import { formatDateTime } from '$lib/format';
	import Button from '$lib/components/Button.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import { VALUE_TYPE_LABELS, canonical, displayValue, parseDraft, toDraft } from './settings-form';
	import type { Draft, Parsed, SettingItem } from './settings-form';

	interface Group {
		key: string;
		label: string;
		items: SettingItem[];
	}

	let groups = $state<Group[] | null>(null);
	let loadError = $state<string | null>(null);
	let drafts = $state<Record<string, Draft>>({});
	let search = $state('');
	let onlyChanged = $state(false);

	// Pending confirm: what will be written for which setting.
	let pending = $state<{ item: SettingItem; kind: 'update' | 'reset'; value: unknown } | null>(null);
	let confirmOpen = $state(false);

	const norm = (text: string) =>
		text
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '');

	const visible = $derived.by(() => {
		const q = norm(search.trim());
		return (groups ?? [])
			.map((g) => ({
				...g,
				items: g.items.filter(
					(i) =>
						(!onlyChanged || !i.isDefault) &&
						(!q || norm(`${i.label} ${i.key} ${i.help ?? ''} ${g.label}`).includes(q))
				)
			}))
			.filter((g) => g.items.length > 0);
	});
	const changedCount = $derived((groups ?? []).reduce((n, g) => n + g.items.filter((i) => !i.isDefault).length, 0));

	function parsed(item: SettingItem): Parsed {
		return parseDraft(item, drafts[item.key] ?? toDraft(item, item.value));
	}
	function isDirty(item: SettingItem, p: Parsed): boolean {
		return !p.ok || canonical(p.value) !== canonical(item.value);
	}

	async function load() {
		try {
			const data = await call<{ groups: Group[] }>('settings.list');
			groups = data.groups;
			drafts = Object.fromEntries(data.groups.flatMap((g) => g.items.map((i) => [i.key, toDraft(i, i.value)])));
			loadError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Nastavení se nepodařilo načíst.';
		}
	}
	onMount(load);

	function askSave(item: SettingItem) {
		const p = parsed(item);
		if (!p.ok) return;
		pending = { item, kind: 'update', value: p.value };
		confirmOpen = true;
	}
	function askReset(item: SettingItem) {
		pending = { item, kind: 'reset', value: item.defaultValue };
		confirmOpen = true;
	}
	function discard(item: SettingItem) {
		drafts[item.key] = toDraft(item, item.value);
	}

	async function confirm() {
		if (!pending) return;
		const { item, kind, value } = pending;
		const result = await call<{ value: unknown; changed: boolean; updatedAt: string | null }>(
			kind === 'update' ? 'settings.update' : 'settings.reset',
			kind === 'update' ? { key: item.key, value } : { key: item.key }
		);
		item.value = result.value;
		item.isDefault = canonical(result.value) === canonical(item.defaultValue);
		item.updatedAt = result.updatedAt;
		drafts[item.key] = toDraft(item, result.value);
		toast.success(
			result.changed
				? kind === 'update'
					? `Uloženo: ${item.label}`
					: `Vráceno na výchozí: ${item.label}`
				: 'Hodnota se nezměnila.'
		);
	}
</script>

{#if loadError}
	<div class="panel">
		<EmptyState title="Nastavení se nepodařilo načíst" text={loadError}>
			<Button variant="secondary" onclick={load}>Zkusit znovu</Button>
		</EmptyState>
	</div>
{:else if !groups}
	<div class="panel panel-pad"><p class="text-muted">Načítám…</p></div>
{:else}
	<!-- Search and the filter float on one glass capsule above both the group list and the plates. -->
	<div class="toolbar">
		<label class="search">
			<Search size={18} />
			<span class="visually-hidden">Hledat v nastavení</span>
			<input type="search" placeholder="Hledat podle názvu nebo klíče" bind:value={search} />
		</label>
		<label class="filter-check">
			<input type="checkbox" bind:checked={onlyChanged} />
			<span>Jen změněná oproti výchozímu ({changedCount})</span>
		</label>
	</div>

	<div class="layout">
		<nav class="groups glass" class:empty={visible.length === 0} aria-label="Skupiny nastavení">
			<ul>
				{#each visible as group (group.key)}
					<li><a href="#skupina-{group.key}">{group.label}<span class="num text-muted">{group.items.length}</span></a></li>
				{/each}
			</ul>
		</nav>

		<div class="content">
			{#if visible.length === 0}
				<div class="panel"><EmptyState title="Nic neodpovídá" text="Zkuste jiný výraz nebo zrušte filtr." /></div>
			{/if}

			{#each visible as group (group.key)}
				<section class="panel group" id="skupina-{group.key}" aria-labelledby="nadpis-{group.key}">
					<h2 id="nadpis-{group.key}">{group.label}</h2>
					{#each group.items as item (item.key)}
						{@const p = parsed(item)}
						{@const dirty = isDirty(item, p)}
						{@const inputId = `nastaveni-${item.key}`}
						<div class="row" class:dirty>
							<div class="about">
								<label for={inputId}>{item.label}</label>
								{#if item.help}<p class="help">{item.help}</p>{/if}
								<p class="meta">
									<code>{item.key}</code>
									<span>{VALUE_TYPE_LABELS[item.valueType]}</span>
									{#if !item.isDefault}
										<span class="tag accent">Změněno</span>
										<span>{formatDateTime(item.updatedAt)}</span>
									{/if}
								</p>
							</div>

							<div class="control">
								{#if item.valueType === 'boolean'}
									<label class="check">
										<input
											id={inputId}
											type="checkbox"
											checked={drafts[item.key] === true}
											onchange={(e) => (drafts[item.key] = e.currentTarget.checked)}
										/>
										<span>{drafts[item.key] === true ? 'Ano' : 'Ne'}</span>
									</label>
								{:else if item.valueType === 'list' || item.valueType === 'map'}
									<textarea
										id={inputId}
										class:mono={item.valueType === 'map'}
										rows={Math.min(12, Math.max(3, String(drafts[item.key] ?? '').split('\n').length + 1))}
										spellcheck="false"
										aria-invalid={!p.ok || undefined}
										aria-describedby="{inputId}-note"
										value={String(drafts[item.key] ?? '')}
										oninput={(e) => (drafts[item.key] = e.currentTarget.value)}
									></textarea>
								{:else}
									<input
										id={inputId}
										type="text"
										class:number={item.valueType === 'number'}
										inputmode={item.valueType === 'number' ? 'decimal' : undefined}
										autocomplete="off"
										placeholder={item.defaultValue === null ? 'neurčeno' : undefined}
										aria-invalid={!p.ok || undefined}
										aria-describedby="{inputId}-note"
										value={String(drafts[item.key] ?? '')}
										oninput={(e) => (drafts[item.key] = e.currentTarget.value)}
									/>
								{/if}
								<p class="note" id="{inputId}-note">
									{#if !p.ok}
										<strong>{p.error}</strong>
									{:else if item.valueType === 'list'}
										Jedna položka na řádek.
									{:else if item.valueType === 'map'}
										Objekt ve formátu JSON.
									{/if}
									{#if !item.isDefault}
										<span class="default">Výchozí: {displayValue(item, item.defaultValue)}</span>
									{/if}
								</p>
							</div>

							<div class="actions">
								{#if dirty}
									<Button size="sm" disabled={!p.ok} onclick={() => askSave(item)}>Uložit</Button>
									<Button size="sm" variant="ghost" onclick={() => discard(item)}>Zahodit</Button>
								{:else if !item.isDefault}
									<Button size="sm" variant="secondary" onclick={() => askReset(item)}>Vrátit výchozí</Button>
								{/if}
							</div>
						</div>
					{/each}
				</section>
			{/each}
		</div>
	</div>
{/if}

<Confirm
	bind:open={confirmOpen}
	title={pending?.kind === 'reset' ? 'Vrátit výchozí hodnotu?' : 'Uložit změnu nastavení?'}
	confirmLabel={pending?.kind === 'reset' ? 'Vrátit výchozí' : 'Uložit změnu'}
	onConfirm={confirm}
>
	{#if pending}
		<p class="confirm-label"><strong>{pending.item.label}</strong></p>
		<dl class="facts change">
			<dt>Nyní</dt>
			<dd><pre>{displayValue(pending.item, pending.item.value)}</pre></dd>
			<dt>Nově</dt>
			<dd><pre>{displayValue(pending.item, pending.value)}</pre></dd>
		</dl>
		<p class="text-muted">Změna platí hned a zapíše se do auditu.</p>
	{/if}
</Confirm>

<style>
	/* ---------- Toolbar: search capsule and the "only changed" filter ---------- */
	.search {
		flex: 1 1 260px;
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
	.search input {
		flex: 1;
		min-width: 0;
		height: 40px;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--ink);
	}
	.search input:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}
	.filter-check {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		height: var(--control-h);
		padding: 0 18px 0 14px;
		border: 1px solid var(--control-border);
		border-radius: var(--radius-control);
		background: var(--control-fill);
		white-space: nowrap;
		cursor: pointer;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.filter-check:hover,
	.filter-check:has(input:checked) {
		background: var(--control-fill-hover);
	}
	.filter-check:has(input:focus-visible) {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
		box-shadow: 0 0 0 2px var(--accent);
	}
	.filter-check input:focus-visible {
		outline: none !important;
		box-shadow: none !important;
	}

	/* ---------- Group list (glass, stays in view) beside the plates ---------- */
	.layout {
		display: grid;
		grid-template-columns: 224px minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.groups {
		position: sticky;
		top: var(--shell-inset);
		max-height: calc(var(--vh) - 2 * var(--shell-inset));
		overflow-y: auto;
		padding: var(--space-2);
	}
	.groups.empty {
		display: none;
	}
	.groups ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.groups a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--control-h);
		padding: 0 14px;
		border-radius: var(--radius-control);
		color: var(--ink);
		font-weight: 500;
		text-decoration: none;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.groups a:hover {
		background: var(--nav-hover-fill);
	}
	.groups .num {
		font-size: var(--text-small);
		font-weight: 400;
	}
	.content {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}

	/* ---------- One plate per group: heading, then one row per setting ---------- */
	.group {
		overflow: hidden;
		scroll-margin-top: var(--shell-inset);
	}
	.group h2 {
		padding: var(--plate-pad-y) var(--plate-pad-x) 14px;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(220px, 5fr) minmax(220px, 5fr) 176px;
		gap: var(--space-4);
		padding: var(--space-4) var(--plate-pad-x);
		border-top: 1px solid var(--line);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	/* Unsaved edit: the row takes the pale yellow of a selected row. */
	.row.dirty {
		background: var(--accent-50);
	}
	.about label {
		font-weight: 600;
	}
	.help {
		margin-top: 2px;
		font-size: var(--text-small);
		color: var(--text-2);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		margin-top: 6px;
		font-size: var(--text-caps);
		color: var(--text-2);
	}
	/* Long keys break inside the narrow column instead of running past the plate. */
	.meta code {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	/* Inputs: 44 px capsules (white with a hairline on the plate), lists and maps as rounded boxes. */
	.control input[type='text'],
	.control textarea {
		width: 100%;
		height: var(--control-h);
		margin: 0;
		padding: 0 16px;
		border: 1px solid var(--field-border);
		border-radius: var(--radius-control);
		background: var(--field-fill);
		color: var(--ink);
		transition: border-color var(--dur-fast) var(--ease-out);
	}
	.control textarea {
		display: block;
		height: auto;
		min-height: var(--control-h);
		padding: 10px 16px;
		border-radius: var(--radius-sheet);
		line-height: 1.45;
		resize: vertical;
	}
	.control input[type='text']:hover,
	.control textarea:hover {
		border-color: var(--field-border-hover);
	}
	.control [aria-invalid='true'] {
		border-color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--ink);
	}
	.control input.number {
		max-width: 160px;
		text-align: right;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--text-caps);
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--control-h);
		cursor: pointer;
	}
	.check input,
	.filter-check input {
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--ink);
		cursor: pointer;
	}
	.note {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin-top: 6px;
		font-size: var(--text-small);
		color: var(--text-2);
	}
	.note strong {
		color: var(--ink);
	}
	.default {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	/* ---------- Confirm dialog content ---------- */
	.confirm-label {
		margin-bottom: var(--space-3);
	}
	.change {
		margin-bottom: var(--space-3);
	}
	.change pre {
		margin: 0;
		font-family: inherit;
		font-size: inherit;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 180px;
		overflow-y: auto;
	}

	@media (max-width: 1100px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.groups {
			display: none;
		}
		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-2);
		}
		.actions {
			justify-content: flex-start;
		}
	}
</style>
