<script lang="ts">
	import { goto } from '$app/navigation';
	import { notify, fail } from '$lib/stores/feedback';
	import { accountAPI, familyAdminAPI } from '$lib/api/system';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { Trash2 } from 'lucide-svelte';

	/**
	 * The Profile tab: the signed-in account — password change, account
	 * deletion — and the family membership line under it. Export is passed in
	 * because the Backup tab offers the same download; deleting the family
	 * asks the page to reload its data.
	 */
	export let activeFamily: any = null;
	export let activeFamilyId: string | null = null;
	/** Page-level export — one concern shared with the Backup tab. */
	export let exportFamily: () => void = () => {};
	/** The page's loadFamilies, called after the family is deleted. */
	export let dataChanged: () => Promise<void> | void = () => {};

	let curPw = '';
	let newPw = '';
	let confirmPw = '';
	let changingPw = false;
	let deletingAccount = false;
	let deleteConfirmName = '';

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

	async function deleteFamily() {
		if (!activeFamilyId) return;
		if (!confirm(`Delete "${activeFamily?.name}" and ALL of its data? This cannot be undone.`)) return;
		try {
			await familyAdminAPI.remove(activeFamilyId);
			notify('Family deleted.');
			await dataChanged();
		} catch (err: any) { fail(err.response?.data?.error || 'Failed to delete family.'); }
	}
</script>

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
