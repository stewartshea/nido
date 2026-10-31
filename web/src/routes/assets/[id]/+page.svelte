<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { tokenExpired, currentFamilyId } from '$lib/api/client';
	import { userAPI, familiesAPI } from '$lib/api/family';
	import { assetsAPI } from '$lib/api/assets';
	import { inventoryAPI } from '$lib/api/inventory';
	import { authActions } from '$lib/stores/authStore';
	import type {
		AssetCare, ConditionState, InventoryItem, MaintenanceEntry, Meter, MeterKind, Schedule,
	} from '$lib/api/types';
	import ScheduleForm from '$lib/components/logging/ScheduleForm.svelte';
	import MaintenanceForm from '$lib/components/logging/MaintenanceForm.svelte';
	import AttachmentGallery from '$lib/components/logging/AttachmentGallery.svelte';
	import AssetPicture from '$lib/components/AssetPicture.svelte';

	// The asset page — where the care loop actually lives (HOME modules 2–4,
	// issues #66–#68).
	//
	// Meters answer "how far / how many hours", schedules answer "what's due",
	// and the maintenance log is the record that satisfies a schedule and
	// rolls up what the asset has cost. Nothing on this page is a checkbox
	// that can disagree with the log: "done" is always an entry.

	let assetId = 0;
	let care: AssetCare | null = null;
	let homes: { id: number; name: string }[] = [];
	let inventory: InventoryItem[] = [];
	let loaded = false;
	let error = '';
	let notice = '';

	// Forms
	let showScheduleForm = false;
	let editingSchedule: Schedule | null = null;
	let showEntryForm = false;
	let entrySchedule: Schedule | null = null;
	let showMeterForm = false;
	let readingMeterId: number | null = null;
	let readingValue = '';
	let readingDate = '';
	let meterKind: MeterKind = 'distance';
	let meterUnit = 'km';
	let meterLabel = '';
	let skipReasons: Record<number, string> = {};
	let showArchivedSchedules = false;
	let pictureError = '';

	$: homeName = (id: number | null) => (id === null ? '' : homes.find((h) => h.id === id)?.name ?? '');
	$: activeSchedules = care?.schedules.filter((s) => s.archivedAt === null) ?? [];
	$: archivedSchedules = care?.schedules.filter((s) => s.archivedAt !== null) ?? [];
	$: dueSchedules = activeSchedules.filter((s) => s.status.state !== 'ok');
	// The seasonal pair is computed once, in the script, so the template never
	// has to assert away a null it just filtered out.
	$: seasonal = activeSchedules
		.filter((s) => s.status.season !== null)
		.map((s) => ({ schedule: s, season: s.status.season! }));

	function formatMoney(cents: number | null): string {
		if (cents === null || cents === undefined) return '—';
		return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
	}

	function formatNumber(value: number): string {
		return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 }).format(value);
	}

	function badgeClass(state: ConditionState): string {
		if (state === 'overdue') return 'border-danger text-danger-text';
		if (state === 'due') return 'border-accent text-accent';
		return 'border-line text-ink-soft';
	}

	function stateLabel(state: ConditionState): string {
		return state === 'overdue' ? 'Overdue' : state === 'due' ? 'Due' : 'OK';
	}

	function conditionLine(schedule: Schedule): string {
		return schedule.conditions.map((condition) => {
			if (condition.kind === 'interval') {
				return condition.unit === 'months'
					? `every ${condition.every} month${condition.every === 1 ? '' : 's'}`
					: `every ${condition.every} day${condition.every === 1 ? '' : 's'}`;
			}
			if (condition.kind === 'meter') {
				const meter = care?.meters.find((m) => m.id === condition.meterId);
				return `every ${formatNumber(condition.every)} ${meter?.unit ?? ''}`.trim();
			}
			return `${condition.start} – ${condition.end}`;
		}).join(schedule.match === 'all' ? ' and ' : ' or ');
	}

	async function load() {
		error = '';
		try {
			const res = await assetsAPI.care(assetId);
			care = res.data;
			readingDate = res.data.today;
		} catch (e: any) {
			if (e?.response?.status === 401) await goto('/login');
			else if (e?.response?.status === 404) error = 'That asset is not here.';
			else error = e?.response?.data?.error || 'Could not load this asset.';
		} finally {
			loaded = true;
		}
	}

	function onScheduleSaved() {
		showScheduleForm = false;
		editingSchedule = null;
		notice = '';
		load();
	}

	function onEntrySaved() {
		showEntryForm = false;
		entrySchedule = null;
		notice = 'Logged.';
		load();
	}

	function logIt(schedule: Schedule) {
		entrySchedule = schedule;
		showEntryForm = true;
		showScheduleForm = false;
	}

	async function archiveSchedule(schedule: Schedule) {
		try {
			await assetsAPI.archiveSchedule(schedule.id);
			notice = `${schedule.task} archived — its history stays.`;
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not archive the schedule.';
		}
	}

	async function unarchiveSchedule(schedule: Schedule) {
		try {
			await assetsAPI.unarchiveSchedule(schedule.id);
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not unarchive the schedule.';
		}
	}

	/** "Not this season" — a recorded excuse, not a pretend completion. */
	async function skipSeason(schedule: Schedule) {
		const window = schedule.status.season?.window;
		if (!window) return;
		try {
			await assetsAPI.skipSeason(schedule.id, window.start, skipReasons[schedule.id]?.trim() || null);
			skipReasons[schedule.id] = '';
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not skip this season.';
		}
	}

	/** The asset's cover photo: upload replaces the previous one. */
	async function onPictureChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		pictureError = '';
		try {
			await assetsAPI.uploadPicture(assetId, file);
			await load();
		} catch (e: any) {
			pictureError = e?.response?.data?.error || 'Could not upload that photo.';
		}
	}

	async function addMeter() {
		error = '';
		try {
			await assetsAPI.addMeter(assetId, { kind: meterKind, unit: meterUnit.trim(), label: meterLabel.trim() || null });
			showMeterForm = false;
			meterLabel = '';
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not add the meter.';
		}
	}

	async function addReading(meter: Meter) {
		error = '';
		const value = Number(readingValue);
		if (!Number.isFinite(value) || value < 0) {
			error = 'A reading must be a number.';
			return;
		}
		try {
			await assetsAPI.addReading(meter.id, { value, recordedAt: readingDate || undefined });
			readingMeterId = null;
			readingValue = '';
			notice = 'Reading saved.';
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not save the reading.';
		}
	}

	async function deleteEntry(entry: MaintenanceEntry) {
		if (!window.confirm(`Delete "${entry.task}"? Stock it used goes back.`)) return;
		try {
			await assetsAPI.deleteEntry(entry.id);
			notice = 'Entry deleted.';
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not delete the entry.';
		}
	}

	onMount(() => {
		const match = /^\/assets\/(\d+)/.exec(window.location.pathname);
		assetId = match ? Number(match[1]) : 0;
		if (!assetId) {
			error = 'That asset is not here.';
			loaded = true;
			return;
		}
		const token = localStorage.getItem('token');
		if (!token || tokenExpired()) {
			goto('/login');
			return;
		}
		load();
		userAPI.getMe().then((res) => {
			const u = (res.data as any).user;
			if (u) {
				authActions.setUser({
					id: Number(u.id),
					email: u.email,
					firstName: u.first_name ?? u.firstName ?? '',
					lastName: u.last_name ?? u.lastName ?? '',
					createdAt: u.created_at ?? u.createdAt ?? '',
				});
			}
		}).catch(() => {});
		const familyId = currentFamilyId();
		if (familyId) {
			familiesAPI.homes(familyId).then((r) => { homes = r.data.homes ?? []; }).catch(() => {});
		}
		inventoryAPI.list().then((r) => { inventory = r.data.items ?? []; }).catch(() => {});
	});
