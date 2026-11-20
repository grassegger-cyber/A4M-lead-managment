<script lang="ts">
	/** Toast host. Rendered once in the root layout; messages come from toasts.svelte.ts. */
	import X from '@lucide/svelte/icons/x';
	import { toast } from './toasts.svelte';
</script>

<div class="toasts" aria-live="polite">
	{#each toast.items as item (item.id)}
		<div class="toast {item.kind}" role={item.kind === 'error' ? 'alert' : 'status'}>
			<span class="dot" aria-hidden="true"></span>
			<span class="message">{item.message}</span>
			<button type="button" aria-label="Zavřít oznámení" onclick={() => toast.dismiss(item.id)}><X size={16} /></button>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		right: var(--space-4);
		bottom: var(--space-4);
		z-index: var(--z-toast);
		display: grid;
		gap: var(--space-2);
		width: min(420px, calc(100vw - 32px));
	}
	/* Glass capsule; denser fill than the sidebar because it can lie over any content. */
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 56px;
		padding: 5px 5px 5px 20px;
		border: 1px solid var(--glass-rim);
		border-radius: var(--radius-float);
		background: var(--glass-fill-strong);
		-webkit-backdrop-filter: var(--glass-blur);
		backdrop-filter: var(--glass-blur);
		box-shadow: var(--glass-light), var(--pop-shadow);
		color: var(--ink);
		font-size: var(--text-body);
		animation: toast-in 200ms var(--ease-out);
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
	.dot {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--ink);
	}
	.info .dot {
		background: var(--state-ve_filtru);
		box-shadow: inset 0 0 0 1px var(--dot-rim);
	}
	.error .dot {
		background: transparent;
		box-shadow: inset 0 0 0 2px var(--ink);
	}
	.error {
		font-weight: 600;
	}
	.message {
		flex: 1;
		min-width: 0;
		padding: 6px 0;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	button {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--ink);
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	button:hover {
		background: rgb(255 255 255 / 0.8);
	}
</style>
