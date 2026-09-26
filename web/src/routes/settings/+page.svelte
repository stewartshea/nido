<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authAPI, userAPI, babyAPI, familiesAPI, feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, importsAPI, photosAPI, formulasAPI, familyAdminAPI, accountAPI, milestoneAPI, vaccinationAPI, settingsAPI, moodAPI, journalAPI, tokenExpired, remindersAPI } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import PhotoStrip from '$lib/components/PhotoStrip.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { CATEGORIES } from '$lib/shared';
	import { Milk, Baby, Moon, TrendingUp, Calendar, Star, Trophy, Stethoscope, Syringe, Smile, Book, Users, Home, Trash2, Mail, Timer, PenLine, ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Plus, Camera, Droplet, AlertCircle, Activity, ChevronDown, Settings, Check , ChevronRight, User, Database, Shield, Upload, Download} from 'lucide-svelte';


	let familyView: 'dashboard' | 'detail' = 'dashboard';

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
	let regEmail = '';
	let regPassword = '';
	let regFirstName = '';
	let regLastName = '';
	let showForgot = false;
	let resetEmail = '';
	let resetRequestSent = false;
	let pendingResetToken = '';
	let resetNewPassword = '';
	let resetDone = false;
	// Per-user mobile quick links (category ids), persisted in localStorage.
	let quickLinks: string[] = [];
	const QUICK_LINK_DEFAULT = ['feeds', 'diapers', 'sleep'];

	function quickLinksKey(userId: number | null) {
		return `nido.quicklinks.${userId ?? $authStore.user?.id}`;
	}

	function loadQuickLinks() {
		const key = quickLinksKey($authStore.user?.id ?? null);
		try {
			const raw = localStorage.getItem(key);
			const parsed = raw ? JSON.parse(raw) : null;
			if (Array.isArray(parsed) && parsed.length > 0) quickLinks = parsed;
			else quickLinks = [...QUICK_LINK_DEFAULT];
		} catch {
			quickLinks = [...QUICK_LINK_DEFAULT];
		}
	}

	function saveQuickLinks(next: string[]) {
		quickLinks = next;
		try {
			localStorage.setItem(quickLinksKey($authStore.user?.id ?? null), JSON.stringify(next));
		} catch {}
	}

	function toggleQuickLink(catId: string) {
		const next = quickLinks.includes(catId)
			? quickLinks.filter((c) => c !== catId)
			: [...quickLinks, catId];
		saveQuickLinks(next);
		notice = 'Mobile quick links updated.';
	}

	async function completeReset(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			await authAPI.resetPassword(pendingResetToken, resetNewPassword);
			resetDone = true;
			pendingResetToken = '';
			resetNewPassword = '';
			notice = 'Password updated — you can now sign in.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to reset password.';
		}
	}
	let loading = false;

	let babies: any[] = [];
	let families: any[] = [];
	let activeFamily: any = null;
	let activeFamilyId: string | null = null;
	let selectedBabyId: number | null = null;
	let activeTab = 'feeds';
	let viewMode: 'list' | 'table' = 'list';
	let defaultProfileId: number | null = null;
	let summary: any = null;

	// ----- Reminders (server-backed, family-scoped) -----
	type ReminderRule = { id: number; kind: 'inactivity' | 'interval'; category: string; targetType: 'member' | 'home'; targetId: number | null; label: string | null; hours: number | null; intervalDays: number | null; overdue: boolean; since: string | null; enabled: boolean };
	let reminderRules: ReminderRule[] = [];

	async function loadReminders() {
		try {
			const res = await remindersAPI.list();
			reminderRules = res.data.reminders ?? [];
		} catch { reminderRules = []; }
	}

	async function addReminder(category: string, kind: 'inactivity' | 'interval', hours: number, label?: string) {
		if (kind === 'inactivity' && hours <= 0) return;
		if (kind === 'interval' && !label) return;
		try {
			await remindersAPI.create({
				kind,
				category: kind === 'inactivity' ? category : undefined,
				label: kind === 'interval' ? label : undefined,
				hours: kind === 'inactivity' ? hours : undefined,
				intervalDays: kind === 'interval' ? hours : undefined,
			});
			await loadReminders();
			notice = 'Reminder added.';
		} catch (err: any) { error = err.response?.data?.error || 'Failed to add reminder.'; }
	}

	async function removeReminder(id: number) {
		try {
			await remindersAPI.remove(id);
			await loadReminders();
			notice = 'Reminder removed.';
		} catch (err: any) { error = err.response?.data?.error || 'Failed to remove reminder.'; }
	}

	$: overdueReminders = reminderRules.filter((r) => r.enabled && r.overdue);

	function reminderFieldValue(sel: string, fallback: string): string {
		const el = document.querySelector(sel);
		if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) return el.value || fallback;
		return fallback;
	}

	function reminderFieldType(sel: string): 'inactivity' | 'interval' {
		const el = document.querySelector(sel);
		if (el instanceof HTMLSelectElement && el.value === 'interval') return 'interval';
		return 'inactivity';
	}

	// Tracking categories now live in $lib/shared.ts (single source of truth).
	// Categories enabled for the selected member.
	let activeCategories: string[] = [];

	// Family-scoped tracking settings (categories + per-category option lists).
	let settingsTab: 'profile' | 'family' | 'import' | 'members' | 'backup' | 'admin' | null = null;
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>>; shareAnonymizedDaily?: boolean } | null = null;
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
	let newMemberName = '';
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
	let showAddFormula = false;
	let newFormulaName = '';
	let newFormulaBrand = '';
	// Manual feed entry (backdated) + repeat-last
	let manualStart = '';
	let manualEnd = '';
	let manualType = 'breast';
	let manualSide = 'left';
	let manualFormulaId: number | null = null;
	let manualAmount = '';
	let manualNotes = '';
	// Diaper detail form
	let diaperTime = '';
	let diaperType = 'wet';
	let diaperConsistency = '';
	let diaperColor = '';
	let diaperNotes = '';
	let savingDiaper = false;
	// Sleep + growth backdated
	let sleepTime = '';
	let growthTime = '';
	// Milestone + vaccine manual forms
	let milestoneTitle = '';
	let milestoneTime = '';
	let milestoneCategory = '';
	let vaccineName = '';
	let vaccineTime = '';
	let vaccineNotes = '';
	let moodMood = 'happy';
	let moodTime = '';
	let moodNotes = '';
	let journalTitle = '';
	let journalBody = '';
	let journalTime = '';
	// Photos (toggle state only — the PhotoStrip component handles loading)
	let photoOpen: Record<string, boolean> = {};
	// Account
	let showAccountPanel = false;
	let curPw = '';
	let newPw = '';
	let confirmPw = '';
	let changingPw = false;

	let feedStartedAt: number | null = null;
	let feedElapsed = 0;
	let leftStartedAt: number | null = null;
	let leftElapsed = 0;
	let rightStartedAt: number | null = null;
	let rightElapsed = 0;
	let feedType = 'breast';
	let feedSide = 'left';
	let feedAmount = '';
	let feedNotes = '';
	let feedMode: 'timer' | 'log' = 'timer';

	let sleepStartedAt: number | null = null;
	let sleepElapsed = 0;
	let sleepLocation = 'crib';
	let sleepNotes = '';
	let sleepMode: 'timer' | 'log' = 'timer';

	let growthWeight = '';
	let growthHeight = '';
	let growthHead = '';
	let growthUnit = 'metric';

	let feedings: any[] = [];
	let diapers: any[] = [];
	let sleeps: any[] = [];
	let growths: any[] = [];
	let milestones: any[] = [];
	let vaccinations: any[] = [];
	let moods: any[] = [];
	let journalEntries: any[] = [];

	// Breast-feeding totals + last side, derived from loaded feedings.
	$: breastFeedings = feedings.filter((f) => f.type === 'breast' || f.type === 'bottle');
	$: lastBreastSide = (() => {
		for (const f of [...breastFeedings].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())) {
			if (f.side === 'left' || f.side === 'right') return f.side;
		}
		return null;
	})();
	$: leftBreastTotal = breastFeedings.filter((f) => f.side === 'left').reduce((s, f) => s + (f.duration || 0), 0);
	$: rightBreastTotal = breastFeedings.filter((f) => f.side === 'right').reduce((s, f) => s + (f.duration || 0), 0);

	let timerTick: any = null;

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

	function formatElapsed(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		return `${h > 0 ? h + 'h ' : ''}${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
	}

	function formatMinutes(totalMs: number): string {
		const m = Math.round(totalMs / 60000);
		if (m < 60) return `${m}m`;
		const h = Math.floor(m / 60);
		const rm = m % 60;
		return rm ? `${h}h ${rm}m` : `${h}h`;
	}

	function formatTime(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	function toLocalInput(iso: string | null | undefined): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	function startTimerLoop() {
		stopTimerLoop();
		timerTick = window.setInterval(() => {
			const now = Date.now();
			if (leftStartedAt) leftElapsed = now - leftStartedAt;
			if (rightStartedAt) rightElapsed = now - rightStartedAt;
			if (sleepStartedAt) sleepElapsed = now - sleepStartedAt;
		}, 1000);
	}

	function stopTimerLoop() {
		if (timerTick) {
			window.clearInterval(timerTick);
			timerTick = null;
		}
	}

	async function refreshSummary() {
		if (!selectedBabyId) return;
		try {
			const res = await healthAPI.getSummary(selectedBabyId);
			summary = res.data.summary;
		} catch {
			summary = null;
		}
	}

	async function refreshLists() {
		if (!selectedBabyId) return;
		try {
			const [f, d, s, g, m, v, mo, j] = await Promise.all([
				feedingAPI.getAll(selectedBabyId),
				diaperAPI.getAll(selectedBabyId),
				sleepAPI.getAll(selectedBabyId),
				growthAPI.getAll(selectedBabyId),
				milestoneAPI.getAll(selectedBabyId),
				vaccinationAPI.getAll(selectedBabyId),
				moodAPI.getAll(selectedBabyId),
				journalAPI.getAll(selectedBabyId),
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

	function recordsForTab(): any[] {
		switch (activeTab) {
			case 'feeds': return feedings;
			case 'diapers': return diapers;
			case 'sleep': return sleeps;
			case 'growth': return growths;
			case 'milestones': case 'firsts': case 'routines': case 'medical': return milestones;
			case 'vaccines': return vaccinations;
			case 'moods': return moods;
			case 'journal': return journalEntries;
			case 'pumping': return feedings.filter((f) => f.type === 'pump');
			default: return [];
		}
	}

	async function deleteRecord(type: string, id: number) {
		if (!confirm('Delete this record?')) return;
		try {
			if (type === 'feeding' || type === 'pumping') await feedingAPI.delete(id);
			else if (type === 'diaper') await diaperAPI.delete(id);
			else if (type === 'sleep') await sleepAPI.delete(id);
			else if (type === 'growth') await growthAPI.delete(id);
			else if (type === 'milestone') await milestoneAPI.delete(id);
			else if (type === 'vaccine') await vaccinationAPI.delete(id);
			notice = 'Record deleted.';
			await refreshLists();
			await refreshSummary();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to delete record.';
		}
	}

	// Edit modal state
	let editingRecord: any = null;
	let editType = '';
	let editTime = '';
	let editNote = '';

	function openEdit(type: string, record: any) {
		editType = type;
		editingRecord = record;
		editTime = toLocalInput(record.start_time || record.change_time || record.measurement_date || record.achieved_date || record.date_given);
		editNote = record.notes || '';
		error = '';
	}

	async function saveEdit() {
		if (!editingRecord) return;
		const id = Number(editingRecord.id);
		const time = editTime ? new Date(editTime).toISOString() : undefined;
		try {
			if (editType === 'feeding' || editType === 'pumping') await feedingAPI.update(id, { startTime: time, notes: editNote || undefined });
			else if (editType === 'diaper') await diaperAPI.update(id, { changeTime: time, notes: editNote || undefined });
			else if (editType === 'sleep') await sleepAPI.update(id, { startTime: time, notes: editNote || undefined });
			else if (editType === 'growth') await growthAPI.update(id, { measurementDate: time, notes: editNote || undefined });
			else if (editType === 'milestone') await milestoneAPI.update(id, { achievedDate: time });
			else if (editType === 'vaccine') await vaccinationAPI.update(id, { dateGiven: time, notes: editNote || undefined });
			editingRecord = null;
			notice = 'Record updated.';
			await refreshLists();
			await refreshSummary();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update record.';
		}
	}

	async function loadFamilies() {
		try {
			const res = await familiesAPI.list();
			families = res.data.families;
			if (families.length === 0) {
				selectedBabyId = null;
				babies = [];
				return;
			}
			// Prefer the saved default family, else the first.
			const savedFamily = localStorage.getItem('nido.familyId');
			activeFamily = families.find((f) => f.familyId === savedFamily) ?? families[0];
			activeFamilyId = activeFamily.familyId;

			const membersRes = await familiesAPI.members(activeFamilyId);
			const members = membersRes.data.members;
			// Members are the profiles the tracker operates on (child/adult; "newborn"
			// is a child with newborn categories enabled).
			babies = members.map((m) => ({
				id: m.id,
				name: m.name,
				birth_date: m.birthDate ?? '',
				gender: m.gender ?? '',
				type: m.type ?? 'child',
				email: m.email ?? null,
				avatar: m.avatar ?? null,
				categories: Array.isArray(m.categories) ? m.categories : [],
			}));

			if (babies.length > 0) {
				const savedDefault = defaultProfileId ?? null;
				const match = savedDefault ? babies.find((b) => Number(b.id) === savedDefault) : null;
				selectedBabyId = match ? Number(match.id) : Number(babies[0].id);
				const selected = babies.find((b) => Number(b.id) === selectedBabyId);
				activeCategories = selected?.categories?.length ? selected.categories : CATEGORIES.map((c) => c.id);
				if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
				restoreTimerState();
			} else {
				selectedBabyId = null;
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

	function setActiveFamily(familyId: string) {
		activeFamilyId = familyId;
		if (browser) localStorage.setItem('nido.familyId', familyId);
		loadFamilies();
	}

	function setDefaultProfile(babyId: number) {
		defaultProfileId = babyId;
		selectedBabyId = babyId;
		if (browser) localStorage.setItem('nido.defaultProfile', String(babyId));
		notice = 'Default profile updated.';
		error = '';
	}

	async function handleLogin(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;
		try {
			const res = await authAPI.login({ email, password });
			const { token, user } = res.data;
			authActions.login(token, {
				id: user.id,
				email: user.email,
				firstName: user.first_name ?? user.firstName,
				lastName: user.last_name ?? user.lastName,
				createdAt: user.created_at ?? user.createdAt,
			});
			isAuthenticated = true;
			email = '';
			password = '';
			await loadFamilies();
			await refreshUserProfile();
			if (isPanelAdmin) await loadAppSettings();
		} catch (err: any) {
			error = err.response?.data?.error || 'Login failed. Check your credentials.';
		} finally {
			loading = false;
		}
	}

	async function handleRegister(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		loading = true;
		if (!regFirstName || !regLastName) {
			error = 'First and last name are required.';
			loading = false;
			return;
		}
		try {
			const res = await authAPI.register({
				email: regEmail,
				password: regPassword,
				firstName: regFirstName,
				lastName: regLastName,
			});
			const { token, user, requiresEmailVerification } = res.data;
			if (requiresEmailVerification) {
				notice = res.data.message || 'Check your email to verify your account.';
				regEmail = '';
				regPassword = '';
				regFirstName = '';
				regLastName = '';
				return;
			}
			authActions.login(token, {
				id: user.id,
				email: user.email,
				firstName: user.first_name ?? user.firstName,
				lastName: user.last_name ?? user.lastName,
				createdAt: user.created_at ?? user.createdAt,
			});
			isAuthenticated = true;
			regEmail = '';
			regPassword = '';
			regFirstName = '';
			regLastName = '';
			await loadFamilies();
			await refreshUserProfile();
			if (isPanelAdmin) await loadAppSettings();
		} catch (err: any) {
			error = err.response?.data?.error || 'Registration failed.';
		} finally {
			loading = false;
		}
	}

	async function sendResetRequest(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			await authAPI.forgotPassword(resetEmail);
			resetRequestSent = true;
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to send reset link.';
		}
	}

	function handleLogout() {
		stopTimerLoop();
		authActions.logout();
		isAuthenticated = false;
		babies = [];
		selectedBabyId = null;
		feedStartedAt = null;
		leftStartedAt = null;
		rightStartedAt = null;
		leftElapsed = 0;
		rightElapsed = 0;
		feedElapsed = 0;
		sleepStartedAt = null;
	}

	async function buildFamily(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!familyName.trim()) {
			error = 'Give your family a name (e.g. "The Hollybrooks").';
			return;
		}
		creatingBaby = true;
		try {
			const payload: any = { name: familyName.trim() };
			if (newMemberName) {
				payload.member = {
					type: memberType,
					name: newMemberName.trim(),
					birthDate: newBabyBirthDate ? new Date(newBabyBirthDate).toISOString() : undefined,
					gender: newBabyGender,
				};
			}
			const res = await familiesAPI.create(payload);
			const fam = res.data.family;
			notice = `${fam.name} created — your family code is ${fam.familyCode}`;
			familyName = '';
			newMemberName = '';
			newBabyBirthDate = '';
			if (browser) localStorage.setItem('nido.familyId', fam.familyId);
			await loadFamilies();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to create your family.';
			console.error(err);
		} finally {
			creatingBaby = false;
		}
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
			});
			notice = `${res.data.member.name} added to the family.`;
			newMemberName = '';
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

	async function loadFormulas() {
		if (!activeFamilyId) { formulas = []; return; }
		try {
			const res = await formulasAPI.list(activeFamilyId);
			formulas = res.data.formulas || [];
		} catch { formulas = []; }
	}

	async function addFormula() {
		if (!newFormulaName.trim() || !activeFamilyId) return;
		try {
			await formulasAPI.create(activeFamilyId, { name: newFormulaName.trim(), brand: newFormulaBrand.trim() || undefined });
			newFormulaName = ''; newFormulaBrand = '';
			await loadFormulas();
		} catch (e: any) { error = e.response?.data?.error || 'Failed to add formula.'; }
	}

	function nowLocalISO(): string {
		// datetime-local friendly: YYYY-MM-DDTHH:mm
		const d = new Date();
		const p = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
	}

	function setFeedMode(mode: 'timer' | 'log') {
		feedMode = mode;
		if (mode === 'log' && !manualStart) manualStart = nowLocalISO();
	}

	function setSleepMode(mode: 'timer' | 'log') {
		sleepMode = mode;
		if (mode === 'log' && !sleepTime) sleepTime = nowLocalISO();
	}

	function repeatLastFeed() {
		const last = localStorage.getItem('nido.lastFeed');
		if (!last) { error = 'No previous feed to repeat.'; return; }
		const l = JSON.parse(last);
		manualType = l.type || 'breast';
		manualSide = l.side === 'right' ? 'right' : 'left';
		manualFormulaId = l.formulaId ?? null;
		manualAmount = l.amount ?? '';
		error = '';
	}

	async function saveManualFeed(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		if (!manualStart) manualStart = nowLocalISO();
		error = '';
		const start = manualStart ? new Date(manualStart).toISOString() : new Date().toISOString();
		const end = manualEnd ? new Date(manualEnd).toISOString() : undefined;
		try {
			await feedingAPI.create({
				babyId: selectedBabyId,
				startTime: start,
				endTime: end,
				type: manualType as any,
				side: manualType === 'breast' ? (manualSide as any) : undefined,
				formulaId: manualType === 'formula' ? manualFormulaId : undefined,
				amount: manualAmount ? Number(manualAmount) : undefined,
				notes: manualNotes || undefined,
			});
			// Remember for "repeat last"
			localStorage.setItem('nido.lastFeed', JSON.stringify({ type: manualType, side: manualType === 'breast' ? manualSide : undefined, formulaId: manualFormulaId, amount: manualAmount }));
			manualStart = ''; manualEnd = ''; manualAmount = ''; manualNotes = '';
			notice = 'Feed recorded.';
			await refreshLists(); await refreshSummary();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to record feed.'; console.error(err); }
	}

	async function saveDiaperManual(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		savingDiaper = true;
		const time = diaperTime ? new Date(diaperTime).toISOString() : new Date().toISOString();
		try {
			await diaperAPI.create({
				babyId: selectedBabyId,
				changeTime: time,
				type: diaperType as any,
				consistency: diaperConsistency || undefined,
				color: diaperColor || undefined,
				notes: diaperNotes || undefined,
			});
			diaperTime = ''; diaperConsistency = ''; diaperColor = ''; diaperNotes = '';
			notice = 'Diaper saved.';
			await refreshLists(); await refreshSummary();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to save diaper.'; console.error(err); }
		finally { savingDiaper = false; }
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
			loadQuickLinks();
			loadReminders();
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

	async function selectBaby(babyId: number) {
		selectedBabyId = babyId;
		const selected = babies.find((b) => Number(b.id) === babyId);
		activeCategories = selected?.categories?.length ? selected.categories : CATEGORIES.map((c) => c.id);
		if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
		restoreTimerState();
		await refreshLists();
		await refreshSummary();
	}

	async function loadFamilySettings() {
		if (!activeFamilyId) return;
		try {
			const res = await familiesAPI.getSettings(activeFamilyId);
			familySettings = res.data.settings;
			anonymizedPreview = res.data.anonymizedPreview ?? anonymizedPreview;
			const cats = familySettings.categories;
			if (cats && cats.length) {
				activeCategories = cats;
			}
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

	async function toggleFamilyCategory(catId: string) {
		if (!activeFamilyId) return;
		const next = activeCategories.includes(catId)
			? activeCategories.filter((c) => c !== catId)
			: [...activeCategories, catId];
		activeCategories = next;
		savingFamilySettings = true;
		try {
			await familiesAPI.updateSettings(activeFamilyId, { categories: next });
			if (familySettings) familySettings.categories = next;
			if (!activeCategories.includes(activeTab)) activeTab = activeCategories[0] || 'feeds';
			notice = 'Tracking categories updated.';
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to update categories.';
		} finally {
			savingFamilySettings = false;
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

	function togglePhoto(key: string) {
		photoOpen[key] = !photoOpen[key];
	}

	// Live per-side elapsed (ms) = frozen total + live running time.
	$: leftTotalMs = leftElapsed + (leftStartedAt ? Date.now() - leftStartedAt : 0);
	$: rightTotalMs = rightElapsed + (rightStartedAt ? Date.now() - rightStartedAt : 0);
	$: feedTotalMs = leftTotalMs + rightTotalMs;
	$: anyBreastRunning = !!(leftStartedAt || rightStartedAt);

	// ----- Connection-resilience: persisted timers + offline outbox -----
	// Timer state is written to localStorage on every mutation so a reload or a
	// dropped connection mid-session does not lose accumulated time. The outbox
	// queues records that fail to reach the API (offline/5xx) and retries later.
	function timerKey(): string {
		return `nido.timer.${selectedBabyId ?? 0}`;
	}

	function persistTimerState() {
		if (!selectedBabyId) return;
		try {
			localStorage.setItem(timerKey(), JSON.stringify({
				leftElapsed, rightElapsed,
				leftStartedAt, rightStartedAt,
				sleepElapsed, sleepStartedAt,
			}));
		} catch {}
	}

	function clearTimerState() {
		try { localStorage.removeItem(timerKey()); } catch {}
	}

	function restoreTimerState() {
		try {
			const raw = localStorage.getItem(timerKey());
			if (!raw) return;
			const s = JSON.parse(raw);
			leftElapsed = Number(s.leftElapsed || 0);
			rightElapsed = Number(s.rightElapsed || 0);
			leftStartedAt = s.leftStartedAt ? Number(s.leftStartedAt) : null;
			rightStartedAt = s.rightStartedAt ? Number(s.rightStartedAt) : null;
			sleepElapsed = Number(s.sleepElapsed || 0);
			sleepStartedAt = s.sleepStartedAt ? Number(s.sleepStartedAt) : null;
			// Auto-pause a timer whose wall-clock is unreasonably stale (e.g. the
			// device was asleep over an hour) so it does not accumulate forever.
			const now = Date.now();
			if (leftStartedAt && now - leftStartedAt > 60 * 60 * 1000) leftStartedAt = null;
			if (rightStartedAt && now - rightStartedAt > 60 * 60 * 1000) rightStartedAt = null;
			if (sleepStartedAt && now - sleepStartedAt > 60 * 60 * 1000) sleepStartedAt = null;
		} catch {}
		if (leftStartedAt || rightStartedAt || sleepStartedAt) startTimerLoop();
	}

	function enqueueRecord(kind: 'feeding' | 'sleep', payload: any) {
		try {
			const key = 'nido.outbox';
			const outbox = JSON.parse(localStorage.getItem(key) || '[]');
			outbox.push({ kind, payload, queuedAt: new Date().toISOString() });
			localStorage.setItem(key, JSON.stringify(outbox.slice(-200)));
		} catch {}
	}

	async function flushOutbox() {
		const key = 'nido.outbox';
		try {
			const outbox = JSON.parse(localStorage.getItem(key) || '[]');
			if (outbox.length === 0) return;
			const remaining: any[] = [];
			let synced = 0;
			for (const item of outbox) {
				try {
					if (item.kind === 'feeding') await feedingAPI.create(item.payload);
					else if (item.kind === 'sleep') await sleepAPI.create(item.payload);
					synced++;
				} catch {
					remaining.push(item);
				}
			}
			localStorage.setItem(key, JSON.stringify(remaining));
			if (synced > 0) {
				notice = `${synced} offline record(s) synced.`;
				await refreshLists();
				await refreshSummary();
			}
		} catch {}
	}

	function toggleSideTimer(side: 'left' | 'right') {
		error = '';
		if (side === 'left') {
			if (leftStartedAt) {
				leftElapsed += Date.now() - leftStartedAt;
				leftStartedAt = null;
			} else {
				leftStartedAt = Date.now();
			}
		} else {
			if (rightStartedAt) {
				rightElapsed += Date.now() - rightStartedAt;
				rightStartedAt = null;
			} else {
				rightStartedAt = Date.now();
			}
		}
		persistTimerState();
		startTimerLoop();
	}

	function anySideHasTime() {
		return leftElapsed > 0 || rightElapsed > 0 || leftStartedAt || rightStartedAt;
	}

	async function saveFeedTimer() {
		if (!anySideHasTime()) return;
		const startTimes: number[] = [];
		if (leftStartedAt) startTimes.push(leftStartedAt);
		if (rightStartedAt) startTimes.push(rightStartedAt);
		const earliest = Math.min(...(startTimes.length ? startTimes : [Date.now() - feedTotalMs]));
		const startTime = new Date(earliest).toISOString();
		const endTime = new Date().toISOString();
		const bothSides = leftElapsed > 0 && rightElapsed > 0;
		const side = bothSides ? 'both' : leftElapsed > 0 || leftStartedAt ? 'left' : 'right';
		// Freeze live timers into totals before computing duration.
		if (leftStartedAt) { leftElapsed += Date.now() - leftStartedAt; leftStartedAt = null; }
		if (rightStartedAt) { rightElapsed += Date.now() - rightStartedAt; rightStartedAt = null; }
		const totalMs = leftElapsed + rightElapsed;
		stopTimerLoop();
		leftElapsed = 0; rightElapsed = 0; feedElapsed = 0; feedStartedAt = null;
		clearTimerState();
		const payload = { babyId: selectedBabyId, startTime, endTime, type: 'breast', side: side as 'left' };
		try {
			await feedingAPI.create(payload);
			notice = 'Feeding recorded.';
			await refreshLists();
			await refreshSummary();
		} catch (err: any) {
			enqueueRecord('feeding', payload);
			notice = 'Feeding saved locally — will sync when connected.';
		}
	}

	function cancelFeed() {
		leftStartedAt = null;
		rightStartedAt = null;
		leftElapsed = 0;
		rightElapsed = 0;
		feedElapsed = 0;
		feedStartedAt = null;
		stopTimerLoop();
		clearTimerState();
	}

	async function startSleep() {
		if (sleepStartedAt) return;
		error = '';
		sleepStartedAt = Date.now();
		sleepElapsed = 0;
		persistTimerState();
		startTimerLoop();
	}

	async function stopSleep() {
		if (!sleepStartedAt) return;
		const endTime = new Date().toISOString();
		const startTime = new Date(sleepStartedAt).toISOString();
		sleepStartedAt = null;
		stopTimerLoop();
		sleepElapsed = 0;
		clearTimerState();
		const payload = { babyId: selectedBabyId, startTime, endTime, location: sleepLocation, notes: sleepNotes || undefined };
		try {
			await sleepAPI.create(payload);
			sleepNotes = '';
			notice = 'Sleep recorded.';
			await refreshLists();
			await refreshSummary();
		} catch (err: any) {
			enqueueRecord('sleep', payload);
			sleepNotes = '';
			notice = 'Sleep saved locally — will sync when connected.';
		}
	}

	function cancelSleep() {
		sleepStartedAt = null;
		sleepElapsed = 0;
		stopTimerLoop();
		clearTimerState();
	}

	async function saveManualSleep(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		const start = sleepTime ? new Date(sleepTime).toISOString() : new Date().toISOString();
		try {
			await sleepAPI.create({ babyId: selectedBabyId, startTime: start, location: sleepLocation, notes: sleepNotes || undefined });
			sleepTime = ''; sleepNotes = '';
			notice = 'Sleep recorded.';
			await refreshLists(); await refreshSummary();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to record sleep.'; console.error(err); }
	}

	async function saveManualGrowth(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		try {
			await growthAPI.create({
				babyId: selectedBabyId,
				measurementDate: growthTime ? new Date(growthTime).toISOString() : new Date().toISOString(),
				weight: growthWeight ? Number(growthWeight) : undefined,
				height: growthHeight ? Number(growthHeight) : undefined,
				headCircumference: growthHead ? Number(growthHead) : undefined,
				unitSystem: growthUnit as 'metric',
			});
			growthTime = ''; growthWeight = ''; growthHeight = ''; growthHead = '';
			notice = 'Growth measurement recorded.';
			await refreshLists(); await refreshSummary();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to save growth measurement.'; console.error(err); }
	}

	async function saveManualMilestone(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		if (!milestoneTitle.trim()) { error = 'Milestone name is required.'; return; }
		try {
			await milestoneAPI.create({
				babyId: selectedBabyId,
				title: milestoneTitle.trim(),
				achievedDate: milestoneTime ? new Date(milestoneTime).toISOString() : new Date().toISOString(),
				category: milestoneCategory || undefined,
			});
			milestoneTitle = ''; milestoneTime = '';
			notice = 'Milestone recorded.';
			await refreshLists();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to record milestone.'; console.error(err); }
	}

	async function saveManualVaccine(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		if (!vaccineName.trim()) { error = 'Vaccine name is required.'; return; }
		try {
			await vaccinationAPI.create({
				babyId: selectedBabyId,
				name: vaccineName.trim(),
				dateGiven: vaccineTime ? new Date(vaccineTime).toISOString() : undefined,
				notes: vaccineNotes || undefined,
			});
			vaccineName = ''; vaccineTime = ''; vaccineNotes = '';
			notice = 'Vaccine recorded.';
			await refreshLists();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to record vaccine.'; console.error(err); }
	}

	async function saveMood(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		try {
			await moodAPI.create({
				babyId: selectedBabyId,
				mood: moodMood,
				recordedAt: moodTime ? new Date(moodTime).toISOString() : undefined,
				notes: moodNotes || undefined,
			});
			moodMood = ''; moodTime = ''; moodNotes = '';
			notice = 'Mood recorded.';
			await refreshLists();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to record mood.'; console.error(err); }
	}

	async function saveJournal(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		error = '';
		if (!journalTitle.trim() && !journalBody.trim()) { error = 'Add a title or a note.'; return; }
		try {
			await journalAPI.create({
				babyId: selectedBabyId,
				title: journalTitle.trim() || undefined,
				body: journalBody.trim() || undefined,
				entryDate: journalTime ? new Date(journalTime).toISOString() : undefined,
			});
			journalTitle = ''; journalBody = ''; journalTime = '';
			notice = 'Journal entry saved.';
			await refreshLists();
		} catch (err: any) { error = err.response?.data?.error || 'Failed to save journal entry.'; console.error(err); }
	}

	async function saveGrowth(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		try {
			await growthAPI.create({
				babyId: selectedBabyId,
				measurementDate: new Date().toISOString(),
				weight: growthWeight ? Number(growthWeight) : undefined,
				height: growthHeight ? Number(growthHeight) : undefined,
				headCircumference: growthHead ? Number(growthHead) : undefined,
				unitSystem: growthUnit as 'metric',
			});
			growthWeight = '';
			growthHeight = '';
			growthHead = '';
			notice = 'Growth measurement recorded.';
			await refreshLists();
			await refreshSummary();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to save growth measurement.';
			console.error(err);
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
				// Reconnect resilience: push anything queued while offline.
				await flushOutbox();
				window.setInterval(() => flushOutbox(), 60 * 1000);
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
										<span class="text-ink font-medium">Family</span>
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
									<h4 class="font-display font-semibold mb-3">Mobile quick links</h4>
									<p class="text-xs text-ink-soft mb-2">Choose which tracking items appear in the bottom quick row on your phone.</p>
									<div class="flex flex-wrap gap-2">
										{#each CATEGORIES as cat}
											<button type="button" on:click={() => toggleQuickLink(cat.id)} class="{quickLinks.includes(cat.id) ? 'bg-accent text-on-accent' : 'bg-surface2 text-ink-soft'} px-3 py-1 rounded-full text-sm border"><svelte:component this={cat.icon} class="w-4 h-4 inline mr-1" /> {cat.label}</button>
										{/each}
									</div>
									<p class="text-xs text-ink-soft mt-2">{quickLinks.length} selected</p>
								</div>
								<div class="border-t border-line-soft pt-4">
									<h4 class="font-display font-semibold mb-3">Reminders</h4>
									<p class="text-xs text-ink-soft mb-2">Get an in-app nudge when something hasn&rsquo;t happened for a while — for baby tracking (&ldquo;no feed in 3h&rdquo;) or future home tasks (&ldquo;change furnace filter every 180 days&rdquo;).</p>
									<div class="flex flex-col gap-3">
										{#each reminderRules as rule}
											<div class="flex items-center justify-between gap-2 bg-surface2 rounded-md px-3 py-2 text-sm">
												<span class="text-ink">
													{#if rule.kind === 'inactivity'}
														no {rule.category === 'pumping' ? 'pump' : rule.category === 'diapers' ? 'change' : rule.category === 'sleep' ? 'sleep' : 'feed'} in {rule.hours}h
													{:else}
														{rule.label || rule.category} — every {rule.intervalDays}d
													{/if}
												</span>
												<button type="button" on:click={() => removeReminder(rule.id)} class="text-xs text-danger-text hover:underline">Remove</button>
											</div>
										{/each}
										<div class="flex flex-wrap items-end gap-2">
											<select id="reminder-kind" class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm">
												<option value="inactivity">Babies: no … in</option>
												<option value="interval">Home/routine: every</option>
											</select>
											<select id="reminder-category" class="px-3 py-2 border border-line rounded-md bg-surface text-ink text-sm">
												<option value="feeds">Feed</option>
												<option value="pumping">Pump</option>
												<option value="diapers">Diaper</option>
												<option value="sleep">Sleep</option>
											</select>
											<input id="reminder-hours" type="number" min="1" value="3" class="w-20 px-2 py-2 border border-line rounded-md bg-surface text-ink text-sm" placeholder="hours/days" />
											<input id="reminder-label" type="text" class="w-40 px-2 py-2 border border-line rounded-md bg-surface text-ink text-sm" placeholder="task label (home)" />
											<button type="button" on:click={() => addReminder(
												reminderFieldValue('#reminder-category', 'feeds'),
												reminderFieldType('#reminder-kind'),
												Number(reminderFieldValue('#reminder-hours', '3')),
												reminderFieldValue('#reminder-label', '') || undefined
											)} class="bg-primary text-on-primary px-3 py-2 rounded-md text-sm">+ Add</button>
										</div>
									</div>
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
								<h3 class="text-lg font-display font-semibold mb-4">Family Settings</h3>
								<div class="mb-5">
									<h4 class="font-display font-semibold text-sm mb-3">Tracked Categories</h4>
									<div class="flex flex-col gap-2">
										{#each CATEGORIES as cat}
											<ToggleSwitch
												checked={activeCategories.includes(cat.id)}
												label={cat.label}
												onToggle={() => toggleFamilyCategory(cat.id)}
											/>
										{/each}
									</div>
								</div>
								{#if familySettings}
									<div class="border-t border-line-soft pt-4">
										<h4 class="font-display font-semibold text-sm mb-2">Category options</h4>
										{#each CATEGORIES.filter((c) => activeCategories.includes(c.id)) as cat}
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
									<h4 class="font-display font-semibold text-sm mb-2">Daily anonymized summary sharing</h4>
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
											<button type="button" on:click={refreshAnonymizedPreview} class="text-xs text-primary underline" disabled={loadingAnonymizedPreview}>{loadingAnonymizedPreview ? 'Refreshing…' : 'Refresh'}</button>
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
								{#if babies.length === 0}
									<p class="text-sm text-ink-soft">No members yet.</p>
								{:else}
									<ul class="divide-y divide-line-soft">
										{#each babies as baby}
											<li class="py-2 flex items-start justify-between gap-3">
												<div>
													<p class="text-sm font-semibold text-ink">{baby.name}</p>
													<div class="flex flex-wrap items-center gap-2 mt-1 text-xs">
														<span class="px-2 py-0.5 rounded-full bg-surface2 text-ink-soft">{baby.type || 'child'}</span>
														{#if baby.trackable !== false}
															<span class="px-2 py-0.5 rounded-full bg-surface2 text-ink-soft">trackable profile</span>
														{/if}
														{#if baby.linkedAccount}
															<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary">account linked</span>
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
														<button type="button" class="text-xs text-primary underline" on:click={() => inviteMemberEmail(String(baby.email))}>invite account</button>
													{/if}
													<button type="button" class="text-xs text-ink-soft underline" on:click={() => openEditMember(baby)}>edit</button>
												</div>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-3">Add a family member</h3>
								<p class="text-xs text-ink-soft mb-3">Adults can exist without accounts. Add an email and invite them later. Children create a trackable profile for feeds/sleep/diapers.</p>
								<form on:submit={addFamilyMember}>
									<div class="mb-2">
										<label for="member-type-x" class="block text-sm font-medium text-ink-soft mb-1">Member Type</label>
										<select id="member-type-x" bind:value={memberType} class="w-full px-3 py-2 border border-line rounded-md">
											<option value="child" selected>Child</option>
											<option value="adult">Adult</option>
										</select>
									</div>
									<div class="mb-2">
										<label for="member-name-x" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
										<input id="member-name-x" bind:value={newMemberName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Name" />
									</div>
									<div class="mb-2">
										<label for="member-email-x" class="block text-sm font-medium text-ink-soft mb-1">Email (optional)</label>
										<input id="member-email-x" type="email" bind:value={editMemberEmail} class="w-full px-3 py-2 border border-line rounded-md" placeholder="adult@email.com" />
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
							{:else if settingsTab === 'import'}
							<div class="bg-surface rounded-lg shadow-card p-4 md:p-6 border border-line-soft">
								<h3 class="text-lg font-display font-semibold mb-2">Import data</h3>
								<p class="text-ink-soft text-sm mb-3">Bring history from another baby app into {activeFamily?.name}. Records land on the selected family member. Re-importing the same file skips duplicates.</p>
								<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
									<div class="flex-1">
										<label for="import-target" class="block text-sm font-medium text-ink-soft mb-1">Assign to family member</label>
										<select id="import-target" bind:value={importTargetBabyId} class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink">
											<option value={null}>— choose a member —</option>
											{#each babies as baby}
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
														<p class="text-xs text-ink-soft">{formatTime(run.createdAt)} · {run.importType}{run.babyId ? ` · member #${run.babyId}` : ''}</p>
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
												<label class="block text-sm font-medium text-ink-soft mb-1">Host</label>
												<input type="text" bind:value={smtpHost} placeholder="smtp.example.com" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div>
												<label class="block text-sm font-medium text-ink-soft mb-1">Port</label>
												<input type="number" bind:value={smtpPort} placeholder="587" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div>
												<label class="block text-sm font-medium text-ink-soft mb-1">Username</label>
												<input type="text" bind:value={smtpUser} placeholder="user@example.com" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div>
												<label class="block text-sm font-medium text-ink-soft mb-1">Password</label>
												<input type="password" bind:value={smtpPass} placeholder="••••••" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
											</div>
											<div class="col-span-2">
												<label class="block text-sm font-medium text-ink-soft mb-1">From address</label>
												<input type="email" bind:value={smtpFrom} placeholder="Nido <nido@example.com>" class="w-full px-3 py-2 border border-line rounded-md bg-surface text-ink" />
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