</script>

<svelte:head><title>Asset · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => goto('/assets')} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; All assets</button>

	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}
	{#if notice}<p class="text-sm text-ink-soft mb-3" role="status">{notice}</p>{/if}

	{#if loaded && care}
		{@const asset = care.asset}
		<header class="mb-4 flex items-start gap-3" data-testid="asset-detail">
			{#if asset.picture}
				<AssetPicture assetId={asset.id} picture={asset.picture} alt={asset.name} size="w-20 h-20" />
			{:else}
				<div class="w-20 h-20 shrink-0 rounded-md border border-dashed border-line flex items-center justify-center text-xs text-ink-soft">No photo</div>
			{/if}
			<div class="min-w-0 flex-1">
				<h1 class="text-2xl font-display font-semibold text-ink">{asset.name}</h1>
				<p class="text-sm text-ink-soft mt-1">
					{[asset.identity.manufacturer, asset.identity.model, asset.identity.modelYear].filter(Boolean).join(' ') || 'No identity yet'}
					{#if asset.homeId !== null && homeName(asset.homeId)} · at {homeName(asset.homeId)}{/if}
				</p>
				{#if asset.notes}<p class="text-sm text-ink-soft mt-2 whitespace-pre-wrap">{asset.notes}</p>{/if}
				<label class="inline-block mt-2 text-sm underline text-accent cursor-pointer">
					{asset.picture ? 'Change photo' : 'Add a photo'}
					<input type="file" accept="image/*" class="sr-only" on:change={onPictureChosen} />
				</label>
				{#if pictureError}<p class="text-xs text-danger-text mt-1">{pictureError}</p>{/if}
			</div>
		</header>

		<div class="mb-6">
			<AttachmentGallery
				refType="asset"
				refId={asset.id}
				attachments={care.attachments.filter((a) => a.refType === 'asset' && a.id !== asset.picture)}
				title="Photos, manuals & files"
				accept="image/*,application/pdf"
				on:change={load}
			/>
		</div>

		{#if dueSchedules.length}
			<div class="bg-surface border border-line rounded-xl shadow-card p-4 mb-4" data-testid="asset-due">
				<h2 class="font-semibold text-ink mb-2">Needs attention</h2>
				<ul class="grid gap-2">
					{#each dueSchedules as schedule (schedule.id)}
						<li class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="text-sm font-semibold text-ink">{schedule.task}</p>
								<p class="text-xs text-ink-soft">{schedule.status.conditions.find((c) => c.state === schedule.status.state)?.detail ?? ''}</p>
							</div>
							<button type="button" class="text-sm underline text-accent shrink-0" on:click={() => logIt(schedule)}>Log it</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if showEntryForm}
			<MaintenanceForm
				assetId={assetId}
				meters={care.meters}
				inventory={inventory}
				schedule={entrySchedule}
				today={care.today}
				on:save={onEntrySaved}
				on:cancel={() => { showEntryForm = false; entrySchedule = null; }}
			/>
		{/if}

		{#if showScheduleForm}
			<ScheduleForm
				{assetId}
				meters={care.meters}
				editing={editingSchedule}
				on:save={onScheduleSaved}
				on:cancel={() => { showScheduleForm = false; editingSchedule = null; }}
			/>
		{/if}

		<!-- Meters -->
		<section class="mb-6" data-testid="asset-meters">
			<div class="flex items-center justify-between mb-2">
				<h2 class="font-display font-semibold text-lg text-ink">Meters</h2>
				<button type="button" class="text-sm underline text-accent" on:click={() => (showMeterForm = !showMeterForm)}>
					{showMeterForm ? 'Cancel' : '+ Add a meter'}
				</button>
			</div>

			{#if showMeterForm}
				<div class="bg-surface border border-line rounded-xl p-4 mb-3 grid gap-2 sm:grid-cols-3">
					<label class="text-sm text-ink-soft">
						Kind
						<select
							class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink"
							bind:value={meterKind}
							on:change={() => (meterUnit = meterKind === 'distance' ? 'km' : meterKind === 'time' ? 'h' : 'cycles')}
						>
							<option value="distance">Distance (odometer)</option>
							<option value="time">Hours (run time)</option>
							<option value="count">Count (cycles, loads)</option>
						</select>
					</label>
					<label class="text-sm text-ink-soft">
						Unit
						{#if meterKind === 'distance'}
							<select class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={meterUnit}>
								<option value="km">km</option>
								<option value="mi">mi</option>
							</select>
						{:else if meterKind === 'time'}
							<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" value="h" disabled />
						{:else}
							<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={meterUnit} placeholder="cycles" />
						{/if}
					</label>
					<label class="text-sm text-ink-soft">
						Label (optional)
						<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={meterLabel} placeholder="Odometer" />
					</label>
					<div class="sm:col-span-3 flex justify-end">
						<button type="button" class="px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold" on:click={addMeter}>Add meter</button>
					</div>
				</div>
			{/if}

			{#if care.meters.length === 0}
				<p class="text-sm text-ink-soft">No meter yet. A car wants an odometer; a generator wants run hours.</p>
			{:else}
				<ul class="grid gap-3">
					{#each care.meters as meter (meter.id)}
						<li class="bg-surface border border-line-soft rounded-xl p-4" data-testid={`meter-${meter.id}`}>
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-semibold text-ink">{meter.label || (meter.kind === 'distance' ? 'Odometer' : meter.kind === 'time' ? 'Run hours' : 'Counter')}</p>
									<p class="text-sm text-ink-soft">
										{#if meter.lastReading}
											Last read <span class="text-ink">{formatNumber(meter.lastReading.value)} {meter.unit}</span> on {meter.lastReading.recordedAt}
										{:else}
											No readings yet
										{/if}
									</p>
									{#if meter.estimate?.estimated}
										<p class="text-xs text-ink-soft mt-1">≈ {formatNumber(meter.estimate.value)} {meter.unit} today (estimated)</p>
									{/if}
								</div>
								<button type="button" class="text-sm underline text-accent shrink-0" on:click={() => { readingMeterId = readingMeterId === meter.id ? null : meter.id; readingValue = ''; }}>
									{readingMeterId === meter.id ? 'Cancel' : 'Add reading'}
								</button>
							</div>
							{#if readingMeterId === meter.id}
								<div class="flex gap-2 mt-3 items-end">
									<label class="text-sm text-ink-soft flex-1">
										Reading ({meter.unit})
										<input class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={readingValue} inputmode="decimal" />
									</label>
									<label class="text-sm text-ink-soft">
										Date
										<input type="date" class="w-full mt-1 px-3 py-2 border border-line rounded-md bg-page text-ink" bind:value={readingDate} />
									</label>
									<button type="button" class="px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold" on:click={() => addReading(meter)}>Save</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<!-- Seasonal checklist: derived, never stored -->
		{#if seasonal.length}
			<section class="mb-6" data-testid="asset-season">
				<h2 class="font-display font-semibold text-lg text-ink mb-2">This season</h2>
				<ul class="grid gap-3">
					{#each seasonal as { schedule, season } (schedule.id)}
						<li class="bg-surface border border-line-soft rounded-xl p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-semibold text-ink">{schedule.task}</p>
									<p class="text-sm text-ink-soft">{season.window.start} – {season.window.end}</p>
								</div>
								<span class="text-xs font-semibold border rounded-full px-2 py-0.5 shrink-0 {season.satisfied ? 'border-line text-ink-soft' : 'border-accent text-accent'}">
									{season.satisfied ? (season.skipped ? 'Skipped' : 'Done') : season.state === 'open' ? 'Open' : season.state === 'closed' ? 'Missed' : 'Upcoming'}
								</span>
							</div>
							{#if season.satisfied && season.entryAt}
								<p class="text-xs text-ink-soft mt-2">Done {season.entryAt}</p>
							{:else if season.satisfied && season.skipped}
								<p class="text-xs text-ink-soft mt-2">Skipped{season.skipReason ? `: ${season.skipReason}` : ''}</p>
							{:else if season.state !== 'upcoming'}
								<div class="flex flex-wrap gap-2 mt-3 items-end">
									<button type="button" class="text-sm underline text-accent" on:click={() => logIt(schedule)}>Mark done</button>
									<input class="px-3 py-1.5 border border-line rounded-md bg-page text-ink text-sm" bind:value={skipReasons[schedule.id]} placeholder="Why not this season? (optional)" />
									<button type="button" class="text-sm underline text-ink-soft hover:text-ink" on:click={() => skipSeason(schedule)}>Not this season</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- Schedules -->
		<section class="mb-6" data-testid="asset-schedules">
			<div class="flex items-center justify-between mb-2">
				<h2 class="font-display font-semibold text-lg text-ink">Schedules</h2>
				<button type="button" class="text-sm underline text-accent" on:click={() => { editingSchedule = null; showScheduleForm = !showScheduleForm; }}>
					{showScheduleForm ? 'Cancel' : '+ Add schedule'}
				</button>
			</div>

			{#if activeSchedules.length === 0}
				<p class="text-sm text-ink-soft">Nothing scheduled yet. Start with what the manual says: oil changes, filters, a seasonal swap.</p>
			{:else}
				<ul class="grid gap-3">
					{#each activeSchedules as schedule (schedule.id)}
						<li class="bg-surface border border-line-soft rounded-xl p-4" data-testid={`schedule-${schedule.id}`}>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-semibold text-ink">{schedule.task}</p>
									<p class="text-sm text-ink-soft">{conditionLine(schedule)}</p>
									<p class="text-xs text-ink-soft mt-1">
										{schedule.status.conditions.find((c) => c.state === schedule.status.state)?.detail ?? ''}
									</p>
								</div>
								<span class="text-xs font-semibold border rounded-full px-2 py-0.5 shrink-0 {badgeClass(schedule.status.state)}">
									{stateLabel(schedule.status.state)}
								</span>
							</div>
							<div class="flex flex-wrap gap-3 mt-3 text-sm">
								<button type="button" class="underline text-accent" on:click={() => logIt(schedule)}>Log it</button>
								<button type="button" class="underline text-ink-soft hover:text-ink" on:click={() => { editingSchedule = schedule; showScheduleForm = true; }}>Edit</button>
								<button type="button" class="underline text-ink-soft hover:text-ink" on:click={() => archiveSchedule(schedule)}>Archive</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if archivedSchedules.length}
				<button type="button" class="mt-3 text-sm underline text-ink-soft hover:text-ink" on:click={() => (showArchivedSchedules = !showArchivedSchedules)}>
					{showArchivedSchedules ? 'Hide' : 'Show'} {archivedSchedules.length} archived
				</button>
				{#if showArchivedSchedules}
					<ul class="grid gap-2 mt-2">
						{#each archivedSchedules as schedule (schedule.id)}
							<li class="flex items-center justify-between gap-3 text-sm text-ink-soft">
								<span>{schedule.task} <span class="text-xs">(archived)</span></span>
								<button type="button" class="underline hover:text-ink" on:click={() => unarchiveSchedule(schedule)}>Unarchive</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>

		<!-- History & cost -->
		<section data-testid="asset-history">
			<div class="flex items-center justify-between mb-2">
				<h2 class="font-display font-semibold text-lg text-ink">History</h2>
				<button type="button" class="text-sm underline text-accent" on:click={() => { entrySchedule = null; showEntryForm = !showEntryForm; }}>
					{showEntryForm ? 'Cancel' : '+ Log maintenance'}
				</button>
			</div>

			{#if care.rollup.total !== null}
				<p class="text-sm text-ink-soft mb-2">
					Spent <span class="font-semibold text-ink">{formatMoney(care.rollup.total)}</span>
					across {care.rollup.count} {care.rollup.count === 1 ? 'entry' : 'entries'}
					{#if care.rollup.byYear.length > 1}
						· {care.rollup.byYear.map((year) => `${year.year}: ${formatMoney(year.total)}`).join(' · ')}
					{/if}
				</p>
			{/if}

			{#if care.entries.length === 0}
				<p class="text-sm text-ink-soft">No maintenance logged yet. Every entry keeps the history — and checks off a schedule.</p>
			{:else}
				<ul class="grid gap-2">
					{#each care.entries as entry (entry.id)}
						<li class="bg-surface border border-line-soft rounded-xl p-3" data-testid={`entry-${entry.id}`}>
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-sm font-semibold text-ink">{entry.task}</p>
									<p class="text-xs text-ink-soft">
										{entry.performedAt}
										{#if entry.cost !== null} · {formatMoney(entry.cost)}{/if}
										{#if entry.scheduleId} · scheduled{/if}
									</p>
									{#if entry.notes}<p class="text-xs text-ink-soft mt-1 whitespace-pre-wrap">{entry.notes}</p>{/if}
									{#if entry.consumedItems.length}
										<p class="text-xs text-ink-soft mt-1">
											Used {entry.consumedItems.map((item) => `${item.quantity} ${item.unit ?? ''} ${item.name ?? 'item'}`.trim()).join(', ')}
										</p>
									{/if}
									<div class="mt-2">
										<AttachmentGallery
											refType="maintenance"
											refId={entry.id}
											attachments={care.attachments.filter((a) => a.refType === 'maintenance' && a.refId === entry.id)}
											title="Receipts & photos"
											accept="image/*,application/pdf"
											compact
											on:change={load}
										/>
									</div>
								</div>
								<button type="button" class="text-xs underline text-ink-soft hover:text-danger-text shrink-0" on:click={() => deleteEntry(entry)}>Delete</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
