<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { tokenExpired } from '$lib/api';

	onMount(() => {
		if (browser) {
			const token = localStorage.getItem('token');
			if (token && !tokenExpired()) {
				goto('/dashboard');
			} else {
				goto('/login');
			}
		}
	});
</script>

<div class="min-h-[80vh] flex items-center justify-center">
	<div class="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
</div>
