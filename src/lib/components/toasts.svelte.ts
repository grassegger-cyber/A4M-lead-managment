// Toast messages. Usage: import { toast } from '$lib/components/toasts.svelte';
// toast.success('Uloženo'), toast.error('Nepodařilo se…'), toast.info('…').
export interface ToastItem {
	id: number;
	kind: 'success' | 'error' | 'info';
	message: string;
}

let nextId = 1;
const items = $state<ToastItem[]>([]);

function push(kind: ToastItem['kind'], message: string, ms: number) {
	const id = nextId++;
	items.push({ id, kind, message });
	if (ms > 0) setTimeout(() => dismiss(id), ms);
	return id;
}

function dismiss(id: number) {
	const index = items.findIndex((item) => item.id === id);
	if (index !== -1) items.splice(index, 1);
}

export const toast = {
	get items() {
		return items;
	},
	success: (message: string) => push('success', message, 4000),
	info: (message: string) => push('info', message, 5000),
	/** Errors stay until dismissed. */
	error: (message: string) => push('error', message, 0),
	dismiss
};
