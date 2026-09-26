<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authAPI, userAPI, babyAPI, familiesAPI, feedingAPI, diaperAPI, sleepAPI, growthAPI, healthAPI, importsAPI, photosAPI, formulasAPI, familyAdminAPI, accountAPI, milestoneAPI, vaccinationAPI, settingsAPI, moodAPI, journalAPI, tokenExpired, remindersAPI } from '$lib/api';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import PhotoStrip from '$lib/components/PhotoStrip.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import LogSheet from '$lib/components/LogSheet.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
		import { CATEGORIES } from '$lib/shared';
	import { Milk, Baby, Moon, TrendingUp, Calendar, Star, Trophy, Stethoscope, Syringe, Smile, Book, Users, Home, Trash2, Mail, Timer, PenLine, ArrowLeft, ArrowRight, Pause, Play, RotateCcw, Plus, Camera, Droplet, AlertCircle, Activity, ChevronDown, Settings, Check, Infinity, Heart } from 'lucide-svelte';

	const FORMULA_TYPES = [
		'standard',
		'gentle',
		'hypoallergenic',
		'hydrolyzed',
		'anti-reflux',
		'lactose-free',
		'soy',
		'goat-milk',
		'premature',
		'sensitive',
	];

	let familyView: 'dashboard' | 'detail' = 'dashboard';
	let sheetOpen = false;
	let categoryMenuOpen = false;

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

	// Tracking categories — a member enables a subset; tabs render from it.
	let activeCategories: string[] = [];

	// Family-scoped tracking settings (categories + per-category option lists).
	let settingsTab: 'profile' | 'family' | 'import' | 'members' | 'backup' | 'admin' = 'profile';
	let familySettings: { categories: string[] | null; categoryOptions: Record<string, Record<string, string[]>>; defaultCategoryOptions: Record<string, Record<string, string[]>> } | null = null;
	let savingFamilySettings = false;

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
	let newFormulaType = 'standard';
	// Manual feed entry (backdated) + repeat-last
	let manualStart = '';
	let manualEnd = '';
	let manualType: 'breast' | 'bottle' | 'combo' | 'pump' | 'solid' | null = null;
	let manualBottleSource: 'breastmilk' | 'formula' = 'breastmilk';
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
	let feedMode: 'timer' | 'log' = 'log';

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
	// Ticking clock source for live "running" portions; updated by the timer
	// interval each second so reactive displays advance without double-counting.
	let timerNow = 0;

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
		timerNow = Date.now();
		timerTick = window.setInterval(() => {
			timerNow = Date.now();
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

	async function sendInvite(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (!inviteEmail.trim() || !activeFamilyId) return;
		try {
			const res = await familiesAPI.invite(activeFamilyId, inviteEmail.trim());
			notice = `Invitation sent to ${res.data.invitation.email}.`;
			inviteEmail = '';
			await loadInvitations();
		} catch (err: any) {
			error = err.response?.data?.error || 'Failed to send invitation.';
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
			await formulasAPI.create(activeFamilyId, { name: newFormulaName.trim(), brand: newFormulaBrand.trim() || undefined, formulaType: newFormulaType });
			newFormulaName = ''; newFormulaBrand = ''; newFormulaType = 'standard';
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
		if (mode === 'timer') feedType = 'breast';
		if (mode === 'log' && !manualStart) manualStart = nowLocalISO();
	}

	function chooseManualFeedType(type: 'breast' | 'bottle' | 'combo') {
		manualType = type;
		if (type === 'breast') {
			feedMode = 'timer';
			manualBottleSource = 'breastmilk';
		} else {
			feedMode = 'log';
			if (type === 'bottle') manualBottleSource = 'breastmilk';
		}
		if (!manualStart) manualStart = nowLocalISO();
	}

	function setSleepMode(mode: 'timer' | 'log') {
		sleepMode = mode;
		if (mode === 'log' && !sleepTime) sleepTime = nowLocalISO();
	}

	function repeatLastFeed() {
		const last = localStorage.getItem('nido.lastFeed');
		if (!last) { error = 'No previous feed to repeat.'; return; }
		const l = JSON.parse(last);
		if (l.type === 'formula') {
			manualType = 'bottle';
			manualBottleSource = 'formula';
			feedMode = 'log';
		} else if (l.type === 'combo') {
			manualType = 'combo';
			manualBottleSource = l.bottleSource === 'formula' ? 'formula' : 'breastmilk';
			feedMode = 'log';
		} else {
			manualType = (l.type || 'breast') as 'breast' | 'bottle' | 'combo' | 'pump' | 'solid';
			if (manualType === 'bottle') { manualBottleSource = 'breastmilk'; feedMode = 'log'; }
			else feedMode = 'timer';
		}
		manualSide = l.side === 'right' ? 'right' : 'left';
		manualFormulaId = l.formulaId ?? null;
		manualAmount = l.amount ?? '';
		error = '';
	}

	async function saveManualFeed(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedBabyId) return;
		if (!manualType) {
			error = 'Choose Breast feed, Bottle feed, or Combo first.';
			return;
		}
		if (!manualStart) manualStart = nowLocalISO();
		const isBottleBased = manualType === 'bottle' || manualType === 'combo';
		if (isBottleBased && manualBottleSource === 'formula' && !manualFormulaId) {
			error = 'Pick a formula for bottle feeding.';
			return;
		}
		error = '';
		const start = manualStart ? new Date(manualStart).toISOString() : new Date().toISOString();
		const usesEndTime = manualType === 'pump' || manualType === 'solid';
		const end = usesEndTime && manualEnd ? new Date(manualEnd).toISOString() : undefined;
		try {
			if (manualType === 'combo') {
				const bottleType = manualBottleSource === 'formula' ? 'formula' : 'bottle';
				await feedingAPI.create({
					babyId: selectedBabyId,
					startTime: start,
					type: 'breast' as any,
					side: manualSide as any,
					notes: manualNotes || undefined,
				});
				await feedingAPI.create({
					babyId: selectedBabyId,
					startTime: start,
					type: bottleType as any,
					formulaId: bottleType === 'formula' ? manualFormulaId : undefined,
					amount: manualAmount ? Number(manualAmount) : undefined,
					notes: manualNotes || undefined,
				});
			} else {
				const resolvedType = (manualType === 'bottle' && manualBottleSource === 'formula') ? 'formula' : manualType;
				await feedingAPI.create({
					babyId: selectedBabyId,
					startTime: start,
					endTime: end,
					type: resolvedType as any,
					side: manualType === 'breast' ? (manualSide as any) : undefined,
					formulaId: resolvedType === 'formula' ? manualFormulaId : undefined,
					amount: manualAmount ? Number(manualAmount) : undefined,
					notes: manualNotes || undefined,
				});
			}
			// Remember for "repeat last"
			localStorage.setItem('nido.lastFeed', JSON.stringify({
				type: manualType,
				side: manualType === 'breast' || manualType === 'combo' ? manualSide : undefined,
				bottleSource: isBottleBased ? manualBottleSource : undefined,
				formulaId: isBottleBased && manualBottleSource === 'formula' ? manualFormulaId : null,
				amount: manualAmount,
			}));
			manualStart = ''; manualEnd = ''; manualAmount = ''; manualNotes = '';
			manualType = null;
			manualBottleSource = 'breastmilk';
			notice = 'Feed recorded.';
			sheetOpen = false;
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
			const cats = familySettings.categories;
			if (cats && cats.length) {
				activeCategories = cats;
			}
		} catch (err: any) {
			console.error('Failed to load family settings:', err);
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
	$: leftTotalMs = leftElapsed + (leftStartedAt ? timerNow - leftStartedAt : 0);
	$: rightTotalMs = rightElapsed + (rightStartedAt ? timerNow - rightStartedAt : 0);
	$: sleepTotalMs = sleepElapsed + (sleepStartedAt ? timerNow - sleepStartedAt : 0);
	$: feedTotalMs = leftTotalMs + rightTotalMs;
	$: anyBreastRunning = !!(leftStartedAt || rightStartedAt);
	// Reactive "has time" flag — the template buttons bind to this so Save/Cancel
	// appear immediately on Start/Stop (a plain function call is not reactive).
	$: hasAnySideTime = leftElapsed > 0 || rightElapsed > 0 || !!leftStartedAt || !!rightStartedAt;

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
			sheetOpen = false;
			await refreshLists();
			await refreshSummary();
		} catch (err: any) {
			enqueueRecord('feeding', payload);
			notice = 'Feeding saved locally — will sync when connected.';
			sheetOpen = false;
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
		{#if families.length === 0}
			<!-- FAMILY ONBOARDING: build your family first -->
			<div class="flex justify-end mb-4">
				<button type="button" class="px-3 py-1 text-sm bg-surface2 text-ink-soft rounded-md hover:bg-line-soft" on:click={handleLogout}>Sign Out</button>
			</div>
			<div class="max-w-2xl mx-auto bg-surface rounded-lg shadow-card p-4 md:p-6">
				<h2 class="text-2xl font-display font-semibold mb-2">Build your family</h2>
				<p class="text-ink-soft mb-4">Nido is family-first. Start by naming your family — anyone you invite joins it.</p>
				<form on:submit={buildFamily}>
					<div class="mb-4">
						<label for="family-name" class="block text-sm font-medium text-ink-soft mb-1">Family Name</label>
						<input id="family-name" bind:value={familyName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="The Hollybrooks" />
					</div>

					<fieldset class="border border-line-soft rounded-lg p-4 mb-4">
						<legend class="text-sm text-ink-soft px-2">Add your first family member (optional)</legend>
						<div class="mb-3">
							<label for="member-type" class="block text-sm font-medium text-ink-soft mb-1">Member Type</label>
							<select id="member-type" bind:value={memberType} class="w-full px-3 py-2 border border-line rounded-md">
								<option value="child" selected>Child</option>
								<option value="adult">Adult</option>
							</select>
						</div>
						<div class="mb-3">
							<label for="member-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
							<input id="member-name" bind:value={newMemberName} class="w-full px-3 py-2 border border-line rounded-md" placeholder="Aiden" />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<label for="member-dob" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
								<input id="member-dob" type="date" bind:value={newBabyBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="member-gender" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
								<select id="member-gender" bind:value={newBabyGender} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="female" selected>Female</option>
									<option value="male">Male</option>
									<option value="other">Other</option>
								</select>
							</div>
						</div>
					</fieldset>

					<button type="submit" disabled={creatingBaby} class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary disabled:opacity-50">
						{creatingBaby ? 'Creating...' : 'Build Family'}
					</button>
				</form>
			</div>
		{:else if babies.length === 0}
			<!-- DASHBOARD (family exists, no members yet): add a member first -->
			<div class="flex items-center justify-between mb-6">
				<div>
					<h2 class="text-2xl font-display font-semibold">{activeFamily?.name}
						<span class="text-accent font-mono text-sm">({activeFamily?.familyCode})</span>
					</h2>
				</div>
				<button type="button" class="px-4 py-2 bg-primary text-on-primary rounded-md hover:bg-primary" on:click={handleLogout}>Sign Out</button>
			</div>

			<div class="max-w-2xl mx-auto bg-surface rounded-lg shadow-card p-4 md:p-6">
				<h3 class="text-xl font-display font-semibold mb-2">Add your first family member</h3>
				<p class="text-ink-soft mb-4">Adding a Baby is the first supported member type.</p>
				<form on:submit={addFamilyMember}>
					<div class="mb-3">
						<label for="member-type-2" class="block text-sm font-medium text-ink-soft mb-1">Member Type</label>
						<select id="member-type-2" bind:value={memberType} class="w-full px-3 py-2 border border-line rounded-md">
							<option value="child" selected>Child</option>
							<option value="adult">Adult</option>
						</select>
					</div>
					<div class="mb-3">
						<label for="member-name-2" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
						<input id="member-name-2" bind:value={newMemberName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Aiden" />
					</div>
					<div class="grid grid-cols-2 gap-3 mb-3">
						<div>
							<label for="member-dob-2" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
							<input id="member-dob-2" type="date" bind:value={newBabyBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div>
							<label for="member-gender-2" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
							<select id="member-gender-2" bind:value={newBabyGender} class="w-full px-3 py-2 border border-line rounded-md">
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
		{:else}
			<!-- DASHBOARD (family + members) -->
			{#if familyView === 'dashboard'}
			<div class="flex flex-col mb-6 gap-4">
				<div class="flex flex-col gap-3">
					{#if families.length > 1}
						<div class="flex overflow-x-auto no-scrollbar">
							<div class="flex gap-2">
								{#each families as fam}
									<button type="button" on:click={() => setActiveFamily(fam.familyId)} class="{activeFamilyId === fam.familyId ? 'bg-surface2 text-ink border-line' : 'bg-surface text-ink-soft border-line-soft'} h-9 px-3 rounded-full text-xs border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors">
										<Users class="w-3 h-3" />
										{fam.name}
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<span class="text-sm font-semibold text-ink-soft flex items-center gap-1"><Users class="w-4 h-4" /> {activeFamily?.name}</span>
					{/if}

					<div class="flex items-center gap-3">
						{#if babies.length > 1}
							<div class="flex-1 overflow-x-auto no-scrollbar">
								<div class="flex gap-2">
									{#each babies as baby}
										<button type="button" on:click={() => selectBaby(Number(baby.id))} class="{selectedBabyId === Number(baby.id) ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors">
											<Avatar familyId={activeFamilyId} memberId={baby.id} avatar={baby.avatar} alt={baby.name} class="w-5 h-5 rounded-full object-cover">
												<Baby class="w-4 h-4" />
											</Avatar>
											{baby.name}
										</button>
									{/each}
								</div>
							</div>
							<button
								type="button"
								title="Set as default profile"
								class="px-2 py-1 rounded-md text-ink-soft hover:text-accent text-xs shrink-0"
								on:click={() => { if (selectedBabyId) setDefaultProfile(selectedBabyId); }}
							>
								<Star class="w-5 h-5 {defaultProfileId === selectedBabyId ? 'text-accent' : 'text-ink-soft opacity-50'}" aria-hidden="true" />
							</button>
						{:else if babies.length === 1}
							<h2 class="text-xl md:text-2xl font-display font-semibold text-ink flex items-center gap-2">
								<Avatar familyId={activeFamilyId} memberId={babies[0].id} avatar={babies[0].avatar} alt={babies[0].name} class="w-8 h-8 rounded-full object-cover" />
								{babies[0].name}
							</h2>
						{/if}
					</div>
				</div>
<div class="flex flex-wrap items-center gap-2">
				</div>
			</div>
			{/if}

			{#if overdueReminders.length > 0}
				<div class="bg-danger border border-danger text-danger-text rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
					<div>
						<p class="text-sm font-semibold">Reminders</p>
						<p class="text-xs">
							{#each overdueReminders as o}
								{#if o.kind === 'inactivity'}
									<span class="capitalize">no {o.category === 'pumping' ? 'pump' : o.category === 'diapers' ? 'change' : o.category === 'sleep' ? 'sleep' : 'feed'} in {o.hours}h{o.since ? ` (since ${new Date(o.since).toLocaleString()})` : ' (never recorded)'}</span>
								{:else}
									<span>{o.label || o.category} — every {o.intervalDays}d{o.since ? ` (last {new Date(o.since).toLocaleString()})` : ' (never done)'}</span>
								{/if}{o !== overdueReminders[overdueReminders.length - 1] ? ' · ' : ''}
							{/each}
						</p>
					</div>
					<button type="button" on:click={() => (familyView = 'detail')} class="bg-danger text-danger-text px-3 py-2 rounded-md text-sm shrink-0">View</button>
				</div>
			{/if}

			{#if familyView === 'dashboard'}
				<div class="mb-8">
					<h2 class="text-2xl font-display font-semibold mb-4">Family Overview</h2>
					
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
						{#each babies as baby}
							<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft flex items-center justify-between">
								<div class="flex items-center gap-4">
									<div class="w-12 h-12 rounded-full bg-accent text-on-accent flex items-center justify-center font-display text-xl overflow-hidden">
										<Avatar familyId={activeFamilyId} memberId={baby.id} avatar={baby.avatar} alt={baby.name} class="w-full h-full object-cover">
											{baby.name[0]}
										</Avatar>
									</div>
									<div>
										<h3 class="font-display font-semibold text-lg">{baby.name}</h3>
										<p class="text-sm text-ink-soft">Born {baby.birth_date.slice(0, 10)}</p>
									</div>
								</div>
								<div class="flex items-center gap-2">
								{#if baby.email}
									<button type="button" on:click={() => inviteMemberEmail(baby.email)} title="Re-send invite" class="px-2 py-2 text-xs text-accent hover:underline"><Mail class="w-4 h-4 inline mr-1" /> Invite</button>
								{/if}
								<button type="button" on:click={() => openEditMember(baby)} class="px-3 py-2 text-xs bg-surface2 text-ink-soft hover:text-ink rounded-md">Edit</button>
								<button type="button" on:click={() => { selectBaby(baby.id); familyView = 'detail'; activeTab = 'feeds'; }} class="px-4 py-2 bg-surface2 text-ink-soft hover:text-ink rounded-md text-sm font-semibold">
									Log Activity
								</button>
							</div>
							</div>
						{/each}
					</div>

					{#if summary}
						<h3 class="text-lg font-display font-semibold mb-3">Today for {babies.find(b => b.id === selectedBabyId)?.name || 'Selected'}</h3>
						<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
							<div class="bg-surface rounded-lg shadow-card p-4 border-l-4 border-line">
								<div class="flex items-center gap-2 mb-1">
									<Baby class="w-5 h-5 text-ink-soft" aria-hidden="true" />
									<p class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Age</p>
								</div>
								<p class="text-2xl font-display font-semibold text-ink">{summary.baby.ageInWeeks} <span class="text-sm text-ink-soft font-sans font-normal">weeks</span></p>
							</div>
							<button type="button" on:click={() => { familyView = 'detail'; activeTab = 'feeds'; }} class="w-full text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-primary hover:bg-surface2 transition-colors">
								<span class="flex items-center gap-2 mb-1">
									<span class="shrink-0" aria-hidden="true"><Milk class="w-5 h-5" /></span>
									<span class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Feed</span>
								</span>
								<span class="text-2xl font-display font-semibold text-ink block">{summary.latestFeeding ? formatTime(summary.latestFeeding.end_time || summary.latestFeeding.start_time).split(', ')[1] || formatTime(summary.latestFeeding.end_time || summary.latestFeeding.start_time) : '—'}</span>
								<span class="text-sm text-ink-soft mt-1 block">{summary.latestFeeding?.type || 'no feed recorded'}</span>
							</button>
							<button type="button" on:click={() => { familyView = 'detail'; activeTab = 'diapers'; }} class="w-full text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-accent hover:bg-surface2 transition-colors">
								<span class="flex items-center gap-2 mb-1">
									<span class="shrink-0" aria-hidden="true"><Baby class="w-5 h-5" /></span>
									<span class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Diaper</span>
								</span>
								<span class="text-2xl font-display font-semibold text-ink block">{summary.latestDiaper ? formatTime(summary.latestDiaper.change_time).split(', ')[1] || formatTime(summary.latestDiaper.change_time) : '—'}</span>
								<span class="text-sm text-ink-soft mt-1 block">{summary.latestDiaper?.type || 'no change recorded'}</span>
							</button>
							<button type="button" on:click={() => { familyView = 'detail'; activeTab = 'sleep'; }} class="w-full text-left bg-surface rounded-lg shadow-card p-4 border-l-4 border-ink hover:bg-surface2 transition-colors">
								<span class="flex items-center gap-2 mb-1">
									<span class="shrink-0" aria-hidden="true"><Moon class="w-5 h-5" /></span>
									<span class="text-xs text-ink-soft uppercase font-semibold tracking-wider">Last Sleep</span>
								</span>
								<span class="text-2xl font-display font-semibold text-ink block">{summary.latestSleep ? formatTime(summary.latestSleep.start_time).split(', ')[1] || formatTime(summary.latestSleep.start_time) : '—'}</span>
								<span class="text-sm text-ink-soft mt-1 block">{summary.latestSleep?.duration ? formatElapsed(summary.latestSleep.duration) : 'no sleep recorded'}</span>
							</button>
						</div>
					{/if}

					<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft mb-8">
						<button type="button" on:click={() => { familyView = 'detail'; activeTab = 'feeds'; }} class="w-full text-left hover:bg-surface2 transition-colors rounded-md">
							<h3 class="text-lg font-display font-semibold mb-1">Quick reports <span class="text-xs text-ink-soft">· feeds →</span></h3>
						</button>
						<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Feeds (24h)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.count1d}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg size (24h)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgSize1d != null ? `${feedReports.avgSize1d.toFixed(1)}oz` : '—'}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg size (30d)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgSize30d != null ? `${feedReports.avgSize30d.toFixed(1)}oz` : '—'}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Feeds (30d)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.count30d}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg length (24h)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgDur1d != null ? formatElapsed(feedReports.avgDur1d) : '—'}</p>
							</div>
							<div>
								<p class="text-xs text-ink-soft uppercase font-semibold">Avg length (30d)</p>
								<p class="text-xl font-display font-semibold text-ink">{feedReports.avgDur30d != null ? formatElapsed(feedReports.avgDur30d) : '—'}</p>
							</div>
						</div>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
						<div class="bg-surface rounded-lg shadow-card p-5 border border-line-soft">
							<h3 class="text-lg font-display font-semibold mb-4">Quick Log</h3>
							<div class="flex flex-col gap-3">
								{#if activeCategories.includes('feeds')}
								<button type="button" on:click={() => { activeTab = 'feeds'; sheetOpen = true; }} class="w-full bg-primary text-on-primary py-4 rounded-lg font-semibold text-lg flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity">
									<Milk class="w-6 h-6 mb-1" aria-hidden="true" /> Log Feed
								</button>
								{/if}
								{#if activeCategories.includes('diapers')}
								<button type="button" on:click={() => { activeTab = 'diapers'; sheetOpen = true; }} class="w-full bg-surface2 text-ink border border-accent py-4 rounded-lg font-semibold text-lg flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity">
									<Baby class="w-6 h-6 mb-1" aria-hidden="true" /> Log Diaper
								</button>
								{/if}
								{#if activeCategories.includes('sleep')}
								<button type="button" on:click={() => { activeTab = 'sleep'; sheetOpen = true; }} class="w-full bg-surface2 text-ink border border-line-soft py-4 rounded-lg font-semibold text-lg flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity">
									<Moon class="w-6 h-6 mb-1" aria-hidden="true" /> Log Sleep
								</button>
								{/if}
							</div>
						</div>
						<div class="bg-surface2 rounded-lg shadow-card p-5 border border-line-soft">
							<h3 class="text-lg font-display font-semibold mb-4">Recent Activity</h3>
							<ul class="divide-y divide-line-soft">
								{#each [...feedings, ...diapers, ...sleeps].sort((a, b) => new Date(b.start_time || b.change_time).getTime() - new Date(a.start_time || a.change_time).getTime()).slice(0, 5) as item}
									<li class="py-3 flex justify-between items-center">
										<div class="flex items-center gap-3">
											<span class="text-2xl" aria-hidden="true">
												{#if item.amount !== undefined}<Milk class="w-4 h-4 inline" />{:else if item.consistency !== undefined}<Baby class="w-4 h-4 inline" />{:else}<Moon class="w-4 h-4 inline" />{/if}
											</span>
											<div>
												<p class="font-semibold text-ink text-sm">
													{#if item.amount !== undefined}Feed ({item.type}){:else if item.consistency !== undefined}Diaper ({item.type}){:else}Sleep{/if}
												</p>
												<p class="text-xs text-ink-soft">{formatTime(item.start_time || item.change_time)}</p>
											</div>
										</div>
										<span class="text-sm font-medium text-ink-soft">
											{#if item.amount}{item.amount}oz{:else if item.duration}{formatElapsed(item.duration)}{/if}
										</span>
									</li>
								{/each}
								{#if [...feedings, ...diapers, ...sleeps].length === 0}
									<li class="py-3 text-ink-soft text-sm">No recent activity.</li>
								{/if}
							</ul>
						</div>
					</div>
				</div>
			{:else}
				<button type="button" on:click={() => (familyView = 'dashboard')} class="mb-2 text-ink-soft hover:text-ink flex items-center gap-1 text-sm font-semibold">
					<span aria-hidden="true">‹</span> {activeFamily?.name || 'Family'} <span class="text-ink-soft" aria-hidden="true">/</span> <span class="text-ink">{babies.find((b) => Number(b.id) === selectedBabyId)?.name || 'Baby'}</span>
				</button>

			<div class="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
				<div class="relative w-full sm:w-56">
					<button
						type="button"
						on:click={() => (categoryMenuOpen = !categoryMenuOpen)}
						class="w-full h-11 px-3 border border-line rounded-md bg-surface text-ink font-semibold text-sm flex items-center gap-2"
						aria-haspopup="listbox"
						aria-expanded={categoryMenuOpen}
					>
						<span class="w-6 h-6 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
							<svelte:component this={CATEGORIES.find((c) => c.id === activeTab)?.icon || Milk} class="w-4 h-4" />
						</span>
						<span class="flex-1 text-left truncate">{CATEGORIES.find((c) => c.id === activeTab)?.label || 'Category'}</span>
						<ChevronDown class="w-4 h-4 text-ink-soft shrink-0 transition-transform {categoryMenuOpen ? 'rotate-180' : ''}" />
					</button>
					{#if categoryMenuOpen}
						<button type="button" class="fixed inset-0 z-20 cursor-default" aria-label="Close category menu" on:click={() => (categoryMenuOpen = false)}></button>
						<div class="absolute z-30 mt-1 w-full bg-surface border border-line-soft rounded-md shadow-card py-1 max-h-72 overflow-y-auto" role="listbox">
							{#each CATEGORIES.filter((c) => activeCategories.includes(c.id)) as cat}
								<button
									type="button"
									role="option"
									aria-selected={activeTab === cat.id}
									on:click={() => { activeTab = cat.id; categoryMenuOpen = false; }}
									class="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-sm text-left transition-colors {activeTab === cat.id ? 'bg-accent-soft text-ink font-semibold' : 'text-ink-soft hover:bg-surface2'}"
								>
									<span class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 {activeTab === cat.id ? 'bg-accent text-on-accent' : 'bg-surface2 text-ink-soft'}">
										<svelte:component this={cat.icon} class="w-4 h-4" />
									</span>
									{cat.label}
									{#if activeTab === cat.id}
										<Check class="w-4 h-4 text-accent shrink-0 ml-auto" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="flex items-center gap-0.5 bg-surface2 rounded-lg p-0.5 self-start sm:self-auto">
					<button type="button" on:click={() => (viewMode = 'list')} class="{viewMode === 'list' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'} h-9 px-3 rounded-md text-sm font-semibold transition-colors">Cards</button>
					<button type="button" on:click={() => (viewMode = 'table')} class="{viewMode === 'table' ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'} h-9 px-3 rounded-md text-sm font-semibold transition-colors">Table</button>
				</div>
			</div>

{#if viewMode === 'table'}
				{#if activeTab === 'feeds'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
					<div class="flex items-center justify-between mb-4">
						<h3 class="text-xl font-display font-semibold">Feed</h3>
								<div class="flex items-center gap-2">
									<button type="button" on:click={() => setFeedMode('log')} class="{feedMode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
									<button type="button" on:click={() => setFeedMode('timer')} class="{feedMode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
								</div>
							</div>
							{#if feedMode === 'timer'}
								<div class="mb-3 text-sm text-ink-soft">Timer mode is available for breast feeds only.</div>

								{#if feedType === 'breast'}
									<div class="flex items-center justify-between mb-2">
										<div class="block text-sm font-medium text-ink-soft">Breast</div>
										{#if lastBreastSide}
											<span class="text-xs text-ink-soft">last: {#if lastBreastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}</span>
										{/if}
									</div>
									<div class="grid grid-cols-2 gap-4 mb-4">
										<div class="rounded-lg border p-4 text-center {leftStartedAt ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}">
											<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Left</p>
											<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(leftTotalMs)}</p>
											<button type="button" on:click={() => toggleSideTimer('left')} class="mt-3 w-full {leftStartedAt ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
												{#if leftStartedAt}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
											</button>
										</div>
										<div class="rounded-lg border p-4 text-center {rightStartedAt ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}">
											<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Right</p>
											<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(rightTotalMs)}</p>
											<button type="button" on:click={() => toggleSideTimer('right')} class="mt-3 w-full {rightStartedAt ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
												{#if rightStartedAt}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
											</button>
										</div>
									</div>
									<div class="flex items-center justify-between mb-3 text-sm">
										<span class="text-ink-soft">Total</span>
										<span class="font-display font-semibold text-ink text-lg">{formatElapsed(feedTotalMs)}</span>
									</div>
									<div class="flex justify-between mt-2 mb-4 text-xs text-ink-soft">
										<span>L total: {formatMinutes(leftBreastTotal)}</span>
										<span>R total: {formatMinutes(rightBreastTotal)}</span>
									</div>
									<div class="flex gap-2">
										<button type="button" on:click={saveFeedTimer} disabled={!hasAnySideTime} class="flex-1 bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">Save</button>
										{#if hasAnySideTime}
											<button type="button" on:click={cancelFeed} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:bg-line-soft">Cancel</button>
										{/if}
									</div>
								{:else}
									<div class="mb-3">
										<label for="feed-timer-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
										<input id="feed-timer-amount" type="number" step="0.1" bind:value={feedAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
									</div>
									<button type="button" on:click={saveFeedTimer} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary text-lg font-display font-semibold">Save Feed</button>
								{/if}
							{:else}
								<form on:submit={saveManualFeed} class="space-y-3">
									<div class="flex gap-2 items-center">
										<div class="flex-1">
											<label for="manual-feed-start" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time (start)</label>
											<input id="manual-feed-start" type="datetime-local" bind:value={manualStart} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
										<div class="pt-5">
											<button type="button" on:click={repeatLastFeed} title="Repeat last selection" class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:bg-line-soft"><RotateCcw class="w-4 h-4 inline mr-1" /> Repeat last</button>
										</div>
									</div>
									<div>
										<div class="block text-sm font-medium text-ink-soft mb-1">BreastFeed, Bottle Feed, or Combo?</div>
										<div class="grid grid-cols-3 gap-2">
											<button type="button" on:click={() => chooseManualFeedType('breast')} class="{manualType === 'breast' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Heart class="w-4 h-4" /> BreastFeed</button>
											<button type="button" on:click={() => chooseManualFeedType('bottle')} class="{manualType === 'bottle' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Baby class="w-4 h-4" /> Bottle Feed</button>
											<button type="button" on:click={() => chooseManualFeedType('combo')} class="{manualType === 'combo' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Infinity class="w-4 h-4" /> Combo</button>
										</div>
									</div>
									{#if manualType === 'bottle' || manualType === 'combo'}
										<div>
											<label for="manual-bottle-source" class="block text-sm font-medium text-ink-soft mb-1">Bottle contents</label>
											<select id="manual-bottle-source" bind:value={manualBottleSource} class="w-full px-3 py-2 border border-line rounded-md">
												<option value="breastmilk">Breast milk</option>
												<option value="formula">Formula</option>
											</select>
										</div>
									{/if}
									{#if (manualType === 'bottle' || manualType === 'combo') && manualBottleSource === 'formula'}
										<div>
											<label for="manual-feed-formula" class="block text-sm font-medium text-ink-soft mb-1">Formula</label>
											<div class="flex gap-2">
												<select id="manual-feed-formula" bind:value={manualFormulaId} class="flex-1 px-3 py-2 border border-line rounded-md">
													<option value="">—</option>
													{#each formulas as f}
													<option value={f.id}>{f.name}{f.brand ? ` (${f.brand})` : ''} · {f.formulaType || 'standard'}</option>
													{/each}
												</select>
												<button type="button" on:click={() => (showAddFormula = !showAddFormula)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md"><Plus class="w-4 h-4" /></button>
											</div>
											{#if showAddFormula}
												<div class="flex gap-2 mt-2">
													<input type="text" bind:value={newFormulaName} placeholder="Formula name" class="flex-1 px-3 py-2 border border-line rounded-md" />
													<input type="text" bind:value={newFormulaBrand} placeholder="Brand" class="flex-1 px-3 py-2 border border-line rounded-md" />
													<select bind:value={newFormulaType} class="flex-1 px-3 py-2 border border-line rounded-md">
														{#each FORMULA_TYPES as t}
															<option value={t}>{t}</option>
														{/each}
													</select>
													<button type="button" on:click={addFormula} class="px-3 py-2 bg-primary text-on-primary rounded-md">Add</button>
												</div>
{/if}
									</div>
									{/if}
									{#if manualType === 'breast' || manualType === 'combo'}
										<div>
											<div class="flex items-center justify-between mb-1">
												<div class="block text-sm font-medium text-ink-soft">Breast</div>
												{#if lastBreastSide}
											<span class="text-xs text-ink-soft">last: {#if lastBreastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}</span>
												{/if}
											</div>
											<div class="flex gap-2">
												<button type="button" on:click={() => (manualSide = 'left')} class="{manualSide === 'left' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line hover:border-line-soft'} flex-1 px-3 py-2 rounded-md border text-sm font-semibold transition-colors">
													<ArrowLeft class="w-4 h-4 inline mr-1" /> Left
												</button>
												<button type="button" on:click={() => (manualSide = 'right')} class="{manualSide === 'right' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line hover:border-line-soft'} flex-1 px-3 py-2 rounded-md border text-sm font-semibold transition-colors">
													Right <ArrowRight class="w-4 h-4 inline ml-1" />
												</button>
											</div>
											<div class="flex justify-between mt-2 text-xs text-ink-soft">
												<span>L total: {formatMinutes(leftBreastTotal)}</span>
												<span>R total: {formatMinutes(rightBreastTotal)}</span>
											</div>
										</div>
									{/if}
									{#if manualType && manualType !== 'breast'}
										<div>
											<label for="manual-feed-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
											<input id="manual-feed-amount" type="number" step="0.1" bind:value={manualAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
										</div>
									{/if}
									{#if manualType === 'pump' || manualType === 'solid'}
										<div>
											<label for="manual-feed-end" class="block text-sm font-medium text-ink-soft mb-1">End time (optional)</label>
											<input id="manual-feed-end" type="datetime-local" bind:value={manualEnd} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
									{/if}
									<div>
										<label for="manual-feed-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
										<input id="manual-feed-notes" type="text" bind:value={manualNotes} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Feed</button>
								</form>
							{/if}
					</div>
				{/if}
				<div class="bg-surface rounded-lg shadow-card p-4 mb-4">
					<div class="flex items-center justify-between mb-3">
						<h3 class="font-display font-semibold">{CATEGORIES.find((c) => c.id === activeTab)?.label} — table view</h3>
						<span class="text-xs text-ink-soft">{recordsForTab().length} record(s)</span>
					</div>
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-ink-soft border-b border-line-soft">
									<th class="py-2 px-2">When</th>
									<th class="py-2 px-2">Details</th>
									<th class="py-2 px-2">Notes</th>
									<th class="py-2 px-2 text-right">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each recordsForTab().slice(0, 100) as r}
									<tr class="border-b border-line-soft">
										<td class="py-2 px-2 whitespace-nowrap">{formatTime(r.start_time || r.change_time || r.measurement_date || r.achieved_date || r.date_given)}</td>
										<td class="py-2 px-2">
											{#if activeTab === 'feeds' || activeTab === 'pumping'}{r.type}{r.amount ? ` · ${r.amount}oz` : ''}
											{:else if activeTab === 'diapers'}{r.type}{r.consistency ? ` · ${r.consistency}` : ''}
											{:else if activeTab === 'sleep'}{r.duration ? formatElapsed(r.duration) : ''}
											{:else if activeTab === 'growth'}{r.weight ? `${r.weight}${r.unit_system === 'imperial' ? 'lb' : 'kg'}` : '—'}
											{:else if activeTab === 'milestones' || activeTab === 'firsts' || activeTab === 'routines' || activeTab === 'medical'}{r.title}
											{:else if activeTab === 'vaccines'}{r.name}
											{/if}
										</td>
										<td class="py-2 px-2 text-ink-soft">{r.notes || ''}</td>
										<td class="py-2 px-2 text-right whitespace-nowrap">
											<button type="button" on:click={() => openEdit(activeTab === 'vaccines' ? 'vaccine' : activeTab === 'milestones' || activeTab === 'firsts' || activeTab === 'routines' || activeTab === 'medical' ? 'milestone' : activeTab === 'pumping' ? 'pumping' : activeTab === 'diapers' ? 'diaper' : activeTab === 'sleep' ? 'sleep' : activeTab === 'growth' ? 'growth' : 'feeding', r)} class="text-accent hover:underline">Edit</button>
											<span class="text-ink-soft mx-1">·</span>
											<button type="button" on:click={() => deleteRecord(activeTab === 'vaccines' ? 'vaccine' : activeTab === 'milestones' || activeTab === 'firsts' || activeTab === 'routines' || activeTab === 'medical' ? 'milestone' : activeTab === 'pumping' ? 'pumping' : activeTab === 'diapers' ? 'diaper' : activeTab === 'sleep' ? 'sleep' : activeTab === 'growth' ? 'growth' : 'feeding', Number(r.id))} class="text-danger-text hover:underline">Delete</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			{#if viewMode === 'list'}
				{#if activeTab === 'feeds'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- FEEDS FORM -->

							<div class="flex items-center justify-between mb-4">
								<h3 class="text-xl font-display font-semibold">Feed</h3>
								<div class="flex items-center gap-2">
									<button type="button" on:click={() => setFeedMode('log')} class="{feedMode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
									<button type="button" on:click={() => setFeedMode('timer')} class="{feedMode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
								</div>
							</div>
							{#if feedMode === 'timer'}
								<div class="mb-3 text-sm text-ink-soft">Timer mode is available for breast feeds only.</div>

								{#if feedType === 'breast'}
									<div class="flex items-center justify-between mb-2">
										<div class="block text-sm font-medium text-ink-soft">Breast</div>
										{#if lastBreastSide}
											<span class="text-xs text-ink-soft">last: {#if lastBreastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}</span>
										{/if}
									</div>
									<div class="grid grid-cols-2 gap-4 mb-4">
										<div class="rounded-lg border p-4 text-center {leftStartedAt ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}">
											<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Left</p>
											<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(leftTotalMs)}</p>
											<button type="button" on:click={() => toggleSideTimer('left')} class="mt-3 w-full {leftStartedAt ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
												{#if leftStartedAt}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
											</button>
										</div>
										<div class="rounded-lg border p-4 text-center {rightStartedAt ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}">
											<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Right</p>
											<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(rightTotalMs)}</p>
											<button type="button" on:click={() => toggleSideTimer('right')} class="mt-3 w-full {rightStartedAt ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
												{#if rightStartedAt}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
											</button>
										</div>
									</div>
									<div class="flex items-center justify-between mb-3 text-sm">
										<span class="text-ink-soft">Total</span>
										<span class="font-display font-semibold text-ink text-lg">{formatElapsed(feedTotalMs)}</span>
									</div>
									<div class="flex justify-between mt-2 mb-4 text-xs text-ink-soft">
										<span>L total: {formatMinutes(leftBreastTotal)}</span>
										<span>R total: {formatMinutes(rightBreastTotal)}</span>
									</div>
									<div class="flex gap-2">
										<button type="button" on:click={saveFeedTimer} disabled={!hasAnySideTime} class="flex-1 bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">Save</button>
										{#if hasAnySideTime}
											<button type="button" on:click={cancelFeed} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:bg-line-soft">Cancel</button>
										{/if}
									</div>
								{:else}
									<div class="mb-3">
										<label for="feed-timer-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
										<input id="feed-timer-amount" type="number" step="0.1" bind:value={feedAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
									</div>
									<button type="button" on:click={saveFeedTimer} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary text-lg font-display font-semibold">Save Feed</button>
								{/if}
							{:else}
								<form on:submit={saveManualFeed} class="space-y-3">
									<div class="flex gap-2 items-center">
										<div class="flex-1">
											<label for="manual-feed-start" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time (start)</label>
											<input id="manual-feed-start" type="datetime-local" bind:value={manualStart} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
										<div class="pt-5">
											<button type="button" on:click={repeatLastFeed} title="Repeat last selection" class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:bg-line-soft"><RotateCcw class="w-4 h-4 inline mr-1" /> Repeat last</button>
										</div>
									</div>
									<div>
										<div class="block text-sm font-medium text-ink-soft mb-1">BreastFeed, Bottle Feed, or Combo?</div>
										<div class="grid grid-cols-3 gap-2">
											<button type="button" on:click={() => chooseManualFeedType('breast')} class="{manualType === 'breast' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Heart class="w-4 h-4" /> BreastFeed</button>
											<button type="button" on:click={() => chooseManualFeedType('bottle')} class="{manualType === 'bottle' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Baby class="w-4 h-4" /> Bottle Feed</button>
											<button type="button" on:click={() => chooseManualFeedType('combo')} class="{manualType === 'combo' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Infinity class="w-4 h-4" /> Combo</button>
										</div>
									</div>
									{#if manualType === 'bottle' || manualType === 'combo'}
										<div>
											<label for="manual-bottle-source" class="block text-sm font-medium text-ink-soft mb-1">Bottle contents</label>
											<select id="manual-bottle-source" bind:value={manualBottleSource} class="w-full px-3 py-2 border border-line rounded-md">
												<option value="breastmilk">Breast milk</option>
												<option value="formula">Formula</option>
											</select>
										</div>
									{/if}
									{#if (manualType === 'bottle' || manualType === 'combo') && manualBottleSource === 'formula'}
										<div>
											<label for="manual-feed-formula" class="block text-sm font-medium text-ink-soft mb-1">Formula</label>
											<div class="flex gap-2">
												<select id="manual-feed-formula" bind:value={manualFormulaId} class="flex-1 px-3 py-2 border border-line rounded-md">
													<option value="">—</option>
													{#each formulas as f}
													<option value={f.id}>{f.name}{f.brand ? ` (${f.brand})` : ''} · {f.formulaType || 'standard'}</option>
													{/each}
												</select>
												<button type="button" on:click={() => (showAddFormula = !showAddFormula)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md"><Plus class="w-4 h-4" /></button>
											</div>
											{#if showAddFormula}
												<div class="flex gap-2 mt-2">
													<input type="text" bind:value={newFormulaName} placeholder="Formula name" class="flex-1 px-3 py-2 border border-line rounded-md" />
													<input type="text" bind:value={newFormulaBrand} placeholder="Brand" class="flex-1 px-3 py-2 border border-line rounded-md" />
													<select bind:value={newFormulaType} class="flex-1 px-3 py-2 border border-line rounded-md">
														{#each FORMULA_TYPES as t}
															<option value={t}>{t}</option>
														{/each}
													</select>
													<button type="button" on:click={addFormula} class="px-3 py-2 bg-primary text-on-primary rounded-md">Add</button>
												</div>
{/if}
									</div>
									{/if}
									{#if manualType === 'breast' || manualType === 'combo'}
										<div>
											<div class="flex items-center justify-between mb-1">
												<div class="block text-sm font-medium text-ink-soft">Breast</div>
												{#if lastBreastSide}
											<span class="text-xs text-ink-soft">last: {#if lastBreastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}</span>
												{/if}
											</div>
											<div class="flex gap-2">
												<button type="button" on:click={() => (manualSide = 'left')} class="{manualSide === 'left' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line hover:border-line-soft'} flex-1 px-3 py-2 rounded-md border text-sm font-semibold transition-colors">
													<ArrowLeft class="w-4 h-4 inline mr-1" /> Left
												</button>
												<button type="button" on:click={() => (manualSide = 'right')} class="{manualSide === 'right' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line hover:border-line-soft'} flex-1 px-3 py-2 rounded-md border text-sm font-semibold transition-colors">
													Right <ArrowRight class="w-4 h-4 inline ml-1" />
												</button>
											</div>
											<div class="flex justify-between mt-2 text-xs text-ink-soft">
												<span>L total: {formatMinutes(leftBreastTotal)}</span>
												<span>R total: {formatMinutes(rightBreastTotal)}</span>
											</div>
										</div>
									{/if}
									{#if manualType && manualType !== 'breast'}
										<div>
											<label for="manual-feed-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
											<input id="manual-feed-amount" type="number" step="0.1" bind:value={manualAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
										</div>
									{/if}
									{#if manualType === 'pump' || manualType === 'solid'}
										<div>
											<label for="manual-feed-end" class="block text-sm font-medium text-ink-soft mb-1">End time (optional)</label>
											<input id="manual-feed-end" type="datetime-local" bind:value={manualEnd} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
									{/if}
									<div>
										<label for="manual-feed-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
										<input id="manual-feed-notes" type="text" bind:value={manualNotes} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Feed</button>
								</form>
							{/if}
						

				</div>
			{:else if activeTab === 'diapers'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- DIAPERS FORM -->

							<h3 class="text-xl font-display font-semibold mb-4">Log Diaper</h3>
							<form on:submit={saveDiaperManual} class="space-y-4">
								<div>
									<div class="block text-sm font-medium text-ink-soft mb-2">Type</div>
									<div class="grid grid-cols-4 gap-3">
										<button type="button" on:click={() => (diaperType = 'wet')} class="{diaperType === 'wet' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
											<Droplet class="w-6 h-6 mb-1" aria-hidden="true" /> Wet
										</button>
										<button type="button" on:click={() => (diaperType = 'dirty')} class="{diaperType === 'dirty' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
											<AlertCircle class="w-6 h-6 mb-1" aria-hidden="true" /> Dirty
										</button>
										<button type="button" on:click={() => (diaperType = 'both')} class="{diaperType === 'both' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
											<Activity class="w-6 h-6 mb-1" aria-hidden="true" /> Both
										</button>
									</div>
								</div>

								<div class="grid grid-cols-2 gap-3">
									<div>
										<label for="diaper-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
										<input id="diaper-time" type="datetime-local" bind:value={diaperTime} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<div>
										<label for="diaper-consistency" class="block text-sm font-medium text-ink-soft mb-1">Consistency</label>
										<select id="diaper-consistency" bind:value={diaperConsistency} class="w-full px-3 py-2 border border-line rounded-md">
											<option value="">—</option>
											{#each currentCategoryOptions('diapers', 'consistency') as opt}
												<option value={opt}>{opt}</option>
											{/each}
										</select>
									</div>
								</div>

								<div class="grid grid-cols-2 gap-3">
									<div>
										<label for="diaper-color" class="block text-sm font-medium text-ink-soft mb-1">Color (optional)</label>
										<select id="diaper-color" bind:value={diaperColor} class="w-full px-3 py-2 border border-line rounded-md">
											<option value="">—</option>
											{#each currentCategoryOptions('diapers', 'color') as opt}
												<option value={opt}>{opt}</option>
											{/each}
										</select>
									</div>
									<div>
										<label for="diaper-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
										<input id="diaper-notes" type="text" bind:value={diaperNotes} class="w-full px-3 py-2 border border-line rounded-md" placeholder="rash, etc." />
									</div>
								</div>

								<button type="submit" disabled={savingDiaper} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">
									{savingDiaper ? 'Saving...' : 'Save Diaper'}
								</button>
							</form>
						

				</div>
			{:else if activeTab === 'sleep'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- SLEEP FORM -->

							<div class="flex items-center justify-between mb-4">
								<h3 class="text-xl font-display font-semibold">Sleep</h3>
								<div class="flex items-center gap-2">
									<button type="button" on:click={() => setSleepMode('log')} class="{sleepMode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
									<button type="button" on:click={() => setSleepMode('timer')} class="{sleepMode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
								</div>
							</div>
							{#if sleepMode === 'timer'}
								{#if sleepStartedAt}
									<div class="text-center mb-4">
										<p class="text-5xl font-display font-bold text-ink-soft">{formatElapsed(sleepTotalMs)}</p>
										<p class="text-sm text-ink-soft">sleeping since {formatTime(new Date(sleepStartedAt).toISOString())}</p>
									</div>
								{/if}
								<div class="mb-3">
									<label for="sleep-location" class="block text-sm font-medium text-ink-soft mb-1">Location</label>
									<select id="sleep-location" bind:value={sleepLocation} class="w-full px-3 py-2 border border-line rounded-md">
										<option value="crib">Crib</option>
										<option value="bassinet">Bassinet</option>
										<option value="stroller">Stroller</option>
										<option value="carrier">Carrier</option>
										<option value="other">Other</option>
									</select>
								</div>
								<div class="mb-3">
									<label for="sleep-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
									<input id="sleep-notes" type="text" bind:value={sleepNotes} class="w-full px-3 py-2 border border-line rounded-md" />
								</div>
								{#if sleepStartedAt}
									<div class="flex gap-4">
										<button type="button" on:click={stopSleep} class="flex-1 bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Wake & Save</button>
										<button type="button" on:click={cancelSleep} class="bg-surface2 text-ink-soft py-2 px-4 rounded-md hover:bg-line-soft">Cancel</button>
									</div>
								{:else}
									<button type="button" on:click={startSleep} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary text-lg font-display font-semibold"><Moon class="w-5 h-5 inline mr-2" /> Start Sleep</button>
								{/if}
							{:else}
								<form on:submit={saveManualSleep} class="space-y-3">
									<div>
										<label for="sleep-start" class="block text-sm font-medium text-ink-soft mb-1">Start date &amp; time</label>
										<input id="sleep-start" type="datetime-local" bind:value={sleepTime} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Sleep</button>
								</form>
							{/if}
						

				</div>
			{:else if activeTab === 'growth'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- GROWTH FORM -->

							<h3 class="text-xl font-display font-semibold mb-4">New Measurement</h3>
							<form on:submit={saveManualGrowth}>
								<div class="mb-3">
									<label for="growth-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
									<input id="growth-time-inline" type="datetime-local" bind:value={growthTime} class="w-full px-3 py-2 border border-line rounded-md" />
								</div>
								<div class="mb-3">
									<label for="growth-unit-inline" class="block text-sm font-medium text-ink-soft mb-1">Units</label>
									<select id="growth-unit-inline" bind:value={growthUnit} class="w-full px-3 py-2 border border-line rounded-md">
										<option value="metric">Metric (kg / cm)</option>
										<option value="imperial">Imperial (lbs / inches)</option>
									</select>
								</div>
								<div class="mb-3">
									<label for="growth-weight-inline" class="block text-sm font-medium text-ink-soft mb-1">Weight ({growthUnit === 'metric' ? 'kg' : 'lbs'})</label>
									<input id="growth-weight-inline" type="number" step="0.1" bind:value={growthWeight} class="w-full px-3 py-2 border border-line rounded-md" placeholder="7.2" />
								</div>
								<div class="mb-3">
									<label for="growth-length-inline" class="block text-sm font-medium text-ink-soft mb-1">Length ({growthUnit === 'metric' ? 'cm' : 'inches'})</label>
									<input id="growth-length-inline" type="number" step="0.1" bind:value={growthHeight} class="w-full px-3 py-2 border border-line rounded-md" placeholder="64.1" />
								</div>
								<div class="mb-3">
									<label for="growth-head-inline" class="block text-sm font-medium text-ink-soft mb-1">Head Circumference ({growthUnit === 'metric' ? 'cm' : 'inches'})</label>
									<input id="growth-head-inline" type="number" step="0.1" bind:value={growthHead} class="w-full px-3 py-2 border border-line rounded-md" placeholder="40.2" />
								</div>
								<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Measurement</button>
							</form>
						

				</div>
		{:else if activeTab === 'pumping'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- PUMPING FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log a pump session</h3>
						<form on:submit={saveManualFeed} class="space-y-3">
							<div>
								<label for="pump-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="pump-time-inline" type="datetime-local" bind:value={manualStart} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="pump-volume-inline" class="block text-sm font-medium text-ink-soft mb-1">Volume (oz)</label>
								<input id="pump-volume-inline" type="number" step="0.1" bind:value={manualAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.0" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Pump</button>
						</form>
					

				</div>
		{:else if activeTab === 'milestones' || activeTab === 'firsts'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- MILESTONES FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">{activeTab === 'firsts' ? 'Log a First' : 'Log a Milestone'}</h3>
						<form on:submit={saveManualMilestone} class="space-y-3">
							<div>
								<label for="milestone-name-inline" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
								<input id="milestone-name-inline" type="text" bind:value={milestoneTitle} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="First smile, rolled over…" />
							</div>
							<div>
								<label for="milestone-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="milestone-time-inline" type="datetime-local" bind:value={milestoneTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="milestone-category-inline" class="block text-sm font-medium text-ink-soft mb-1">Category</label>
								<select id="milestone-category-inline" bind:value={milestoneCategory} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="motor">Motor</option>
									<option value="cognitive">Cognitive</option>
									<option value="social">Social</option>
									<option value="communication">Communication</option>
									<option value="firsts">First</option>
									<option value="other">Other</option>
								</select>
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">{activeTab === 'firsts' ? 'Save First' : 'Save Milestone'}</button>
						</form>
					

				</div>
		{:else if activeTab === 'vaccines'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- VACCINES FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log a Vaccine</h3>
						<form on:submit={saveManualVaccine} class="space-y-3">
							<div>
								<label for="vaccine-name-inline" class="block text-sm font-medium text-ink-soft mb-1">Vaccine name</label>
								<input id="vaccine-name-inline" type="text" bind:value={vaccineName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Hepatitis B, DTaP…" />
							</div>
							<div>
								<label for="vaccine-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="vaccine-time-inline" type="datetime-local" bind:value={vaccineTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="vaccine-notes-inline" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
								<input id="vaccine-notes-inline" type="text" bind:value={vaccineNotes} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Vaccine</button>
						</form>
					

				</div>
		{:else if activeTab === 'routines' || activeTab === 'medical'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- ROUTINES FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log {CATEGORIES.find((c) => c.id === activeTab)?.label}</h3>
						<form on:submit={saveManualMilestone} class="space-y-3">
							<div>
								<label for="routine-description-inline" class="block text-sm font-medium text-ink-soft mb-1">Description</label>
								<input id="routine-description-inline" type="text" bind:value={milestoneTitle} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Bath, vitamin, medication…" />
							</div>
							<div>
								<label for="routine-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="routine-time-inline" type="datetime-local" bind:value={milestoneTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save</button>
						</form>
					

				</div>
		{:else if activeTab === 'moods'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- MOODS FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log Mood</h3>
						<form on:submit={saveMood} class="space-y-3">
							<div class="mb-3">
								<div class="block text-sm font-medium text-ink-soft mb-1">Mood</div>
								<div class="flex flex-wrap gap-2">
									{#each currentCategoryOptions('moods', 'mood') as opt}
										<button type="button" on:click={() => (moodMood = opt)} class="{moodMood === opt ? 'bg-accent border-accent text-ink' : 'bg-surface2 text-ink-soft border-line-soft'} px-3 py-2 rounded-full border text-sm">{opt}</button>
									{/each}
								</div>
							</div>
							<div>
								<label for="mood-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="mood-time-inline" type="datetime-local" bind:value={moodTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="mood-notes-inline" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
								<input id="mood-notes-inline" type="text" bind:value={moodNotes} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Mood</button>
						</form>
					

				</div>
		{:else if activeTab === 'journal'}
				<div class="bg-surface rounded-xl shadow-sm border border-line-soft p-4 mb-6 max-w-2xl">
		<!-- JOURNAL FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">New Journal Entry</h3>
						<form on:submit={saveJournal} class="space-y-3">
							<div>
								<label for="journal-title-inline" class="block text-sm font-medium text-ink-soft mb-1">Title</label>
								<input id="journal-title-inline" type="text" bind:value={journalTitle} class="w-full px-3 py-2 border border-line rounded-md" placeholder="First walk, doctor visit…" />
							</div>
							<div>
								<label for="journal-body-inline" class="block text-sm font-medium text-ink-soft mb-1">Note</label>
								<textarea id="journal-body-inline" bind:value={journalBody} rows="4" class="w-full px-3 py-2 border border-line rounded-md" placeholder="What happened today…"></textarea>
							</div>
							<div>
								<label for="journal-time-inline" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="journal-time-inline" type="datetime-local" bind:value={journalTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Entry</button>
						</form>
				</div>
{/if}
{/if}
{/if}
{/if}
		{#if editingRecord}
			<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
				<button type="button" class="absolute inset-0 bg-ink/40" aria-label="Close dialog" on:click={() => (editingRecord = null)}></button>
				<div class="relative bg-surface rounded-lg shadow-card p-4 md:p-6 w-full max-w-md">
					<h3 class="text-xl font-display font-semibold mb-4">Edit record</h3>
					<div class="mb-3">
					<label for="edit-record-time" class="block text-sm font-medium text-ink-soft mb-1">When</label>
					<input id="edit-record-time" type="datetime-local" bind:value={editTime} class="w-full px-3 py-2 border border-line rounded-md" />
					</div>
					<div class="mb-4">
					<label for="edit-record-note" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
					<textarea id="edit-record-note" bind:value={editNote} rows="3" class="w-full px-3 py-2 border border-line rounded-md" placeholder="Optional notes"></textarea>
					</div>
					<div class="flex justify-end gap-2">
						<button type="button" on:click={() => (editingRecord = null)} class="px-4 py-2 bg-surface2 text-ink-soft rounded-md">Cancel</button>
						<button type="button" on:click={saveEdit} class="px-4 py-2 bg-primary text-on-primary rounded-md">Save</button>
					</div>
				</div>
			</div>
		{/if}

		{#if editingMember}
			<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
				<button type="button" class="absolute inset-0 bg-ink/40" aria-label="Close dialog" on:click={() => (editingMember = null)}></button>
				<div class="relative bg-surface rounded-lg shadow-card p-4 md:p-6 w-full max-w-md">
					<h3 class="text-xl font-display font-semibold mb-4">Edit family member</h3>
					<div class="flex items-center gap-3 mb-4">
						<div class="w-16 h-16 rounded-full bg-accent text-on-accent flex items-center justify-center font-display text-2xl overflow-hidden">
							<Avatar familyId={activeFamilyId} memberId={editingMember?.id} avatar={editingMember?.avatar} alt={editingMember?.name} class="w-full h-full object-cover">
								{editMemberName[0] || '?'}
							</Avatar>
						</div>
						<div>
							<label for="member-avatar" class="block text-sm font-medium text-ink-soft mb-1">Profile photo</label>
							<input id="member-avatar" type="file" accept="image/*" on:change={onMemberAvatarSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
						</div>
					</div>
					<form on:submit={saveEditMember} class="space-y-3">
						<div>
						<label for="edit-member-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
						<input id="edit-member-name" type="text" bind:value={editMemberName} class="w-full px-3 py-2 border border-line rounded-md" />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
							<label for="edit-member-birth" class="block text-sm font-medium text-ink-soft mb-1">Birth Date</label>
							<input id="edit-member-birth" type="date" bind:value={editMemberBirthDate} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
							<label for="edit-member-sex" class="block text-sm font-medium text-ink-soft mb-1">Sex</label>
							<select id="edit-member-sex" bind:value={editMemberGender} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="female">Female</option>
									<option value="male">Male</option>
									<option value="other">Other</option>
								</select>
							</div>
						</div>
						<div>
						<label for="edit-member-email" class="block text-sm font-medium text-ink-soft mb-1">Email (for invites)</label>
						<div class="flex gap-2">
							<input id="edit-member-email" type="email" bind:value={editMemberEmail} class="flex-1 px-3 py-2 border border-line rounded-md" placeholder="person@email.com" />
								<button type="button" on:click={() => inviteMemberEmail(editMemberEmail)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:text-ink"><Mail class="w-4 h-4 inline mr-1" /> Invite</button>
							</div>
						</div>
						<div class="flex justify-end gap-2">
							<button type="button" on:click={deleteEditMember} class="px-4 py-2 bg-danger text-danger-text rounded-md"><Trash2 class="w-4 h-4 inline mr-1" /> Delete</button>
							<button type="button" on:click={closeEditMember} class="px-4 py-2 bg-surface2 text-ink-soft rounded-md">Cancel</button>
							<button type="submit" class="px-4 py-2 bg-primary text-on-primary rounded-md">Save</button>
						</div>
					</form>
				</div>
			</div>
		{/if}


<LogSheet bind:open={sheetOpen} title="Log {CATEGORIES.find(c => c.id === activeTab)?.label || 'Activity'}">
	{#if activeTab === 'feeds'}
		<!-- FEEDS FORM -->

							<div class="flex items-center justify-between mb-4">
								<h3 class="text-xl font-display font-semibold">Feed</h3>
								<div class="flex items-center gap-2">
									<button type="button" on:click={() => setFeedMode('log')} class="{feedMode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
									<button type="button" on:click={() => setFeedMode('timer')} class="{feedMode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
								</div>
							</div>
							{#if feedMode === 'timer'}
								<div class="mb-3 text-sm text-ink-soft">Timer mode is available for breast feeds only.</div>

								{#if feedType === 'breast'}
									<div class="flex items-center justify-between mb-2">
										<div class="block text-sm font-medium text-ink-soft">Breast</div>
										{#if lastBreastSide}
											<span class="text-xs text-ink-soft">last: {#if lastBreastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}</span>
										{/if}
									</div>
									<div class="grid grid-cols-2 gap-4 mb-4">
										<div class="rounded-lg border p-4 text-center {leftStartedAt ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}">
											<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Left</p>
											<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(leftTotalMs)}</p>
											<button type="button" on:click={() => toggleSideTimer('left')} class="mt-3 w-full {leftStartedAt ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
												{#if leftStartedAt}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
											</button>
										</div>
										<div class="rounded-lg border p-4 text-center {rightStartedAt ? 'border-primary bg-accent-soft' : 'border-line-soft bg-surface2'}">
											<p class="text-xs text-ink-soft uppercase font-semibold mb-1">Right</p>
											<p class="text-2xl font-display font-semibold text-ink">{formatElapsed(rightTotalMs)}</p>
											<button type="button" on:click={() => toggleSideTimer('right')} class="mt-3 w-full {rightStartedAt ? 'bg-accent text-on-accent' : 'bg-primary text-on-primary'} py-2 px-3 rounded-md text-sm font-semibold hover:opacity-90 transition-opacity">
												{#if rightStartedAt}<Pause class="w-4 h-4 inline mr-1" /> Pause{:else}<Play class="w-4 h-4 inline mr-1" /> Start{/if}
											</button>
										</div>
									</div>
									<div class="flex items-center justify-between mb-3 text-sm">
										<span class="text-ink-soft">Total</span>
										<span class="font-display font-semibold text-ink text-lg">{formatElapsed(feedTotalMs)}</span>
									</div>
									<div class="flex justify-between mt-2 mb-4 text-xs text-ink-soft">
										<span>L total: {formatMinutes(leftBreastTotal)}</span>
										<span>R total: {formatMinutes(rightBreastTotal)}</span>
									</div>
									<div class="flex gap-2">
										<button type="button" on:click={saveFeedTimer} disabled={!hasAnySideTime} class="flex-1 bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">Save</button>
										{#if hasAnySideTime}
											<button type="button" on:click={cancelFeed} class="bg-surface2 text-ink-soft px-4 py-2 rounded-md hover:bg-line-soft">Cancel</button>
										{/if}
									</div>
								{:else}
									<div class="mb-3">
										<label for="sheet-feed-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
										<input id="sheet-feed-amount" type="number" step="0.1" bind:value={feedAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
									</div>
									<button type="button" on:click={saveFeedTimer} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary text-lg font-display font-semibold">Save Feed</button>
								{/if}
							{:else}
								<form on:submit={saveManualFeed} class="space-y-3">
									<div class="flex gap-2 items-center">
										<div class="flex-1">
											<label for="sheet-manual-start" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time (start)</label>
											<input id="sheet-manual-start" type="datetime-local" bind:value={manualStart} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
										<div class="pt-5">
											<button type="button" on:click={repeatLastFeed} title="Repeat last selection" class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:bg-line-soft"><RotateCcw class="w-4 h-4 inline mr-1" /> Repeat last</button>
										</div>
									</div>
									<div>
										<div class="block text-sm font-medium text-ink-soft mb-1">BreastFeed, Bottle Feed, or Combo?</div>
										<div class="grid grid-cols-3 gap-2">
											<button type="button" on:click={() => chooseManualFeedType('breast')} class="{manualType === 'breast' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Heart class="w-4 h-4" /> BreastFeed</button>
											<button type="button" on:click={() => chooseManualFeedType('bottle')} class="{manualType === 'bottle' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Baby class="w-4 h-4" /> Bottle Feed</button>
											<button type="button" on:click={() => chooseManualFeedType('combo')} class="{manualType === 'combo' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft'} border rounded-lg py-2 px-3 text-sm font-semibold flex items-center justify-center gap-2"><Infinity class="w-4 h-4" /> Combo</button>
										</div>
									</div>
									{#if manualType === 'bottle' || manualType === 'combo'}
										<div>
											<label for="sheet-manual-bottle-source" class="block text-sm font-medium text-ink-soft mb-1">Bottle contents</label>
											<select id="sheet-manual-bottle-source" bind:value={manualBottleSource} class="w-full px-3 py-2 border border-line rounded-md">
												<option value="breastmilk">Breast milk</option>
												<option value="formula">Formula</option>
											</select>
										</div>
									{/if}
									{#if (manualType === 'bottle' || manualType === 'combo') && manualBottleSource === 'formula'}
										<div>
											<label for="sheet-manual-formula" class="block text-sm font-medium text-ink-soft mb-1">Formula</label>
											<div class="flex gap-2">
												<select id="sheet-manual-formula" bind:value={manualFormulaId} class="flex-1 px-3 py-2 border border-line rounded-md">
													<option value="">—</option>
													{#each formulas as f}
													<option value={f.id}>{f.name}{f.brand ? ` (${f.brand})` : ''} · {f.formulaType || 'standard'}</option>
													{/each}
												</select>
												<button type="button" on:click={() => (showAddFormula = !showAddFormula)} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md"><Plus class="w-4 h-4" /></button>
											</div>
											{#if showAddFormula}
												<div class="flex gap-2 mt-2">
													<input type="text" bind:value={newFormulaName} placeholder="Formula name" class="flex-1 px-3 py-2 border border-line rounded-md" />
													<input type="text" bind:value={newFormulaBrand} placeholder="Brand" class="flex-1 px-3 py-2 border border-line rounded-md" />
													<select bind:value={newFormulaType} class="flex-1 px-3 py-2 border border-line rounded-md">
														{#each FORMULA_TYPES as t}
															<option value={t}>{t}</option>
														{/each}
													</select>
													<button type="button" on:click={addFormula} class="px-3 py-2 bg-primary text-on-primary rounded-md">Add</button>
												</div>
{/if}
									</div>
									{/if}
									{#if manualType === 'breast' || manualType === 'combo'}
										<div>
											<div class="flex items-center justify-between mb-1">
												<div class="block text-sm font-medium text-ink-soft">Breast</div>
												{#if lastBreastSide}
											<span class="text-xs text-ink-soft">last: {#if lastBreastSide === 'left'}<ArrowLeft class="w-3 h-3 inline mr-1" /> left{:else}right <ArrowRight class="w-3 h-3 inline ml-1" />{/if}</span>
												{/if}
											</div>
											<div class="flex gap-2">
												<button type="button" on:click={() => (manualSide = 'left')} class="{manualSide === 'left' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line hover:border-line-soft'} flex-1 px-3 py-2 rounded-md border text-sm font-semibold transition-colors">
													<ArrowLeft class="w-4 h-4 inline mr-1" /> Left
												</button>
												<button type="button" on:click={() => (manualSide = 'right')} class="{manualSide === 'right' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line hover:border-line-soft'} flex-1 px-3 py-2 rounded-md border text-sm font-semibold transition-colors">
													Right <ArrowRight class="w-4 h-4 inline ml-1" />
												</button>
											</div>
											<div class="flex justify-between mt-2 text-xs text-ink-soft">
												<span>L total: {formatMinutes(leftBreastTotal)}</span>
												<span>R total: {formatMinutes(rightBreastTotal)}</span>
											</div>
										</div>
									{/if}
									{#if manualType && manualType !== 'breast'}
										<div>
											<label for="sheet-manual-amount" class="block text-sm font-medium text-ink-soft mb-1">Amount (oz)</label>
											<input id="sheet-manual-amount" type="number" step="0.1" bind:value={manualAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.5" />
										</div>
									{/if}
									{#if manualType === 'pump' || manualType === 'solid'}
										<div>
											<label for="sheet-manual-end" class="block text-sm font-medium text-ink-soft mb-1">End time (optional)</label>
											<input id="sheet-manual-end" type="datetime-local" bind:value={manualEnd} class="w-full px-3 py-2 border border-line rounded-md" />
										</div>
									{/if}
									<div>
										<label for="sheet-manual-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
										<input id="sheet-manual-notes" type="text" bind:value={manualNotes} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Feed</button>
								</form>
							{/if}
						

	{:else if activeTab === 'diapers'}
		<!-- DIAPERS FORM -->

							<h3 class="text-xl font-display font-semibold mb-4">Log Diaper</h3>
							<form on:submit={saveDiaperManual} class="space-y-4">
								<div>
									<div class="block text-sm font-medium text-ink-soft mb-2">Type</div>
									<div class="grid grid-cols-4 gap-3">
										<button type="button" on:click={() => (diaperType = 'wet')} class="{diaperType === 'wet' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
											<Droplet class="w-6 h-6 mb-1" aria-hidden="true" /> Wet
										</button>
										<button type="button" on:click={() => (diaperType = 'dirty')} class="{diaperType === 'dirty' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
											<AlertCircle class="w-6 h-6 mb-1" aria-hidden="true" /> Dirty
										</button>
										<button type="button" on:click={() => (diaperType = 'both')} class="{diaperType === 'both' ? 'bg-primary text-on-primary border-primary' : 'bg-surface text-ink-soft border-line-soft hover:border-line'} border rounded-lg py-4 flex flex-col items-center gap-1 text-sm font-semibold transition-colors">
											<Activity class="w-6 h-6 mb-1" aria-hidden="true" /> Both
										</button>
									</div>
								</div>

								<div class="grid grid-cols-2 gap-3">
									<div>
										<label for="diaper-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
										<input id="diaper-time" type="datetime-local" bind:value={diaperTime} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<div>
										<label for="diaper-consistency" class="block text-sm font-medium text-ink-soft mb-1">Consistency</label>
										<select id="diaper-consistency" bind:value={diaperConsistency} class="w-full px-3 py-2 border border-line rounded-md">
											<option value="">—</option>
											{#each currentCategoryOptions('diapers', 'consistency') as opt}
												<option value={opt}>{opt}</option>
											{/each}
										</select>
									</div>
								</div>

								<div class="grid grid-cols-2 gap-3">
									<div>
										<label for="diaper-color" class="block text-sm font-medium text-ink-soft mb-1">Color (optional)</label>
										<select id="diaper-color" bind:value={diaperColor} class="w-full px-3 py-2 border border-line rounded-md">
											<option value="">—</option>
											{#each currentCategoryOptions('diapers', 'color') as opt}
												<option value={opt}>{opt}</option>
											{/each}
										</select>
									</div>
									<div>
										<label for="diaper-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
										<input id="diaper-notes" type="text" bind:value={diaperNotes} class="w-full px-3 py-2 border border-line rounded-md" placeholder="rash, etc." />
									</div>
								</div>

								<button type="submit" disabled={savingDiaper} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary disabled:opacity-50 text-lg font-display font-semibold">
									{savingDiaper ? 'Saving...' : 'Save Diaper'}
								</button>
							</form>
						

	{:else if activeTab === 'sleep'}
		<!-- SLEEP FORM -->

							<div class="flex items-center justify-between mb-4">
								<h3 class="text-xl font-display font-semibold">Sleep</h3>
								<div class="flex items-center gap-2">
									<button type="button" on:click={() => setSleepMode('log')} class="{sleepMode === 'log' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><PenLine class="w-4 h-4" /> Log</button>
									<button type="button" on:click={() => setSleepMode('timer')} class="{sleepMode === 'timer' ? 'bg-accent text-on-accent border-accent' : 'bg-surface2 text-ink-soft border-line-soft'} h-11 px-4 rounded-full text-sm border flex items-center gap-2 whitespace-nowrap font-semibold transition-colors"><Timer class="w-4 h-4" /> Timer</button>
								</div>
							</div>
							{#if sleepMode === 'timer'}
								{#if sleepStartedAt}
									<div class="text-center mb-4">
										<p class="text-5xl font-display font-bold text-ink-soft">{formatElapsed(sleepTotalMs)}</p>
										<p class="text-sm text-ink-soft">sleeping since {formatTime(new Date(sleepStartedAt).toISOString())}</p>
									</div>
								{/if}
								<div class="mb-3">
									<label for="sleep-location" class="block text-sm font-medium text-ink-soft mb-1">Location</label>
									<select id="sleep-location" bind:value={sleepLocation} class="w-full px-3 py-2 border border-line rounded-md">
										<option value="crib">Crib</option>
										<option value="bassinet">Bassinet</option>
										<option value="stroller">Stroller</option>
										<option value="carrier">Carrier</option>
										<option value="other">Other</option>
									</select>
								</div>
								<div class="mb-3">
									<label for="sleep-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
									<input id="sleep-notes" type="text" bind:value={sleepNotes} class="w-full px-3 py-2 border border-line rounded-md" />
								</div>
								{#if sleepStartedAt}
									<div class="flex gap-4">
										<button type="button" on:click={stopSleep} class="flex-1 bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Wake & Save</button>
										<button type="button" on:click={cancelSleep} class="bg-surface2 text-ink-soft py-2 px-4 rounded-md hover:bg-line-soft">Cancel</button>
									</div>
								{:else}
									<button type="button" on:click={startSleep} class="w-full bg-primary text-on-primary py-3 px-4 rounded-md hover:bg-primary text-lg font-display font-semibold"><Moon class="w-5 h-5 inline mr-2" /> Start Sleep</button>
								{/if}
							{:else}
								<form on:submit={saveManualSleep} class="space-y-3">
									<div>
										<label for="sleep-start" class="block text-sm font-medium text-ink-soft mb-1">Start date &amp; time</label>
										<input id="sleep-start" type="datetime-local" bind:value={sleepTime} class="w-full px-3 py-2 border border-line rounded-md" />
									</div>
									<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Sleep</button>
								</form>
							{/if}
						

	{:else if activeTab === 'growth'}
		<!-- GROWTH FORM -->

							<h3 class="text-xl font-display font-semibold mb-4">New Measurement</h3>
							<form on:submit={saveManualGrowth}>
								<div class="mb-3">
									<label for="growth-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
									<input id="growth-time" type="datetime-local" bind:value={growthTime} class="w-full px-3 py-2 border border-line rounded-md" />
								</div>
								<div class="mb-3">
									<label for="growth-unit" class="block text-sm font-medium text-ink-soft mb-1">Units</label>
									<select id="growth-unit" bind:value={growthUnit} class="w-full px-3 py-2 border border-line rounded-md">
										<option value="metric">Metric (kg / cm)</option>
										<option value="imperial">Imperial (lbs / inches)</option>
									</select>
								</div>
								<div class="mb-3">
									<label for="growth-weight" class="block text-sm font-medium text-ink-soft mb-1">Weight ({growthUnit === 'metric' ? 'kg' : 'lbs'})</label>
									<input id="growth-weight" type="number" step="0.1" bind:value={growthWeight} class="w-full px-3 py-2 border border-line rounded-md" placeholder="7.2" />
								</div>
								<div class="mb-3">
									<label for="growth-height" class="block text-sm font-medium text-ink-soft mb-1">Length ({growthUnit === 'metric' ? 'cm' : 'inches'})</label>
									<input id="growth-height" type="number" step="0.1" bind:value={growthHeight} class="w-full px-3 py-2 border border-line rounded-md" placeholder="64.1" />
								</div>
								<div class="mb-3">
									<label for="growth-head" class="block text-sm font-medium text-ink-soft mb-1">Head Circumference ({growthUnit === 'metric' ? 'cm' : 'inches'})</label>
									<input id="growth-head" type="number" step="0.1" bind:value={growthHead} class="w-full px-3 py-2 border border-line rounded-md" placeholder="40.2" />
								</div>
								<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Measurement</button>
							</form>
						

	{:else if activeTab === 'pumping'}
		<!-- PUMPING FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log a pump session</h3>
						<form on:submit={saveManualFeed} class="space-y-3">
							<div>
							<label for="pump-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
							<input id="pump-time" type="datetime-local" bind:value={manualStart} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
							<label for="pump-volume" class="block text-sm font-medium text-ink-soft mb-1">Volume (oz)</label>
							<input id="pump-volume" type="number" step="0.1" bind:value={manualAmount} class="w-full px-3 py-2 border border-line rounded-md" placeholder="4.0" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Pump</button>
						</form>
					

	{:else if activeTab === 'milestones' || activeTab === 'firsts'}
		<!-- MILESTONES FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">{activeTab === 'firsts' ? 'Log a First' : 'Log a Milestone'}</h3>
						<form on:submit={saveManualMilestone} class="space-y-3">
							<div>
								<label for="milestone-name" class="block text-sm font-medium text-ink-soft mb-1">Name</label>
								<input id="milestone-name" type="text" bind:value={milestoneTitle} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="First smile, rolled over…" />
							</div>
							<div>
								<label for="milestone-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="milestone-time" type="datetime-local" bind:value={milestoneTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="milestone-category" class="block text-sm font-medium text-ink-soft mb-1">Category</label>
								<select id="milestone-category" bind:value={milestoneCategory} class="w-full px-3 py-2 border border-line rounded-md">
									<option value="motor">Motor</option>
									<option value="cognitive">Cognitive</option>
									<option value="social">Social</option>
									<option value="communication">Communication</option>
									<option value="firsts">First</option>
									<option value="other">Other</option>
								</select>
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">{activeTab === 'firsts' ? 'Save First' : 'Save Milestone'}</button>
						</form>
					

	{:else if activeTab === 'vaccines'}
		<!-- VACCINES FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log a Vaccine</h3>
						<form on:submit={saveManualVaccine} class="space-y-3">
							<div>
								<label for="vaccine-name" class="block text-sm font-medium text-ink-soft mb-1">Vaccine name</label>
								<input id="vaccine-name" type="text" bind:value={vaccineName} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Hepatitis B, DTaP…" />
							</div>
							<div>
								<label for="vaccine-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="vaccine-time" type="datetime-local" bind:value={vaccineTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="vaccine-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes (optional)</label>
								<input id="vaccine-notes" type="text" bind:value={vaccineNotes} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Vaccine</button>
						</form>
					

	{:else if activeTab === 'routines' || activeTab === 'medical'}
		<!-- ROUTINES FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log {CATEGORIES.find((c) => c.id === activeTab)?.label}</h3>
						<form on:submit={saveManualMilestone} class="space-y-3">
							<div>
								<label for="routine-description" class="block text-sm font-medium text-ink-soft mb-1">Description</label>
								<input id="routine-description" type="text" bind:value={milestoneTitle} required class="w-full px-3 py-2 border border-line rounded-md" placeholder="Bath, vitamin, medication…" />
							</div>
							<div>
								<label for="routine-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="routine-time" type="datetime-local" bind:value={milestoneTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save</button>
						</form>
					

	{:else if activeTab === 'moods'}
		<!-- MOODS FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">Log Mood</h3>
						<form on:submit={saveMood} class="space-y-3">
							<div class="mb-3">
								<div class="block text-sm font-medium text-ink-soft mb-1">Mood</div>
								<div class="flex flex-wrap gap-2">
									{#each currentCategoryOptions('moods', 'mood') as opt}
										<button type="button" on:click={() => (moodMood = opt)} class="{moodMood === opt ? 'bg-accent border-accent text-ink' : 'bg-surface2 text-ink-soft border-line-soft'} px-3 py-2 rounded-full border text-sm">{opt}</button>
									{/each}
								</div>
							</div>
							<div>
								<label for="mood-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="mood-time" type="datetime-local" bind:value={moodTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<div>
								<label for="mood-notes" class="block text-sm font-medium text-ink-soft mb-1">Notes</label>
								<input id="mood-notes" type="text" bind:value={moodNotes} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Mood</button>
						</form>
					

	{:else if activeTab === 'journal'}
		<!-- JOURNAL FORM -->

						<h3 class="text-xl font-display font-semibold mb-4">New Journal Entry</h3>
						<form on:submit={saveJournal} class="space-y-3">
							<div>
								<label for="journal-title" class="block text-sm font-medium text-ink-soft mb-1">Title</label>
								<input id="journal-title" type="text" bind:value={journalTitle} class="w-full px-3 py-2 border border-line rounded-md" placeholder="First walk, doctor visit…" />
							</div>
							<div>
								<label for="journal-body" class="block text-sm font-medium text-ink-soft mb-1">Note</label>
								<textarea id="journal-body" bind:value={journalBody} rows="4" class="w-full px-3 py-2 border border-line rounded-md" placeholder="What happened today…"></textarea>
							</div>
							<div>
								<label for="journal-time" class="block text-sm font-medium text-ink-soft mb-1">Date &amp; time</label>
								<input id="journal-time" type="datetime-local" bind:value={journalTime} class="w-full px-3 py-2 border border-line rounded-md" />
							</div>
							<button type="submit" class="w-full bg-primary text-on-primary py-2 px-4 rounded-md hover:bg-primary">Save Entry</button>
						</form>
	{/if}
</LogSheet>
