<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		feedingAPI, diaperAPI, sleepAPI, growthAPI, milestoneAPI,
		vaccinationAPI, moodAPI, journalAPI,
	} from '$lib/api';
	import { DEFAULT_CATEGORY_OPTIONS, milestoneCategory, milestoneCategoryKey, isMilestoneKind } from '$lib/shared';
	import { convertLength, convertWeight, round1, type GrowthUnitSystem } from '$lib/growth/units';
	import { buildManualBreastFeed } from '$lib/breast';

	// Shared edit dialog for every tracking record. `kind` is one of:
	// feeding | pumping | diaper | sleep | growth | milestone | vaccine | mood | journal
	export let open = false;
	export let kind = '';
	export let record: any = null;

	const dispatch = createEventDispatcher();

	let error = '';
	let saving = false;

	// Time fields
	let eTime = '';
	let eEnd = '';
	// Feeds / pump
	let eType = '';
	let eSide = '';
	let eLeftMin = '';
	let eRightMin = '';
	let eLastOn: 'left' | 'right' = 'right';
	let eAmount: number | string = '';
	let eAmountUnit: 'ml' | 'oz' = 'oz';
	// Diapers
	let eConsistency = '';
	let eColor = '';
	// Sleep
	let eLocation = '';
	// Growth
	let eWeight: number | string = '';
	let eHeight: number | string = '';
	let eHead: number | string = '';
	let eUnitSystem: GrowthUnitSystem = 'metric';
	// Milestones / vaccines / journal
	let eTitle = '';
	let eBody = '';
	let eCategory = '';
	let eName = '';
	// Moods
	let eMood = '';
	// Shared
	let eNotes = '';

	function field(r: any, ...names: string[]): any {
		for (const n of names) {
			if (r && r[n] !== undefined && r[n] !== null) return r[n];
		}
		return null;
	}

	function toLocalInput(iso: string | null | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function initFields() {
		if (!record) return;
		error = '';
		saving = false;
		const r = record;
		eTime = toLocalInput(field(r, 'start_time', 'change_time', 'measurement_date', 'achieved_date', 'date_given', 'recorded_at', 'entry_date', 'startTime', 'recordedAt', 'entryDate'));
		eEnd = toLocalInput(field(r, 'end_time', 'endTime'));
		eType = String(field(r, 'type') ?? '');
		eSide = String(field(r, 'side') ?? '');
		const leftMs = field(r, 'left_duration');
		const rightMs = field(r, 'right_duration');
		eLeftMin = leftMs == null ? '' : String(Math.max(1, Math.round(Number(leftMs) / 60000)));
		eRightMin = rightMs == null ? '' : String(Math.max(1, Math.round(Number(rightMs) / 60000)));
		const leftAt = field(r, 'left_breast_at');
		const rightAt = field(r, 'right_breast_at');
		eLastOn = leftAt && rightAt && new Date(leftAt).getTime() > new Date(rightAt).getTime() ? 'left' : 'right';
		eAmount = field(r, 'amount') ?? '';
		eAmountUnit = String(field(r, 'amount_unit') ?? 'oz') === 'ml' ? 'ml' : 'oz';
		eConsistency = String(field(r, 'consistency') ?? '');
		eColor = String(field(r, 'color') ?? '');
		eLocation = String(field(r, 'location') ?? '');
		eWeight = field(r, 'weight') ?? '';
		eHeight = field(r, 'height') ?? '';
		eHead = field(r, 'head_circumference', 'headCircumference') ?? '';
		eUnitSystem = field(r, 'unit_system', 'unitSystem') === 'imperial' ? 'imperial' : 'metric';
		eTitle = String(field(r, 'title') ?? '');
		eBody = String(field(r, 'body') ?? '');
		eCategory = String(field(r, 'category') ?? '');
		eName = String(field(r, 'name') ?? '');
		eMood = String(field(r, 'mood') ?? '');
		eNotes = String(field(r, 'notes') ?? '');
	}

	$: if (open && record) initFields();

	function changeGrowthUnit(value: string) {
		const next: GrowthUnitSystem = value === 'imperial' ? 'imperial' : 'metric';
		const prev = eUnitSystem;
		if (next === prev) return;
		const converted = (value: number | string, fn: (n: number) => number) =>
			value === '' ? value : String(round1(fn(Number(value))));
		eWeight = converted(eWeight, (n) => convertWeight(n, prev, next));
		eHeight = converted(eHeight, (n) => convertLength(n, prev, next));
		eHead = converted(eHead, (n) => convertLength(n, prev, next));
		eUnitSystem = next;
	}

	// A milestone row's own kind selects the vocabulary, so the edit dialog
	// offers the same categories the logger does instead of free text.
	$: eCategories = (() => {
		if (!record) return [] as string[];
		const k = milestoneCategory(record);
		if (!isMilestoneKind(k)) return [];
		return DEFAULT_CATEGORY_OPTIONS[k]?.[milestoneCategoryKey(k)] ?? [];
	})();

	function isoOrNull(local: string): string | undefined {
		return local ? new Date(local).toISOString() : undefined;
	}

	async function save() {
		if (!record) return;
		saving = true;
		error = '';
		const id = Number(record.id);
		const time = isoOrNull(eTime);
		const end = isoOrNull(eEnd);
		try {
			if (kind === 'feeding' || kind === 'pumping') {
				const perSide = eSide && eType === 'breast' ? 1 : 0;
				const breast = perSide
					? buildManualBreastFeed({
						startMs: new Date(time ?? new Date().toISOString()).getTime(),
						side: eSide as 'left' | 'right' | 'both',
						endsOn: eLastOn,
						leftMin: eLeftMin ? Number(eLeftMin) : null,
						rightMin: eRightMin ? Number(eRightMin) : null,
					})
					: { side: null, leftBreastAt: null, rightBreastAt: null, leftDuration: null, rightDuration: null };
				await feedingAPI.update(id, {
					startTime: time,
					endTime: end,
					type: eType as any,
					side: breast.side as any,
					leftBreastAt: breast.leftBreastAt ?? null,
					rightBreastAt: breast.rightBreastAt ?? null,
					leftDuration: breast.leftDuration ?? null,
					rightDuration: breast.rightDuration ?? null,
					amount: eAmount === '' ? undefined : Number(eAmount),
					amountUnit: kind === 'pumping' ? eAmountUnit : undefined,
					notes: eNotes || undefined,
				});
			} else if (kind === 'diaper') {
				await diaperAPI.update(id, {
					changeTime: time,
					type: eType as any,
					consistency: eConsistency || undefined,
					color: eColor || undefined,
					notes: eNotes || undefined,
				});
			} else if (kind === 'sleep') {
				await sleepAPI.update(id, {
					startTime: time,
					endTime: end,
					location: eLocation || undefined,
					notes: eNotes || undefined,
				});
			} else if (kind === 'growth') {
				await growthAPI.update(id, {
					measurementDate: time,
					weight: eWeight === '' ? undefined : Number(eWeight),
					height: eHeight === '' ? undefined : Number(eHeight),
					headCircumference: eHead === '' ? undefined : Number(eHead),
					unitSystem: eUnitSystem,
					notes: eNotes || undefined,
				});
			} else if (kind === 'milestone') {
				await milestoneAPI.update(id, {
					title: eTitle.trim() || undefined,
					achievedDate: time,
					category: eCategory || undefined,
					description: eNotes || undefined,
				});
			} else if (kind === 'vaccine') {
				await vaccinationAPI.update(id, {
					name: eName.trim() || undefined,
					dateGiven: time,
					notes: eNotes || undefined,
				});
			} else if (kind === 'mood') {
				await moodAPI.update(id, {
					mood: eMood || undefined,
					recordedAt: time,
					notes: eNotes || undefined,
				});
			} else if (kind === 'journal') {
				await journalAPI.update(id, {
					title: eTitle || undefined,
					body: eBody || undefined,
					entryDate: time,
				});
			}
			open = false;
			dispatch('saved');
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update record.';
		} finally {
			saving = false;
		}
	}

	function close() {
		open = false;
	}
</script>

{#if open && record}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Edit record">
		<button type="button" class="absolute inset-0 bg-ink/40" aria-label="Close dialog" on:click={close}></button>
		<div class="relative bg-surface rounded-lg shadow-card p-4 md:p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
			<h3 class="text-xl font-display font-semibold mb-1">Edit {kind === 'pumping' ? 'pump session' : kind}</h3>
			{#if record && (record.created_by_name || record.createdByName)}
				<p class="text-xs text-ink-soft mb-4">Recorded by {record.created_by_name || record.createdByName}</p>
			{:else}
				<div class="mb-4"></div>
			{/if}

			{#if error}
				<div class="bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm mb-3">{error}</div>
			{/if}

			<div class="space-y-3">
				<div>
					<label for="edit-record-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
					<input id="edit-record-time" type="datetime-local" bind:value={eTime} class="w-full px-3 py-2 border border-line rounded-md" />
				</div>

				{#if kind === 'feeding' || kind === 'pumping'}
					{#if kind === 'feeding'}
						<div>
							<div class="block text-sm font-medium text-ink-soft mb-1">Type</div>
							<select bind:value={eType} class="w-full px-3 py-2 border border-line rounded-md">
								<option value="breast">Breast</option>
								<option value="bottle">Bottle</option>
								<option value="formula">Formula</option>
								<option value="pump">Pump</option>
								<option value="solid">Solid</option>
							</select>
						</div>
					{/if}
					{#if eType === 'breast' || kind === 'pumping'}
						<div>
							<div class="block text-sm font-medium text-ink-soft mb-1">Side</div>
							<select bind:value={eSide} class="w-full px-3 py-2 border border-line rounded-md">
								<option value="">—</option>
								<option value="left">Left</option>
								<option value="right">Right</option>
								<option value="both">Both</option>
							</select>
						</div>
						{#if eSide === 'left' || eSide === 'both'}
							<div>
								<label for="edit-record-left-min" class="block text-sm font-medium text-ink-soft mb-1">Left (minutes)</label>
								<input id="edit-record-left-min" type="number" min="0" step="1" bind:value={eLeftMin} class="w-full px-3 py-2 border border-line rounded-md" placeholder="optional" />
							</div>
						{/if}
						{#if eSide === 'right' || eSide === 'both'}
							<div>
								<label for="edit-record-right-min" class="block text-sm font-medium text-ink-soft mb-1">Right (minutes)</label>
								<input id="edit-record-right-min" type="number" min="0" step="1" bind:value={eRightMin} class="w-full px-3 py-2 border border-line rounded-md" placeholder="optional" />
							</div>
						{/if}
						{#if eSide === 'both'}
							<div>
								<div class="block text-sm font-medium text-ink-soft mb-1">Last used</div>
								<select bind:value={eLastOn} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="left">Left</option>
									<option value="right">Right</option>
								</select>
							</div>
						{/if}
					{/if}
					{#if eType !== 'breast' || kind === 'pumping'}
						<div>
							<label for="edit-record-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount {kind === 'pumping' ? `({eAmountUnit})` : '(oz)'}</label>
							<div class="flex items-center gap-2">
								<input id="edit-record-amount" type="number" step="0.1" bind:value={eAmount} class="flex-1 px-3 py-2 border border-line rounded-md" />
								{#if kind === 'pumping'}
									<div class="flex rounded-md border border-line-soft overflow-hidden">
										<button type="button" on:click={() => (eAmountUnit = 'oz')} class="{eAmountUnit === 'oz' ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft'} h-9 px-3 text-sm font-semibold">oz</button>
										<button type="button" on:click={() => (eAmountUnit = 'ml')} class="{eAmountUnit === 'ml' ? 'bg-primary text-on-primary' : 'bg-surface text-ink-soft'} h-9 px-3 text-sm font-semibold">ml</button>
									</div>
								{/if}
							</div>
						</div>
					{/if}
					<div>
						<label for="edit-record-end" class="block text-sm font-medium text-ink-soft mb-1">End time (optional)</label>
						<input id="edit-record-end" type="datetime-local" bind:value={eEnd} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
				{:else if kind === 'diaper'}
					<div>
						<div class="block text-sm font-medium text-ink-soft mb-1">Type</div>
						<select bind:value={eType} class="w-full px-3 py-2 border border-line rounded-md">
							<option value="wet">Wet</option>
							<option value="dirty">Dirty</option>
							<option value="both">Both</option>
						</select>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div>
							<label for="edit-record-consistency" class="block text-sm font-medium text-ink-soft mb-1">Consistency</label>
							<input id="edit-record-consistency" type="text" bind:value={eConsistency} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div>
							<label for="edit-record-color" class="block text-sm font-medium text-ink-soft mb-1">Color</label>
							<input id="edit-record-color" type="text" bind:value={eColor} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
					</div>
				{:else if kind === 'sleep'}
					<div>
						<label for="edit-record-end" class="block text-sm font-medium text-ink-soft mb-1">End time (optional)</label>
						<input id="edit-record-end" type="datetime-local" bind:value={eEnd} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
					<div>
						<label for="edit-record-location" class="block text-sm font-medium text-ink-soft mb-1">Location</label>
						<select id="edit-record-location" bind:value={eLocation} class="w-full px-3 py-2 border border-line rounded-md">
							<option value="">—</option>
							<option value="crib">Crib</option>
							<option value="bassinet">Bassinet</option>
							<option value="stroller">Stroller</option>
							<option value="carrier">Carrier</option>
							<option value="other">Other</option>
						</select>
					</div>
				{:else if kind === 'growth'}
					<div>
						<label for="edit-record-units" class="block text-sm font-medium text-ink-soft mb-1">Units</label>
						<select id="edit-record-units" value={eUnitSystem} on:change={(e) => changeGrowthUnit(e.currentTarget.value)} class="w-full px-3 py-2 border border-line rounded-md">
							<option value="metric">Metric (kg, cm)</option>
							<option value="imperial">Imperial (lb, in)</option>
						</select>
					</div>
					<div class="grid grid-cols-3 gap-3">
						<div>
							<label for="edit-record-weight" class="block text-sm font-medium text-ink-soft mb-1">Weight ({eUnitSystem === 'imperial' ? 'lb' : 'kg'})</label>
							<input id="edit-record-weight" type="number" step="0.1" bind:value={eWeight} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div>
							<label for="edit-record-height" class="block text-sm font-medium text-ink-soft mb-1">Length ({eUnitSystem === 'imperial' ? 'in' : 'cm'})</label>
							<input id="edit-record-height" type="number" step="0.1" bind:value={eHeight} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div>
							<label for="edit-record-head" class="block text-sm font-medium text-ink-soft mb-1">Head ({eUnitSystem === 'imperial' ? 'in' : 'cm'})</label>
							<input id="edit-record-head" type="number" step="0.1" bind:value={eHead} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
					</div>
				{:else if kind === 'milestone'}
					<div>
						<label for="edit-record-title" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
						<input id="edit-record-title" type="text" bind:value={eTitle} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
					<div>
						<label for="edit-record-category" class="block text-sm font-medium text-ink-soft mb-1">Category</label>
						<select id="edit-record-category" bind:value={eCategory} class="w-full px-3 py-2 border border-line rounded-md">
							<option value="">—</option>
							{#each eCategories as c}
								<option value={c}>{c}</option>
							{/each}
							{#if eCategory && !eCategories.includes(eCategory)}
								<option value={eCategory}>{eCategory} (saved)</option>
							{/if}
						</select>
					</div>
				{:else if kind === 'vaccine'}
					<div>
						<label for="edit-record-name" class="block text-sm font-medium text-ink-soft mb-1">Vaccine name</label>
						<input id="edit-record-name" type="text" bind:value={eName} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
				{:else if kind === 'mood'}
					<div>
						<label for="edit-record-mood" class="block text-sm font-medium text-ink-soft mb-1">Mood</label>
						<input id="edit-record-mood" type="text" bind:value={eMood} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
				{:else if kind === 'journal'}
					<div>
						<label for="edit-record-title" class="block text-sm font-medium text-ink-soft mb-1">Title</label>
						<input id="edit-record-title" type="text" bind:value={eTitle} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
					<div>
						<label for="edit-record-body" class="block text-sm font-medium text-ink-soft mb-1">Note</label>
						<textarea id="edit-record-body" bind:value={eBody} rows="3" class="w-full px-3 py-2 border border-line rounded-md"></textarea>
					</div>
				{/if}

				{#if kind !== 'journal'}
					<div>
						<label for="edit-record-note" class="block text-sm font-medium text-ink-soft mb-1">{kind === 'milestone' ? 'Description' : 'Notes'}</label>
						<textarea id="edit-record-note" bind:value={eNotes} rows="2" class="w-full px-3 py-2 border border-line rounded-md" placeholder="Optional"></textarea>
					</div>
				{/if}
			</div>

			<div class="flex justify-end gap-2 mt-5">
				<button type="button" on:click={close} class="px-4 py-2 bg-surface2 text-ink-soft rounded-md">Cancel</button>
				<button type="button" on:click={save} disabled={saving} class="px-4 py-2 bg-primary text-on-primary rounded-md disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
			</div>
		</div>
	</div>
{/if}
