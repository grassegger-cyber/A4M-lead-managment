<script lang="ts">
	/**
	 * Detail of one IČO: ownership, return and quarantine, subject, phones, state history and the
	 * sales reps it went through, with the manual change of state and the override of dates.
	 * Used as a page (/ico/[ico]) and as the panel next to the list (embedded).
	 */
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import X from '@lucide/svelte/icons/x';
	import { call } from '$lib/api';
	import {
		CHANNEL_LABELS,
		HISTORY_SOURCE_LABELS,
		HOLDER_LABELS,
		HOLDER_TYPES,
		OPERATOR_LABELS,
		SUBJECT_TYPE_LABELS,
		stateLabel
	} from '$lib/states';
	import type { Channel, CompanyState, HistorySource, HolderType, Operator, SubjectType } from '$lib/states';
	import { formatDate, formatDateTime, formatNumber, formatPhone } from '$lib/format';
	import { reasonLabel } from '$lib/reason-labels';
	import Button from '$lib/components/Button.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import Field from '$lib/components/Field.svelte';
	import Select from '$lib/components/Select.svelte';
	import StateDot from '$lib/components/StateDot.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { toast } from '$lib/components/toasts.svelte';
	import DateInput from './DateInput.svelte';
	import { splitHolder } from './filters';

	interface Company {
		ico: string;
		name: string | null;
		subject_type: SubjectType | null;
		legal_form_code: string | null;
		region_name: string | null;
		district_name: string | null;
		nace_codes: string[];
		founded_on: string | null;
		dissolved_on: string | null;
		ico_valid: boolean | null;
		ico_verified_at: string | null;
		state: CompanyState;
		holder_type: HolderType;
		holder_login: string | null;
		sales_rep_id: number | null;
		sales_rep_name: string | null;
		sales_rep_login: string | null;
		owned_from: string | null;
		ownership_ends_on: string | null;
		cohort_code: string | null;
		channel: Channel | null;
		rounds_count: number;
		return_on: string | null;
		return_path: string | null;
		quarantine_until: string | null;
		never_return: boolean;
		return_on_overridden: boolean;
		return_on_override_note: string | null;
		quarantine_overridden: boolean;
		quarantine_override_note: string | null;
		ca_number: string | null;
		siebel_owner: string | null;
		siebel_opportunity_valid_until: string | null;
		siebel_checked_at: string | null;
		raynet_company_id: number | null;
		created_at: string;
		updated_at: string;
	}
	interface Phone {
		id: number;
		phone: string;
		is_primary: boolean;
		operator: Operator | null;
		operator_verified_at: string | null;
		number_type: string | null;
		source: string | null;
	}
	interface HistoryRow {
		id: number;
		at: string;
		from_state: string | null;
		to_state: string;
		from_holder: string | null;
		to_holder: string | null;
		reason_code: string | null;
		note: string | null;
		source: HistorySource;
		actor_name: string | null;
		cohort_code: string | null;
	}
	interface Assignment {
		id: number;
		sales_rep_name: string;
		siebel_login: string | null;
		channel: Channel | null;
		source: string | null;
		round_no: number;
		cohort_code: string | null;
		assigned_from: string;
		assigned_to: string | null;
		end_reason: string | null;
		end_note: string | null;
	}
	interface TransitionOption {
		to_state: CompanyState;
		label_cs: string;
		note_required: boolean;
	}
	interface Override {
		id: number;
		at: string;
		actor_name: string | null;
		details: {
			note?: string;
			return_on?: { old: string | null; new: string | null };
			quarantine_until?: { old: string | null; new: string | null };
		} | null;
	}
	interface Detail {
		company: Company;
		phones: Phone[];
		history: HistoryRow[];
		assignments: Assignment[];
		transitions: TransitionOption[];
		overrides: Override[];
	}
	interface Options {
		reps: { id: number; name: string; siebel_login: string | null; active: boolean }[];
		pools: { free: string[]; releaseTargets: string[] };
		/** Holder a manual change into a state sets (setting ownership.manual_holder_by_state). */
		holderByState?: Partial<Record<CompanyState, HolderType>>;
	}

	interface Props {
		ico: string;
		/** Shown in the panel next to the list: compact head, one column, a close button. */
		embedded?: boolean;
		/** Called after the state or a date was changed, so the list can reload the row. */
		onchanged?: () => void;
		onclose?: () => void;
		/** Called with the name once the company is loaded (the page puts it into the title). */
		onloaded?: (company: { ico: string; name: string | null }) => void;
	}

	let { ico, embedded = false, onchanged, onclose, onloaded }: Props = $props();

	const ASSIGNMENT_SOURCE_LABELS: Record<string, string> = {
		operator_handover: 'Předání operátorkou',
		cold_call_allocation: 'Přidělení cold call',
		rotation: 'Rotace',
		manual: 'Ručně'
	};
	const RETURN_PATH_LABELS: Record<string, string> = {
		siebel_check: 'Kontrola vlastníka v Siebelu',
		robot: 'Robot'
	};
	const PHONE_SOURCE_LABELS: Record<string, string> = {
		import: 'Import',
		manual: 'Ručně',
		raynet: 'Raynet'
	};

	let detail = $state<Detail | null>(null);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let options = $state<Options | null>(null);

	// Change of state
	let stateOpen = $state(false);
	let toState = $state('');
	let reason = $state('');
	let repId = $state('');
	let holderType = $state('');
	let holderLogin = $state('');
	let stateBusy = $state(false);
	let stateError = $state<string | null>(null);

	// Override of dates
	let datesOpen = $state(false);
	let overrideReturn = $state(false);
	let overrideQuarantine = $state(false);
	let newReturnOn = $state('');
	let newQuarantineUntil = $state('');
	let returnInvalid = $state(false);
	let quarantineInvalid = $state(false);
	let datesNote = $state('');
	let datesBusy = $state(false);
	let datesError = $state<string | null>(null);

	const company = $derived(detail?.company ?? null);
	const target = $derived(detail?.transitions.find((t) => t.to_state === toState) ?? null);
	/** Holder the chosen target state brings with it; null leaves the holder to the user. */
	const requiredHolder = $derived<HolderType | null>(
		toState && toState !== 'login_oz' ? (options?.holderByState?.[toState as CompanyState] ?? null) : null
	);
	const transitionOptions = $derived(
		(detail?.transitions ?? []).map((t) => ({ value: t.to_state, label: `${stateLabel(t.to_state)} · ${t.label_cs}` }))
	);
	const repOptions = $derived(
		(options?.reps ?? [])
			.filter((r) => r.active)
			.map((r) => ({ value: String(r.id), label: r.siebel_login ? `${r.name} · ${r.siebel_login}` : r.name }))
	);
	const poolOptions = $derived((options?.pools.free ?? []).map((pool) => ({ value: pool, label: pool })));
	const holderOptions = HOLDER_TYPES.filter((type) => type !== 'login_oz').map((value) => ({ value, label: HOLDER_LABELS[value] }));

	$effect(() => {
		load(ico);
	});

	$effect(() => {
		call<Options>('companies.filterOptions')
			.then((o) => (options = o))
			.catch(() => {
				// The dialogs explain what is missing when the options did not load.
			});
	});

	async function load(which: string, quiet = false) {
		if (!quiet) {
			loading = true;
			detail = null;
		}
		try {
			const data = await call<Detail>('companies.get', { ico: which });
			if (which !== ico) return;
			detail = data;
			error = null;
			onloaded?.({ ico: data.company.ico, name: data.company.name });
		} catch (e) {
			if (which !== ico) return;
			error = e instanceof Error ? e.message : 'Detail se nepodařilo načíst.';
		} finally {
			if (which === ico) loading = false;
		}
	}

	function holderText(text: string | null): string {
		const holder = splitHolder(text);
		if (!holder) return '—';
		const label = HOLDER_LABELS[holder.type as HolderType] ?? holder.type;
		return holder.login ? `${label} · ${holder.login}` : label;
	}

	/** Reason of a history row in words; a manual change is already named by its source. */
	function historyReason(item: HistoryRow): string | null {
		if (!item.reason_code || item.reason_code === 'manual') return null;
		return reasonLabel(item.reason_code);
	}

	/** Source, reason, who and cohort of a history row; the same words are not said twice. */
	function historyMeta(item: HistoryRow, why: string | null): string {
		const parts = [
			HISTORY_SOURCE_LABELS[item.source] ?? item.source,
			why,
			item.actor_name,
			item.cohort_code ? `dávka ${item.cohort_code}` : null
		].filter((part): part is string => !!part);
		return [...new Set(parts)].join(' · ');
	}

	function openState() {
		toState = '';
		reason = '';
		repId = '';
		holderType = '';
		holderLogin = '';
		stateError = null;
		stateOpen = true;
	}

	function onTargetChange() {
		// The holder fields depend on the target state: start them empty for the new choice.
		holderType = '';
		holderLogin = '';
		repId = '';
		stateError = null;
	}

	async function submitState() {
		if (!company) return;
		if (!toState) return void (stateError = 'Vyberte cílový stav.');
		if (toState === 'login_oz' && !repId) return void (stateError = 'Vyberte obchodníka, na jehož login IČO přechází.');
		if (requiredHolder === 'pool' && !holderLogin) return void (stateError = 'Vyberte pool, do kterého IČO přechází.');
		if (target?.note_required && !reason.trim()) {
			return void (stateError = 'U tohoto přechodu je důvod povinný (nastavení přechodů stavů).');
		}
		stateError = null;
		stateBusy = true;
		const holder = toState === 'login_oz' ? '' : (requiredHolder ?? holderType);
		try {
			await call('companies.transition', {
				ico: company.ico,
				toState,
				reason: reason.trim(),
				expectedFromState: company.state,
				salesRepId: toState === 'login_oz' ? Number(repId) : undefined,
				holderType: holder || undefined,
				holderLogin: holder && holderLogin.trim() ? holderLogin.trim() : undefined
			});
			toast.success(`Stav změněn: ${stateLabel(company.state)} → ${stateLabel(toState)}`);
			stateOpen = false;
			await load(company.ico, true);
			onchanged?.();
		} catch (e) {
			stateError = e instanceof Error ? e.message : 'Stav se nepodařilo změnit.';
		} finally {
			stateBusy = false;
		}
	}

	function openDates() {
		overrideReturn = false;
		overrideQuarantine = false;
		newReturnOn = company?.return_on ?? '';
		newQuarantineUntil = company?.quarantine_until ?? '';
		returnInvalid = false;
		quarantineInvalid = false;
		datesNote = '';
		datesError = null;
		datesOpen = true;
	}

	async function submitDates() {
		if (!company) return;
		if (!overrideReturn && !overrideQuarantine) return void (datesError = 'Zaškrtněte, které datum chcete přepsat.');
		if ((overrideReturn && returnInvalid) || (overrideQuarantine && quarantineInvalid)) {
			return void (datesError = 'Opravte datum (DD. MM. RRRR).');
		}
		if (!datesNote.trim()) return void (datesError = 'Přepsání data vyžaduje poznámku.');
		datesError = null;
		datesBusy = true;
		try {
			await call('companies.overrideDates', {
				ico: company.ico,
				note: datesNote.trim(),
				returnOn: overrideReturn ? newReturnOn || null : undefined,
				quarantineUntil: overrideQuarantine ? newQuarantineUntil || null : undefined
			});
			toast.success('Datum přepsáno a zapsáno do auditu.');
			datesOpen = false;
			await load(company.ico, true);
			onchanged?.();
		} catch (e) {
			datesError = e instanceof Error ? e.message : 'Datum se nepodařilo přepsat.';
		} finally {
			datesBusy = false;
		}
	}
