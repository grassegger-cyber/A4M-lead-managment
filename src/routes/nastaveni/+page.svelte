<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import RulesTab from './RulesTab.svelte';
	import TransitionsTab from './TransitionsTab.svelte';
	import AccountTab from './AccountTab.svelte';

	const tabs = [
		{ id: 'pravidla', label: 'Pravidla' },
		{ id: 'prechody', label: 'Přechody stavů' },
		{ id: 'ucet', label: 'Účet' }
	] as const;
	type TabId = (typeof tabs)[number]['id'];

	const active = $derived<TabId>(tabs.find((t) => t.id === page.url.searchParams.get('zalozka'))?.id ?? 'pravidla');

	function select(id: TabId) {
		const url = new URL(page.url);
		if (id === 'pravidla') url.searchParams.delete('zalozka');
		else url.searchParams.set('zalozka', id);
		goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const index = tabs.findIndex((t) => t.id === active);
		const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
		select(next.id);
		document.getElementById(`tab-${next.id}`)?.focus();
	}
</script>

<svelte:head><title>Nastavení pravidel · Lead management A4M</title></svelte:head>

<!-- The transitions table fills the window (only its rows scroll); the other tabs let the page scroll. -->
<div class="page" class:fill={active === 'prechody'}>
	<div class="page-head">
		<div class="title">
			<h1>Nastavení <strong>pravidel</strong></h1>
			<p class="sub">Bez zásahu do kódu</p>
		</div>
		<div class="tabs" role="tablist" aria-label="Části nastavení" tabindex="-1" onkeydown={onKeydown}>
			{#each tabs as tab (tab.id)}
				<button
					type="button"
					role="tab"
					id="tab-{tab.id}"
					aria-selected={active === tab.id}
					aria-controls="panel-{tab.id}"
					tabindex={active === tab.id ? 0 : -1}
					class:active={active === tab.id}
					onclick={() => select(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="tabpanel" role="tabpanel" id="panel-{active}" aria-labelledby="tab-{active}">
		{#if active === 'pravidla'}
			<RulesTab />
		{:else if active === 'prechody'}
			<TransitionsTab />
		{:else}
			<AccountTab />
		{/if}
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.page.fill {
		height: var(--page-h);
	}
	/* Title with its one-line description beside it; the section tabs sit at the right of the row. */
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
	.tabpanel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.fill .tabpanel {
		flex: 1 1 auto;
		min-height: 0;
	}
	@media (max-width: 859.98px) {
		.page.fill {
			height: auto;
		}
	}
</style>
