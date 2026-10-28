<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { tokenExpired } from '$lib/api/client';
	import { authAPI, userAPI, familiesAPI } from '$lib/api/family';
	import { importsAPI, familyAdminAPI } from '$lib/api/system';
	import { authActions } from '$lib/stores/authStore';
	import { uiStore, uiActions } from '$lib/stores/uiStore';
	import { notify, fail } from '$lib/stores/feedback';
	import { familyStore, familyActions } from '$lib/stores/family';
	import { loadFamilySettings } from '$lib/stores/familySettings';
	import AccountPanel from '$lib/components/settings/AccountPanel.svelte';
	import ImportPanel from '$lib/components/settings/ImportPanel.svelte';
	import BackupPanel from '$lib/components/settings/BackupPanel.svelte';
	import AdminPanel from '$lib/components/settings/AdminPanel.svelte';
	import FamilyTrackingPanel from '$lib/components/settings/FamilyTrackingPanel.svelte';
	import EditMemberModal from '$lib/components/EditMemberModal.svelte';
	import FeedbackToasts from '$lib/components/FeedbackToasts.svelte';
	import { Users, Home, Settings, ChevronRight, User, Shield, Upload, Download } from 'lucide-svelte';



	$: if ($uiStore.accountPanelOpen) {
		uiActions.setSection('account');
		uiStore.update(s => ({ ...s, accountPanelOpen: false }));
	}

	let isAuthenticated = false;

	// The session context (families, active family, members) lives in
	// $lib/stores/family; the settings row in $lib/stores/familySettings.
	// Aliases keep the template reading the names the page always used.
	$: profiles = $familyStore.profiles;
	$: activeFamily = $familyStore.activeFamily;
	$: activeFamilyId = $familyStore.activeFamilyId;

	let settingsTab: 'profile' | 'family' | 'import' | 'members' | 'backup' | 'admin' | null = null;

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

	// Edit modal state — the shared EditMemberModal owns the form fields.
	let editingMember: any = null;

	// The family/member loading core is familyActions.loadFamilies
	// ($lib/stores/family); this wrapper runs this page's post-load extras.
	// Settings deliberately does NOT ask the settings load to apply the
	// timezone — on this page the layout owns the clock (see
	// loadFamilySettings in $lib/stores/familySettings).
	async function loadFamilies() {
		const loaded = await familyActions.loadFamilies();
		if (!loaded) return;
		await Promise.all([loadFamilySettings(), loadInvitations(), loadImportRuns()]);
	}

	function handleLogout() {
		familyActions.handleLogout();
		isAuthenticated = false;
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

	function openEditMember(baby: any) {
		editingMember = baby;
		fail('');
	}

	function closeEditMember() {
		editingMember = null;
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

	async function deleteEditMember(e: CustomEvent<{ name: string }>) {
		if (!editingMember || !activeFamilyId) return;
		if (!confirm(`Delete "${e.detail.name}" and ALL of their records? This cannot be undone.`)) return;
		try {
			await familiesAPI.removeMember(activeFamilyId, Number(editingMember.id));
			notify('Member deleted.');
			editingMember = null;
			await loadFamilies();
		} catch (err: any) {
			fail(err.response?.data?.error || 'Failed to delete member.');
		}
	}

	async function saveEditMember(e: CustomEvent<Record<string, any>>) {
		if (!editingMember || !activeFamilyId) return;
		try {
			await familiesAPI.updateMember(activeFamilyId, Number(editingMember.id), e.detail);
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

	async function onMemberAvatarSelected(e: CustomEvent<{ file: File }>) {
		const file = e.detail.file;
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
			// The store outlives navigations; a fresh mount while signed out
			// starts empty, like the page-local state this replaced.
			if (!isAuthenticated) familyActions.reset();
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
							<FamilyTrackingPanel {activeFamily} {activeFamilyId} />
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
								<EditMemberModal
									member={editingMember}
									mode="categories"
									familyId={activeFamilyId}
									on:save={saveEditMember}
									on:delete={deleteEditMember}
									on:avatar={onMemberAvatarSelected}
									on:close={closeEditMember}
								/>
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