</script>

{#snippet ownership(c: Company)}
	<h3>Vlastnictví</h3>
	<dl class="facts">
		<div><dt>Stav</dt><dd><StateDot state={c.state} /></dd></div>
		<div>
			<dt>Držitel</dt>
			<dd>{HOLDER_LABELS[c.holder_type] ?? c.holder_type}{#if c.holder_login}<span class="text-muted">&nbsp;· {c.holder_login}</span>{/if}</dd>
		</div>
		<div>
			<dt>Přiřazený OZ</dt>
			<dd>
				{#if c.sales_rep_name}{c.sales_rep_name}{:else}<span class="none">—</span>{/if}{#if c.sales_rep_login}<span class="text-muted">&nbsp;· {c.sales_rep_login}</span>{/if}
			</dd>
		</div>
		<div><dt>Dávka</dt><dd class:none={!c.cohort_code}>{c.cohort_code ?? '—'}</dd></div>
		<div><dt>Vlastnictví od</dt><dd class="num" class:none={!c.owned_from}>{formatDate(c.owned_from)}</dd></div>
		<div><dt>Konec vlastnictví</dt><dd class="num" class:none={!c.ownership_ends_on}>{formatDate(c.ownership_ends_on)}</dd></div>
		<div><dt>Kanál</dt><dd class:none={!c.channel}>{c.channel ? CHANNEL_LABELS[c.channel] : '—'}</dd></div>
		<div><dt>Počet kol</dt><dd class="num">{formatNumber(c.rounds_count)}</dd></div>
	</dl>
{/snippet}

{#snippet returns(c: Company, overrides: Override[])}
	<h3>Návrat a karanténa</h3>
	<dl class="facts">
		<div>
			<dt>Datum návratu</dt>
			<dd>
				<span class="num" class:none={!c.return_on}>{formatDate(c.return_on)}</span>
				{#if c.return_on_overridden}<span class="tag">Ručně přepsáno</span>{/if}
				{#if c.return_on_override_note}<p class="note">{c.return_on_override_note}</p>{/if}
			</dd>
		</div>
		<div>
			<dt>Cesta návratu</dt>
			<dd class:none={!c.return_path}>{c.return_path ? (RETURN_PATH_LABELS[c.return_path] ?? c.return_path) : '—'}</dd>
		</div>
		<div>
			<dt>Karanténa do</dt>
			<dd>
				<span class="num" class:none={!c.quarantine_until}>{formatDate(c.quarantine_until)}</span>
				{#if c.quarantine_overridden}<span class="tag">Ručně přepsáno</span>{/if}
				{#if c.quarantine_override_note}<p class="note">{c.quarantine_override_note}</p>{/if}
			</dd>
		</div>
		<div><dt>Trvalé vyřazení</dt><dd>{c.never_return ? 'Ano, IČO se do dávek nevrací' : 'Ne'}</dd></div>
	</dl>
	{#if overrides.length}
		<h4>Ruční přepsání</h4>
		<ul class="overrides">
			{#each overrides as item (item.id)}
				<li>
					<time class="when num" datetime={item.at}>{formatDateTime(item.at)}</time>
					<span>
						{#if item.details?.return_on}
							Návrat: <span class="num">{formatDate(item.details.return_on.old)}</span>
							<ArrowRight size={14} />
							<span class="num">{formatDate(item.details.return_on.new)}</span>
						{/if}
						{#if item.details?.return_on && item.details?.quarantine_until}<span class="text-muted">&nbsp;· </span>{/if}
						{#if item.details?.quarantine_until}
							Karanténa: <span class="num">{formatDate(item.details.quarantine_until.old)}</span>
							<ArrowRight size={14} />
							<span class="num">{formatDate(item.details.quarantine_until.new)}</span>
						{/if}
						{#if item.details?.note}<span class="note-inline">{item.details.note}</span>{/if}
						<span class="text-muted">&nbsp;· {item.actor_name ?? '—'}</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet subject(c: Company)}
	<h3>Subjekt</h3>
	<dl class="facts">
		<div class="wide">
			<dt>Typ subjektu</dt>
			<dd>{c.subject_type ? `${c.subject_type} · ${SUBJECT_TYPE_LABELS[c.subject_type]}` : 'Neurčeno'}</dd>
		</div>
		<div class="wide">
			<dt>Platnost IČO</dt>
			<dd>
				{c.ico_valid === null ? 'Neověřeno' : c.ico_valid ? 'Platné' : 'Neplatné'}{#if c.ico_verified_at}<span class="text-muted"
						>&nbsp;· ověřeno <span class="num">{formatDate(c.ico_verified_at)}</span></span
					>{/if}
			</dd>
		</div>
		<div><dt>Kraj</dt><dd class:none={!c.region_name}>{c.region_name ?? '—'}</dd></div>
		<div><dt>Okres</dt><dd class:none={!c.district_name}>{c.district_name ?? '—'}</dd></div>
		<div><dt>Právní forma</dt><dd class:none={!c.legal_form_code}>{c.legal_form_code ?? '—'}</dd></div>
		<div><dt>CZ-NACE</dt><dd class:none={!c.nace_codes?.length}>{c.nace_codes?.length ? c.nace_codes.join(', ') : '—'}</dd></div>
		<div><dt>Založeno</dt><dd class="num" class:none={!c.founded_on}>{formatDate(c.founded_on)}</dd></div>
		{#if c.dissolved_on}
			<div><dt>Zánik</dt><dd class="num">{formatDate(c.dissolved_on)}</dd></div>
		{/if}
		<div><dt>V databázi od</dt><dd class="num">{formatDate(c.created_at)}</dd></div>
		<div class="wide">
			<dt>Siebel</dt>
			<dd>
				{#if c.siebel_checked_at}
					{c.siebel_owner ?? 'Vlastník neznámý'}<span class="text-muted"
						>&nbsp;· kontrola <span class="num">{formatDate(c.siebel_checked_at)}</span>{#if c.siebel_opportunity_valid_until}, příležitost do <span
								class="num">{formatDate(c.siebel_opportunity_valid_until)}</span
							>{/if}</span
					>
				{:else}
					Zatím nekontrolováno
				{/if}
			</dd>
		</div>
		{#if c.ca_number}
			<div><dt>Číslo CA</dt><dd class="num">{c.ca_number}</dd></div>
		{/if}
	</dl>
{/snippet}

<!-- Phones as a list for the narrow inspector, as a table on the page -->
{#snippet phonesList(phones: Phone[])}
	<h3>Telefony <span class="count">{phones.length}</span></h3>
	{#if phones.length}
		<ul class="items">
			{#each phones as phone (phone.id)}
				<li>
					<dl class="facts phone">
						<div class="wide lead">
							<dt class="visually-hidden">Číslo</dt>
							<dd><span class="num">{formatPhone(phone.phone)}</span>{#if phone.is_primary}<span class="tag">Hlavní</span>{/if}</dd>
						</div>
						<div><dt>Operátor</dt><dd>{phone.operator ? OPERATOR_LABELS[phone.operator] : 'Neověřeno'}</dd></div>
						<div>
							<dt>Ověřeno</dt>
							<dd class="num" class:none={!phone.operator_verified_at}>{formatDate(phone.operator_verified_at)}</dd>
						</div>
						<div>
							<dt>Zdroj</dt>
							<dd class:none={!phone.source}>{phone.source ? (PHONE_SOURCE_LABELS[phone.source] ?? phone.source) : '—'}</dd>
						</div>
					</dl>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">U tohoto IČO není žádný telefon.</p>
	{/if}
{/snippet}

{#snippet phonesTable(phones: Phone[])}
	<h3 class="pad">Telefony <span class="count">{phones.length}</span></h3>
	{#if phones.length}
		<div class="scroll">
			<table>
				<thead>
					<tr><th scope="col">Číslo</th><th scope="col">Operátor</th><th scope="col">Ověřeno</th><th scope="col">Zdroj</th></tr>
				</thead>
				<tbody>
					{#each phones as phone (phone.id)}
						<tr>
							<td class="num">{formatPhone(phone.phone)}{#if phone.is_primary}<span class="tag primary">Hlavní</span>{/if}</td>
							<td>{phone.operator ? OPERATOR_LABELS[phone.operator] : 'Neověřeno'}</td>
							<td class="num" class:none={!phone.operator_verified_at}>{formatDate(phone.operator_verified_at)}</td>
							<td class:none={!phone.source}>{phone.source ? (PHONE_SOURCE_LABELS[phone.source] ?? phone.source) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="pad text-muted">U tohoto IČO není žádný telefon.</p>
	{/if}
{/snippet}

{#snippet historyList(history: HistoryRow[])}
	<h3>Historie stavů <span class="count">{history.length}</span></h3>
	{#if history.length}
		<ol class="timeline">
			{#each history as item (item.id)}
				{@const why = historyReason(item)}
				<li>
					<time class="when num" datetime={item.at}>{formatDateTime(item.at)}</time>
					<p class="move">
						{#if item.from_state}
							<span class="text-muted">{stateLabel(item.from_state)}</span>
							<ArrowRight size={16} />
						{/if}
						<StateDot state={item.to_state} />
					</p>
					{#if item.from_holder !== item.to_holder}
						<p class="holder">
							Držitel: {#if item.from_holder}{holderText(item.from_holder)} <ArrowRight size={14} />{/if}
							{holderText(item.to_holder)}
						</p>
					{/if}
					{#if item.note}<p class="note">{item.note}</p>{/if}
					<p class="meta">{historyMeta(item, why)}</p>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="text-muted">Bez záznamu.</p>
	{/if}
{/snippet}

<!-- Sales reps as a list for the narrow inspector, as a table on the page -->
{#snippet repsList(assignments: Assignment[])}
	<h3>Obchodníci u tohoto IČO <span class="count">{assignments.length}</span></h3>
	{#if assignments.length}
		<ul class="items">
			{#each assignments as a (a.id)}
				<li>
					<dl class="facts">
						<div class="wide lead">
							<dt class="visually-hidden">Obchodník</dt>
							<dd>{a.sales_rep_name}</dd>
						</div>
						<div><dt>Login</dt><dd class:none={!a.siebel_login}>{a.siebel_login ?? '—'}</dd></div>
						<div><dt>Kolo</dt><dd class="num">{a.round_no}</dd></div>
						<div><dt>Od</dt><dd class="num">{formatDate(a.assigned_from)}</dd></div>
						<div>
							<dt>Do</dt>
							<dd class="num">{#if a.assigned_to}{formatDate(a.assigned_to)}{:else}<span class="tag accent">Trvá</span>{/if}</dd>
						</div>
						<div><dt>Kanál</dt><dd class:none={!a.channel}>{a.channel ? CHANNEL_LABELS[a.channel] : '—'}</dd></div>
						<div>
							<dt>Způsob přidělení</dt>
							<dd class:none={!a.source}>{a.source ? (ASSIGNMENT_SOURCE_LABELS[a.source] ?? a.source) : '—'}</dd>
						</div>
						<div><dt>Dávka</dt><dd class:none={!a.cohort_code}>{a.cohort_code ?? '—'}</dd></div>
						<div>
							<dt>Důvod ukončení</dt>
							<dd class:none={!a.end_reason}>
								{#if a.end_reason}{reasonLabel(a.end_reason)}{#if a.end_note}<span class="text-muted">&nbsp;· {a.end_note}</span>{/if}{:else}—{/if}
							</dd>
						</div>
					</dl>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">Toto IČO zatím žádný obchodník neměl.</p>
	{/if}
{/snippet}

{#snippet repsTable(assignments: Assignment[])}
	<h3 class="pad">Obchodníci u tohoto IČO <span class="count">{assignments.length}</span></h3>
	{#if assignments.length}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Obchodník</th>
						<th scope="col">Login</th>
						<th scope="col">Od</th>
						<th scope="col">Do</th>
						<th scope="col">Důvod ukončení</th>
						<th scope="col">Kanál</th>
						<th scope="col">Způsob přidělení</th>
						<th scope="col" class="right">Kolo</th>
						<th scope="col">Dávka</th>
					</tr>
				</thead>
				<tbody>
					{#each assignments as a (a.id)}
						<tr>
							<td>{a.sales_rep_name}</td>
							<td class:none={!a.siebel_login}>{a.siebel_login ?? '—'}</td>
							<td class="num">{formatDate(a.assigned_from)}</td>
							<td class="num">{#if a.assigned_to}{formatDate(a.assigned_to)}{:else}<span class="tag accent">Trvá</span>{/if}</td>
							<td class="why" class:none={!a.end_reason}>
								{#if a.end_reason}{reasonLabel(a.end_reason)}{#if a.end_note}<span class="text-muted">&nbsp;· {a.end_note}</span>{/if}{:else}—{/if}
							</td>
							<td class:none={!a.channel}>{a.channel ? CHANNEL_LABELS[a.channel] : '—'}</td>
							<td class:none={!a.source}>{a.source ? (ASSIGNMENT_SOURCE_LABELS[a.source] ?? a.source) : '—'}</td>
							<td class="right num">{a.round_no}</td>
							<td class:none={!a.cohort_code}>{a.cohort_code ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="pad text-muted">Toto IČO zatím žádný obchodník neměl.</p>
	{/if}
{/snippet}

{#snippet actionButtons(d: Detail)}
	<Button onclick={openState} disabled={d.transitions.length === 0} fullWidth={embedded}>Změnit stav</Button>
	<Button variant="secondary" onclick={openDates} fullWidth={embedded}>Přepsat datum návratu / karantény</Button>
{/snippet}

<!-- In the panel next to the list: head and actions on the glass frame, the sections on a solid
     sheet that scrolls. On the page: title on the backdrop, the sections on plates. -->
<div class="detail" class:embedded class:page={!embedded}>
	{#if error}
		<div class={embedded ? 'sheet body' : 'plate'}>
			<EmptyState title="Detail se nepodařilo načíst" text={error}>
				{#if embedded}
					<Button variant="secondary" onclick={() => onclose?.()}>Zavřít</Button>
				{:else}
					<Button variant="secondary" href="/ico">Zpět na seznam</Button>
				{/if}
			</EmptyState>
		</div>
	{:else if loading || !detail || !company}
		<div class="head waiting">
			<p class="text-muted">Načítám…</p>
			{#if embedded}
				<button type="button" class="icon" aria-label="Zavřít detail" onclick={() => onclose?.()}><X size={18} /></button>
			{/if}
		</div>
		{#if embedded}<div class="sheet body"></div>{/if}
	{:else}
		<header class="head">
			<div class="title">
				<svelte:element this={embedded ? 'h2' : 'h1'} class="name"><strong>{company.name ?? 'Bez názvu'}</strong></svelte:element>
				<p class="badges">
					<span>IČO <span class="num ico-num">{company.ico}</span></span>
					<span class="state-big"><StateDot state={company.state} /></span>
					{#if company.subject_type}<span class="tag" title={SUBJECT_TYPE_LABELS[company.subject_type]}>{company.subject_type}</span>{/if}
					{#if company.never_return}<span class="tag accent">Trvale vyřazeno</span>{/if}
					{#if company.ico_valid === false}<span class="tag">IČO neplatné</span>{/if}
				</p>
			</div>
			{#if embedded}
				<div class="window">
					<a class="icon" href="/ico/{company.ico}" aria-label="Otevřít detail na celé stránce" title="Otevřít na celé stránce">
						<Maximize2 size={18} />
					</a>
					<button type="button" class="icon" aria-label="Zavřít detail" title="Zavřít" onclick={() => onclose?.()}><X size={18} /></button>
				</div>
			{:else}
				<div class="actions">{@render actionButtons(detail)}</div>
			{/if}
		</header>

		{#if embedded}
			<div class="sheet body">
				<section aria-label="Vlastnictví">{@render ownership(company)}</section>
				<section aria-label="Návrat a karanténa">{@render returns(company, detail.overrides)}</section>
				<section aria-label="Telefony">{@render phonesList(detail.phones)}</section>
				<section aria-label="Historie stavů">{@render historyList(detail.history)}</section>
				<section aria-label="Obchodníci u tohoto IČO">{@render repsList(detail.assignments)}</section>
				<section aria-label="Subjekt">{@render subject(company)}</section>
			</div>
			<div class="actions">{@render actionButtons(detail)}</div>
		{:else}
			<div class="grid">
				<div class="col">
					<section class="plate panel-pad" aria-label="Vlastnictví">{@render ownership(company)}</section>
					<section class="plate panel-pad" aria-label="Návrat a karanténa">{@render returns(company, detail.overrides)}</section>
					<section class="plate panel-pad" aria-label="Subjekt">{@render subject(company)}</section>
					<section class="plate" aria-label="Telefony">{@render phonesTable(detail.phones)}</section>
				</div>
				<div class="col">
					<section class="plate panel-pad" aria-label="Historie stavů">{@render historyList(detail.history)}</section>
				</div>
			</div>
			<section class="plate" aria-label="Obchodníci u tohoto IČO">{@render repsTable(detail.assignments)}</section>
		{/if}

		<Dialog bind:open={stateOpen} title="Změnit stav IČO" busy={stateBusy}>
			<p>
				IČO <strong class="num">{company.ico}</strong> je ve stavu <strong>{stateLabel(company.state)}</strong>. Nabízejí se jen
				přechody povolené v nastavení.
			</p>
			<Select label="Nový stav" placeholder="Vyberte…" options={transitionOptions} bind:value={toState} onchange={onTargetChange} />
			{#if toState === 'login_oz'}
				<Select
					label="Obchodník"
					placeholder="Vyberte…"
					options={repOptions}
					bind:value={repId}
					hint="Držitelem se stane login vybraného obchodníka a založí se mu přidělení od dnešního dne."
				/>
			{:else if requiredHolder === 'pool'}
				<Select
					label="Pool"
					placeholder="Vyberte…"
					options={poolOptions}
					bind:value={holderLogin}
					hint="V tomto stavu IČO drží volný pool. Přiřazený obchodník a data vlastnictví se tím ukončí."
				/>
			{:else if requiredHolder}
				<Field
					label={requiredHolder === 'jiny_partner' ? 'Partner' : 'Login držitele'}
					optional
					bind:value={holderLogin}
					hint={`Držitelem se stane: ${HOLDER_LABELS[requiredHolder]}.${
						requiredHolder === 'superuser' ? ' Vlastnictví se počítá ode dneška, konec podle nastavení doby držení na superuseru.' : ''
					}`}
				/>
			{:else if toState}
				<div class="two">
					<Select
						label="Držitel"
						placeholder="Beze změny"
						options={holderOptions}
						bind:value={holderType}
						hint="Tento stav držitele sám nemění. Mění-li se s přechodem i držitel, vyberte ho."
					/>
					{#if holderType}
						<Field
							label="Login / pool / partner"
							optional
							bind:value={holderLogin}
							list="holder-logins"
							hint={holderType === 'pool' ? `Volné pooly: ${(options?.pools.free ?? []).join(', ') || '—'}` : undefined}
						/>
						<datalist id="holder-logins">
							{#if holderType === 'pool'}
								{#each options?.pools.free ?? [] as pool (pool)}<option value={pool}></option>{/each}
							{/if}
						</datalist>
					{/if}
				</div>
			{/if}
			<Field
				label="Důvod"
				multiline
				rows={3}
				bind:value={reason}
				maxlength={1000}
				optional={!!target && !target.note_required}
				hint={target?.note_required
					? 'U tohoto přechodu je důvod povinný. Zapíše se do historie i do auditu.'
					: 'Zapíše se do historie i do auditu.'}
			/>
			{#if toState}
				<p class="summary">
					<span class="text-muted">{stateLabel(company.state)}</span>
					<ArrowRight size={16} />
					<StateDot state={toState} />
				</p>
			{/if}
			{#if stateError}<p class="error" role="alert">{stateError}</p>{/if}
			{#snippet footer()}
				<Button variant="secondary" onclick={() => (stateOpen = false)} disabled={stateBusy}>Zrušit</Button>
				<Button onclick={submitState} loading={stateBusy}>{stateBusy ? 'Ukládám…' : 'Potvrdit změnu stavu'}</Button>
			{/snippet}
		</Dialog>

		<Dialog bind:open={datesOpen} title="Přepsat datum návratu / karantény" busy={datesBusy}>
			<p>
				Ručně přepsané datum už automatický výpočet nezmění. Každé přepsání se s původní i novou hodnotou zapíše do auditu.
			</p>
			<div class="override">
				<label class="check">
					<input type="checkbox" bind:checked={overrideReturn} />
					<span>Přepsat datum návratu <span class="text-muted">(teď {formatDate(company.return_on, 'není')})</span></span>
				</label>
				{#if overrideReturn}
					<DateInput label="Nové datum návratu" bind:value={newReturnOn} bind:invalid={returnInvalid} hint="Prázdné pole datum smaže." />
				{/if}
			</div>
			<div class="override">
				<label class="check">
					<input type="checkbox" bind:checked={overrideQuarantine} />
					<span>Přepsat karanténu do <span class="text-muted">(teď {formatDate(company.quarantine_until, 'není')})</span></span>
				</label>
				{#if overrideQuarantine}
					<DateInput
						label="Nová karanténa do"
						bind:value={newQuarantineUntil}
						bind:invalid={quarantineInvalid}
						hint="Prázdné pole karanténu smaže."
					/>
				{/if}
			</div>
			<Field label="Poznámka" multiline rows={3} bind:value={datesNote} maxlength={1000} hint="Povinná. Proč se datum mění." />
			{#if datesError}<p class="error" role="alert">{datesError}</p>{/if}
			{#snippet footer()}
				<Button variant="secondary" onclick={() => (datesOpen = false)} disabled={datesBusy}>Zrušit</Button>
				<Button onclick={submitDates} loading={datesBusy}>{datesBusy ? 'Ukládám…' : 'Potvrdit přepsání'}</Button>
			{/snippet}
		</Dialog>
	{/if}
</div>

<style>
	/* The layout follows the width the detail really has (page or panel), not the window. */
	.detail {
		container-type: inline-size;
		min-width: 0;
	}
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	/* Inspector: fills the glass frame it sits in (the list page draws the frame). */
	.embedded {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	/* Head */
	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}
	/* Inspector head: the name beside the window buttons, the IČO line under both at full width */
	.embedded .head {
		flex: none;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'name window'
			'badges badges';
		align-items: start;
		gap: 6px var(--space-2);
		padding: 4px 0 2px var(--space-3);
	}
	.embedded .title {
		display: contents;
	}
	.embedded .name {
		grid-area: name;
		padding-top: 10px;
	}
	.embedded .badges {
		grid-area: badges;
	}
	.embedded .window {
		grid-area: window;
	}
	.page .head {
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-3) var(--space-6);
		padding-left: var(--plate-pad-x);
	}
	.title {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.page .title {
		flex: 0 1 auto;
		gap: var(--space-2);
	}
	.waiting p {
		flex: 1;
		padding-top: 11px;
	}
	.page .waiting p {
		padding: 0 0 0 var(--plate-pad-x);
	}
	.name {
		overflow-wrap: anywhere;
	}
	h2.name {
		line-height: 1.25;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
	}
	.ico-num,
	.state-big {
		font-weight: 600;
	}
	.window {
		flex: none;
		display: flex;
	}
	.icon {
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
	.icon:hover {
		background: rgb(255 255 255 / 0.6);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.embedded > .actions {
		flex: none;
		flex-direction: column;
	}

	/* Inspector sheet: one scrolling column of sections divided by hairlines */
	/* position: relative keeps the visually hidden labels inside the scroll box; otherwise the glass
	   frame (a containing block through its backdrop filter) holds them and they extend the page. */
	.embedded > .body {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: var(--space-4);
	}
	.embedded section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.embedded section + section {
		padding-top: 14px;
		border-top: 1px solid var(--rule);
	}

	/* Page: plates in two columns, the sales reps across the whole width */
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
	}
	/* minmax(0, 1fr): a wide table inside a plate scrolls in its box instead of widening the column. */
	.col {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		min-width: 0;
	}
	.panel-pad > h3 {
		margin-bottom: var(--space-3);
	}
	h3.pad {
		padding: var(--plate-pad-y) var(--plate-pad-x) var(--space-3);
	}
	p.pad {
		padding: 0 var(--plate-pad-x) var(--plate-pad-y);
	}

	/* Section content */
	.count {
		margin-left: var(--space-1);
		font-weight: 400;
		color: var(--text-2);
	}
	.none {
		color: var(--text-3);
	}
	dd .tag {
		margin-left: 6px;
	}
	h4 {
		margin-top: var(--space-4);
		font-weight: 600;
		color: var(--text-2);
	}
	.embedded h4 {
		margin-top: 4px;
	}
	.page h4 + .overrides {
		margin-top: var(--space-2);
	}
	/* Notes: a quiet tinted box, line breaks kept */
	.note {
		margin-top: 4px;
		padding: 6px 10px;
		border-radius: 10px;
		background: rgb(11 27 51 / 0.05);
		font-size: var(--text-small);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.note-inline {
		padding: 1px 6px;
		border-radius: 6px;
		background: rgb(11 27 51 / 0.05);
	}

	/* History and manual overrides: a thin line on the left, newest first */
	.timeline,
	.overrides,
	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.timeline li,
	.overrides li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-left: var(--space-3);
		border-left: 1px solid rgb(11 27 51 / 0.18);
	}
	.when,
	.meta {
		font-size: var(--text-caps);
		color: var(--text-2);
	}
	.move {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--space-2);
		font-weight: 600;
	}
	.move .text-muted {
		font-weight: 400;
	}
	.holder :global(svg),
	.overrides :global(svg) {
		vertical-align: -2px;
	}

	/* Phones and sales reps in the inspector: one group per item, its first line set bold */
	.items li + li {
		padding-top: var(--space-3);
		border-top: 1px solid var(--line);
	}
	.phone {
		--facts-cols: 3;
	}
	.lead dd {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px var(--space-2);
		font-weight: 600;
	}
	.lead dd .tag {
		margin-left: 0;
	}

	/* Tables on the page */
	.scroll {
		overflow-x: auto;
		border-radius: 0 0 var(--radius-plate) var(--radius-plate);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-body);
	}
	th {
		height: var(--control-h);
		padding: 0 var(--cell-x);
		border-bottom: 1px solid var(--line-strong);
		text-align: left;
		font-size: var(--text-caps);
		font-weight: 600;
		color: var(--text-2);
		white-space: nowrap;
	}
	td {
		height: var(--row-h);
		padding: 0 var(--cell-x);
		border-bottom: 1px solid var(--line);
		white-space: nowrap;
	}
	th:first-child,
	td:first-child {
		padding-left: var(--plate-pad-x);
	}
	th:last-child,
	td:last-child {
		padding-right: var(--plate-pad-x);
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	td.why {
		white-space: normal;
		min-width: 200px;
		max-width: 420px;
		padding-top: 6px;
		padding-bottom: 6px;
		overflow-wrap: anywhere;
	}
	.right {
		text-align: right;
	}
	.tag.primary {
		margin-left: var(--space-2);
	}

	/* Dialog content */
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
		align-items: start;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: 14px;
		background: rgb(11 27 51 / 0.05);
		font-weight: 600;
	}
	.summary .text-muted {
		font-weight: 400;
	}
	.override {
		display: grid;
		gap: var(--space-2);
	}
	.check {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: var(--control-h);
		font-weight: 600;
		cursor: pointer;
	}
	.check .text-muted {
		font-weight: 400;
	}
	.check input {
		flex: none;
		width: 18px;
		height: 18px;
		margin: 0;
		accent-color: var(--ink);
	}
	/* Error: bold ink text on a quiet ink-tinted box (no red in the palette) */
	.error {
		font-weight: 600;
		padding: 10px 14px;
		border-radius: 14px;
		background: rgb(11 27 51 / 0.06);
		box-shadow: inset 0 0 0 1px rgb(11 27 51 / 0.16);
	}

	@container (max-width: 880px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	/* The dialogs sit in the top layer, so they follow the window, not the detail's width. */
	@media (max-width: 600px) {
		.two {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	/* Narrow window: the inspector grows with its content and the page scrolls. */
	@media (max-width: 859.98px) {
		.embedded {
			flex: none;
		}
		.embedded > .body {
			flex: none;
			overflow: visible;
		}
		.page .head {
			padding-left: var(--space-3);
		}
	}
</style>
