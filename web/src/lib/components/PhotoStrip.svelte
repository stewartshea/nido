<script lang="ts">
	import { onMount } from 'svelte';
	import { photosAPI } from '$lib/api';

	export let parentType: string;
	export let parentId: number;

	let photos: any[] = [];
	let urls: Record<number, string> = {};
	let file: File | null = null;
	let loading = false;

	async function fetchPhoto(p: any) {
		const r = await photosAPI.file(p.id);
		urls[p.id] = URL.createObjectURL(r.data);
	}

	// Fetch photo bytes with a small concurrency cap instead of one serial
	// round-trip per photo (was the dominant cost of page load).
	async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
		let i = 0;
		const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) {
				const item = items[i++];
				try {
					await task(item);
				} catch {
					// Skip a failed photo rather than aborting the strip.
				}
			}
		});
		await Promise.all(workers);
	}

	async function load() {
		try {
			const res = await photosAPI.list(parentType, parentId);
			photos = res.data.photos || [];
			await runWithConcurrency(photos, 4, fetchPhoto);
		} catch {
			photos = [];
		}
	}

	async function upload() {
		if (!file) return;
		loading = true;
		try {
			await photosAPI.upload(parentType, parentId, file);
			file = null;
			await load();
		} catch (e: any) {
			alert(e.response?.data?.error || 'Photo upload failed.');
		} finally {
			loading = false;
		}
	}

	async function remove(photoId: number) {
		try {
			await photosAPI.remove(photoId);
			if (urls[photoId]) URL.revokeObjectURL(urls[photoId]);
			await load();
		} catch (e: any) {
			alert(e.response?.data?.error || 'Photo delete failed.');
		}
	}

	onMount(() => { load(); });
</script>

<div class="mt-2 border-t border-line-soft pt-2">
	<div class="flex gap-2 flex-wrap">
		{#each photos as p}
			<div class="relative">
				{#if urls[p.id]}
					<img src={urls[p.id]} alt="photo" class="w-16 h-16 object-cover rounded-md" />
					<button type="button" on:click={() => remove(p.id)} class="absolute -top-3 -right-3 w-11 h-11 flex items-center justify-center text-danger">
						<span class="bg-danger-bg w-6 h-6 rounded-full flex items-center justify-center text-sm">✕</span>
					</button>
				{/if}
			</div>
		{/each}
	</div>
	<label class="flex items-center gap-2 mt-2 text-sm text-ink-soft">
		<input type="file" accept="image/*" on:change={(e) => (file = e.target.files?.[0] ?? null)} class="text-xs" />
		<button type="button" on:click={upload} disabled={loading || !file} class="px-3 py-1 bg-surface2 rounded-md disabled:opacity-50">{loading ? 'Uploading...' : 'Upload'}</button>
	</label>
</div>