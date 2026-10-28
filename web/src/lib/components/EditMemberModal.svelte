<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import ToggleSwitch from '$lib/components/ToggleSwitch.svelte';
	import { CATEGORIES } from '$lib/shared';
	import { Mail, Trash2 } from 'lucide-svelte';

	/**
	 * The edit-member modal, shared by the family page and the settings
	 * Members tab. The two hand-rolled versions differed by more than the
	 * extra field block (stage picker vs per-member category toggles) — the
	 * overlay, header, field ids/options and footer buttons all differed —
	 * so `mode` switches the whole chrome and each mode renders exactly the
	 * markup its page had. The shared part is this script: the form fields,
	 * the payload builder, and the events.
	 *
	 * The page keeps the member and the API calls: `save` carries the built
	 * payload, `delete` the display name for the page's confirm, `invite`
	 * the typed email, `avatar` the picked file. Render inside an
	 * `{#if member}` guard — the fields are seeded once, when this mounts.
	 */
	export let member: any = null;
	export let mode: 'stage' | 'categories' = 'stage';
	export let familyId: string | null = null;

	const dispatch = createEventDispatcher<{
		save: Record<string, any>;
		delete: { name: string };
		invite: { email: string };
		avatar: { file: File };
		close: undefined;
	}>();

	// The form's own copies, seeded from the member when the modal opens
	// (both pages' openEditMember did exactly this seeding).
	let editMemberName = member?.name || '';
	let editMemberBirthDate = member?.birth_date ? member.birth_date.slice(0, 10) : '';
	let editMemberGender = member?.gender || '';
	let editMemberEmail = member?.email || '';
	// The member's life stage, so the family can identify a legacy child that
	// was created before stages existed (its stage is null in the database).
	let editMemberStage: string | null = member?.stage ?? null;
	// The categories this member tracks, edited in place. Per member rather than
	// per stage: the stage template only decides what a *new* profile starts
	// with, and an existing person's own list is what the log forms actually read.
	let editMemberCategories: string[] = Array.isArray(member?.categories) ? [...member.categories] : [];

	function closeEditMember() {
		dispatch('close');
	}

	function onSave(event: SubmitEvent) {
		event.preventDefault();
		const birthDate = editMemberBirthDate ? new Date(editMemberBirthDate + 'T00:00:00Z').toISOString() : null;
		const payload: Record<string, any> = {
			name: editMemberName.trim(),
			birthDate,
			gender: editMemberGender || null,
			email: editMemberEmail.trim() || null,
		};
		if (mode === 'stage') payload.stage = editMemberStage || null;
		else payload.categories = editMemberCategories;
		dispatch('save', payload);
	}

	function onDelete() {
		dispatch('delete', { name: editMemberName.trim() || member.name });
	}

	function onInvite() {
		dispatch('invite', { email: editMemberEmail });
	}

	function onAvatarSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) dispatch('avatar', { file });
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
</script>

{#if mode === 'stage'}
	<!-- The family page's modal: backdrop-dismiss dialog, stage picker, inline invite. -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
		<button type="button" class="absolute inset-0 bg-ink/40" aria-label="Close dialog" on:click={closeEditMember}></button>
		<div class="relative bg-surface rounded-lg shadow-card p-4 md:p-6 w-full max-w-md">
			<h3 class="text-xl font-display font-semibold mb-4">Edit family member</h3>
			<div class="flex items-center gap-3 mb-4">
				<div class="w-16 h-16 rounded-full bg-accent text-on-accent flex items-center justify-center font-display text-2xl overflow-hidden">
					<Avatar familyId={familyId} memberId={member?.id} avatar={member?.avatar} alt={member?.name} class="w-full h-full object-cover">
						{editMemberName[0] || '?'}
					</Avatar>
				</div>
				<div>
					<label for="member-avatar" class="block text-sm font-medium text-ink-soft mb-1">Profile photo</label>
					<input id="member-avatar" type="file" accept="image/*" on:change={onAvatarSelected} class="block w-full text-sm text-ink border border-line rounded-md file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-on-primary" />
				</div>
			</div>
			<form on:submit={onSave} class="space-y-3">
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
				{#if member?.type === 'child'}
					<div>
					<label for="edit-member-stage" class="block text-sm font-medium text-ink-soft mb-1">Stage</label>
					<select id="edit-member-stage" bind:value={editMemberStage} class="w-full px-3 py-2 border border-line rounded-md">
						<option value="">Not set</option>
						<option value="infant">Infant</option>
						<option value="child">Child</option>
					</select>
					<p class="text-xs text-ink-soft mt-1">Sets which categories this person starts with.</p>
					</div>
				{/if}
				<div>
				<label for="edit-member-email" class="block text-sm font-medium text-ink-soft mb-1">Email (for invites)</label>
				<div class="flex gap-2">
					<input id="edit-member-email" type="email" bind:value={editMemberEmail} class="flex-1 px-3 py-2 border border-line rounded-md" placeholder="person@email.com" />
					<button type="button" on:click={onInvite} class="px-3 py-2 bg-surface2 text-ink-soft rounded-md hover:text-ink"><Mail class="w-4 h-4 inline mr-1" /> Invite</button>
				</div>
				</div>
				<div class="flex justify-end gap-2">
					<button type="button" on:click={onDelete} class="px-4 py-2 bg-danger text-danger-text rounded-md"><Trash2 class="w-4 h-4 inline mr-1" /> Delete</button>
					<button type="button" on:click={closeEditMember} class="px-4 py-2 bg-surface2 text-ink-soft rounded-md">Cancel</button>
					<button type="submit" class="px-4 py-2 bg-primary text-on-primary rounded-md">Save</button>
				</div>
			</form>
		</div>
	</div>
{:else}
	<!-- The settings Members tab's modal: header close, per-member category toggles. -->
	<div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
		<div class="w-full max-w-lg bg-surface border border-line-soft rounded-lg shadow-card p-4 md:p-6">
			<div class="flex items-center justify-between mb-4">
				<h3 class="text-lg font-display font-semibold">Edit member</h3>
				<button type="button" class="text-ink-soft hover:text-ink" on:click={closeEditMember}>Close</button>
			</div>
			<form on:submit={onSave} class="space-y-3">
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
					<input id="edit-member-avatar" type="file" accept="image/*" class="w-full text-sm" on:change={onAvatarSelected} />
				</div>
				<div class="flex items-center justify-between pt-2">
					<button type="button" class="text-danger-text underline text-sm" on:click={onDelete}>Delete member</button>
					<div class="flex items-center gap-2">
						<button type="button" class="px-3 py-2 text-sm border border-line rounded-md" on:click={closeEditMember}>Cancel</button>
						<button type="submit" class="px-3 py-2 text-sm bg-primary text-on-primary rounded-md">Save</button>
					</div>
				</div>
			</form>
		</div>
	</div>
{/if}
