<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Building from '@lucide/svelte/icons/building';
	import Upload from '@lucide/svelte/icons/upload';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Settings from '@lucide/svelte/icons/settings';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Toast from '$lib/components/Toast.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import { goto } from '$app/navigation';
	import { call } from '$lib/api';
	import { auth } from '$lib/auth.svelte';

	let { children }: { children: Snippet } = $props();

	const nav = [
		{ href: '/', label: 'Přehled', icon: LayoutDashboard },
		{ href: '/ico', label: 'IČO', icon: Building },
		{ href: '/import', label: 'Import', icon: Upload },
		{ href: '/lhuty', label: 'Lhůty', icon: CalendarClock },
		{ href: '/nastaveni', label: 'Nastavení', icon: Settings },
		{ href: '/audit', label: 'Audit', icon: ScrollText }
	];

	const path = $derived(page.url.pathname);
	const onLogin = $derived(path === '/prihlaseni');
	let loggingOut = $state(false);

	// Convenience only: the server refuses everything without a session that passed 2FA.
	void auth.init();
	$effect(() => {
		if (auth.status === 'loading' || auth.status === 'unconfigured') return;
		if (auth.status !== 'ready' && !onLogin) void goto('/prihlaseni', { replaceState: true });
		else if (auth.status === 'ready' && onLogin) void goto('/', { replaceState: true });
	});

	function isActive(href: string): boolean {
		return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
	}

	async function logout() {
		loggingOut = true;
		try {
			// The audit row is written while the session still exists; a failure must not block the logout.
			await call('auth.sessionEnded').catch(() => undefined);
			await auth.signOut();
			window.location.assign('/prihlaseni');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Odhlášení se nepodařilo.');
			loggingOut = false;
		}
	}
</script>

<svelte:head>
	<title>Lead management A4M</title>
</svelte:head>

{#if auth.status === 'unconfigured'}
	<main class="notice"><p>Aplikace není nastavená: chybí adresa serveru. Nasazení je potřeba spustit znovu.</p></main>
{:else if auth.status === 'loading'}
	<main class="notice" aria-busy="true"></main>
{:else if onLogin}
	{@render children()}
{:else if auth.status !== 'ready'}
	<main class="notice" aria-busy="true"></main>
{:else}
	<div class="shell">
		<a class="skip" href="#obsah">Přeskočit na obsah</a>
		<aside class="nav glass">
			<a class="brand" href="/" aria-label="A4M Lead management, přehled">
				<span class="logo-tile"><img src="/a4m-logo.png" alt="A4M" width="118" height="28" /></span>
				<span class="brand-sub">Lead management</span>
			</a>
			<nav aria-label="Hlavní navigace">
				<ul>
					{#each nav as item (item.href)}
						<li>
							<a href={item.href} class:active={isActive(item.href)} aria-current={isActive(item.href) ? 'page' : undefined}>
								<item.icon size={18} />
								<span>{item.label}</span>
							</a>
						</li>
					{/each}
				</ul>
			</nav>
			<button type="button" class="logout" onclick={logout} disabled={loggingOut}>
				<LogOut size={18} />
				<span>{loggingOut ? 'Odhlašuji…' : 'Odhlásit'}</span>
			</button>
		</aside>
		<main id="obsah">
			{@render children()}
		</main>
	</div>
{/if}

<Toast />

<style>
	.notice {
		min-height: var(--vh);
		display: grid;
		place-items: center;
		padding: var(--space-4);
		color: var(--text-2);
	}
	/* Sidebar column (glass, inset from the window edge) and the main column. The document scrolls;
	   the sidebar stays in view. */
	.shell {
		display: grid;
		grid-template-columns: calc(var(--sidebar-w) + var(--shell-inset)) minmax(0, 1fr);
		min-height: var(--vh);
	}
	.skip {
		position: absolute;
		left: -9999px;
		top: var(--space-4);
		z-index: var(--z-toast);
		display: flex;
		align-items: center;
		height: var(--control-h);
		padding: 0 20px;
		border-radius: var(--radius-control);
		background: var(--accent);
		color: var(--ink);
		font-weight: 600;
		text-decoration: none;
	}
	.skip:focus {
		left: var(--space-4);
	}
	.nav {
		position: sticky;
		top: var(--shell-inset);
		align-self: start;
		height: calc(var(--vh) - 2 * var(--shell-inset));
		margin: var(--shell-inset) 0 var(--shell-inset) var(--shell-inset);
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		padding: var(--space-3);
		overflow-y: auto;
		z-index: var(--z-nav);
	}
	.brand {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 8px 14px 10px;
		border-radius: 18px;
		color: var(--ink);
		text-decoration: none;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.brand:hover {
		background: var(--nav-hover-fill);
	}
	/* The gold A4M logo, unchanged and without a background (Thomas, 20. 11. 2026). */
	.logo-tile {
		display: flex;
		align-items: center;
		height: var(--control-h);
	}
	.logo-tile img {
		display: block;
		height: 22px;
		width: auto;
	}
	.brand-sub {
		font-size: var(--text-caps);
		line-height: 1.3;
		color: var(--text-2);
	}
	nav {
		flex: 1;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-1);
	}
	nav a,
	.logout {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		height: var(--control-h);
		padding: 0 14px;
		border: 0;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--ink);
		font-size: var(--text-body);
		font-weight: 500;
		text-decoration: none;
		text-align: left;
		white-space: nowrap;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	nav a :global(svg),
	.logout :global(svg) {
		flex: none;
	}
	nav a:hover,
	.logout:hover:not(:disabled) {
		background: var(--nav-hover-fill);
	}
	nav a.active {
		background: var(--nav-current-fill);
		box-shadow: var(--nav-current-shadow);
		font-weight: 600;
	}
	nav a.active:hover {
		background: var(--nav-current-hover-fill);
	}
	.logout:disabled {
		color: var(--text-disabled);
		cursor: progress;
	}
	main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--shell-inset) var(--shell-inset) var(--shell-inset) var(--shell-gap);
	}
	/* Narrow window: the sidebar becomes a block above the content, its items wrap in rows. */
	@media (max-width: 859.98px) {
		.shell {
			display: block;
		}
		.nav {
			position: static;
			height: auto;
			margin: var(--shell-inset) var(--shell-inset) 0;
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			overflow: visible;
		}
		nav {
			flex: 1 1 100%;
		}
		ul {
			display: flex;
			flex-wrap: wrap;
		}
		nav a,
		.logout {
			width: auto;
		}
		main {
			padding: var(--shell-inset);
		}
	}
</style>
