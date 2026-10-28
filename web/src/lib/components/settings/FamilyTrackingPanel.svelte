<script lang="ts">
	import { notify, fail } from '$lib/stores/feedback';
	import { familiesAPI } from '$lib/api/family';
	import { applyTimezone } from '$lib/stores/timezoneStore';
	import { detectTimeZone, listTimeZones, zonedOptions } from '$lib/logging/format';
	import { familySettingsStore, anonymizedPreview, type FamilySettings } from '$lib/stores/familySettings';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { CATEGORIES } from '$lib/shared';
	import { DIGEST_FREQUENCIES } from '$lib/vocabulary.generated';

	/**
	 * The Family & tracking tab of Settings: everything shared with the whole
	 * family — stage categories, the family's clock, feed grouping, the digest
	 * and weekly appointment reminders, logging choices, and anonymized
	 * sharing.
	 *
	 * The settings row lives in $lib/stores/familySettings (loaded by the
	 * page's loadFamilies); this panel owns the form glue — the stage
	 * editor's draft, the saving flags — and the mutators, which are all
	 * "familySettings + activeFamilyId → updateSettings" round trips.
	 */
	export let activeFamily: any = null;
	export let activeFamilyId: string | null = null;

	// The stage whose category set is being edited, and a local mirror so toggles
	// feel instant before the round trip lands.
	let stageEditor: string | null = null;
	let stageDraft: Record<string, string[]> = {};
	let savingFamilySettings = false;
	let loadingAnonymizedPreview = false;

	async function refreshAnonymizedPreview() {
		if (!activeFamilyId) return;
		loadingAnonymizedPreview = true;
		try {
			const res = await familiesAPI.getAnonymizedPreview(activeFamilyId);
			anonymizedPreview.set(res.data.preview);
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to load anonymized preview.');
		} finally {
			loadingAnonymizedPreview = false;
		}
	}

	function onDigestFrequencyChange(e: Event) {
		void setDigestFrequency((e.currentTarget as HTMLSelectElement).value);
	}

	async function setDigestFrequency(next: string) {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { digestFrequency: next });
			familySettingsStore.update((s) => (s ? { ...s, digestFrequency: res.data.settings?.digestFrequency ?? next } : s));
			notify('Digest frequency updated.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the digest frequency.');
		}
	}

	/** The window (in minutes) that groups a breast feed and its bottle into one feed. */
	const FEED_GROUPING_OPTIONS = [15, 30, 45, 60, 90, 120];

	function onFeedGroupingMinutesChange(e: Event) {
		const value = parseInt((e.currentTarget as HTMLSelectElement).value, 10);
		if (Number.isFinite(value)) void setFeedGroupingMinutes(value);
	}

	async function setFeedGroupingMinutes(next: number) {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { feedGroupingMinutes: next });
			familySettingsStore.update((s) => (s ? { ...s, feedGroupingMinutes: res.data.settings?.feedGroupingMinutes ?? next } : s));
			notify('Feed grouping window updated.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the feed grouping window.');
		}
	}

	// ── Local send times ──────────────────────────────────────────────────
	//
	// "Send at 09:00" means 9am on the family's own clock, which is the timezone
	// set just below. A value here is meaningless without it, so the UI says so.
	//
	// The empty option is the default and is not a missing value: it means "send
	// whenever the cadence allows", which is what every family had before this
	// existed. It is sent as an explicit null rather than omitted, because
	// omitting a field means "leave it alone" and would make the choice
	// impossible to undo.
	const SEND_HOURS = Array.from({ length: 24 }, (_, h) => h);

	/** "09:00", so the option list reads as clock times rather than bare numbers. */
	function hourLabel(h: number): string {
		return `${String(h).padStart(2, '0')}:00`;
	}

	/**
	 * The one thing that can make a send time behave unexpectedly: no timezone
	 * has been chosen, so the hour is being read on UTC. Said here rather than
	 * left for a family to discover from a 4am email.
	 */
	function timezoneAdvice(zone: string | null | undefined): string {
		if (zone) return '';
		return 'No timezone is set for this family yet, so this is UTC — set one under Family & tracking.';
	}

	function onSendHourChange(e: Event, which: 'digest' | 'appointment') {
		const raw = (e.currentTarget as HTMLSelectElement).value;
		const value = raw === '' ? null : parseInt(raw, 10);
		void setSendHour(which, Number.isFinite(value as number) ? value : null);
	}

	async function setSendHour(which: 'digest' | 'appointment', hour: number | null) {
		if (!activeFamilyId) return;
		try {
			const payload = which === 'digest' ? { digestSendHour: hour } : { appointmentSendHour: hour };
			const res = await familiesAPI.updateSettings(activeFamilyId, payload);
			familySettingsStore.update((s) => {
				if (!s) return s;
				if (which === 'digest') return { ...s, digestSendHour: res.data.settings?.digestSendHour ?? hour };
				return { ...s, appointmentSendHour: res.data.settings?.appointmentSendHour ?? hour };
			});
			notify(hour === null ? 'Sending time cleared — email goes out as soon as it is due.' : `Email will arrive around ${hourLabel(hour)} on the family's clock.`);
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the sending time.');
		}
	}

	// ── The family's clock ────────────────────────────────────────────────
	//
	// Every IANA zone this browser knows, offered once, from the one shared list
	// (which is also what makes UTC pickable). Detected rather than defaulted: the
	// device's own zone is the right first guess, but it is only a guess, so it is
	// shown as a suggestion until someone saves it.
	const TIMEZONES = listTimeZones();

	/** The zone the picker shows: the family's choice, else a detected suggestion. */
	function timezoneValue(): string {
		return $familySettingsStore?.timezone || detectTimeZone();
	}

	/** True while nobody has saved a choice and the picker is showing a guess. */
	function timezoneIsSuggestion(): boolean {
		return !$familySettingsStore?.timezone;
	}

	/** A worked example so the choice is concrete: the same instant, both ways. */
	function timezoneExample(zone: string): string {
		const sample = new Date(Date.now() + 26 * 60 * 60 * 1000);
		try {
			return sample.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone });
		} catch {
			return '';
		}
	}

	function onTimezoneChange(e: Event) {
		const value = (e.currentTarget as HTMLSelectElement).value;
		if (value) void setTimezone(value);
	}

	async function setTimezone(next: string) {
		if (!activeFamilyId) return;
		savingFamilySettings = true;
		fail('');
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { timezone: next });
			const saved = (res.data.settings?.timezone as string | null | undefined) ?? next;
			familySettingsStore.update((s) => (s ? { ...s, timezone: saved } : s));
			// Applied immediately rather than on the next load, so the appointment
			// list behind this tab is already reading the new clock.
			applyTimezone(saved);
			notify('Timezone updated.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the timezone.');
		} finally {
			savingFamilySettings = false;
		}
	}

	/**
	 * The weekly appointment reminder is a separate opt-in from the digest: it
	 * has its own cadence and its own column, so turning one off never turns the
	 * other off. Optimistic like the other settings toggles here.
	 */
	async function toggleAppointmentNotifications() {
		if (!activeFamilyId || !$familySettingsStore) return;
		savingFamilySettings = true;
		const next = !$familySettingsStore.appointmentNotifications;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { appointmentNotifications: next });
			familySettingsStore.update((s) => s && {
				...s,
				...res.data.settings,
				defaultCategoryOptions: s.defaultCategoryOptions,
				defaultStageCategories: s.defaultStageCategories,
			});
			notify(next
				? 'Weekly appointment reminders enabled.'
				: 'Weekly appointment reminders turned off.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update appointment reminders.');
		} finally {
			savingFamilySettings = false;
		}
	}

	/**
	 * The categories a stage starts a new profile with: an in-flight edit first,
	 * then this family's saved set, then the built-in template.
	 *
	 * Its inputs are arguments rather than captured variables on purpose.
	 * Svelte's dependency tracking is syntactic, so a template expression that
	 * only read `stageSetFor(stageEditor)` would depend on `stageEditor` alone —
	 * a toggle updated `stageDraft` and the API, but the switch on screen never
	 * moved. Deriving the set in a reactive statement that names `stageDraft`
	 * and `$familySettingsStore` gives the binding something to depend on.
	 */
	function stageCategoriesFor(
		stage: string | null,
		draft: Record<string, string[]>,
		settings: FamilySettings | null,
	): string[] {
		if (!stage) return [];
		return draft[stage]
			?? settings?.stageCategories?.[stage]
			?? settings?.defaultStageCategories?.[stage]
			?? [];
	}

	/** The stage currently open in the editor, as a value the template can depend on. */
	$: editorStageCategories = stageCategoriesFor(stageEditor, stageDraft, $familySettingsStore);

	/**
	 * Turn a category on or off for a whole stage.
	 *
	 * Family-level because doing it per pet or per child is the same decision
	 * repeated; a household that does not track moods for its dog should not have
	 * to say so on every dog. Existing members keep their own lists — this sets
	 * what a *new* profile of that stage starts with.
	 */
	async function toggleStageCategory(stage: string | null, catId: string) {
		if (!activeFamilyId || !stage) return;
		const cur = stageCategoriesFor(stage, stageDraft, $familySettingsStore);
		const on = cur.includes(catId);
		const nextSet = on ? cur.filter((c) => c !== catId) : [...cur, catId];
		// Keep the vocabulary's order, so the template's sense of "most important
		// first" survives a toggle and Quick Actions stay sensible.
		const ordered = CATEGORIES.map((c) => c.id).filter((id) => nextSet.includes(id));
		stageDraft = { ...stageDraft, [stage]: ordered };
		const merged = { ...($familySettingsStore?.stageCategories ?? {}), [stage]: ordered };
		try {
			await familiesAPI.updateSettings(activeFamilyId, { stageCategories: merged });
			familySettingsStore.update((s) => (s ? { ...s, stageCategories: merged } : s));
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the stage.');
		}
	}

	async function saveCategoryOptions(nextOptions: Record<string, Record<string, string[]>>) {
		if (!activeFamilyId) return;
		savingFamilySettings = true;
		try {
			await familiesAPI.updateSettings(activeFamilyId, { categoryOptions: nextOptions });
			familySettingsStore.update((s) => (s ? { ...s, categoryOptions: nextOptions } : s));
			notify('Category options saved.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to save category options.');
		} finally {
			savingFamilySettings = false;
		}
	}

	async function toggleAnonymizedSharing() {
		if (!activeFamilyId || !$familySettingsStore) return;
		savingFamilySettings = true;
		const next = !$familySettingsStore.shareAnonymizedDaily;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { shareAnonymizedDaily: next });
			familySettingsStore.update((s) => s && {
				...s,
				...res.data.settings,
				defaultCategoryOptions: s.defaultCategoryOptions,
			});
			anonymizedPreview.update((p) => res.data.anonymizedPreview ?? p);
			notify(next
				? 'Daily anonymized sharing enabled.'
				: 'Daily anonymized sharing disabled.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to update anonymized sharing setting.');
		} finally {
			savingFamilySettings = false;
		}
	}

	function currentCategoryOptions(category: string, key: string): string[] {
		const merged = $familySettingsStore?.categoryOptions?.[category]?.[key]
			?? $familySettingsStore?.defaultCategoryOptions?.[category]?.[key]
			?? [];
		return Array.isArray(merged) ? merged : [];
	}

	function setCategoryOptions(category: string, key: string, options: string[]): Record<string, Record<string, string[]>> {
		const cur = { ...($familySettingsStore?.categoryOptions ?? {}) };
		const catOpts = { ...(cur[category] ?? {}) };
		catOpts[key] = options;
		cur[category] = catOpts;
		return cur;
	}

	function addCategoryOption(category: string, key: string, value: string) {
		const v = value.trim();
		if (!v) return;
		const next = [...currentCategoryOptions(category, key), v];
		saveCategoryOptions(setCategoryOptions(category, key, next));
	}

	function removeCategoryOption(category: string, key: string, opt: string) {
		const next = currentCategoryOptions(category, key).filter((o) => o !== opt);
		saveCategoryOptions(setCategoryOptions(category, key, next));
	}
