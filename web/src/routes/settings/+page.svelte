<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { tokenExpired } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { importsAPI, familyAdminAPI } from '$lib/api/system';
	import { authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { applyTimezone } from '$lib/stores/timezoneStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { detectTimeZone, listTimeZones, zonedOptions } from '$lib/logging/format';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { CATEGORIES, defaultMemberId } from '$lib/shared';
	import { DIGEST_FREQUENCIES } from '$lib/vocabulary.generated';
	import { Users, Home, Settings, ChevronRight, User, Shield, Upload, Download } from 'lucide-svelte';
	import AccountPanel from '$lib/components/settings/AccountPanel.svelte';
	import ImportPanel from '$lib/components/settings/ImportPanel.svelte';
	import BackupPanel from '$lib/components/settings/BackupPanel.svelte';
	import AdminPanel from '$lib/components/settings/AdminPanel.svelte';



	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	let profiles: any[] = [];
	let families: any[] = [];
	let activeFamily: any = null;
	let activeFamilyId: string | null = null;
	let selectedMemberId: number | null = null;
	let defaultProfileId: number | null = null;

	// Family-scoped tracking settings (categories + per-category option lists).
	let settingsTab: 'profile' | 'family' | 'import' | 'members' | 'backup' | 'admin' | null = null;
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>>; stageCategories?: Record<string, string[]> | null; defaultStageCategories?: Record<string, string[]>; digestFrequency?: string; digestSentAt?: string | null; shareAnonymizedDaily?: boolean; appointmentNotifications?: boolean; appointmentNotificationsSentAt?: string | null; feedGroupingMinutes?: number; timezone?: string | null; digestSendHour?: number | null; appointmentSendHour?: number | null } | null = null;
	// The stage whose category set is being edited, and a local mirror so toggles
	// feel instant before the round trip lands.
	let stageEditor: string | null = null;
	let stageDraft: Record<string, string[]> = {};
	let savingFamilySettings = false;
	let anonymizedPreview: any = null;
	let loadingAnonymizedPreview = false;

	let editingMember: any = null;
	let editMemberName = '';
	let editMemberBirthDate = '';
	let editMemberGender = '';
	let editMemberEmail = '';
	// The categories this member tracks, edited in place. Per member rather than
	// per stage: the stage template only decides what a *new* profile starts
	// with, and an existing person's own list is what the log forms actually read.
	let editMemberCategories: string[] = [];

	// Family onboarding
	let memberType = 'child';
	// Only meaningful for a child: an infant and a ten-year-old are both children
	// but track different things. Pets and adults imply their own stage.
	let memberStage = 'child';
	let newMemberName = '';
	let newMemberEmail = '';
	let newBabyBirthDate = '';
	let newBabyGender = 'female';
	let creatingBaby = false;

	// Invite-by-email
	let inviteEmail = '';
	let invitations: any[] = [];

	// Import runs, loaded with the rest of the family data and handed to the
	// Import panel; everything an import itself mutates lives in the panel.
	let importRuns: any[] = [];


	// Edit modal state



	async function loadFamilies() {
		try {
			const res = await familiesAPI.list();
			families = res.data.families;
			if (families.length === 0) {
				selectedMemberId = null;
				profiles = [];
				return;
			}
			// Prefer the saved default family, else the first.
			const savedFamily = localStorage.getItem('nido.familyId');
			activeFamily = families.find((f) => f.familyId === savedFamily) ?? families[0];
			activeFamilyId = activeFamily.familyId;

			if (!activeFamilyId) {
				profiles = [];
				selectedMemberId = null;
				return;
			}
			const membersRes = await familiesAPI.members(activeFamilyId);
			const members = membersRes.data.members;
			// Members are the profiles the tracker operates on (child/adult; "newborn"
			// is a child with newborn categories enabled).
			profiles = members.map((m: any) => ({
				id: m.id,
				name: m.name,
				birth_date: m.birthDate ?? '',
				gender: m.gender ?? '',
				type: m.type ?? 'child',
				email: m.email ?? null,
				avatar: m.avatar ?? null,
				categories: Array.isArray(m.categories) ? m.categories : [],
				trackable: m.trackable !== false,
				legacySubjectId: m.legacySubjectId ?? null,
				// The badge below reads this, and it was never carried across from
				// the API, so every profile claimed to have no account.
				linkedAccount: m.linkedAccount === true,
			}));

			if (profiles.length > 0) {
				const savedDefault = defaultProfileId ?? null;
				const match = savedDefault ? profiles.find((b) => Number(b.id) === savedDefault) : null;
				selectedMemberId = match ? Number(match.id) : defaultMemberId(profiles);
			} else {
				selectedMemberId = null;
			}
			await Promise.all([loadFamilySettings(), loadInvitations(), loadImportRuns()]);
		} catch (e: any) {
			const status = e.response?.status;
			if (status === 401 || status === 403) {
				handleLogout();
				fail('Your session has expired. Please sign in again.');
				return;
			}
			fail(e.response?.data?.error || 'Failed to load your families.');
			console.error(e);
		}
	}






	function handleLogout() {
		authActions.logout();
		isAuthenticated = false;
		profiles = [];
		selectedMemberId = null;
	}


	async function addFamilyMember(event: SubmitEvent) {
		event.preventDefault();
		fail('');
		if (!newMemberName) {
			fail('Member name is required.');
			return;
		}
		if (!activeFamilyId) return;
		creatingBaby = true;
		try {
			const res = await familiesAPI.addMember(activeFamilyId, {
				type: memberType,
				name: newMemberName.trim(),
				birthDate: newBabyBirthDate ? new Date(newBabyBirthDate).toISOString() : undefined,
				gender: newBabyGender,
				email: newMemberEmail.trim() || undefined,
				// Only a child needs the family to choose; the API implies the rest.
				stage: memberType === 'child' ? memberStage : undefined,
			});
			notify(`${res.data.member.name} added to the family.`);
			newMemberName = '';
			newMemberEmail = '';
			newBabyBirthDate = '';
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to add family member.');
			console.error(err);
		} finally {
			creatingBaby = false;
		}
	}

	let inviteFallbackUrl = '';

	function selectAll(event: FocusEvent) {
		(event.currentTarget as HTMLInputElement).select();
	}

	async function sendInvite(event: SubmitEvent) {
		event.preventDefault();
		fail('');
		inviteFallbackUrl = '';
		if (!inviteEmail.trim() || !activeFamilyId) return;
		try {
			const res = await familiesAPI.invite(activeFamilyId, inviteEmail.trim());
			notify(`Invitation sent to ${res.data.invitation.email}.`);
			inviteEmail = '';
			await loadInvitations();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to send invitation.');
			// The server keeps the pending invite and hands back a link so the
			// invite can still reach the recipient without working SMTP.
			inviteFallbackUrl = err.response?.data?.invitation?.inviteUrl ?? '';
			if (inviteFallbackUrl) await loadInvitations();
			console.error(err);
		}
	}

	async function loadInvitations() {
		if (!activeFamilyId) {
			invitations = [];
			return;
		}
		try {
			const res = await familiesAPI.listInvites(activeFamilyId);
			invitations = res.data.invitations || [];
		} catch {
			invitations = [];
		}
	}

	async function revokeInvite(inviteId: number) {
		if (!activeFamilyId) return;
		try {
			await familiesAPI.revokeInvite(activeFamilyId, inviteId);
			await loadInvitations();
		} catch (e: any) {
			fail(e.response?.data?.error || 'Failed to revoke invitation.');
		}
	}

	async function loadImportRuns() {
		try {
			const res = await importsAPI.runs();
			importRuns = res.data.runs || [];
		} catch {
			importRuns = [];
		}
	}

	async function exportFamily() {
		if (!activeFamilyId) return;
		try {
			const res = await familyAdminAPI.export(activeFamilyId);
			const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${activeFamily?.name || 'family'}-backup-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			notify('All-data backup downloaded.');
		} catch (err: any) { fail(err.response?.data?.error || 'Backup failed.'); }
	}

	// Admin tab state lives in AdminPanel; the page keeps only the admin flag
	// that gates the Admin row and the tab itself.
	let isPanelAdmin = false;

	async function refreshUserProfile() {
		try {
			const res = await userAPI.getMe();
			const u = res.data.user;
			if (u) {
				authActions.setUser({
					id: Number(u.id),
					email: u.email,
					firstName: u.first_name ?? u.firstName ?? '',
					lastName: u.last_name ?? u.lastName ?? '',
					createdAt: u.created_at ?? u.createdAt ?? '',
				});
				isPanelAdmin = Number(u.is_platform_admin ?? 0) === 1;
			}
		} catch {
			isPanelAdmin = false;
		}
	}

	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings;
			anonymizedPreview = res.data.anonymizedPreview ?? anonymizedPreview;
		} catch (err: any) {
			console.error('Failed to load family settings:', err);
		}
	}

	async function refreshAnonymizedPreview() {
		if (!activeFamilyId) return;
		loadingAnonymizedPreview = true;
		try {
			const res = await familiesAPI.getAnonymizedPreview(activeFamilyId);
			anonymizedPreview = res.data.preview;
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to load anonymized preview.');
		} finally {
			loadingAnonymizedPreview = false;
		}
	}

	/**
	 * A stage's categories: the in-flight edit first so a toggle lands instantly,
	 * then this family's saved version, then the built-in set.
	 */
	function onDigestFrequencyChange(e: Event) {
		void setDigestFrequency((e.currentTarget as HTMLSelectElement).value);
	}

	async function setDigestFrequency(next: string) {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { digestFrequency: next });
			if (familySettings) familySettings.digestFrequency = res.data.settings?.digestFrequency ?? next;
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
			if (familySettings) familySettings.feedGroupingMinutes = res.data.settings?.feedGroupingMinutes ?? next;
			notify('Feed grouping window updated.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the feed grouping window.');
		}
	}

	// ── Local send times ──────────────────────────────────────────────────
	//
	// "Send at 09:00" means 9am on the family's own clock, which is the timezone
	// set just above. A value here is meaningless without it, so the UI says so.
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
			if (familySettings) {
				if (which === 'digest') familySettings.digestSendHour = res.data.settings?.digestSendHour ?? hour;
				else familySettings.appointmentSendHour = res.data.settings?.appointmentSendHour ?? hour;
			}
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
		return familySettings?.timezone || detectTimeZone();
	}

	/** True while nobody has saved a choice and the picker is showing a guess. */
	function timezoneIsSuggestion(): boolean {
		return !familySettings?.timezone;
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
			if (familySettings) familySettings.timezone = saved;
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
		if (!activeFamilyId || !familySettings) return;
		savingFamilySettings = true;
		const next = !familySettings.appointmentNotifications;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { appointmentNotifications: next });
			familySettings = {
				...familySettings,
				...res.data.settings,
				defaultCategoryOptions: familySettings.defaultCategoryOptions,
				defaultStageCategories: familySettings.defaultStageCategories,
			};
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
	 * and `familySettings` gives the binding something to depend on.
	 */
	function stageCategoriesFor(
		stage: string | null,
		draft: Record<string, string[]>,
		settings: typeof familySettings,
	): string[] {
		if (!stage) return [];
		return draft[stage]
			?? settings?.stageCategories?.[stage]
			?? settings?.defaultStageCategories?.[stage]
			?? [];
	}

	/** The stage currently open in the editor, as a value the template can depend on. */
	$: editorStageCategories = stageCategoriesFor(stageEditor, stageDraft, familySettings);

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
		const cur = stageCategoriesFor(stage, stageDraft, familySettings);
		const on = cur.includes(catId);
		const nextSet = on ? cur.filter((c) => c !== catId) : [...cur, catId];
		// Keep the vocabulary's order, so the template's sense of "most important
		// first" survives a toggle and Quick Actions stay sensible.
		const ordered = CATEGORIES.map((c) => c.id).filter((id) => nextSet.includes(id));
		stageDraft = { ...stageDraft, [stage]: ordered };
		const merged = { ...(familySettings?.stageCategories ?? {}), [stage]: ordered };
		try {
			await familiesAPI.updateSettings(activeFamilyId, { stageCategories: merged });
			if (familySettings) familySettings.stageCategories = merged;
		} catch (err: any) {
			fail(err.response?.data?.error || 'Could not update the stage.');
		}
	}

	async function saveCategoryOptions(nextOptions: Record<string, Record<string, string[]>>) {
		if (!activeFamilyId) return;
		savingFamilySettings = true;
		try {
			await familiesAPI.updateSettings(activeFamilyId, { categoryOptions: nextOptions });
			if (familySettings) familySettings.categoryOptions = nextOptions;
			notify('Category options saved.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to save category options.');
		} finally {
			savingFamilySettings = false;
		}
	}

	async function toggleAnonymizedSharing() {
		if (!activeFamilyId || !familySettings) return;
		savingFamilySettings = true;
		const next = !familySettings.shareAnonymizedDaily;
		try {
			const res = await familiesAPI.updateSettings(activeFamilyId, { shareAnonymizedDaily: next });
			familySettings = {
				...familySettings,
				...res.data.settings,
				defaultCategoryOptions: familySettings.defaultCategoryOptions,
			};
			anonymizedPreview = res.data.anonymizedPreview ?? anonymizedPreview;
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
		const merged = familySettings?.categoryOptions?.[category]?.[key]
			?? familySettings?.defaultCategoryOptions?.[category]?.[key]
			?? [];
		return Array.isArray(merged) ? merged : [];
	}

	function setCategoryOptions(category: string, key: string, options: string[]) {
		const cur = { ...(familySettings?.categoryOptions ?? {}) };
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

	function openEditMember(baby: any) {
		editingMember = baby;
		editMemberName = baby.name || '';
		editMemberBirthDate = baby.birth_date ? baby.birth_date.slice(0, 10) : '';
		editMemberGender = baby.gender || '';
		editMemberEmail = baby.email || '';
		editMemberCategories = Array.isArray(baby.categories) ? [...baby.categories] : [];
		fail('');
	}

	function closeEditMember() {
		editingMember = null;
	}

	/**
	 * Turn one tracked category on or off for the member being edited.
	 *
	 * Saved with the rest of the form rather than on each tap, so the whole
	 * member is one round trip and Cancel really cancels. The order is the
	 * vocabulary's, so the tiles that follow a person stay sensible.
	 */
	function toggleEditMemberCategory(catId: string) {
		const next = editMemberCategories.includes(catId)
			? editMemberCategories.filter((c) => c !== catId)
			: [...editMemberCategories, catId];
		editMemberCategories = CATEGORIES.map((c) => c.id).filter((id) => next.includes(id));
	}

	async function toggleMemberTracking(baby: any) {
		if (!activeFamilyId) return;
		fail('');
		const next = !baby.trackable;
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(baby.id), { trackable: next });
			await loadFamilies();
			notify(next ? `${baby.name} will now be tracked.` : `${baby.name} is no longer tracked.`);
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to update tracking.');
		}
	}

	async function deleteEditMember() {
		if (!editingMember || !activeFamilyId) return;
		if (!confirm(`Delete "${editMemberName.trim() || editingMember.name}" and ALL of their records? This cannot be undone.`)) return;
		try {
			await familiesAPI.removeMember(activeFamilyId, Number(editingMember.id));
			notify('Member deleted.');
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to delete member.');
		}
	}

	async function saveEditMember(event: SubmitEvent) {
		event.preventDefault();
		if (!editingMember || !activeFamilyId) return;
		try {
			const birthDate = editMemberBirthDate ? new Date(editMemberBirthDate + 'T00:00:00Z').toISOString() : null;
			await familiesAPI.updateMember(activeFamilyId, Number(editingMember.id), {
				name: editMemberName.trim(),
				birthDate,
				gender: editMemberGender || null,
				email: editMemberEmail.trim() || null,
				categories: editMemberCategories,
			});
			notify('Member updated.');
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to update member.');
		}
	}

	async function inviteMemberEmail(email: string) {
		if (!email || !activeFamilyId) return;
		try {
			await familiesAPI.invite(activeFamilyId, email);
			notify(`Invite sent to ${email}.`);
			await loadInvitations();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to send invite.');
		}
	}

	async function onMemberAvatarSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !editingMember || !activeFamilyId) return;
		try {
			await familiesAPI.uploadAvatar(activeFamilyId, Number(editingMember.id), file);
			notify('Profile photo updated.');
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to upload photo.');
		}
	}


	onMount(async () => {
		if (browser) {
			const params = new URLSearchParams(window.location.search);
			const verifyParam = params.get('verify');
			const resetParam = params.get('reset');
			if (verifyParam) {
				try {
					const res = await authAPI.verifyEmail(verifyParam);
					notify(res.data.message || 'Email verified.');
				} catch (err: any) {
					fail(err.response?.data?.error || 'Verification failed.');
				}
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			if (resetParam) {
				notify('Enter a new password to complete your password reset.');
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			const token = localStorage.getItem('token');
			isAuthenticated = !!token && !tokenExpired();
			const savedDefault = localStorage.getItem('nido.defaultProfile');
			if (savedDefault) {
				defaultProfileId = Number(savedDefault);
			}
			if (isAuthenticated) {
				await Promise.all([loadFamilies(), refreshUserProfile()]);
			}
		}
	});
</script>
 				<FeedbackToasts />
 				<div class="max-w-4xl mx-auto">
					{#if settingsTab === null}
					<div class="flex items-center gap-3 mb-6">
						<span class="w-12 h-12 rounded-full border-2 border-ink text-ink flex items-center justify-center" aria-hidden="true"><Settings class="w-6 h-6" /></span>
						<div>
							<h2 class="text-2xl font-display font-semibold">Settings</h2>
							<p class="text-ink-soft text-sm">Manage your account, family, and data.</p>
						</div>
					</div>

					<div class="flex flex-col gap-6">
						<!-- Account Group -->
						<section>
							<h3 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2 px-4">Account</h3>
							<div class="bg-surface rounded-xl border border-line-soft overflow-hidden">
								<button type="button" on:click={() => (settingsTab = 'profile')} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left">
									<div class="flex items-center gap-3">
										<User class="w-5 h-5 text-ink-soft" />
										<span class="text-ink font-medium">Profile</span>
									</div>
									<ChevronRight class="w-5 h-5 text-ink-soft" />
								</button>
							</div>
						</section>

						<!-- Household Group -->
						<section>
							<h3 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2 px-4">Household</h3>
							<div class="bg-surface rounded-xl border border-line-soft overflow-hidden flex flex-col">
								<button type="button" on:click={() => (settingsTab = 'family')} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left border-b border-line-soft">
									<div class="flex items-center gap-3">
										<Home class="w-5 h-5 text-ink-soft" />
										<span class="text-ink font-medium">Family &amp; tracking</span>
									</div>
									<ChevronRight class="w-5 h-5 text-ink-soft" />
								</button>
								<button type="button" on:click={() => (settingsTab = 'members')} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left">
									<div class="flex items-center gap-3">
										<Users class="w-5 h-5 text-ink-soft" />
										<span class="text-ink font-medium">Members</span>
									</div>
									<ChevronRight class="w-5 h-5 text-ink-soft" />
								</button>
							</div>
						</section>

						<!-- Data Group -->
						<section>
							<h3 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2 px-4">Data</h3>
							<div class="bg-surface rounded-xl border border-line-soft overflow-hidden flex flex-col">
								<button type="button" on:click={() => (settingsTab = 'import')} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left border-b border-line-soft">
									<div class="flex items-center gap-3">
										<Upload class="w-5 h-5 text-ink-soft" />
										<span class="text-ink font-medium">Import</span>
									</div>
									<ChevronRight class="w-5 h-5 text-ink-soft" />
								</button>
								<button type="button" on:click={() => (settingsTab = 'backup')} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left">
									<div class="flex items-center gap-3">
										<Download class="w-5 h-5 text-ink-soft" />
										<span class="text-ink font-medium">Backup</span>
									</div>
									<ChevronRight class="w-5 h-5 text-ink-soft" />
								</button>
							</div>
						</section>

						<!-- Admin Group -->
						{#if isPanelAdmin}
						<section>
							<h3 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2 px-4">Admin</h3>
							<div class="bg-surface rounded-xl border border-line-soft overflow-hidden">
								<button type="button" on:click={() => (settingsTab = 'admin')} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left">
									<div class="flex items-center gap-3">
										<Shield class="w-5 h-5 text-ink-soft" />
										<span class="text-ink font-medium">Admin</span>
									</div>
									<ChevronRight class="w-5 h-5 text-ink-soft" />
								</button>
							</div>
						</section>
						{/if}
					</div>
					{:else}
					<div class="mb-4">
						<button type="button" on:click={() => (settingsTab = null)} class="text-ink-soft hover:text-ink flex items-center gap-1 text-sm font-semibold py-2">
							<span aria-hidden="true">‹</span> Back to Settings
						</button>
					</div>
					<div class="flex-1 min-w-0">
						{#if settingsTab === 'profile'}
							<AccountPanel {activeFamily} {activeFamilyId} {exportFamily} dataChanged={loadFamilies} />
							{:else if settingsTab === 'family'}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-1">Family &amp; tracking</h3>
								<p class="text-sm text-ink-soft mb-5">
									Everything on this tab is shared with everyone in {activeFamily?.name || 'your family'} — it is not a personal setting.
									Your own account is under Profile, and the people you track are under Members.
								</p>
								{#if familySettings}
									<div class="border-t border-line-soft pt-4 mt-5">
										<h4 class="font-display font-semibold text-sm mb-1">Categories by stage</h4>
										<p class="text-sm text-ink-soft mb-3">
											What a <em>new</em> profile starts with. An infant, a child, an adult and a pet do not track the same things.
											Say it once here for the whole family; people you have already added keep their own choices.
										</p>
										<div class="flex flex-wrap gap-2 mb-3">
											{#each Object.keys(familySettings.defaultStageCategories ?? {}) as stage}
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
								{#if familySettings}
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
								{#if familySettings}
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
											value={familySettings.feedGroupingMinutes ?? 60}
											on:change={onFeedGroupingMinutesChange}
											class="w-full px-3 py-2 border border-line rounded-md"
										>
											{#each FEED_GROUPING_OPTIONS as m}
												<option value={m}>{m} minutes</option>
											{/each}
										</select>
									</div>
								{/if}
								{#if familySettings}
									<div class="border-t border-line-soft pt-4">
										<h4 class="font-display font-semibold text-sm mb-1">Digest email</h4>
										<p class="text-sm text-ink-soft mb-3">
											How often Nido emails this family when something needs attention. Rules are still evaluated
											every sweep — this only sets how often they can reach an inbox. Nothing firing means no email.
										</p>
										<label for="digest-frequency" class="block text-sm font-medium text-ink-soft mb-1">How often</label>
										<select
											id="digest-frequency"
											value={familySettings.digestFrequency ?? 'hourly'}
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
											value={familySettings.digestSendHour == null ? '' : String(familySettings.digestSendHour)}
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
											{#if familySettings.digestSendHour == null}
												Email goes out whenever a rule is due, at any hour. Choose a time to have it wait for
												that hour on the family's clock instead.
											{:else}
												Held until around {hourLabel(familySettings.digestSendHour)} in {familySettings.timezone || 'UTC'}.
												{timezoneAdvice(familySettings.timezone)}
											{/if}
										</p>
										{#if familySettings.digestSentAt}
											<p class="text-xs text-ink-soft mt-2">Last sent {new Date(familySettings.digestSentAt).toLocaleString(undefined, zonedOptions())}.</p>
										{/if}
										<div class="border-t border-line-soft pt-4 mt-4">
											<h4 class="font-display font-semibold text-sm mb-1">Weekly upcoming reminders</h4>
											<p class="text-sm text-ink-soft mb-2">
												A weekly email listing everything your family has coming up in the next two weeks —
												appointments, medical visits, routines, whatever you logged with a future date.
												Separate from the digest above: this is a reminder, not an alert, and it stays quiet when nothing is booked.
											</p>
											<ToggleSwitch
												checked={familySettings.appointmentNotifications === true}
												disabled={savingFamilySettings}
												label="Email a weekly list of what's coming up"
												description="Off by default. Sent once a week to everyone in the family with a confirmed email address."
												onToggle={toggleAppointmentNotifications}
											/>
											{#if familySettings.appointmentNotifications}
												<div class="mt-4">
													<label for="appointment-send-hour" class="block text-sm font-medium text-ink-soft mb-1">Send at</label>
													<select
														id="appointment-send-hour"
														value={familySettings.appointmentSendHour == null ? '' : String(familySettings.appointmentSendHour)}
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
														{#if familySettings.appointmentSendHour == null}
															Sent whenever the weekly cadence is up. Choose a time to have it wait for
															that hour on the family's clock instead.
														{:else}
															Held until around {hourLabel(familySettings.appointmentSendHour)} in {familySettings.timezone || 'UTC'}.
															{timezoneAdvice(familySettings.timezone)}
														{/if}
													</p>
												</div>
											{/if}
											{#if familySettings.appointmentNotificationsSentAt}
												<p class="text-xs text-ink-soft mt-2">Last sent {new Date(familySettings.appointmentNotificationsSentAt).toLocaleString(undefined, zonedOptions())}.</p>
											{/if}
											<p class="text-xs text-ink-soft mt-2">
												See everything on the <a href="/appointments" class="text-link underline">upcoming page</a>.
											</p>
										</div>
									</div>
								{/if}
								{#if familySettings}
									<div class="border-t border-line-soft pt-4">
										<h4 class="font-display font-semibold text-sm mb-1">Choices when logging</h4>
										<p class="text-sm text-ink-soft mb-3">The values offered for each kind of record, for example routine type or visit type. They appear in the log forms for everyone.</p>
										{#each CATEGORIES as cat}
											{@const options = familySettings.categoryOptions?.[cat.id] ?? familySettings.defaultCategoryOptions?.[cat.id] ?? {}}
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
										checked={familySettings?.shareAnonymizedDaily === true}
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
										{#if anonymizedPreview}
											<pre class="text-[11px] leading-4 text-ink-soft whitespace-pre-wrap break-words">{JSON.stringify(anonymizedPreview, null, 2)}</pre>
										{:else}
											<p class="text-xs text-ink-soft">No preview loaded yet.</p>
										{/if}
									</div>
								</div>
							{/if}
							</div>
							{:else if settingsTab === 'members'}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
								<h3 class="text-lg font-display font-semibold mb-3">Invite someone to {activeFamily?.name}</h3>
								<form on:submit={sendInvite} class="flex gap-2">
									<input type="email" bind:value={inviteEmail} required class="flex-1 px-3 py-2 border border-line rounded-md" placeholder="person@email.com" />
									<button type="submit" class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary">Send Invite</button>
								</form>
								{#if inviteFallbackUrl}
									<div class="mt-3 p-3 border border-line-soft rounded-md bg-surface-soft">
										<p class="text-xs text-ink-soft uppercase mb-1">Share this link manually</p>
										<p class="text-xs text-ink-soft mb-2">The invitation was saved, but the email did not go out. Send this link to the recipient yourself.</p>
										<input readonly value={inviteFallbackUrl} class="w-full px-3 py-2 border border-line rounded-md text-xs" on:focus={selectAll} aria-label="Invitation link" />
									</div>
								{/if}
								{#if invitations.length > 0}
									<div class="mt-3">
										<p class="text-xs text-ink-soft uppercase">Pending invitations</p>
										<ul class="divide-y divide-line-soft mt-1">
											{#each invitations as inv}
												{#if inv.status === 'pending'}
													<li class="flex justify-between items-center py-1.5">
														<span class="text-sm text-ink">{inv.email}</span>
														<button type="button" class="text-xs text-danger-text underline" on:click={() => revokeInvite(Number(inv.id))}>revoke</button>
													</li>
												{/if}
											{/each}
										</ul>
									</div>
								{/if}
							</div>
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
								<h3 class="text-lg font-display font-semibold mb-2">People in {activeFamily?.name}</h3>
								<p class="text-sm text-ink-soft mb-3">Family members are people in the household (children and adults). Accounts are optional and can be linked through invitations.</p>
								{#if profiles.length === 0}
									<p class="text-sm text-ink-soft">No members yet.</p>
								{:else}
									<ul class="divide-y divide-line-soft">
										{#each profiles as baby}
											<li class="py-2 flex items-start justify-between gap-3">
												<div>
													<p class="text-sm font-semibold text-ink">{baby.name}</p>
													<div class="flex flex-wrap items-center gap-2 mt-1 text-xs">
														<span class="px-2 py-0.5 rounded-full bg-surface2 text-ink-soft">{baby.type || 'child'}</span>
														{#if baby.trackable !== false}
															<span class="px-2 py-0.5 rounded-full bg-surface2 text-ink-soft">trackable profile</span>
														{/if}
														{#if baby.linkedAccount}
															<span class="px-2 py-0.5 rounded-full bg-primary/10 text-link">account linked</span>
														{:else}
															<span class="px-2 py-0.5 rounded-full bg-danger/10 text-danger-text">no account linked</span>
														{/if}
													</div>
													{#if baby.email}
														<p class="text-xs text-ink-soft mt-1">{baby.email}</p>
													{/if}
												</div>
												<div class="flex flex-col gap-1 items-end">
													{#if baby.email && !baby.linkedAccount}
														<button type="button" class="text-xs text-link underline" on:click={() => inviteMemberEmail(String(baby.email))}>invite account</button>
													{/if}
													<button type="button" class="text-xs text-ink-soft underline" on:click={() => openEditMember(baby)}>edit</button>
													<button type="button" class="text-xs {baby.trackable ? 'text-danger-text' : 'text-link'} underline" on:click={() => toggleMemberTracking(baby)}>{baby.trackable ? 'stop tracking' : 'track'}</button>
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-3">Add a family member</h3>
								<p class="text-xs text-ink-soft mb-3">Adults can exist without accounts. Add an email and invite them later. Children and pets get a profile you can log against.</p>
								<form on:submit={addFamilyMember}>
									<div class="mb-2">
										<label for="member-type-x" class="block text-sm font-medium text-ink-soft mb-1">Member Type</label>
										<select id="member-type-x" bind:value={memberType} class="w-full px-3 py-2 border border-line rounded-md">
											<option value="child" selected>Child</option>
											<option value="adult">Adult</option>
											<option value="pet">Pet</option>
										</select>
									</div>
									{#if memberType === 'child'}
										<div class="mb-2">
											<label for="member-stage-x" class="block text-sm font-medium text-ink-soft mb-1">Stage</label>
											<select id="member-stage-x" bind:value={memberStage} class="w-full px-3 py-2 border border-line rounded-md">
												<option value="infant">Infant</option>
												<option value="child">Child</option>
											</select>
											<p class="text-xs text-ink-soft mt-1">Sets which categories start switched on.</p>
										</div>
									{/if}
									<div class="mb-2">
										<label for="member-name-x" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
										<input id="member-name-x" bind:value={newMemberName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Name" />
									</div>
									<div class="mb-2">
										<label for="member-email-x" class="block text-sm font-medium text-ink-soft mb-1">Email (optional)</label>
										<input id="member-email-x" type="email" bind:value={newMemberEmail} class="w-full px-3 py-2 border border-line rounded-md" placeholder="adult@email.com" />
									</div>
									<div class="grid grid-cols-2 gap-3 mb-2">
										<div>
											<label for="member-dob-x" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
											<input id="member-dob-x" type="date" bind:value={newBabyBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
										<div>
											<label for="member-gender-x" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
											<select id="member-gender-x" bind:value={newBabyGender} class="w-full px-3 py-2 border border-line rounded-md">
												<option value="female" selected>Female</option>
												<option value="male">Male</option>
												<option value="other">Other</option>
											</select>
										</div>
									</div>
									<button type="submit" disabled={creatingBaby} class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary disabled:opacity-50">
										{creatingBaby ? 'Adding...' : 'Add Family Member'}
									</button>
								</form>
							</div>
							{#if editingMember}
								<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
									<div class="w-full max-w-lg bg-surface border border-line-soft rounded-lg shadow-card p-4 md:p-6">
										<div class="flex items-center justify-between mb-4">
											<h3 class="text-lg font-display font-semibold">Edit member</h3>
											<button type="button" class="text-ink-soft hover:text-ink" on:click={closeEditMember}>Close</button>
										</div>
										<form on:submit={saveEditMember} class="space-y-3">
											<div>
												<label for="edit-member-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
												<input id="edit-member-name" bind:value={editMemberName} required class="w-full px-3 py-2 border border-line rounded-md" />
											</div>
											<div class="grid grid-cols-2 gap-3">
												<div>
													<label for="edit-member-birth" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
													<input id="edit-member-birth" type="date" bind:value={editMemberBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
												</div>
												<div>
													<label for="edit-member-gender" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
													<select id="edit-member-gender" bind:value={editMemberGender} class="w-full px-3 py-2 border border-line rounded-md">
														<option value="">Not set</option>
														<option value="female">Female</option>
														<option value="male">Male</option>
														<option value="other">Other</option>
													</select>
												</div>
											</div>
											<div>
												<label for="edit-member-email" class="block text-sm font-medium text-ink-soft mb-1">Email</label>
												<input id="edit-member-email" type="email" bind:value={editMemberEmail} class="w-full px-3 py-2 border border-line rounded-md" placeholder="optional@email.com" />
											</div>
											<div class="border-t border-line-soft pt-3">
												<p class="text-sm font-medium text-ink-soft mb-1">Tracks</p>
												<p class="text-xs text-ink-soft mb-2">
													What this person's log forms offer. Turning one off removes it from their tabs and Quick
													Actions; the records already kept stay.
												</p>
												<div class="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
													{#each CATEGORIES as cat}
														<ToggleSwitch
															checked={editMemberCategories.includes(cat.id)}
															label={cat.label}
															onToggle={() => toggleEditMemberCategory(cat.id)}
														/>
													{/each}
												</div>
											</div>
											<div>
												<label for="edit-member-avatar" class="block text-sm font-medium text-ink-soft mb-1">Photo</label>
												<input id="edit-member-avatar" type="file" accept="image/*" class="w-full text-sm" on:change={onMemberAvatarSelected} />
											</div>
											<div class="flex items-center justify-between pt-2">
												<button type="button" class="text-danger-text underline text-sm" on:click={deleteEditMember}>Delete member</button>
												<div class="flex items-center gap-2">
													<button type="button" class="px-3 py-2 text-sm border border-line rounded-md" on:click={closeEditMember}>Cancel</button>
													<button type="submit" class="px-3 py-2 text-sm bg-primary text-on-primary rounded-md">Save</button>
												</div>
											</div>
										</form>
									</div>
								</div>
							{/if}
							{:else if settingsTab === 'import'}
							<ImportPanel {profiles} {activeFamily} runs={importRuns} dataChanged={loadFamilies} />
							{:else if settingsTab === 'backup'}
							<BackupPanel {activeFamily} {activeFamilyId} {exportFamily} dataChanged={loadFamilies} />
							{:else if settingsTab === 'admin'}
							{#if isPanelAdmin}
							<AdminPanel isAdmin={isPanelAdmin} />
							{/if}
							{/if}
						</div>
					{/if}
				</div>
