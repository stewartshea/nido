<script lang="ts">
	import { onDestroy } from 'svelte';
	import { attachmentsAPI, type AttachmentMeta } from '$lib/api';
	import { FileText, Paperclip } from 'lucide-svelte';

	/**
	 * One stored file, rendered as a thumbnail (images in the feed) or a compact
	 * file pill (anything else, and everything in the table).
	 *
	 * The bytes come from the authenticated endpoint, so the browser cannot load
	 * them straight from a URL — a plain <img>/<a> sends no Authorization header
	 * and the API answers 401 instead of bytes. This fetches through the axios
	 * client and hands back an object URL instead. Images load eagerly so the row
	 * reads at a glance; other files wait for the click, so a page of PDFs is not
	 * a page of downloads.
	 */
	export let attachment: AttachmentMeta;
	export let variant: 'thumb' | 'chip' = 'thumb';

	let objectUrl: string | null = null;
	let requested = false;
	let failed = false;

	$: isImage = String(attachment.contentType || '').startsWith('image/');
	$: label = attachment.filename || (isImage ? 'Image' : 'File');
	$: showThumb = variant === 'thumb' && isImage;

	function revoke() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	async function ensureUrl(): Promise<string | null> {
		if (objectUrl) return objectUrl;
		try {
			const res = await attachmentsAPI.file(attachment.id);
			objectUrl = URL.createObjectURL(res.data);
			return objectUrl;
		} catch {
			failed = true;
			return null;
		}
	}

	$: if (showThumb && !requested && !failed) {
		requested = true;
		ensureUrl();
	}

	function open() {
		// A prefetched thumbnail opens synchronously, which is the path a click
		// normally takes; anything still to be fetched goes through an anchor
		// once the bytes land, since window.open after an await reads as a popup.
		if (objectUrl) {
			window.open(objectUrl, '_blank', 'noopener,noreferrer');
			return;
		}
		ensureUrl().then((url) => {
			if (!url) return;
			const a = document.createElement('a');
			a.href = url;
			if (isImage) a.target = '_blank';
			else a.download = label;
			document.body.appendChild(a);
			a.click();
			a.remove();
		});
	}

	function sizeLabel(bytes: number): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	onDestroy(revoke);
</script>

{#if showThumb}
	<button
		type="button"
		on:click={open}
		title={label}
		aria-label="Open {label}"
		class="w-11 h-11 shrink-0 rounded-md overflow-hidden border border-line-soft bg-surface2 hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
	>
		{#if objectUrl}
			<img src={objectUrl} alt={label} class="w-full h-full object-cover" />
		{:else}
			<span class="w-full h-full flex items-center justify-center text-ink-soft" aria-hidden="true">
				<Paperclip class="w-4 h-4" />
			</span>
		{/if}
	</button>
{:else}
	<button
		type="button"
		on:click={open}
		title={label}
		aria-label="Open {label}"
		class="inline-flex items-center gap-1.5 max-w-[13rem] px-2 h-7 rounded-full border border-line-soft bg-surface2 text-xs text-ink hover:text-accent hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
	>
		{#if isImage}<Paperclip class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{:else}<FileText class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{/if}
		<span class="truncate">{label}</span>
		{#if sizeLabel(attachment.size)}<span class="text-ink-soft shrink-0">{sizeLabel(attachment.size)}</span>{/if}
	</button>
{/if}
