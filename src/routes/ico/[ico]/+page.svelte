<script lang="ts">
	/** Detail of one IČO as a page of its own (direct link). The list opens the same detail in a panel. */
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Button from '$lib/components/Button.svelte';
	import IcoDetail from '../IcoDetail.svelte';

	const ico = $derived(page.params.ico ?? '');
	let name = $state<string | null>(null);
	let backHref = $state('/ico');

	$effect(() => {
		try {
			backHref = sessionStorage.getItem('ico-list-url') || '/ico';
		} catch {
			backHref = '/ico';
		}
	});
</script>

<svelte:head><title>{name ?? `IČO ${ico}`} · Lead management A4M</title></svelte:head>

<!-- Back to the list: a glass capsule on the backdrop, left above the detail. -->
<div class="back">
	<Button variant="secondary" href={backHref}><ArrowLeft size={18} /> Seznam IČO</Button>
</div>

{#key ico}
	<IcoDetail {ico} onloaded={(company) => (name = company.name)} />
{/key}

<style>
	.back {
		display: flex;
		flex-shrink: 0;
	}
</style>
