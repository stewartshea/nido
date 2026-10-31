<script lang="ts">
	// Files attached to one record — an asset's photos and manuals, or the
	// receipts and before/after shots on a maintenance entry (HOME #68/#69).
	//
	// The bytes live in the family's encrypted blob store, so a plain <img src>
	// or <a href> cannot load them (no Authorization header → 401). Images are
	// fetched through the authenticated client into blob URLs; anything else
	// downloads the same way.
	//
	// The caller passes the attachments it already loaded (the care aggregate
	// carries them all in one query) and re-loads on `change`.
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { attachmentsAPI } from '$lib/api/attachments';
	import type { AttachmentMeta } from '$lib/api/types';

	export let refType: string;
	export let refId: number;
	export let attachments: AttachmentMeta[] = [];
	export let title = 'Photos & files';
	export let accept = 'image/*';
	export let compact = false;

	const dispatch = createEventDispatcher<{ change: void }>();

	let uploading = false;
	let error = '';
	let urls: Record<number, string> = {};

	function isImage(attachment: AttachmentMeta): boolean {
		return attachment.contentType.startsWith('image/');
	}

	async function ensureUrl(attachment: AttachmentMeta) {
		if (!isImage(attachment) || urls[attachment.id]) return;
		try {
			const res = await attachmentsAPI.file(attachment.id);
			urls = { ...urls, [attachment.id]: URL.createObjectURL(res.data) };
		} catch {
			// A file that will not decrypt shows as a chip; the page stays up.
		}
	}

	$: {
		for (const attachment of attachments) ensureUrl(attachment);
	}

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		error = '';
		uploading = true;
		try {
			await attachmentsAPI.upload(refType, refId, file);
			dispatch('change');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not upload that file.';
		} finally {
			uploading = false;
		}
	}

	async function remove(attachment: AttachmentMeta) {
		if (!window.confirm(`Remove ${attachment.filename ?? 'this file'}?`)) return;
		try {
			await attachmentsAPI.remove(attachment.id);
			dispatch('change');
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not remove that file.';
		}
	}

	async function download(attachment: AttachmentMeta) {
		try {
			const res = await attachmentsAPI.file(attachment.id);
			const url = URL.createObjectURL(res.data);
			const link = document.createElement('a');
			link.href = url;
			link.download = attachment.filename ?? 'file';
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch {
			error = 'Could not read that file.';
		}
	}

	onDestroy(() => {
		for (const url of Object.values(urls)) URL.revokeObjectURL(url);
	});
</script>

<div class={compact ? '' : 'bg-surface border border-line-soft rounded-xl p-4'} data-testid={`attachments-${refType}-${refId}`}>
	<div class="flex items-center justify-between gap-3 {compact ? 'mb-1' : 'mb-2'}">
		<p class={compact ? 'text-xs font-semibold text-ink-soft' : 'text-sm font-semibold text-ink'}>
			{title}{attachments.length ? ` (${attachments.length})` : ''}
		</p>
		<label class="text-sm underline text-accent cursor-pointer">
			{uploading ? 'Uploading…' : '+ Add'}
			<input type="file" class="sr-only" {accept} on:change={onFile} disabled={uploading} />
		</label>
	</div>

	{#if error}<p class="text-xs text-danger-text mb-1">{error}</p>{/if}

	{#if attachments.length === 0}
		{#if !compact}
			<p class="text-sm text-ink-soft">Nothing yet. A photo of the model plate or the last receipt is worth more than a note.</p>
		{/if}
	{:else}
		<ul class="flex flex-wrap gap-2">
			{#each attachments as attachment (attachment.id)}
				<li class="relative group" data-testid={`attachment-${attachment.id}`}>
					{#if isImage(attachment) && urls[attachment.id]}
						<button type="button" on:click={() => download(attachment)} title={attachment.filename ?? 'Photo'}>
							<img
								src={urls[attachment.id]}
								alt={attachment.filename ?? 'Attachment'}
								class="{compact ? 'w-14 h-14' : 'w-20 h-20'} rounded-md object-cover border border-line-soft"
							/>
						</button>
					{:else}
						<button type="button" class="text-xs text-ink-soft underline max-w-[10rem] truncate" on:click={() => download(attachment)}>
							{attachment.filename ?? 'File'}
						</button>
					{/if}
					<button
						type="button"
						class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-page border border-line text-ink-soft text-xs leading-none"
						aria-label={`Remove ${attachment.filename ?? 'file'}`}
						on:click={() => remove(attachment)}
					>×</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
