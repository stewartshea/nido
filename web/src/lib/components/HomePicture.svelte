<script lang="ts">
	// A home picture, served from the authenticated /families/homes/:id/picture
	// endpoint. Same reason as Avatar.svelte: a plain <img src="/api/..."> sends
	// no Authorization header and gets a 401 instead of image bytes, so this
	// fetches through the authenticated client and renders a blob URL. Falls
	// back to rendering nothing when there is no picture (the caller's layout
	// is fine without it).
	import { onDestroy } from 'svelte';
	import { familiesAPI } from '$lib/api/family';

	export let familyId: string | null | undefined;
	export let homeId: number | null | undefined;
	export let picture: number | null | undefined;
	export let alt = '';

	let objectUrl: string | null = null;
	let loadedKey = '';

	function revoke() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	async function load(fid: typeof familyId, hid: typeof homeId, pic: typeof picture) {
		if (!fid || !hid || !pic) {
			revoke();
			loadedKey = '';
			return;
		}
		const key = `${fid}:${hid}:${pic}`;
		if (key === loadedKey) return;
		loadedKey = key;
		try {
			const res = await familiesAPI.getHomePicture(fid, Number(hid));
			revoke();
			objectUrl = URL.createObjectURL(res.data);
		} catch {
			// A failed fetch falls back to nothing; the card works without a
			// picture, and the next marker change retries.
			revoke();
			loadedKey = '';
		}
	}

	// React to any of the three changing — the marker moves on replace.
	$: load(familyId, homeId, picture);

	onDestroy(revoke);
</script>

{#if objectUrl}
	<img src={objectUrl} {alt} class="w-14 h-14 rounded-md object-cover border border-line-soft" />
{/if}