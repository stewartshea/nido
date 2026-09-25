<script lang="ts">
	// Member avatars are served from an authenticated endpoint (requireAuth
	// checks the Authorization header), so a plain <img src="/api/..."> can
	// never load one — the browser sends no auth header for <img> requests
	// and the API replies 401/403 instead of image bytes. This component
	// fetches the image through the authenticated axios client and renders it
	// as a blob URL instead. Falls back to the default slot when there's no
	// avatar (or the fetch fails), matching every existing call site's
	// icon/initial fallback.
	import { onDestroy } from 'svelte';
	import { familiesAPI } from '$lib/api';

	export let familyId: string | null | undefined;
	export let memberId: number | string | null | undefined;
	export let avatar: string | null | undefined;
	export let alt = '';
	let classes = '';
	export { classes as class };

	let objectUrl: string | null = null;
	let loadedKey = '';

	function revoke() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	async function load(fid: typeof familyId, mid: typeof memberId, av: typeof avatar) {
		if (!fid || !mid || !av) {
			revoke();
			loadedKey = '';
			return;
		}
		const key = `${fid}:${mid}:${av}`;
		if (key === loadedKey) return;
		loadedKey = key;
		try {
			const res = await familiesAPI.getAvatar(fid, Number(mid));
			const url = URL.createObjectURL(res.data);
			revoke();
			objectUrl = url;
		} catch {
			revoke();
		}
	}

	$: load(familyId, memberId, avatar);

	onDestroy(revoke);
</script>

{#if objectUrl}
	<img src={objectUrl} {alt} class={classes} />
{:else}
	<slot />
{/if}
