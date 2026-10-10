<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authAPI, userAPI, familiesAPI, feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, importsAPI, familyAdminAPI, accountAPI, milestoneAPI, vaccinationAPI, settingsAPI, moodAPI, journalAPI, tokenExpired } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { CATEGORIES, defaultMemberId } from '$lib/shared';
	import { DIGEST_FREQUENCIES } from '$lib/vocabulary.generated';
	import { Users, Home, Trash2, Timer, AlertCircle, Settings, Check, ChevronRight, User, Shield, Upload, Download } from 'lucide-svelte';



	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;
	let error = '';
	let notice = '';
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	function dismissFeedback() {
		notice = '';
		error = '';
		if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = undefined; }
	}
	$: if (notice || error) {
		if (feedbackTimer) clearTimeout(feedbackTimer);
		feedbackTimer = setTimeout(() => { feedbackTimer = undefined; notice = ''; error = ''; }, 6000);
	}

	let email = '';
	let password = '';
	let showForgot = false;
	let pendingResetToken = '';
	// Per-user mobile quick links (category ids), persisted in localStorage.
	let loading = false;

	let profiles: any[] = [];
	let families: any[] = [];
	let activeFamily: any = null;
	let activeFamilyId: string | null = null;
	let selectedMemberId: number | null = null;
	// Feeds, sleep, diapers and the rest only exist for a trackable profile.
	/**
	 * Whether the selected person can be logged against.
	 *
	 * Computed here rather than from a `$:` flag: reactive statements are
	 * scheduled, not synchronous, so selectMember() would call refreshLists()
	 * before the flag had recomputed and fetch the baby endpoints for whoever was
	 * selected previously.
	 */
	function currentIsTrackable(): boolean {
		const m = profiles.find((b) => Number(b.id) === selectedMemberId);
		return !!m && m.trackable !== false;
	}
	let activeTab = 'feeds';
	let defaultProfileId: number | null = null;
	let summary: any = null;

	// Tracking categories now live in $lib/shared.ts (single source of truth).
	// Categories enabled for the selected member.
	let activeCategories: string[] = [];

	// Family-scoped tracking settings (categories + per-category option lists).
	let settingsTab: 'profile' | 'family' | 'import' | 'members' | 'backup' | 'admin' | null = null;
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>>; stageCategories?: Record<string, string[]> | null; defaultStageCategories?: Record<string, string[]>; digestFrequency?: string; digestSentAt?: string | null; shareAnonymizedDaily?: boolean } | null = null;
	// The stage whose category set is being edited, and a local mirror so toggles
	// feel instant before the round trip lands.
	let stageEditor: string | null = null;
	let stageDraft: Record<string, string[]> = {};
	// What the family tracks, as opposed to `activeCategories`, which is the
	// selected member's own set. They shared one variable, so this tab showed
	// one member's categories while writing a family-wide setting.
	let savingFamilySettings = false;
	let anonymizedPreview: any = null;
	let loadingAnonymizedPreview = false;

	let editingMember: any = null;
	let editMemberName = '';
	let editMemberBirthDate = '';
	let editMemberGender = '';
	let editMemberEmail = '';

	// Family onboarding
	let familyName = '';
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

	// Import data (Narababy CSV)
	let importFile: File | null = null;
	let importResult: any = null;
	let importing = false;
	let importTargetBabyId: number | null = null;
	let importType: 'narababy' | 'csv' = 'narababy';
	let importRuns: any[] = [];
	let undoingRunId: number | null = null;

	// Formula catalog
	let formulas: any[] = [];
	// Manual feed entry (backdated) + repeat-last
	// Diaper detail form
	// Sleep + growth backdated
	// Milestone + vaccine manual forms
	// Account
	let curPw = '';
	let newPw = '';
	let confirmPw = '';
	let changingPw = false;
	let deletingAccount = false;
	let deleteConfirmName = '';

	let feedStartedAt: number | null = null;
	let feedElapsed = 0;
	let leftStartedAt: number | null = null;
	let leftElapsed = 0;
	let rightStartedAt: number | null = null;
	let rightElapsed = 0;

	let sleepStartedAt: number | null = null;


	let feedings: any[] = [];
	let diapers: any[] = [];
	let sleeps: any[] = [];
	let growths: any[] = [];
	let milestones: any[] = [];
	let vaccinations: any[] = [];
	let moods: any[] = [];
	let journalEntries: any[] = [];

	// Breast-feeding totals + last side, derived from loaded feedings.


	function avg(a: number[]): number | null {
		if (a.length === 0) return null;
		return a.reduce((s, x) => s + x, 0) / a.length;
	}

	$: feedReports = (() => {
		const now = Date.now();
		const dayAgo = now - 24 * 3600 * 1000;
		const monthAgo = now - 30 * 24 * 3600 * 1000;
		const f = feedings.filter((x) => x.type === 'breast' || x.type === 'bottle' || x.type === 'formula');
		const withDuration = f.filter((x) => x.duration && x.duration > 0);
		const sizes1d = f.filter((x) => new Date(x.start_time).getTime() >= dayAgo && x.amount).map((x) => Number(x.amount));
		const sizes30d = f.filter((x) => new Date(x.start_time).getTime() >= monthAgo && x.amount).map((x) => Number(x.amount));
		const dur1d = withDuration.filter((x) => new Date(x.start_time).getTime() >= dayAgo).map((x) => Number(x.duration));
		const dur30d = withDuration.filter((x) => new Date(x.start_time).getTime() >= monthAgo).map((x) => Number(x.duration));
		return {
			count1d: f.filter((x) => new Date(x.start_time).getTime() >= dayAgo).length,
			count30d: f.length,
			avgSize1d: avg(sizes1d),
			avgSize30d: avg(sizes30d),
			avgDur1d: avg(dur1d),
			avgDur30d: avg(dur30d),
		};
	})();



	function formatTime(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}




	async function refreshSummary() {
		if (!selectedMemberId) return;
		if (!currentIsTrackable()) {
			// Health summary is baby tracking; an adult profile has none and the
			// endpoint refuses it, so don't ask and report nothing.
			summary = null;
			return;
		}
		try {
			const res = await healthAPI.getSummary(selectedMemberId);
			summary = res.data.summary;
		} catch {
			summary = null;
		}
	}

	async function refreshLists() {
		if (!selectedMemberId) return;
		if (!currentIsTrackable()) {
			// Feeds, sleep, diapers, growth, moods and the rest belong to a baby
			// profile. The person who created the household is now an adult member
			// of it, so a household with no child yet would otherwise fire eight
			// requests that all fail.
			feedings = [];
			diapers = [];
			sleeps = [];
			growths = [];
			milestones = [];
			vaccinations = [];
			moods = [];
			journalEntries = [];
			return;
		}
		try {
			const [f, d, s, g, m, v, mo, j] = await Promise.all([
				feedingAPI.getAll(selectedMemberId),
				diaperAPI.getAll(selectedMemberId),
				sleepAPI.getAll(selectedMemberId),
				growthAPI.getAll(selectedMemberId),
				milestoneAPI.getAll(selectedMemberId),
				vaccinationAPI.getAll(selectedMemberId),
				moodAPI.getAll(selectedMemberId),
				journalAPI.getAll(selectedMemberId),
			]);
			feedings = f.data.feedings;
			diapers = d.data.diapers;
			sleeps = s.data.sleep;
			growths = g.data.growth;
			milestones = m.data.milestones;
			vaccinations = v.data.vaccinations;
			moods = mo.data.moods ?? [];
			journalEntries = j.data.entries ?? [];
		} catch (e: any) {
			error = e.response?.data?.error || 'Failed to load tracking data.';
			console.error(e);
		}
	}



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
				const selected = profiles.find((b) => Number(b.id) === selectedMemberId);
				// The API resolves this to the member's own set, constrained by their
				// stage. An empty list is a real answer, not a prompt to show everything.
				activeCategories = selected?.categories ?? [];
				if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
			} else {
				selectedMemberId = null;
				activeCategories = [];
			}
			await Promise.all([loadFamilySettings(), refreshLists(), refreshSummary(), loadInvitations(), loadImportRuns()]);
		} catch (e: any) {
			const status = e.response?.status;
			if (status === 401 || status === 403) {
				handleLogout();
				error = 'Your session has expired. Please sign in again.';
				return;
			}
			error = e.response?.data?.error || 'Failed to load your families.';
			console.error(e);
		}
	}






	function handleLogout() {
		authActions.logout();
		isAuthenticated = false;
		profiles = [];
		selectedMemberId = null;
		feedStartedAt = null;
		leftStartedAt = null;
		rightStartedAt = null;
		leftElapsed = 0;
		rightElapsed = 0;
		feedElapsed = 0;
		sleepStartedAt = null;
	}


	async function addFamilyMember(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!newMemberName) {
			error = 'Member name is required.';
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
			notice = `${res.data.member.name} added to the family.`;
			newMemberName = '';
			newMemberEmail = '';
			newBabyBirthDate = '';
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to add family member.';
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
		error = '';
		inviteFallbackUrl = '';
		if (!inviteEmail.trim() || !activeFamilyId) return;
		try {
			const res = await familiesAPI.invite(activeFamilyId, inviteEmail.trim());
			notice = `Invitation sent to ${res.data.invitation.email}.`;
			inviteEmail = '';
			await loadInvitations();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to send invitation.';
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
			error = e.response?.data?.error || 'Failed to revoke invitation.';
		}
	}

	function onImportFileSelected() {
		const input = document.getElementById('import-file') as HTMLInputElement | null;
		importFile = input?.files?.[0] ?? null;
		importResult = null;
	}

	async function importNarababy() {
		error = '';
		if (!importFile) {
			error = 'Choose a Narababy export file first.';
			return;
		}
		importing = true;
		importResult = null;
		try {
			const res = await importsAPI.narababy(importFile, importTargetBabyId, importType);
			importResult = res.data;
			notice = res.data.message || 'Import complete.';
			await loadImportRuns();
			await loadFamilies();
			await loadInvitations();
		} catch (err: any) {
			error = err.response?.data?.error || 'Import failed.';
			console.error(err);
		} finally {
			importing = false;
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

	async function undoImportRun(runId: number) {
		if (!confirm('Undo this import? Records created by it will be deleted.')) return;
		undoingRunId = runId;
		try {
			const res = await importsAPI.undoRun(runId);
			notice = res.data.message || 'Import undone.';
			await loadImportRuns();
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to undo import.';
		} finally {
			undoingRunId = null;
		}
	}









	// Account + family admin
	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (newPw !== confirmPw) { error = 'New passwords do not match.'; return; }
		changingPw = true;
		try {
			await accountAPI.changePassword(curPw, newPw);
			curPw = ''; newPw = ''; confirmPw = '';
			notice = 'Password updated.';
		} catch (err: any) { error = err.response?.data?.error || 'Failed to change password.'; }
		finally { changingPw = false; }
	}

	async function deleteAccount() {
		error = '';
		const isOwner = activeFamily?.role === 'owner';
		const familyName = String(activeFamily?.name ?? '');
		if (isOwner && deleteConfirmName.trim().toLowerCase() !== familyName.trim().toLowerCase()) {
			error = 'Type the family name to confirm deleting the family.';
			return;
		}
		if (!confirm('Delete your account permanently? This cannot be undone. If you own the family, the family and all of its data are removed too.')) return;
		deletingAccount = true;
		try {
			await accountAPI.remove(isOwner ? deleteConfirmName.trim() : undefined);
			authActions.logout();
			goto('/login');
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to delete account.';
		} finally {
			deletingAccount = false;
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
			notice = 'All-data backup downloaded.';
		} catch (err: any) { error = err.response?.data?.error || 'Backup failed.'; }
	}

	let backupFile: File | null = null;
	let restoring = false;

	// Instance settings (Admin tab)
	let appSettings: any = null;
	let isPanelAdmin = false;
	let savingSettings = false;
	let testingSmtp = false;
	let smtpHost = '';
	let smtpPort = 587;
	let smtpUser = '';
	let smtpPass = '';
	let smtpFrom = '';
	let signupEnabled = true;
	let signupEnvLocked = false;
	let emailVerificationSetting = false;

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

	async function loadAppSettings() {
		try {
			const res = await settingsAPI.get();
			appSettings = res.data.settings;
			smtpHost = appSettings.smtpHost || '';
			smtpPort = appSettings.smtpPort || 587;
			smtpUser = appSettings.smtpUser || '';
			smtpFrom = appSettings.smtpFrom || '';
			signupEnabled = appSettings.signupEnabled;
			signupEnvLocked = appSettings.signupEnvLocked === true;
			emailVerificationSetting = appSettings.emailVerification;
		} catch {
			appSettings = null;
		}
	}

	async function saveAppSettings() {
		savingSettings = true;
		error = '';
		try {
			const res = await settingsAPI.update({
				signupEnabled,
				emailVerification: emailVerificationSetting,
				smtpHost: smtpHost || null,
				smtpPort: smtpPort || null,
				smtpUser: smtpUser || null,
				smtpPass: smtpPass || null,
				smtpFrom: smtpFrom || null,
			});
			appSettings = res.data.settings;
			notice = 'Settings saved.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to save settings.';
		} finally {
			savingSettings = false;
		}
	}

	async function testSmtp() {
		testingSmtp = true;
		error = '';
		try {
			const res = await settingsAPI.test();
			notice = res.data.message || 'Test email sent.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Test failed.';
		} finally {
			testingSmtp = false;
		}
	}

	function onBackupFileSelected() {
		const input = document.getElementById('backup-file') as HTMLInputElement | null;
		backupFile = input?.files?.[0] ?? null;
	}

	async function restoreBackup() {
		if (!activeFamilyId || !backupFile) {
			error = 'Choose a Nido backup file first.';
			return;
		}
		if (!confirm('Restore this backup into your family? Existing members are matched by name and skipped; records will be re-added.')) return;
		restoring = true;
		try {
			const text = await backupFile.text();
			const json = JSON.parse(text);
			const res = await familyAdminAPI.restore(activeFamilyId, json);
			notice = `${res.data.message}. Members added: ${res.data.membersAdded}.`;
			backupFile = null;
			await loadFamilies();
			await refreshLists();
		} catch (err: any) {
			error = err.response?.data?.error || (err instanceof SyntaxError ? 'Not a valid JSON backup file.' : 'Restore failed.');
		} finally {
			restoring = false;
		}
	}

	async function deleteFamily() {
		if (!activeFamilyId) return;
		if (!confirm(`Delete "${activeFamily?.name}" and ALL of its data? This cannot be undone.`)) return;
		try {
			await familyAdminAPI.remove(activeFamilyId);
			notice = 'Family deleted.';
			await loadFamilies();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to delete family.'; }
	}


	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings;
			anonymizedPreview = res.data.anonymizedPreview ?? anonymizedPreview;
			const cats = familySettings?.categories;
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
			error = err.response?.data?.error || 'Failed to load anonymized preview.';
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
			notice = 'Digest frequency updated.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Could not update the digest frequency.';
		}
	}

	function stageSetFor(stage: string | null): string[] {
		if (!stage) return [];
		return stageDraft[stage]
			?? familySettings?.stageCategories?.[stage]
			?? familySettings?.defaultStageCategories?.[stage]
			?? [];
	}

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
		const cur = stageSetFor(stage);
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
			error = err.response?.data?.error || 'Could not update the stage.';
		}
	}

	async function saveCategoryOptions(nextOptions: Record<string, Record<string, string[]>>) {
		if (!activeFamilyId) return;
		savingFamilySettings = true;
		try {
			await familiesAPI.updateSettings(activeFamilyId, { categoryOptions: nextOptions });
			if (familySettings) familySettings.categoryOptions = nextOptions;
			notice = 'Category options saved.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to save category options.';
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
			notice = next
				? 'Daily anonymized sharing enabled.'
				: 'Daily anonymized sharing disabled.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update anonymized sharing setting.';
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
		error = '';
	}

	function closeEditMember() {
		editingMember = null;
	}

	async function toggleMemberTracking(baby: any) {
		if (!activeFamilyId) return;
		error = '';
		const next = !baby.trackable;
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(baby.id), { trackable: next });
			await loadFamilies();
			notice = next ? `${baby.name} will now be tracked.` : `${baby.name} is no longer tracked.`;
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update tracking.';
		}
	}

	async function deleteEditMember() {
		if (!editingMember || !activeFamilyId) return;
		if (!confirm(`Delete "${editMemberName.trim() || editingMember.name}" and ALL of their records? This cannot be undone.`)) return;
		try {
			await familiesAPI.removeMember(activeFamilyId, Number(editingMember.id));
			notice = 'Member deleted.';
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to delete member.';
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
			});
			notice = 'Member updated.';
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update member.';
		}
	}

	async function inviteMemberEmail(email: string) {
		if (!email || !activeFamilyId) return;
		try {
			await familiesAPI.invite(activeFamilyId, email);
			notice = `Invite sent to ${email}.`;
			await loadInvitations();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to send invite.';
		}
	}

	async function onMemberAvatarSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || !editingMember || !activeFamilyId) return;
		try {
			await familiesAPI.uploadAvatar(activeFamilyId, Number(editingMember.id), file);
			notice = 'Profile photo updated.';
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to upload photo.';
		}
	}


	// Live per-side elapsed (ms) = frozen total + live running time.

	// ----- Connection-resilience: persisted timers + offline outbox -----
	// Timer state is written to localStorage on every mutation so a reload or a
	// dropped connection mid-session does not lose accumulated time. The outbox




















	

	onMount(async () => {
		if (browser) {
			const params = new URLSearchParams(window.location.search);
			const verifyParam = params.get('verify');
			const resetParam = params.get('reset');
			if (verifyParam) {
				try {
					const res = await authAPI.verifyEmail(verifyParam);
					notice = res.data.message || 'Email verified.';
				} catch (err: any) {
					error = err.response?.data?.error || 'Verification failed.';
				}
				if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
			}
			if (resetParam) {
				pendingResetToken = resetParam;
				showForgot = true;
				notice = 'Enter a new password to complete your password reset.';
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
				if (isPanelAdmin) await loadAppSettings();
			}
		}
	});