</script>

<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
	<h3 class="text-lg font-display font-semibold mb-1">Family &amp; tracking</h3>
	<p class="text-sm text-ink-soft mb-5">
		Everything on this tab is shared with everyone in {activeFamily?.name || 'your family'} — it is not a personal setting.
		Your own account is under Profile, and the people you track are under Members.
	</p>
	{#if $familySettingsStore}
		<div class="border-t border-line-soft pt-4 mt-5">
			<h4 class="font-display font-semibold text-sm mb-1">Categories by stage</h4>
			<p class="text-sm text-ink-soft mb-3">
				What a <em>new</em> profile starts with. An infant, a child, an adult and a pet do not track the same things.
				Say it once here for the whole family; people you have already added keep their own choices.
			</p>
			<div class="flex flex-wrap gap-2 mb-3">
				{#each Object.keys($familySettingsStore.defaultStageCategories ?? {}) as stage}
					<button
						type="button"
						on:click={() => (stageEditor = stageEditor === stage ? null : stage)}
						class="px-3 py-1.5 rounded-full text-sm font-semibold border {stageEditor === stage ? 'bg-primary text-on-primary border-primary' : 'bg-surface2 text-ink-soft border-line-soft hover:text-ink'}"
					>{stage}</button>
				{/each}
			</div>
			{#if stageEditor}
				<div class="flex flex-col gap-2">
					{#each CATEGORIES as cat}
						<ToggleSwitch
							checked={editorStageCategories.includes(cat.id)}
							label={cat.label}
							onToggle={() => toggleStageCategory(stageEditor, cat.id)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	{#if $familySettingsStore}
		<div class="border-t border-line-soft pt-4 mt-5">
			<h4 class="font-display font-semibold text-sm mb-1">Timezone</h4>
			<p class="text-sm text-ink-soft mb-3">
				The clock this family reads times on. Appointments, reminders and logs are
				recorded as instants, and this decides which hour of which day they show as —
				so a 9:30am appointment reads 9:30am here, not the server's time.
			</p>
			{#if timezoneIsSuggestion()}
				<p class="text-xs text-ink-soft mb-2">
					Nothing saved yet — showing what this device reports. Save it if it is right.
				</p>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<label for="family-timezone" class="sr-only">Timezone</label>
				<select
					id="family-timezone"
					value={timezoneValue()}
					on:change={onTimezoneChange}
					class="px-3 py-2 border border-line rounded-md max-w-full"
				>
					{#if !TIMEZONES.includes(timezoneValue())}
						<option value={timezoneValue()}>{timezoneValue()}</option>
					{/if}
					{#each TIMEZONES as zone}
						<option value={zone}>{zone}</option>
					{/each}
				</select>
				{#if timezoneIsSuggestion()}
					<button
						type="button"
						on:click={() => setTimezone(detectTimeZone())}
						disabled={savingFamilySettings}
						class="h-9 bg-surface2 text-ink-soft px-3 rounded-md font-semibold hover:bg-line-soft disabled:opacity-50"
					>Use this device's zone</button>
				{/if}
			</div>
			<p class="text-xs text-ink-soft mt-2">
				Appointments here will read: <span class="text-ink font-medium">{timezoneExample(timezoneValue())}</span>
			</p>
		</div>
	{/if}
	{#if $familySettingsStore}
		<div class="border-t border-line-soft pt-4">
			<h4 class="font-display font-semibold text-sm mb-1">Feeding</h4>
			<p class="text-sm text-ink-soft mb-3">
				How close together two feed records have to be to count as one feed in the
				Trends &ldquo;feeds per day&rdquo; rate. A breast feed and the bottle that follows it are
				usually one feed — set the window wide enough to merge them.
			</p>
			<label for="feed-grouping" class="block text-sm font-medium text-ink-soft mb-1">Group feeds within</label>
			<select
				id="feed-grouping"
				value={$familySettingsStore.feedGroupingMinutes ?? 60}
				on:change={onFeedGroupingMinutesChange}
				class="w-full px-3 py-2 border border-line rounded-md"
			>
				{#each FEED_GROUPING_OPTIONS as m}
					<option value={m}>{m} minutes</option>
				{/each}
			</select>
		</div>
	{/if}
	{#if $familySettingsStore}
		<div class="border-t border-line-soft pt-4">
			<h4 class="font-display font-semibold text-sm mb-1">Digest email</h4>
			<p class="text-sm text-ink-soft mb-3">
				How often Nido emails this family when something needs attention. Rules are still evaluated
				every sweep — this only sets how often they can reach an inbox. Nothing firing means no email.
			</p>
			<label for="digest-frequency" class="block text-sm font-medium text-ink-soft mb-1">How often</label>
			<select
				id="digest-frequency"
				value={$familySettingsStore.digestFrequency ?? 'hourly'}
				on:change={onDigestFrequencyChange}
				class="w-full px-3 py-2 border border-line rounded-md"
			>
				{#each DIGEST_FREQUENCIES as f}
					<option value={f}>{f[0].toUpperCase() + f.slice(1)}</option>
				{/each}
			</select>
			<label for="digest-send-hour" class="block text-sm font-medium text-ink-soft mb-1 mt-3">Send at</label>
			<select
				id="digest-send-hour"
				value={$familySettingsStore.digestSendHour == null ? '' : String($familySettingsStore.digestSendHour)}
				on:change={(e) => onSendHourChange(e, 'digest')}
				disabled={savingFamilySettings}
				class="w-full px-3 py-2 border border-line rounded-md disabled:opacity-50"
			>
				<option value="">As soon as it is due</option>
				{#each SEND_HOURS as h}
					<option value={String(h)}>{hourLabel(h)}{#if h === 0} (midnight){/if}</option>
				{/each}
			</select>
			<p class="text-xs text-ink-soft mt-2">
				{#if $familySettingsStore.digestSendHour == null}
					Email goes out whenever a rule is due, at any hour. Choose a time to have it wait for
					that hour on the family's clock instead.
				{:else}
					Held until around {hourLabel($familySettingsStore.digestSendHour)} in {$familySettingsStore.timezone || 'UTC'}.
					{timezoneAdvice($familySettingsStore.timezone)}
				{/if}
			</p>
			{#if $familySettingsStore.digestSentAt}
				<p class="text-xs text-ink-soft mt-2">Last sent {new Date($familySettingsStore.digestSentAt).toLocaleString(undefined, zonedOptions())}.</p>
			{/if}
			<div class="border-t border-line-soft pt-4 mt-4">
				<h4 class="font-display font-semibold text-sm mb-1">Weekly upcoming reminders</h4>
				<p class="text-sm text-ink-soft mb-2">
					A weekly email listing everything your family has coming up in the next two weeks —
					appointments, medical visits, routines, whatever you logged with a future date.
					Separate from the digest above: this is a reminder, not an alert, and it stays quiet when nothing is booked.
				</p>
				<ToggleSwitch
					checked={$familySettingsStore.appointmentNotifications === true}
					disabled={savingFamilySettings}
					label="Email a weekly list of what's coming up"
					description="Off by default. Sent once a week to everyone in the family with a confirmed email address."
					onToggle={toggleAppointmentNotifications}
				/>
				{#if $familySettingsStore.appointmentNotifications}
					<div class="mt-4">
						<label for="appointment-send-hour" class="block text-sm font-medium text-ink-soft mb-1">Send at</label>
						<select
							id="appointment-send-hour"
							value={$familySettingsStore.appointmentSendHour == null ? '' : String($familySettingsStore.appointmentSendHour)}
							on:change={(e) => onSendHourChange(e, 'appointment')}
							disabled={savingFamilySettings}
							class="w-full px-3 py-2 border border-line rounded-md disabled:opacity-50"
						>
							<option value="">As soon as it is due</option>
							{#each SEND_HOURS as h}
								<option value={String(h)}>{hourLabel(h)}{#if h === 0} (midnight){/if}</option>
							{/each}
						</select>
						<p class="text-xs text-ink-soft mt-2">
							{#if $familySettingsStore.appointmentSendHour == null}
								Sent whenever the weekly cadence is up. Choose a time to have it wait for
								that hour on the family's clock instead.
							{:else}
								Held until around {hourLabel($familySettingsStore.appointmentSendHour)} in {$familySettingsStore.timezone || 'UTC'}.
								{timezoneAdvice($familySettingsStore.timezone)}
							{/if}
						</p>
					</div>
				{/if}
				{#if $familySettingsStore.appointmentNotificationsSentAt}
					<p class="text-xs text-ink-soft mt-2">Last sent {new Date($familySettingsStore.appointmentNotificationsSentAt).toLocaleString(undefined, zonedOptions())}.</p>
				{/if}
				<p class="text-xs text-ink-soft mt-2">
					See everything on the <a href="/appointments" class="text-link underline">upcoming page</a>.
				</p>
			</div>
		</div>
	{/if}
	{#if $familySettingsStore}
		<div class="border-t border-line-soft pt-4">
			<h4 class="font-display font-semibold text-sm mb-1">Choices when logging</h4>
			<p class="text-sm text-ink-soft mb-3">The values offered for each kind of record, for example routine type or visit type. They appear in the log forms for everyone.</p>
			{#each CATEGORIES as cat}
				{@const options = $familySettingsStore.categoryOptions?.[cat.id] ?? $familySettingsStore.defaultCategoryOptions?.[cat.id] ?? {}}
				{#if Object.entries(options).length > 0}
					<div class="mb-4">
						<p class="text-sm font-semibold text-ink mb-1"><svelte:component this={cat.icon} class="w-4 h-4 inline mr-1" /> {cat.label}</p>
						{#each Object.entries(options) as [key, opts]}
							<div class="mb-2">
								<p class="text-xs text-ink-soft uppercase mb-1">{key}</p>
								<div class="flex flex-wrap gap-1.5 items-center">
									{#each opts as opt}
										<span class="inline-flex items-center gap-1 bg-surface2 text-ink-soft px-2 py-1 rounded text-sm">
											{opt}
											<button type="button" on:click={() => removeCategoryOption(cat.id, key, opt)} class="text-ink-soft hover:text-danger-text" aria-label="Remove {opt}">&times;</button>
										</span>
									{/each}
									<input type="text" on:keydown={(e) => { if (e.key === 'Enter') { addCategoryOption(cat.id, key, e.currentTarget.value); e.currentTarget.value = ''; } }} placeholder="+ add" class="w-24 px-2 py-1 text-sm border border-line rounded-md" />
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		</div>

		<div class="border-t border-line-soft pt-4 mt-4">
			<h4 class="font-display font-semibold text-sm mb-1">Daily anonymized summary sharing</h4>
			<p class="text-sm text-ink-soft mb-2">Only an owner or admin can change this, because it decides what data leaves your family.</p>
			<ToggleSwitch
				checked={$familySettingsStore?.shareAnonymizedDaily === true}
				disabled={savingFamilySettings}
				label="Opt in to daily anonymized roundup sharing"
				description="Default is off. Shared data never includes names, emails, notes, or exact timestamps."
				onToggle={toggleAnonymizedSharing}
			/>
			<div class="mt-3 p-3 bg-surface2 rounded-md border border-line-soft">
				<div class="flex items-center justify-between mb-2">
					<p class="text-xs text-ink-soft uppercase">Preview of anonymized payload</p>
					<button type="button" on:click={refreshAnonymizedPreview} class="text-xs text-link underline" disabled={loadingAnonymizedPreview}>{loadingAnonymizedPreview ? 'Refreshing…' : 'Refresh'}</button>
				</div>
				{#if $anonymizedPreview}
					<pre class="text-[11px] leading-4 text-ink-soft whitespace-pre-wrap break-words">{JSON.stringify($anonymizedPreview, null, 2)}</pre>
				{:else}
					<p class="text-xs text-ink-soft">No preview loaded yet.</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
