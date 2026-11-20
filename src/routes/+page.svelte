<script lang="ts">
	/** Overview: IČO counts by state, holder, type and region, superuser occupancy, last imports and audit. */
	import { onMount } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { call } from '$lib/api';
	import {
		HOLDER_LABELS,
		HOLDER_TYPES,
		STATES,
		STATE_DOTS,
		STATE_LABELS,
		SUBJECT_TYPES,
		SUBJECT_TYPE_LABELS
	} from '$lib/states';
	import { formatDateTime, formatNumber, formatPercent } from '$lib/format';
	import { auditActionLabel } from '$lib/audit-actions';
	import StateDot from '$lib/components/StateDot.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Button from '$lib/components/Button.svelte';

	interface CountRow {
		key: string | null;
		count: number;
	}
	interface Overview {
		total: number;
		byState: CountRow[];
		byHolder: CountRow[];
		bySubjectType: CountRow[];
		byRegion: { code: string | null; name: string | null; count: number }[];
		superuser: { count: number; limit: number | null; pct: number | null; warningPct: number | null; level: 'ok' | 'warning' | 'full' | 'unknown' };
		reps: number;
		cohorts: number;
		lastImports: { id: string; at: string; name: string | null; kind: string | null; status: string | null; rows: number | null }[] | null;
		lastAudit: { id: number; at: string; actor_name: string | null; action: string; entity_id: string | null; description: string | null }[];
	}

	// Display names for values written by the import area; unknown values are shown as they are.
	const IMPORT_STATUS_LABELS: Record<string, string> = {
		uploading: 'Nahrává se',
		uploaded: 'Nahráno',
		validated: 'Zkontrolováno',
		applying: 'Zapisuje se',
		applied: 'Zapsáno',
		cancelled: 'Zrušeno'
	};
	const IMPORT_KIND_LABELS: Record<string, string> = { master_import: 'Kmenový Excel' };

	let overview = $state<Overview | null>(null);
	let error = $state<string | null>(null);

	const countOf = (rows: CountRow[], key: string) => rows.find((r) => r.key === key)?.count ?? 0;
	const share = (count: number, of: number) => (of > 0 ? (count / of) * 100 : 0);

	const holders = $derived(
		overview ? HOLDER_TYPES.map((key) => ({ key, label: HOLDER_LABELS[key], count: countOf(overview!.byHolder, key) })) : []
	);
	const subjects = $derived(
		overview
			? [
					...SUBJECT_TYPES.map((key) => ({ key: key as string, label: SUBJECT_TYPE_LABELS[key], count: countOf(overview!.bySubjectType, key) })),
					{ key: 'none', label: 'Neurčeno', count: overview.bySubjectType.find((r) => r.key === null)?.count ?? 0 }
				].filter((s) => s.key !== 'none' || s.count > 0)
			: []
	);
	const regionMax = $derived(Math.max(1, ...(overview?.byRegion ?? []).map((r) => r.count)));
	const holderMax = $derived(Math.max(1, ...holders.map((h) => h.count)));

	// The state legend and the region list each run in two columns.
	const stateHalf = Math.ceil(STATES.length / 2);
	const stateColumns = [STATES.slice(0, stateHalf), STATES.slice(stateHalf)];
	const regionRows = $derived(Math.max(1, Math.ceil((overview?.byRegion.length ?? 0) / 2)));

	async function load() {
		try {
			overview = await call<Overview>('dashboard.overview');
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Přehled se nepodařilo načíst.';
		}
	}
	onMount(load);
</script>

<svelte:head><title>Přehled · Lead management A4M</title></svelte:head>

