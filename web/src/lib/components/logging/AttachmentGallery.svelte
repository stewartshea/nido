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
	// Which attachment's extracted text is expanded below the gallery. One at
	// a time keeps the compact view compact.
	let openOcrId: number | null = null;

	// Whether a file's text was read for search at all (PRD §7.2): a scan that
	// could not be read must say so, not sit silently unsearchable.
	function isSearchable(attachment: AttachmentMeta): boolean {
		return attachment.ocrStatus === 'done' && !!attachment.ocrText;
	}

	function isNotSearchable(attachment: AttachmentMeta): boolean {
		return attachment.ocrStatus === 'unavailable' || attachment.ocrStatus === 'failed';
	}

	function toggleOcr(id: number) {
		openOcrId = openOcrId === id ? null : id;
	}

	$: openAttachment = attachments.find((a) => a.id === openOcrId) ?? null;

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
		const chosen = Array.from(input.files ?? []);
		input.value = '';
		if (!chosen.length) return;
		error = '';
		uploading = true;
		try {
			for (const file of chosen) {
				await attachmentsAPI.upload(refType, refId, file);
			}
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
			<input type="file" class="sr-only" {accept} multiple on:change={onFile} disabled={uploading} />
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
					{#if isNotSearchable(attachment)}
						<span
							class="block w-fit mt-1 text-[11px] px-1.5 py-0.5 rounded border border-line text-ink-soft"
							title="No text could be read from this file, so it is not searchable."
							data-testid={`attachment-ocr-badge-${attachment.id}`}
						>Not searchable</span>
					{:else if isSearchable(attachment)}
						<button
							type="button"
							class="block w-fit mt-1 text-[11px] px-1.5 py-0.5 rounded border border-line-soft text-accent underline"
							title="Show the text read from this file."
							data-testid={`attachment-ocr-badge-${attachment.id}`}
							on:click={() => toggleOcr(attachment.id)}
						>{openOcrId === attachment.id ? 'Hide text' : 'Searchable'}</button>
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

		{#if openAttachment}
			<div class="mt-2 bg-surface2 border border-line-soft rounded-md p-2">
				<div class="flex items-center justify-between gap-2">
					<p class="text-xs font-semibold text-ink truncate">{openAttachment.filename ?? 'Scanned file'}</p>
					<button type="button" class="text-xs underline text-accent shrink-0" on:click={() => download(openAttachment)}>Open original</button>
				</div>
				<pre class="text-xs text-ink-soft whitespace-pre-wrap bg-page border border-line-soft rounded-md p-2 mt-1 max-h-40 overflow-y-auto">{openAttachment.ocrText}</pre>
			</div>
		{/if}
	{/if}
</div>
