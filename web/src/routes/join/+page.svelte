<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { authStore } from '$lib/stores/authStore';
	import { familiesAPI } from '$lib/api';
	import { AlertCircle, Check, Users } from 'lucide-svelte';

	let familyId = '';
	let token = '';
	let ready = false;
	let submitting = false;
	let error = '';
	let done = false;
	let isAuthed = false;

	$: returnTo = `/join?family=${encodeURIComponent(familyId)}&token=${encodeURIComponent(token)}`;

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		familyId = params.get('family') ?? '';
		token = params.get('token') ?? '';
		ready = true;
	});

	$: isAuthed = $authStore.isAuthenticated && !!$authStore.token;

	async function accept() {
		error = '';
		submitting = true;
		try {
			const res = await familiesAPI.join(familyId, token);
			// The previous JWT still carries the pre-join familyId, so a full
			// reload is what guarantees every later request uses the new one.
			if (browser) localStorage.setItem('token', res.data.token);
			done = true;
			setTimeout(() => {
				window.location.href = '/family';
			}, 900);
		} catch (err: any) {
			error = err.response?.data?.error || 'This invitation could not be accepted. Please try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Accept invitation · Nido</title>
</svelte:head>

<div class="min-h-[80vh] flex flex-col items-center justify-center px-4 py-8">
	<div class="text-center mb-8">
		<div class="inline-flex items-center justify-center w-16 h-16 rounded-full border-2 border-accent/50 text-accent text-3xl font-light mb-4" aria-hidden="true">巣</div>
		<h1 class="text-4xl font-display font-bold text-ink mb-2">Nido</h1>
		<p class="text-base text-ink-soft italic">tending to the home</p>
	</div>

	<div class="w-full max-w-md bg-surface rounded-2xl shadow-card p-6 md:p-8 border border-line-soft">
		{#if !ready}
			<p class="text-center text-ink-soft text-sm">Loading invitation…</p>
		{:else if done}
			<div class="text-center py-4">
				<div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary text-on-primary mb-4" aria-hidden="true">
					<Check class="w-6 h-6" />
				</div>
				<h2 class="text-2xl font-display font-semibold mb-2 text-ink">You're in</h2>
				<p class="text-sm text-ink-soft">Taking you to the family…</p>
			</div>
		{:else if !familyId || !token}
			<div class="mb-6 bg-danger border border-danger text-danger-text px-4 py-3 rounded-md text-sm">
				<AlertCircle class="w-4 h-4 inline mr-1 align-[-1px]" aria-hidden="true" />
				This invitation link is incomplete. Ask for a fresh link.
			</div>
			<a href="/login" class="block w-full min-h-[44px] text-center bg-primary text-on-primary py-2 px-4 rounded-xl font-semibold">Go to sign in</a>
		{:else}
			<div class="text-center mb-6">
				<div class="inline-flex items-center justify-center w-12 h-12 rounded-full border-2 border-accent/50 text-accent mb-3" aria-hidden="true">
					<Users class="w-5 h-5" />
				</div>
				<h2 class="text-2xl font-display font-semibold text-ink">Family invitation</h2>
				<p class="text-sm text-ink-soft mt-1">You've been invited to join a Nido family.</p>
			</div>

			{#if error}
				<div class="mb-6 bg-danger border border-danger text-danger-text px-4 py-3 rounded-md text-sm">
					<AlertCircle class="w-4 h-4 inline mr-1 align-[-1px]" aria-hidden="true" />{error}
				</div>
			{/if}

			{#if !isAuthed}
				<p class="text-sm text-ink-soft mb-4">
					Sign in with the email address this invitation was sent to, then come back here to accept.
				</p>
				<a href="/login?next={encodeURIComponent(returnTo)}" class="block w-full min-h-[44px] text-center bg-primary text-on-primary py-2 px-4 rounded-xl font-semibold">Sign in to accept</a>
			{:else}
				<button type="button" on:click={accept} disabled={submitting} class="w-full min-h-[44px] bg-primary text-on-primary py-2 px-4 rounded-xl hover:bg-primary disabled:opacity-50 font-semibold">
					{submitting ? 'Joining…' : 'Accept invitation'}
				</button>
				<p class="text-xs text-ink-soft mt-4 text-center">
					Accepting moves this account into the family. Because an account belongs to one family, this can't be undone afterwards.
				</p>
			{/if}
		{/if}
	</div>
</div>
