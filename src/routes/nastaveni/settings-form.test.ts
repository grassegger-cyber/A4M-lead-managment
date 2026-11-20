import { describe, expect, it } from 'vitest';
import { canonical, displayValue, parseDraft, toDraft } from './settings-form.ts';

const item = (valueType: any, defaultValue: unknown) => ({ valueType, defaultValue });

describe('settings form', () => {
	it('parses numbers with a Czech decimal comma and spaces', () => {
		expect(parseDraft(item('number', 1), '0,002')).toEqual({ ok: true, value: 0.002 });
		expect(parseDraft(item('number', 1), '10 000')).toEqual({ ok: true, value: 10000 });
		expect(parseDraft(item('number', 1), 'deset').ok).toBe(false);
		expect(parseDraft(item('number', 1), '-1').ok).toBe(false);
		expect(parseDraft(item('number', 1), '').ok).toBe(false);
	});
	it('parses lists one item per line, numeric when the default is numeric', () => {
		expect(parseDraft(item('list', ['A']), 'VBCPOOL\n\n SADMIN \n')).toEqual({ ok: true, value: ['VBCPOOL', 'SADMIN'] });
		expect(parseDraft(item('list', [1, 5]), '1\n5\n15')).toEqual({ ok: true, value: [1, 5, 15] });
		expect(parseDraft(item('list', [1, 5]), '1\nx').ok).toBe(false);
		expect(parseDraft(item('list', []), '')).toEqual({ ok: true, value: [] });
		expect(parseDraft(item('list', ['A']), 'A\nA').ok).toBe(false);
	});
	it('parses JSON objects only', () => {
		expect(parseDraft(item('map', {}), '{"from": 6, "to": 20}')).toEqual({ ok: true, value: { from: 6, to: 20 } });
		expect(parseDraft(item('map', {}), '[1]').ok).toBe(false);
		expect(parseDraft(item('map', {}), '{oops').ok).toBe(false);
	});
	it('treats empty text as null only for undecided settings', () => {
		expect(parseDraft(item('text', null), ' ')).toEqual({ ok: true, value: null });
		expect(parseDraft(item('text', 'any'), ' ').ok).toBe(false);
		expect(parseDraft(item('boolean', true), false)).toEqual({ ok: true, value: false });
	});
	it('round-trips values through the draft', () => {
		for (const [type, def, value] of [
			['number', 1, 0.002],
			['text', 'a', 'any'],
			['boolean', true, false],
			['list', ['A'], ['VBCPOOL', 'SADMIN']],
			['list', [1], [1, 5, 15]],
			['map', {}, { a: { b: [1, 2] } }]
		] as const) {
			const parsed = parseDraft(item(type, def), toDraft(item(type, def), value));
			expect(parsed).toEqual({ ok: true, value });
		}
	});
	it('compares maps regardless of key order and prints values in Czech', () => {
		expect(canonical({ a: 1, b: [1, { d: 1, c: 2 }] })).toBe(canonical({ b: [1, { c: 2, d: 1 }], a: 1 }));
		expect(displayValue(item('boolean', true), true)).toBe('Ano');
		expect(displayValue(item('text', null), null)).toBe('neurčeno');
		expect(displayValue(item('list', []), [])).toBe('prázdný seznam');
	});
});
