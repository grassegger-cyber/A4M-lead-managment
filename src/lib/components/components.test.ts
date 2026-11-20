// Server-side render smoke tests for the shared components (no browser needed).
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Table from './Table.svelte';
import Select from './Select.svelte';
import StateDot from './StateDot.svelte';
import EmptyState from './EmptyState.svelte';
import Pagination from './Pagination.svelte';
import Field from './Field.svelte';

describe('shared components render on the server', () => {
	it('Table shows headers, rows, sort state and pagination', () => {
		const { body } = render(Table, {
			props: {
				columns: [
					{ key: 'ico', label: 'IČO', sortable: true, width: '110px' },
					{ key: 'name', label: 'Název' },
					{ key: 'count', label: 'Počet', align: 'right', format: (v: number) => `${v} ks` }
				],
				rows: [
					{ ico: '99000016', name: 'Testovací firma 00001 s.r.o.', count: 3 },
					{ ico: '99000024', name: null, count: 0 }
				],
				rowKey: 'ico',
				sort: { key: 'ico', dir: 'asc' },
				onSort: () => {},
				page: 2,
				pageSize: 50,
				total: 120,
				onPage: () => {}
			}
		});
		expect(body).toContain('IČO');
		expect(body).toContain('Testovací firma 00001 s.r.o.');
		expect(body).toContain('3 ks');
		expect(body).toContain('aria-sort="ascending"');
		expect(body).toContain('51–100 z 120');
		// Paging: a field to jump to a page, first and last page next to previous and next.
		expect(body).toMatch(/<label[^>]*>Strana<\/label>\s*<input[^>]*value="2"/);
		expect(body).toContain('z 3');
		for (const name of ['První stránka', 'Předchozí stránka', 'Další stránka', 'Poslední stránka']) {
			expect(body, name).toContain(`aria-label="${name}"`);
		}
	});

	it('Table pins leading columns and marks the active row', () => {
		const { body } = render(Table, {
			props: {
				columns: [
					{ key: 'ico', label: 'IČO', width: '112px', pin: true },
					{ key: 'name', label: 'Název', pin: true },
					{ key: 'state', label: 'Stav' }
				],
				rows: [
					{ ico: '99000016', name: 'Testovací firma 00001 s.r.o.', state: 'v_poolu' },
					{ ico: '99000024', name: 'Testovací firma 00002 s.r.o.', state: 'superuser' }
				],
				rowKey: 'ico',
				activeKey: '99000024',
				fill: true
			}
		});
		// The second pinned column starts where the first one ends; the third is not pinned.
		expect(body).toMatch(/<th[^>]*class="[^"]*pinned[^"]*"[^>]*style="[^"]*left: 0px/);
		expect(body).toMatch(/<th[^>]*class="[^"]*pinned[^"]*pin-edge[^"]*"[^>]*style="[^"]*left: 112px/);
		expect(body.match(/<th[^>]*pinned/g)).toHaveLength(2);
		expect(body.match(/aria-current="true"/g)).toHaveLength(1);
		expect(body).toMatch(/<tr(?=[^>]*aria-current="true")(?=[^>]*class="[^"]*active)/);
	});

	it('Table shows the empty state without rows', () => {
		const { body } = render(Table, {
			props: { columns: [{ key: 'ico', label: 'IČO' }], rows: [], rowKey: 'ico', emptyTitle: 'Nic nenalezeno' }
		});
		expect(body).toContain('Nic nenalezeno');
	});

	it('Select renders the placeholder and options', () => {
		const { body } = render(Select, {
			props: { label: 'Stav', value: 'superuser', placeholder: 'Všechny stavy', options: [{ value: 'superuser', label: 'Superuser' }] }
		});
		expect(body).toContain('Všechny stavy');
		expect(body).toContain('Superuser');
		expect(body).toContain('Stav');
	});

	it('StateDot uses the Czech label', () => {
		expect(render(StateDot, { props: { state: 'u_robota_ocisteni' } }).body).toContain('U robota (očištění)');
		expect(render(StateDot, { props: { state: null } }).body).toContain('—');
	});

	it('EmptyState, Pagination and Field render', () => {
		expect(render(EmptyState, { props: { title: 'Prázdno', text: 'Nic tu není.' } }).body).toContain('Nic tu není.');
		expect(render(Pagination, { props: { page: 1, pageSize: 50, total: 0, onPage: () => {} } }).body).toContain('0–0 z 0');
		const field = render(Field, { props: { label: 'Poznámka', value: 'abc', error: 'Povinné pole' } }).body;
		expect(field).toContain('Poznámka');
		expect(field).toContain('Povinné pole');
		expect(field).toContain('aria-invalid="true"');
	});
});
