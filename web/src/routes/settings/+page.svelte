<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { tokenExpired } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { importsAPI, familyAdminAPI, accountAPI, settingsAPI } from '$lib/api/system';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { applyTimezone } from '$lib/stores/timezoneStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { detectTimeZone, listTimeZones, zonedOptions } from '$lib/logging/format';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { CATEGORIES, defaultMemberId } from '$lib/shared';
	import { DIGEST_FREQUENCIES } from '$lib/vocabulary.generated';
	import type { ComponentStatus, SystemOverview, RegistryView } from '$lib/api/types';
	import { Users, Home, Trash2, Settings, ChevronRight, User, Shield, Upload, Download } from 'lucide-svelte';



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

	// Tracking categories now live in $lib/shared.ts (single source of truth).
	// Categories enabled for the selected member.
	let activeCategories: string[] = [];

	// Family-scoped tracking settings (categories + per-category option lists).
	let settingsTab: 'profile' | 'family' | 'import' | 'members' | 'backup' | 'admin' | null = null;
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>>; stageCategories?: Record<string, string[]> | null; defaultStageCategories?: Record<string, string[]>; digestFrequency?: string; digestSentAt?: string | null; shareAnonymizedDaily?: boolean; appointmentNotifications?: boolean; appointmentNotificationsSentAt?: string | null; feedGroupingMinutes?: number; timezone?: string | null; digestSendHour?: number | null; appointmentSendHour?: number | null } | null = null;
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

	// Import data (Narababy CSV)
	let importFile: File | null = null;
	let importResult: any = null;
	let importing = false;
	let importTargetBabyId: number | null = null;
	let importType: 'narababy' | 'csv' = 'narababy';
	let importRuns: any[] = [];
	let undoingRunId: number | null = null;

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

	function formatTime(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString(undefined, zonedOptions({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
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
			} else {
				selectedMemberId = null;
				activeCategories = [];
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

	function onImportFileSelected() {
		const input = document.getElementById('import-file') as HTMLInputElement | null;
		importFile = input?.files?.[0] ?? null;
		importResult = null;
	}

	async function importNarababy() {
		fail('');
		if (!importFile) {
			fail('Choose a Narababy export file first.');
			return;
		}
		importing = true;
		importResult = null;
		try {
			const res = await importsAPI.narababy(importFile, importTargetBabyId, importType);
			importResult = res.data;
			notify(res.data.message || 'Import complete.');
			await loadImportRuns();
			await loadFamilies();
			await loadInvitations();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Import failed.');
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
			notify(res.data.message || 'Import undone.');
			await loadImportRuns();
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to undo import.');
		} finally {
			undoingRunId = null;
		}
	}









	// Account + family admin
	async function changePassword(event: SubmitEvent) {
		event.preventDefault();
		fail('');
		if (newPw !== confirmPw) { fail('New passwords do not match.'); return; }
		changingPw = true;
		try {
			await accountAPI.changePassword(curPw, newPw);
			curPw = ''; newPw = ''; confirmPw = '';
			notify('Password updated.');
		} catch (err: any) { fail(err.response?.data?.error || 'Failed to change password.'); }
		finally { changingPw = false; }
	}

	async function deleteAccount() {
		fail('');
		const isOwner = activeFamily?.role === 'owner';
		const familyName = String(activeFamily?.name ?? '');
		if (isOwner && deleteConfirmName.trim().toLowerCase() !== familyName.trim().toLowerCase()) {
			fail('Type the family name to confirm deleting the family.');
			return;
		}
		if (!confirm('Delete your account permanently? This cannot be undone. If you own the family, the family and all of its data are removed too.')) return;
		deletingAccount = true;
		try {
			await accountAPI.remove(isOwner ? deleteConfirmName.trim() : undefined);
			authActions.logout();
			goto('/login');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to delete account.');
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
			notify('All-data backup downloaded.');
		} catch (err: any) { fail(err.response?.data?.error || 'Backup failed.'); }
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

	// Instance health / roll-up stats for the Admin tab.
	let systemOverview: SystemOverview | null = null;
	let loadingOverview = false;
	let overviewError = '';

	// Formatting lives here too rather than being sent pre-rendered for the
	// tiles; the component metrics arrive as strings from the API.
	function formatBytes(bytes: number | null | undefined): string {
		if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
		if (bytes < 1024) return `${Math.round(bytes)} B`;
		const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
		let value = bytes / 1024;
		let i = 0;
		while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
		return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
	}

	function formatDuration(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) return '—';
		const s = Math.floor(seconds);
		const d = Math.floor(s / 86_400);
		const h = Math.floor((s % 86_400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d > 0) return `${d}d ${h}h`;
		if (h > 0) return `${h}h ${m}m`;
		if (m > 0) return `${m}m ${s % 60}s`;
		return `${s}s`;
	}

	function statusDot(status: ComponentStatus): string {
		return status === 'ok' ? 'bg-ok-text' : status === 'warn' ? 'bg-accent' : 'bg-danger-text';
	}
	function statusText(status: ComponentStatus): string {
		return status === 'ok' ? 'text-ok-text' : status === 'warn' ? 'text-ink-soft' : 'text-danger-text';
	}
	function statusLabel(status: ComponentStatus): string {
		return status === 'ok' ? 'OK' : status === 'warn' ? 'Attention' : 'Down';
	}

	$: overviewTiles = systemOverview
		? [
			{ label: 'Families', value: String(systemOverview.rollup.activeFamilies), hint: systemOverview.rollup.orphanedFamilies > 0 ? `${systemOverview.rollup.orphanedFamilies} retained · no accounts` : 'all with accounts' },
			{ label: 'Accounts', value: String(systemOverview.rollup.accounts), hint: `${systemOverview.rollup.platformAdmins} platform admin${systemOverview.rollup.platformAdmins === 1 ? '' : 's'}` },
			{ label: 'Family databases', value: String(systemOverview.rollup.familyDbFiles), hint: formatBytes(systemOverview.rollup.familyDbBytes) },
			{ label: 'Registry size', value: formatBytes(systemOverview.rollup.registryBytes), hint: 'control plane' },
			{ label: 'Attachments', value: systemOverview.rollup.attachmentFiles.toLocaleString(), hint: formatBytes(systemOverview.rollup.attachmentBytes) },
			{ label: 'Disk free', value: formatBytes(systemOverview.rollup.diskFreeBytes), hint: systemOverview.rollup.diskTotalBytes ? `of ${formatBytes(systemOverview.rollup.diskTotalBytes)}` : 'data volume' },
			{ label: 'Uptime', value: formatDuration(systemOverview.instance.uptimeSeconds), hint: `PID ${systemOverview.instance.pid}` },
			{ label: 'Memory (RSS)', value: formatBytes(systemOverview.instance.memoryRssBytes), hint: `heap ${formatBytes(systemOverview.instance.memoryHeapUsedBytes)}` },
		]
		: [];

	async function loadSystemOverview() {
		if (!isPanelAdmin) return;
		loadingOverview = true;
		overviewError = '';
		try {
			const res = await settingsAPI.overview();
			systemOverview = res.data.overview;
		} catch (err: any) {
			systemOverview = null;
			overviewError = err.response?.data?.error || 'Could not load system status.';
		} finally {
			loadingOverview = false;
		}
	}

	// Read-only registry view for the Admin tab.
	let registryView: RegistryView | null = null;
	let loadingRegistry = false;
	let registryError = '';

	// A family with no routed accounts is a namespace that was retained when its
	// last account joined another family. It is not a live family, so it is
	// counted and shown separately rather than inflating the family list.
	$: registryActiveFamilies = registryView ? registryView.families.filter((f) => f.accountCount > 0).length : 0;
	$: registryRetainedFamilies = registryView ? registryView.families.length - registryActiveFamilies : 0;

	function fmtDate(iso: string): string {
		if (!iso) return '—';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso;
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	async function loadRegistry() {
		if (!isPanelAdmin) return;
		loadingRegistry = true;
		registryError = '';
		try {
			const res = await settingsAPI.registry();
			registryView = res.data.registry;
		} catch (err: any) {
			registryView = null;
			registryError = err.response?.data?.error || 'Could not load the registry.';
		} finally {
			loadingRegistry = false;
		}
	}

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
		fail('');
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
			notify('Settings saved.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to save settings.');
		} finally {
			savingSettings = false;
		}
	}

	async function testSmtp() {
		testingSmtp = true;
		fail('');
		try {
			const res = await settingsAPI.test();
			notify(res.data.message || 'Test email sent.');
		} catch (err: any) {
			fail(err.response?.data?.error || 'Test failed.');
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
			fail('Choose a Nido backup file first.');
			return;
		}
		if (!confirm('Restore this backup into your family? Existing members are matched by name and skipped; records will be re-added.')) return;
		restoring = true;
		try {
			const text = await backupFile.text();
			const json = JSON.parse(text);
			const res = await familyAdminAPI.restore(activeFamilyId, json);
			notify(`${res.data.message}. Members added: ${res.data.membersAdded}.`);
			backupFile = null;
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || (err instanceof SyntaxError ? 'Not a valid JSON backup file.' : 'Restore failed.'));
		} finally {
			restoring = false;
		}
	}

	async function deleteFamily() {
		if (!activeFamilyId) return;
		if (!confirm(`Delete "${activeFamily?.name}" and ALL of its data? This cannot be undone.`)) return;
		try {
			await familyAdminAPI.remove(activeFamilyId);
			notify('Family deleted.');
			await loadFamilies();
		} catch (err: any) { fail(err.response?.data?.error || 'Failed to delete family.'); }
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
				if (isPanelAdmin) await Promise.all([loadAppSettings(), loadSystemOverview(), loadRegistry()]);
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
								<button type="button" on:click={() => { settingsTab = 'admin'; loadSystemOverview(); loadRegistry(); }} class="w-full flex items-center justify-between px-4 py-3 min-h-[44px] hover:bg-surface2 transition-colors text-left">
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
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
								<div class="flex items-start justify-between gap-3 mb-4">
									<div>
										<h3 class="text-lg font-display font-semibold">System status</h3>
										<p class="text-ink-soft text-sm">Roll-up of this instance: accounts, storage, and the health of each component.</p>
									</div>
									<button type="button" on:click={loadSystemOverview} disabled={loadingOverview} class="bg-surface2 text-ink-soft px-3 py-2 rounded-md hover:text-ink disabled:opacity-50 text-sm min-h-[36px] shrink-0">
										{loadingOverview ? 'Refreshing…' : 'Refresh'}
									</button>
								</div>

								{#if overviewError}
									<div class="bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm">{overviewError}</div>
								{:else if !systemOverview}
									<p class="text-ink-soft text-sm">Loading system status…</p>
								{:else}
									<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mb-5" data-testid="admin-stats">
										{#each overviewTiles as tile (tile.label)}
											<div class="rounded-lg border border-line-soft bg-surface px-3 py-2.5">
												<p class="text-xs text-ink-soft leading-tight">{tile.label}</p>
												<p class="text-2xl font-display font-semibold text-ink leading-tight mt-0.5">{tile.value}</p>
												<p class="text-[11px] text-ink-soft leading-tight mt-0.5">{tile.hint}</p>
											</div>
										{/each}
									</div>

									<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Components</h4>
									<div class="flex flex-col divide-y divide-line-soft border border-line-soft rounded-lg overflow-hidden">
										{#each systemOverview.components as cmp (cmp.key)}
											<div class="p-3 flex flex-col gap-2">
												<div class="flex items-start gap-2">
													<span class="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 {statusDot(cmp.status)}" aria-hidden="true"></span>
													<div class="flex-1 min-w-0">
														<div class="flex flex-wrap items-baseline gap-x-2">
															<span class="font-medium text-ink">{cmp.name}</span>
															<span class="text-xs font-semibold {statusText(cmp.status)}">{statusLabel(cmp.status)}</span>
														</div>
														<p class="text-sm text-ink-soft break-words">{cmp.summary}</p>
													</div>
												</div>
												{#if cmp.usagePct !== null}
													<div class="h-1.5 rounded-full bg-surface2 overflow-hidden ml-[18px]" aria-hidden="true">
														<div class="h-full {statusDot(cmp.status)}" style={`width: ${Math.min(100, Math.max(0, cmp.usagePct))}%`}></div>
													</div>
												{/if}
												<div class="flex flex-wrap gap-x-4 gap-y-1 ml-[18px]">
													{#each cmp.metrics as m (m.label)}
														<span class="text-xs text-ink-soft">{m.label}: <span class="text-ink">{m.value}</span></span>
													{/each}
												</div>
											</div>
										{/each}
									</div>

									<p class="text-[11px] text-ink-soft mt-3 break-words">
										Node {systemOverview.instance.node} · {systemOverview.instance.platform} · host {systemOverview.instance.hostname} · PID {systemOverview.instance.pid} · data {systemOverview.instance.dataDir}
									</p>
								{/if}
							</div>

							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft mb-4">
								<div class="flex items-start justify-between gap-3 mb-4">
									<div>
										<h3 class="text-lg font-display font-semibold">Registry</h3>
										<p class="text-ink-soft text-sm">Read-only rows of the instance control plane: families, accounts, settings, scheduler leases. Secrets and reset tokens are never shown.</p>
									</div>
									<button type="button" on:click={loadRegistry} disabled={loadingRegistry} class="bg-surface2 text-ink-soft px-3 py-2 rounded-md hover:text-ink disabled:opacity-50 text-sm min-h-[36px] shrink-0">
										{loadingRegistry ? 'Refreshing…' : 'Refresh'}
									</button>
								</div>

								{#if registryError}
									<div class="bg-danger border border-danger text-danger-text px-3 py-2 rounded-md text-sm">{registryError}</div>
								{:else if !registryView}
									<p class="text-ink-soft text-sm">Loading registry…</p>
								{:else}
									<div class="space-y-5">
										<section>
											<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Instance settings</h4>
											<div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 rounded-lg border border-line-soft p-3 text-sm">
												<div><span class="text-ink-soft text-xs block">Sign-up</span><span class="text-ink">{registryView.settings.signupEnabled ? 'Open' : 'Closed'}{registryView.settings.signupEnvLocked ? ' (env-locked)' : ''}</span></div>
												<div><span class="text-ink-soft text-xs block">Email verification</span><span class="text-ink">{registryView.settings.emailVerification ? 'Required' : 'Off'}</span></div>
												<div><span class="text-ink-soft text-xs block">SMTP</span><span class="text-ink">{registryView.settings.smtpConfigured ? `${registryView.settings.smtpHost}:${registryView.settings.smtpPort}` : 'Not configured'}</span></div>
												<div><span class="text-ink-soft text-xs block">From</span><span class="text-ink break-words">{registryView.settings.smtpFrom || 'default'}</span></div>
												<div><span class="text-ink-soft text-xs block">SMTP credentials</span><span class="text-ink">user {registryView.settings.smtpUserSet ? 'set' : 'unset'} · password {registryView.settings.smtpPassSet ? 'set' : 'unset'}</span></div>
												<div><span class="text-ink-soft text-xs block">Updated</span><span class="text-ink">{fmtDate(registryView.settings.updatedAt)}</span></div>
											</div>
										</section>

										<section>
											<div class="flex flex-wrap items-baseline gap-x-2">
												<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider">Families ({registryActiveFamilies})</h4>
												{#if registryRetainedFamilies > 0}
													<span class="text-[11px] text-ink-soft">+ {registryRetainedFamilies} retained without accounts</span>
												{/if}
											</div>
											{#if registryRetainedFamilies > 0}
												<p class="text-xs text-ink-soft mt-1 mb-2">
													A retained family has no accounts left — the account that owned it joined another family, and its data was kept rather than deleted. Retained families are excluded from the family count and skipped by the notification scheduler.
												</p>
											{/if}
											{#if registryView.families.length === 0}
												<p class="text-ink-soft text-sm">No families provisioned yet.</p>
											{:else}
												<div class="overflow-x-auto rounded-lg border border-line-soft">
													<table class="w-full text-sm min-w-[560px]">
														<thead>
															<tr class="text-left text-xs text-ink-soft bg-surface2">
																<th class="px-3 py-2 font-semibold">Family</th>
																<th class="px-3 py-2 font-semibold">Name</th>
																<th class="px-3 py-2 font-semibold">Code</th>
																<th class="px-3 py-2 font-semibold">Accounts</th>
																<th class="px-3 py-2 font-semibold">Created</th>
															</tr>
														</thead>
														<tbody>
															{#each registryView.families as fam (fam.familyId)}
															<tr class="border-t border-line-soft">
																<td class="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">{fam.familyId}</td>
																<td class="px-3 py-2 text-ink whitespace-nowrap">{fam.name}</td>
																<td class="px-3 py-2 font-mono text-xs text-ink-soft whitespace-nowrap">{fam.familyCode || '—'}</td>
																<td class="px-3 py-2 whitespace-nowrap">
																	{#if fam.accountCount > 0}
																		<span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-ok-text" aria-hidden="true"></span><span class="text-ink">{fam.accountCount}</span></span>
																	{:else}
																		<span class="inline-flex items-center rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-ink-soft">none · retained</span>
																	{/if}
																</td>
																<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(fam.createdAt)}</td>
															</tr>
															{/each}
														</tbody>
													</table>
												</div>
											{/if}
										</section>

										<section>
											<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Accounts ({registryView.users.length})</h4>
											{#if registryView.users.length === 0}
												<p class="text-ink-soft text-sm">No accounts yet.</p>
											{:else}
												<div class="overflow-x-auto rounded-lg border border-line-soft">
													<table class="w-full text-sm min-w-[560px]">
														<thead>
															<tr class="text-left text-xs text-ink-soft bg-surface2">
																<th class="px-3 py-2 font-semibold">Email</th>
																<th class="px-3 py-2 font-semibold">Role</th>
																<th class="px-3 py-2 font-semibold">Admin</th>
																<th class="px-3 py-2 font-semibold">Family</th>
																<th class="px-3 py-2 font-semibold">Created</th>
															</tr>
														</thead>
														<tbody>
															{#each registryView.users as usr (usr.userId + usr.familyId)}
															<tr class="border-t border-line-soft">
																<td class="px-3 py-2 text-ink whitespace-nowrap">{usr.email}</td>
																<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{usr.role}</td>
																<td class="px-3 py-2 whitespace-nowrap">{#if usr.isPlatformAdmin}<span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-ok-text" aria-hidden="true"></span><span class="text-ink">platform admin</span></span>{:else}<span class="text-ink-soft">—</span>{/if}</td>
																<td class="px-3 py-2 font-mono text-xs text-ink-soft whitespace-nowrap">{usr.familyId}</td>
																<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(usr.createdAt)}</td>
															</tr>
															{/each}
														</tbody>
													</table>
												</div>
											{/if}
										</section>

										{#if registryView.leases.length > 0}
										<section>
											<h4 class="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Scheduler leases ({registryView.leases.length})</h4>
											<div class="overflow-x-auto rounded-lg border border-line-soft">
												<table class="w-full text-sm min-w-[480px]">
													<thead>
														<tr class="text-left text-xs text-ink-soft bg-surface2">
															<th class="px-3 py-2 font-semibold">Job</th>
															<th class="px-3 py-2 font-semibold">Holder</th>
															<th class="px-3 py-2 font-semibold">Acquired</th>
															<th class="px-3 py-2 font-semibold">Expires</th>
														</tr>
													</thead>
													<tbody>
														{#each registryView.leases as lease (lease.name)}
														<tr class="border-t border-line-soft">
															<td class="px-3 py-2 font-mono text-xs text-ink whitespace-nowrap">{lease.name}</td>
															<td class="px-3 py-2 font-mono text-xs text-ink-soft whitespace-nowrap">{lease.holder}</td>
															<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(lease.acquiredAt)}</td>
															<td class="px-3 py-2 text-ink-soft whitespace-nowrap">{fmtDate(lease.expiresAt)}</td>
														</tr>
														{/each}
													</tbody>
												</table>
											</div>
										</section>
										{/if}
									</div>
								{/if}
							</div>

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
