<script lang="ts">
	// An asset photo, served from the authenticated /home-assets/:id/picture
	// endpoint. Same reason as Avatar.svelte and HomePicture.svelte: a plain
	// <img src="/api/..."> sends no Authorization header and gets a 401 instead
	// of bytes, so this fetches through the authenticated client and renders a
	// blob URL. Renders nothing when there is no photo, so the caller's layout
	// works either way.
	import { onDestroy } from 'svelte';
	import { assetsAPI } from '$lib/api/assets';

	export let assetId: number | null | undefined;
	export let picture: number | null | undefined;
	export let alt = '';
	/** Tailwind size classes; the default suits a card thumbnail. */
	export let size = 'w-14 h-14';

	let objectUrl: string | null = null;
	let loadedKey = '';

	function revoke() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	async function load(id: typeof assetId, pic: typeof picture) {
		if (!id || !pic) {
			revoke();
			loadedKey = '';
			return;
		}
		const key = `${id}:${pic}`;
		if (key === loadedKey) return;
		loadedKey = key;
		try {
			const res = await assetsAPI.picture(Number(id));
			revoke();
			objectUrl = URL.createObjectURL(res.data);
		} catch {
			revoke();
			loadedKey = '';
		}
	}

	// The marker moves when the photo is replaced, which re-fetches.
	$: load(assetId, picture);

	onDestroy(revoke);
</script>

{#if objectUrl}
	<img src={objectUrl} {alt} class="{size} rounded-md object-cover border border-line-soft" />
{/if}
