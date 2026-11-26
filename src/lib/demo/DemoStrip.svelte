<script lang="ts">
	/**
	 * Demo build only: the strip above every page, the loading screen while the fictional data are
	 * prepared in this browser, and the reset. The sign-in and password pages lead to the overview.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/Button.svelte';
	import Confirm from '$lib/components/Confirm.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import { demo, resetDemoData, startDemo } from './worker-client.svelte.ts';

	/** A database that opens quickly shows no loading screen at all. */
	const LOADING_DELAY_MS = 600;

	let stripHeight = $state(0);
	let slowStart = $state(false);
	let confirmOpen = $state(false);
	let reloading = $state(false);

	const busy = $derived(reloading || demo.phase === 'seeding' || demo.phase === 'resetting' || (demo.phase === 'starting' && slowStart));
	const covered = $derived(busy || demo.phase === 'locked' || demo.phase === 'failed');

	onMount(() => {
		startDemo();
		const timer = setTimeout(() => (slowStart = true), LOADING_DELAY_MS);
		return () => clearTimeout(timer);
	});

	// No login in the demo.
	$effect(() => {
		const path = page.url.pathname.replace(/\/+$/, '') || '/';
		if (path === '/prihlaseni' || path === '/nastaveni-hesla') goto('/', { replaceState: true });
	});

	// Full-window pages size themselves to --vh: leave room for the strip.
	$effect(() => {
		const root = document.documentElement;
		const unit = CSS.supports('height', '100dvh') ? '100dvh' : '100vh';
		root.style.setProperty('--vh', `calc(${unit} - ${stripHeight}px)`);
		return () => root.style.removeProperty('--vh');
	});

	async function reset() {
		reloading = true;
		try {
			await resetDemoData();
			window.location.assign('/');
		} catch (e) {
			reloading = false;
			toast.error(e instanceof Error ? e.message : 'Ukázková data se nepodařilo obnovit.');
		}
	}
</script>

<div class="strip glass" data-phase={demo.phase} bind:offsetHeight={stripHeight}>
	<p><strong>Ukázka se smyšlenými daty</strong> · změny vidíte jen vy v tomto prohlížeči</p>
	<Button variant="secondary" size="sm" onclick={() => (confirmOpen = true)} disabled={busy}>Obnovit ukázková data</Button>
</div>

{#if covered}
	<div class="cover">
		<div class="glass card" role="status" aria-live="polite">
			{#if demo.phase === 'locked'}
				<h2>Ukázka je otevřená v jiné záložce</h2>
				<p>Zavřete ji. Tady se ukázka potom načte sama.</p>
			{:else if demo.phase === 'failed' && !reloading}
				<h2>Ukázku se nepodařilo spustit</h2>
				{#if demo.detail}<p>{demo.detail}</p>{/if}
				<div class="actions">
					<Button variant="secondary" onclick={() => window.location.reload()}>Načíst znovu</Button>
					<Button onclick={reset}>Obnovit ukázková data</Button>
				</div>
			{:else}
				<h2>Připravuji ukázková data…</h2>
				{#if demo.phase === 'seeding' || demo.phase === 'resetting'}
					<p>V tomto prohlížeči se vytvářejí smyšlená IČO. Trvá to pár sekund.</p>
				{/if}
				<div class="bar" aria-hidden="true"><span></span></div>
			{/if}
		</div>
	</div>
{/if}

<Confirm
	bind:open={confirmOpen}
	title="Obnovit ukázková data?"
	message="Všechny vaše změny v ukázce se zahodí a smyšlená data se vytvoří znovu."
	confirmLabel="Obnovit"
	onConfirm={() => {
		confirmOpen = false;
		void reset();
	}}
/>

<style>
	/* A thin glass strip along the top edge of the window; the shell below keeps its own insets.
	   The text lines up with the logo in the sidebar, the button with the right edge of the plates. */
	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
		padding: 4px var(--shell-inset) 4px calc(var(--shell-inset) + 26px);
		border-width: 0 0 1px;
		border-color: var(--line);
		border-radius: 0;
		box-shadow: none;
	}
	.strip p {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.3;
		color: var(--text-2);
	}
	.strip strong {
		color: var(--ink);
		font-weight: 600;
	}
	/* Covers the app while the data are not usable; the app stays visible, muted, behind it. */
	.cover {
		position: fixed;
		inset: 0;
		z-index: var(--z-dialog);
		display: grid;
		place-items: center;
		padding: var(--space-4);
		background: rgb(242 243 245 / 0.72);
		-webkit-backdrop-filter: blur(6px);
		backdrop-filter: blur(6px);
	}
	.card {
		display: grid;
		gap: var(--space-3);
		width: min(440px, 100%);
		padding: var(--space-5) var(--space-6);
	}
	.card h2 {
		margin: 0;
		font-size: var(--text-lead);
		line-height: 1.3;
	}
	.card p {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		color: var(--text-2);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.bar {
		position: relative;
		height: 4px;
		margin-top: var(--space-1);
		overflow: hidden;
		border-radius: var(--radius-pill);
		background: var(--line-2);
	}
	.bar span {
		position: absolute;
		inset: 0 auto 0 0;
		width: 35%;
		border-radius: inherit;
		background: var(--ink);
		animation: slide 1.4s var(--ease-out) infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(290%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar span {
			animation: none;
			width: 100%;
			opacity: 0.35;
		}
	}
</style>