<div class="overview">
	<div class="page-head head">
		<div>
			<h1>Přehled <strong>databáze</strong></h1>
		</div>
		{#if !error && overview && overview.total > 0}
			<dl class="totals">
				<div>
					<dt>IČO celkem</dt>
					<dd><span class="figure num">{formatNumber(overview.total)}</span></dd>
				</div>
				{#each subjects as subject (subject.key)}
					<div>
						<dt>{subject.label}</dt>
						<dd>
							<span class="figure num">{formatNumber(subject.count)}</span>
							<span class="num">{formatPercent(share(subject.count, overview.total), 1)}</span>
						</dd>
					</div>
				{/each}
				<div>
					<dt>Aktivní obchodníci</dt>
					<dd><span class="figure num">{formatNumber(overview.reps)}</span></dd>
				</div>
				<div>
					<dt>Dávky</dt>
					<dd><span class="figure num">{formatNumber(overview.cohorts)}</span></dd>
				</div>
			</dl>
		{/if}
	</div>

	{#if error}
		<div class="plate">
			<EmptyState title="Přehled se nepodařilo načíst" text={error}>
				<Button variant="secondary" onclick={load}>Zkusit znovu</Button>
			</EmptyState>
		</div>
	{:else if !overview}
		<p class="loading text-muted">Načítám…</p>
	{:else if overview.total === 0}
		<div class="plate">
			<EmptyState
				title="Databáze je prázdná"
				text="Zatím tu není žádné IČO. Nahrajte kmenový Excel na stránce Import. Smyšlená data na vyzkoušení: nejdřív zastavte aplikaci, pak spusťte příkaz npm run seed a aplikaci znovu spusťte."
			>
				<Button href="/import">Přejít na import</Button>
			</EmptyState>
		</div>
	{:else}
		{@const su = overview.superuser}
		<div class="board">
			<section class="plate card states" aria-labelledby="t-state">
				<h2 id="t-state">IČO podle stavu</h2>
				<div class="spectrum" aria-hidden="true">
					{#each STATES as state (state)}
						{@const count = countOf(overview.byState, state)}
						{#if count > 0}
							<span
								class:rim={STATE_DOTS[state].rim}
								style:flex-grow={count}
								style:background="var(--state-{state})"
								title="{STATE_LABELS[state]} · {formatNumber(count)} · {formatPercent(share(count, overview.total), 1)}"
							></span>
						{/if}
					{/each}
				</div>
				<div class="legend">
					{#each stateColumns as column, i (i)}
						<div class="legend-col" style:--rows={column.length}>
							<div class="cols-head"><span>Stav</span><span class="right">Počet</span><span class="right">Podíl</span></div>
							<ul>
								{#each column as state (state)}
									{@const count = countOf(overview.byState, state)}
									<li>
										<a class="state-row" href="/ico?state={state}">
											<StateDot {state} />
											<span class="right num count">{formatNumber(count)}</span>
											<span class="right num share">{formatPercent(share(count, overview.total), 1)}</span>
											<ChevronRight size={14} />
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			</section>

			<div class="plate card occupancy-plate">
				<section class="occupancy" class:alert={su.level === 'warning' || su.level === 'full'} aria-labelledby="su-title">
					<div class="su-head">
						<h2 id="su-title">Obsazenost superusera</h2>
						{#if su.level === 'full'}
							<span class="tag accent">Limit vyčerpán</span>
						{:else if su.level === 'warning'}
							<span class="tag accent">Blíží se limitu</span>
						{/if}
					</div>
					{#if su.limit === null || su.pct === null}
						<p>
							Na superuseru je <strong class="num">{formatNumber(su.count)}</strong> IČO. Limit není nastavený,
							<a href="/nastaveni">doplňte ho v Nastavení</a>.
						</p>
					{:else}
						<p class="su-numbers">
							<strong class="big num">{formatNumber(su.count)}</strong>
							<span class="num of">z {formatNumber(su.limit)}</span>
							<span class="num su-pct">{formatPercent(su.pct, 1)}</span>
						</p>
						<div
							class="meter"
							role="meter"
							aria-labelledby="su-title"
							aria-valuemin="0"
							aria-valuemax={su.limit}
							aria-valuenow={su.count}
							aria-valuetext="{formatNumber(su.count)} z {formatNumber(su.limit)}"
						>
							<span class="fill" style:width="{Math.min(100, su.pct)}%"></span>
							{#if su.warningPct !== null && su.warningPct < 100}
								<span class="mark" style:left="{su.warningPct}%" aria-hidden="true"></span>
							{/if}
						</div>
						<p class="text-muted su-note">
							{#if su.level === 'full'}
								Limit je vyčerpaný. Další IČO na superusera nepřidávejte, dokud se místo neuvolní.
							{:else if su.level === 'warning'}
								Obsazenost překročila hranici varování {formatPercent(su.warningPct)}. Zbývá {formatNumber(su.limit - su.count)} míst.
							{:else}
								Zbývá {formatNumber(su.limit - su.count)} míst.
								{#if su.warningPct !== null}Varování od {formatPercent(su.warningPct)} (značka na liště).{/if}
							{/if}
							Limit a hranici upravíte v <a href="/nastaveni">Nastavení</a>.
						</p>
					{/if}
				</section>

				<section class="holders" aria-labelledby="t-holder">
					<h2 id="t-holder">IČO podle držitele</h2>
					<div class="cols-head"><span>Držitel</span><span class="right">Počet</span><span class="right">Podíl</span></div>
					<ul class="bar-list" style:--rows={holders.length}>
						{#each holders as holder (holder.key)}
							<li>
								<div class="bar-row">
									<span>{holder.label}</span>
									<span class="right num count">{formatNumber(holder.count)}</span>
									<span class="right num share">{formatPercent(share(holder.count, overview.total), 1)}</span>
								</div>
								<span class="track" aria-hidden="true">
									<span class="bar" class:zero={holder.count === 0} style:width="{share(holder.count, holderMax)}%"></span>
								</span>
							</li>
						{/each}
					</ul>
				</section>
			</div>

			<section class="plate card regions" aria-labelledby="t-region">
				<h2 id="t-region">IČO podle kraje</h2>
				<div class="regions-head">
					<div class="cols-head"><span>Kraj</span><span class="right">Počet</span><span class="right">Podíl</span></div>
					<div class="cols-head second" aria-hidden="true"><span>Kraj</span><span class="right">Počet</span><span class="right">Podíl</span></div>
				</div>
				<ul class="bar-list region-list" style:--rows={regionRows}>
					{#each overview.byRegion as region (region.code ?? 'none')}
						<li>
							<div class="bar-row">
								<span class:text-muted={region.code === null}>{region.name ?? (region.code === null ? 'Kraj neuveden' : `Kraj ${region.code}`)}</span>
								<span class="right num count">{formatNumber(region.count)}</span>
								<span class="right num share">{formatPercent(share(region.count, overview.total), 1)}</span>
							</div>
							<span class="track" aria-hidden="true">
								<span class="bar" style:width="{share(region.count, regionMax)}%"></span>
							</span>
						</li>
					{/each}
				</ul>
			</section>

			<div class="plate card activity">
				<section class="changes" style:flex-grow={Math.max(1, overview.lastAudit.length)} aria-labelledby="t-audit">
					<div class="section-head">
						<h2 id="t-audit">Poslední změny</h2>
						<a href="/audit">Celý audit</a>
					</div>
					{#if overview.lastAudit.length === 0}
						<p class="empty-title">Audit je prázdný</p>
					{:else}
						<ul class="entries">
							{#each overview.lastAudit as entry (entry.id)}
								<li>
									<dl class="entry">
										<div class="entry-title">
											<dt class="visually-hidden">Akce</dt>
											<dd>{auditActionLabel(entry.action)}</dd>
										</div>
										<div class="entry-time">
											<dt class="visually-hidden">Kdy</dt>
											<dd><time class="num" datetime={entry.at}>{formatDateTime(entry.at)}</time></dd>
										</div>
										<div class="entry-text">
											<dt class="visually-hidden">Popis</dt>
											<dd title={entry.description ?? undefined}>{entry.description ?? entry.entity_id ?? '—'}</dd>
										</div>
									</dl>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#if overview.lastImports !== null}
					<section
						class="imports"
						class:has-list={overview.lastImports.length > 0}
						style:flex-grow={overview.lastImports.length > 0 ? overview.lastImports.length : undefined}
						aria-labelledby="t-imports"
					>
						<div class="section-head">
							<h2 id="t-imports">Poslední importy</h2>
							<a href="/import">Všechny importy</a>
						</div>
						{#if overview.lastImports.length === 0}
							<p class="empty-title">Zatím žádný import</p>
							<p class="empty-text">Kmenový Excel nahrajete na stránce Import.</p>
						{:else}
							<ul class="entries">
								{#each overview.lastImports as item (item.id)}
									<li>
										<dl class="entry import">
											<div class="entry-title">
												<dt class="visually-hidden">Soubor</dt>
												<dd title={item.name ?? undefined}>{item.name ?? '—'}</dd>
											</div>
											<div class="entry-time">
												<dt class="visually-hidden">Kdy</dt>
												<dd><time class="num" datetime={item.at}>{formatDateTime(item.at)}</time></dd>
											</div>
											<div class="entry-fact">
												<dt class="visually-hidden">Druh</dt>
												<dd>{item.kind ? (IMPORT_KIND_LABELS[item.kind] ?? item.kind) : '—'}</dd>
											</div>
											<div class="entry-fact">
												<dt class="visually-hidden">Stav</dt>
												<dd>{item.status ? (IMPORT_STATUS_LABELS[item.status] ?? item.status) : '—'}</dd>
											</div>
											<div class="entry-fact">
												<dt>Řádků</dt>
												<dd class="num">{formatNumber(item.rows)}</dd>
											</div>
										</dl>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* The page fills the window: the title row on the backdrop, then the board takes the rest. */
	.overview {
		min-height: var(--page-h);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* Title with the key totals beside it, on the totals' baseline. */
	.head {
		align-items: flex-end;
		align-items: last baseline;
		gap: var(--space-1) var(--space-6);
		padding-right: var(--plate-pad-x);
	}
	/* The totals stay beside the title and wrap within the space left there (right-aligned like the
	   comp); only a narrow window puts them under the title. */
	.totals {
		flex: 1 1 0px;
		min-width: min(100%, 340px);
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: baseline;
		gap: var(--space-1) 20px;
	}
	.totals > div {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.totals dt,
	.totals dd {
		font-size: var(--text-small);
		color: var(--text-2);
	}
	.totals dd {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
	.figure {
		font-size: var(--text-lead);
		font-weight: 600;
		color: var(--ink);
	}
	.loading {
		padding-left: var(--plate-pad-x);
	}

	/* Four plates in two columns. Each row is as tall as its content needs; the height left in the
	   window is shared between the two rows (content-sized rows never inflate the page). */
	.board {
		flex: 1 0 auto;
		display: grid;
		grid-template-columns: minmax(0, 1.94fr) minmax(0, 1fr);
		grid-template-rows: auto auto;
		gap: var(--space-4);
	}
	.card {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: var(--plate-pad-y) var(--plate-pad-x) 20px;
	}

	/* Column header line above a list: label, Počet, Podíl. Rows use the same columns. */
	.cols-head,
	.state-row,
	.bar-row {
		display: grid;
		grid-template-columns: var(--cols);
		column-gap: var(--space-2);
	}
	.cols-head {
		font-size: var(--text-caps);
		color: var(--text-2);
	}
	.right {
		text-align: right;
	}
	.count {
		font-weight: 600;
	}
	.share {
		color: var(--text-2);
	}

	/* States: one segmented bar and a two-column legend; every row opens the filtered list. */
	.states {
		gap: 14px;
		padding-bottom: 18px;
		--cols: minmax(0, 1fr) 56px 56px 14px;
	}
	.spectrum {
		flex: none;
		display: flex;
		gap: 2px;
		height: 32px;
		border-radius: 10px;
		overflow: hidden;
	}
	.spectrum span {
		flex: 1 1 0px;
		min-width: 3px;
	}
	.spectrum .rim {
		box-shadow: inset 0 0 0 1px var(--line-strong);
	}
	.legend {
		flex: 1 0 auto;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 40px;
	}
	.legend-col {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.legend .cols-head {
		padding: 0 var(--space-2) 6px;
	}
	.legend ul {
		flex: 1 0 auto;
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-rows: repeat(var(--rows), minmax(44px, 1fr));
	}
	.legend li {
		display: grid;
		box-shadow: inset 0 1px 0 var(--line);
	}
	.state-row {
		align-items: center;
		padding: 0 var(--space-2);
		border-radius: 10px;
		color: var(--ink);
		text-decoration: none;
		transition: background-color var(--dur-fast) var(--ease-out);
	}
	.state-row:hover {
		background: rgb(11 27 51 / 0.05);
	}
	.state-row:focus-visible {
		z-index: 1;
	}
	/* A long state name wraps inside its column instead of running under the numbers. */
	.state-row :global(.state) {
		min-width: 0;
		white-space: normal;
	}
	.state-row :global(svg) {
		color: var(--icon-quiet);
		transition: color var(--dur-fast) var(--ease-out);
	}
	.state-row:hover :global(svg) {
		color: var(--ink);
	}

	/* Occupancy and holders share one plate. */
	.occupancy-plate {
		gap: 14px;
	}
	.occupancy {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	/* Near or over the limit: the occupancy part of the plate turns yellow, up to the hairline. */
	.occupancy.alert {
		margin: calc(-1 * var(--plate-pad-y)) calc(-1 * var(--plate-pad-x)) -14px;
		padding: var(--plate-pad-y) var(--plate-pad-x) 14px;
		border-radius: var(--radius-plate) var(--radius-plate) 0 0;
		background: var(--accent-50);
	}
	.su-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.su-numbers {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 var(--space-2);
	}
	.big {
		font-size: var(--text-heading);
		line-height: 1.1;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.of {
		color: var(--text-2);
	}
	.su-pct {
		flex: 1;
		text-align: right;
		font-size: var(--text-lead);
		font-weight: 600;
	}
	.meter {
		position: relative;
		height: 12px;
		margin: 4px 0;
		border-radius: 6px;
		background: var(--rule);
	}
	.occupancy.alert .meter {
		background: var(--white);
		box-shadow: inset 0 0 0 1px var(--rule);
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--ink);
	}
	.mark {
		position: absolute;
		top: -4px;
		bottom: -4px;
		width: 4px;
		border-radius: 2px;
		background: var(--accent);
		box-shadow: 0 0 0 1px rgb(11 27 51 / 0.7);
		transform: translateX(-50%);
	}
	.su-note {
		font-size: var(--text-small);
	}
	.occupancy a {
		font-weight: 600;
	}
	.holders {
		flex: 1 0 auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: 14px;
		border-top: 1px solid var(--rule);
		--cols: minmax(0, 1fr) 56px 56px;
	}

	/* Lists with a thin bar under each row (holders, regions); bars relative to the largest row. */
	.bar-list {
		flex: 1 0 auto;
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-rows: repeat(var(--rows), minmax(30px, 1fr));
	}
	.bar-list li {
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
	}
	.bar-row {
		line-height: 18px;
	}
	.track {
		display: block;
		height: 4px;
		border-radius: 2px;
		background: var(--rule);
	}
	.bar {
		display: block;
		height: 100%;
		min-width: 2px;
		border-radius: inherit;
		background: var(--ink);
	}
	.bar.zero {
		min-width: 0;
	}

	/* Regions: one list flowing down two columns, each with its header line. */
	.regions {
		gap: var(--space-3);
		--cols: minmax(0, 1fr) 56px 56px;
	}
	.regions-head,
	.region-list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 40px;
	}
	.region-list {
		grid-auto-flow: column;
	}

	/* Latest changes and imports: lists scroll inside the plate, so the page itself does not. */
	/* The 44 px link row sits higher so the heading lines up with the regions heading beside it. */
	.activity {
		gap: 6px;
		padding-top: 11px;
	}
	.changes,
	.imports {
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.changes {
		flex: 1 1 0px;
		min-height: 97px;
		gap: 6px;
	}
	.imports {
		flex: none;
		gap: 2px;
		padding-top: 6px;
		border-top: 1px solid var(--line);
	}
	.imports.has-list {
		flex: 1 1 0px;
		min-height: 110px;
		gap: 6px;
	}
	/* Only whole entries show: an entry that does not fit wraps into a second column, which is
	   clipped. The rest is one click away under "Celý audit" / "Všechny importy". */
	.entries {
		/* Containing block for the screen-reader labels, so they stay inside the clipped box. */
		position: relative;
		flex: 1 1 0px;
		min-height: 0;
		overflow: hidden;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-flow: column wrap;
		align-content: flex-start;
	}
	.entries li {
		flex: none;
		width: 100%;
		min-width: 0;
		padding: 6px 0;
		border-top: 1px solid var(--line);
	}
	/* One entry: title left, time right (it wraps under a long title), then the second line.
	   The labels are for screen readers; the layout shows what each value is. */
	.entry {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 1px 6px;
	}
	.entry dd {
		margin: 0;
	}
	.entry-title {
		min-width: 0;
		max-width: 100%;
	}
	.entry-title dd,
	.entry-text dd {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.entry-title dd {
		font-weight: 600;
	}
	.entry-time {
		flex: none;
		margin-left: auto;
		padding-left: 6px;
		font-size: var(--text-caps);
		color: var(--text-2);
	}
	.entry-text,
	.entry-fact {
		font-size: var(--text-small);
		color: var(--text-2);
	}
	.entry-text {
		flex: 1 1 100%;
		min-width: 0;
	}
	/* Import: kind, status and rows share the second line. */
	.import::after {
		content: '';
		flex-basis: 100%;
		order: 1;
	}
	.entry-fact {
		order: 2;
		display: flex;
		gap: 4px;
	}
	.entry-fact + .entry-fact::before {
		content: '·';
		content: '·' / '';
		margin-right: 2px;
	}
	.empty-title {
		font-weight: 600;
	}
	.empty-text {
		font-size: var(--text-small);
		color: var(--text-2);
	}

	/* Narrower window: the plates stack and take their natural height. */
	@media (max-width: 1099.98px) {
		.totals {
			justify-content: flex-start;
		}
		.board {
			flex: none;
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: none;
		}
		.changes,
		.imports.has-list,
		.entries {
			flex: none;
			min-height: 0;
			overflow: visible;
		}
		.bar-list {
			grid-template-rows: repeat(var(--rows), minmax(32px, 1fr));
		}
	}
	@media (max-width: 859.98px) {
		.overview {
			min-height: 0;
		}
		.legend {
			grid-template-columns: minmax(0, 1fr);
			row-gap: var(--space-4);
		}
		.regions-head,
		.region-list {
			grid-template-columns: minmax(0, 1fr);
		}
		.regions-head .second {
			display: none;
		}
		.region-list {
			grid-auto-flow: row;
			grid-template-rows: none;
			grid-auto-rows: 40px;
		}
	}
</style>
