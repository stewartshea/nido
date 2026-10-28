<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, AlertCircle } from 'lucide-svelte';
	import { feedback, dismissFeedback } from '$lib/stores/feedback';

	// A toast belongs to the page that raised it. The store outlives any one
	// page, so start each mount clean — the same silence these four pages got
	// from their own local notice/error state before the block was extracted.
	onMount(() => { dismissFeedback(); });
</script>

{#if $feedback.notice || $feedback.error}
	<div class="fixed top-4 right-4 z-[70] w-full max-w-sm space-y-2" role="status" aria-live="polite" data-testid="feedback-toast">
		{#if $feedback.notice}
			<div class="bg-surface border border-line-soft text-ink shadow-card px-4 py-3 rounded-md text-sm">
				<span class="inline-flex items-center gap-2"><Check class="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
				{$feedback.notice}<button type="button" on:click={dismissFeedback} class="ml-auto text-ink-soft hover:text-ink shrink-0" aria-label="Dismiss">&times;</button></span>
			</div>
		{/if}
		{#if $feedback.error}
			<div class="bg-danger border border-danger text-danger-text px-4 py-3 rounded-md text-sm">
				<span class="inline-flex items-center gap-2"><AlertCircle class="w-4 h-4 shrink-0" aria-hidden="true" />
				{$feedback.error}<button type="button" on:click={dismissFeedback} class="ml-auto hover:opacity-70 shrink-0" aria-label="Dismiss">&times;</button></span>
			</div>
		{/if}
	</div>
{/if}