</script>
 				{#if notice || error}
					<div class="fixed top-4 right-4 z-[70] w-full max-w-sm space-y-2" role="status" aria-live="polite">
						{#if notice}
							<div class="bg-surface border border-line-soft text-ink shadow-card px-4 py-3 rounded-md text-sm">
								<span class="inline-flex items-center gap-2"><Check class="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
								{notice}<button type="button" on:click={dismissFeedback} class="ml-auto text-ink-soft hover:text-ink shrink-0" aria-label="Dismiss">&times;</button></span>
							</div>
						{/if}
						{#if error}
							<div class="bg-danger border border-danger text-danger-text px-4 py-3 rounded-md text-sm">
								<span class="inline-flex items-center gap-2"><AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
								{error}<button type="button" on:click={dismissFeedback} class="ml-auto hover:opacity-70 shrink-0" aria-label="Dismiss">&times;</button></span>
							</div>
						{/if}
					</div>
				{/if}
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
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-4">Profile</h3>
								<div class="mb-6">
									<p class="text-sm text-ink-soft mb-1">Name</p>
									<p class="font-semibold text-ink">{$authStore.user?.firstName} {$authStore.user?.lastName}</p>
								</div>
								<div class="mb-6">
									<p class="text-sm text-ink-soft mb-1">Email</p>
									<p class="font-semibold text-ink">{$authStore.user?.email}</p>
								</div>
								<div class="border-t border-line-soft pt-4">
									<h4 class="font-display font-semibold mb-3">Change password</h4>
									<form on:submit={changePassword} class="space-y-3 max-w-sm">
										<input type="password" bind:value={curPw} placeholder="Current password" class="w-full px-3 py-2 border border-line rounded-md" />
										<input type="password" bind:value={newPw} placeholder="New password" class="w-full px-3 py-2 border border-line rounded-md" />
										<input type="password" bind:value={confirmPw} placeholder="Confirm new password" class="w-full px-3 py-2 border border-line rounded-md" />
										<button type="submit" disabled={changingPw} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50">
											{changingPw ? 'Saving...' : 'Change Password'}
										</button>
								</form>
								{#if inviteFallbackUrl}
									<div class="mt-3 p-3 border border-line-soft rounded-md bg-surface-soft">
										<p class="text-xs text-ink-soft uppercase mb-1">Share this link manually</p>
										<p class="text-xs text-ink-soft mb-2">The invitation was saved, but the email did not go out. Send this link to the recipient yourself.</p>
										<input readonly value={inviteFallbackUrl} class="w-full px-3 py-2 border border-line rounded-md text-xs" on:focus={selectAll} aria-label="Invitation link" />
									</div>
								{/if}
								</div>
								<div class="border-t border-line-soft pt-4">
									<h4 class="font-display font-semibold mb-3 text-danger-text">Delete account</h4>
									<p class="text-xs text-ink-soft mb-3">Permanently removes your account. If you own the family, the family and all of its members and records are removed too. This cannot be undone.</p>
									{#if activeFamily?.role === 'owner'}
										<label for="delete-confirm-name" class="block text-xs text-ink-soft mb-1">Type the family name to confirm</label>
										<input id="delete-confirm-name" type="text" bind:value={deleteConfirmName} class="w-full px-3 py-2 border border-line rounded-md mb-3" placeholder={activeFamily?.name} />
									{/if}
									<button type="button" on:click={deleteAccount} disabled={deletingAccount || (activeFamily?.role === 'owner' && deleteConfirmName.trim().toLowerCase() !== String(activeFamily?.name ?? '').trim().toLowerCase())} class="bg-danger text-danger-text border border-danger px-4 py-2 rounded-md font-semibold disabled:opacity-50">
										{deletingAccount ? 'Deleting...' : 'Delete my account'}
									</button>
								</div>
								<div class="border-t border-line-soft pt-4">
									<h4 class="font-display font-semibold mb-3">Family</h4>
									<p class="text-sm text-ink-soft mb-2">Family: <span class="text-ink font-medium">{activeFamily?.name} <span class="text-accent font-mono text-sm">({activeFamily?.familyCode})</span></span></p>
									<p class="text-sm text-ink-soft mb-2">Your role: <span class="text-ink font-medium">{activeFamily?.role || 'member'}</span></p>
									<div class="flex flex-wrap gap-3">
										<button type="button" on:click={exportFamily} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:bg-line-soft">⬇ Export data</button>
										{#if activeFamily?.role === 'owner'}
											<button type="button" on:click={deleteFamily} class="bg-danger text-danger-text px-4 py-2 rounded-md hover:bg-danger"><Trash2 class="w-4 h-4 inline mr-1" /> Delete family</button>
										{/if}
									</div>
								</div>
							</div>
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
														checked={stageSetFor(stageEditor).includes(cat.id)}
														label={cat.label}
														onToggle={() => toggleStageCategory(stageEditor, cat.id)}
													/>
												{/each}
											</div>
										{/if}
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
										{#if familySettings.digestSentAt}
											<p class="text-xs text-ink-soft mt-2">Last sent {new Date(familySettings.digestSentAt).toLocaleString()}.</p>
										{/if}
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
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-2">Import data</h3>
								<p class="text-ink-soft text-sm mb-3">Bring history from another baby app into {activeFamily?.name}. Records land on the selected family member. Re-importing the same file skips duplicates.</p>
								<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
									<div class="flex-1">
										<label for="import-target" class="block text-sm font-medium text-ink-soft mb-1">Assign to family member</label>
										<select id="import-target" bind:value={importTargetBabyId} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
											<option value={null}>— choose a member —</option>
											{#each profiles as baby}
												<option value={baby.id}>{baby.name}</option>
											{/each}
										</select>
									</div>
									<div class="flex-1">
										<label for="import-type" class="block text-sm font-medium text-ink-soft mb-1">Import type</label>
										<select id="import-type" bind:value={importType} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
											<option value="narababy">Narababy (CSV)</option>
											<option value="csv">Generic CSV</option>
										</select>
									</div>
									<div class="flex-1">
										<label for="import-file" class="block text-sm font-medium text-ink-soft mb-1">File</label>
										<input id="import-file" type="file" accept=".csv,text/csv" on:change={onImportFileSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
										{#if importFile}
											<p class="text-xs text-ink-soft mt-1">Selected: {importFile.name}</p>
										{/if}
									</div>
									<div class="sm:self-end">
										<button type="button" disabled={importing || !importFile} on:click={importNarababy} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50">
											{importing ? 'Importing...' : 'Import'}
										</button>
									</div>
								</div>
								{#if importResult}
									<div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
										<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Feedings</span><br /><span class="font-semibold text-ink">{importResult.created?.feedings ?? 0}</span></div>
										<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Diapers</span><br /><span class="font-semibold text-ink">{importResult.created?.diapers ?? 0}</span></div>
										<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Sleep</span><br /><span class="font-semibold text-ink">{importResult.created?.sleep ?? 0}</span></div>
										<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Growth</span><br /><span class="font-semibold text-ink">{importResult.created?.growth ?? 0}</span></div>
										<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Milestones</span><br /><span class="font-semibold text-ink">{importResult.created?.milestones ?? 0}</span></div>
										<div class="bg-surface2 rounded-md px-3 py-2"><span class="text-ink-soft uppercase text-xs">Skipped (dups)</span><br /><span class="font-semibold text-ink">{importResult.skippedDuplicate ?? 0}</span></div>
									</div>
									{#if importResult.errors && importResult.errors.length > 0}
										<p class="text-xs text-danger-text mt-2">{importResult.errors.length} row(s) had issues.</p>
									{/if}
								{/if}
								{#if importRuns.length > 0}
									<div class="border-t border-line-soft pt-3 mt-4">
										<h4 class="font-display font-semibold text-sm mb-2">Import history</h4>
										<ul class="divide-y divide-line-soft">
											{#each importRuns as run}
												<li class="py-2 flex items-center justify-between gap-2">
													<div class="min-w-0">
														<p class="text-sm text-ink truncate">{run.filename || 'Import'}</p>
														<p class="text-xs text-ink-soft">{formatTime(run.createdAt)} · {run.importType}{run.memberId ? ` · member #${run.memberId}` : ''}</p>
													</div>
													<button type="button" disabled={undoingRunId === run.id} on:click={() => undoImportRun(run.id)} class="text-xs text-danger-text hover:underline shrink-0">
														{undoingRunId === run.id ? 'Undoing...' : 'Undo'}
													</button>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
							</div>
							{:else if settingsTab === 'backup'}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-2">Backup</h3>
								<p class="text-ink-soft text-sm mb-4">Download a full backup of <span class="text-ink font-medium">{activeFamily?.name}</span> — every member, all records (feeds, diapers, sleep, growth, milestones, vaccinations), formulas, tracked-category settings, and pending invitations — as a portable JSON file. Restore it later into this family.</p>

								<div class="flex flex-col gap-4">
									<button type="button" on:click={exportFamily} class="bg-primary text-on-primary px-4 py-2.5 rounded-md hover:bg-primary">⬇ Download all-data backup</button>

									<div class="border-t border-line-soft pt-4">
										<h4 class="font-display font-semibold text-sm mb-2">Restore from backup</h4>
										<p class="text-xs text-ink-soft mb-2">Choose a Nido backup JSON file. Members already present (matched by name) are skipped; their records will be re-added from the backup.</p>
										<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
											<input id="backup-file" type="file" accept=".json,application/json" on:change={onBackupFileSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
											<button type="button" disabled={restoring || !backupFile} on:click={restoreBackup} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50 shrink-0">
												{restoring ? 'Restoring...' : 'Restore'}
											</button>
										</div>
									</div>

									<div class="border-t border-line-soft pt-4 bg-surface2 rounded-md p-4">
										<h4 class="font-display font-semibold text-sm mb-2">Restore notes</h4>
										<ul class="text-xs text-ink-soft list-disc ml-4 space-y-1">
											<li>Backups are per-family. Download each family&rsquo;s backup separately from that family&rsquo;s account.</li>
											<li>To restore into a different family, switch to (or create) that family in Account → Family, then Restore here.</li>
											<li>Restore is additive: existing members are matched by name and skipped, and their records are appended. To fully replace data, delete the family first (owner only), rebuild it, then restore.</li>
											<li>Restoring to a brand-new family requires the restore file&rsquo;s members to be added first — it will create them automatically.</li>
										</ul>
									</div>
								</div>
							</div>
							{:else if settingsTab === 'admin'}
							{#if isPanelAdmin}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-2">Admin</h3>
								<p class="text-ink-soft text-sm mb-4">Instance-wide settings. These apply to every family on this server.</p>

								<div class="flex flex-col gap-4">
									<div class="border-t border-line-soft pt-4">
										<h4 class="font-display font-semibold text-sm mb-2">Sign up</h4>
										<ToggleSwitch
											checked={signupEnabled}
											disabled={signupEnvLocked}
											label="Allow new account sign up"
											description="When off, the register page is blocked for new accounts."
											onToggle={() => { signupEnabled = !signupEnabled; saveAppSettings(); }}
										/>
										{#if signupEnvLocked}
											<p class="text-xs text-ink-soft mt-2">Controlled by the <span class="font-mono">SIGNUP_ENABLED</span> environment variable — this toggle is locked.</p>
										{/if}
										<ToggleSwitch
											checked={emailVerificationSetting}
											label="Require email verification"
											description="New users must click a link emailed to them before they can sign in. Requires SMTP."
											onToggle={() => { emailVerificationSetting = !emailVerificationSetting; saveAppSettings(); }}
										/>
										{#if emailVerificationSetting && appSettings && !appSettings.smtpConfigured}
											<div class="mt-2 bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm">
												Email verification is on, but SMTP is not configured — verification emails will not be sent, and new accounts will be stuck unable to sign in. Configure SMTP below before enabling it.
											</div>
										{/if}
									</div>

									<div class="border-t border-line-soft pt-4">
										<h4 class="font-display font-semibold text-sm mb-2">SMTP</h4>
										<div class="grid grid-cols-2 gap-3">
											<div>
												<label for="smtp-host" class="block text-sm font-medium text-ink-soft mb-1">Host</label>
												<input id="smtp-host" type="text" bind:value={smtpHost} placeholder="smtp.example.com" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div>
												<label for="smtp-port" class="block text-sm font-medium text-ink-soft mb-1">Port</label>
												<input id="smtp-port" type="number" bind:value={smtpPort} placeholder="587" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div>
												<label for="smtp-user" class="block text-sm font-medium text-ink-soft mb-1">Username</label>
												<input id="smtp-user" type="text" bind:value={smtpUser} placeholder="user@example.com" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div>
												<label for="smtp-pass" class="block text-sm font-medium text-ink-soft mb-1">Password</label>
												<input id="smtp-pass" type="password" bind:value={smtpPass} placeholder="••••••" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div class="col-span-2">
												<label for="smtp-from" class="block text-sm font-medium text-ink-soft mb-1">From address</label>
												<input id="smtp-from" type="email" bind:value={smtpFrom} placeholder="Nido <nido@example.com>" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
										</div>
									</div>

									<div class="flex flex-wrap gap-2">
										<button type="button" disabled={savingSettings} on:click={saveAppSettings} class="bg-primary text-on-primary px-4 py-2 rounded-md hover:bg-primary disabled:opacity-50">
											{savingSettings ? 'Saving...' : 'Save settings'}
										</button>
										<button type="button" disabled={testingSmtp} on:click={testSmtp} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:text-ink disabled:opacity-50">
											{testingSmtp ? 'Sending...' : 'Send test email'}
										</button>
									</div>
								</div>
							</div>
							{/if}
							{/if}
						</div>
					{/if}
				</div>
