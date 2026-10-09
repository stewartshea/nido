<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { inventoryAPI, notificationsAPI, remindersAPI, type InventoryAlert, type NotifySchedule, type Reminder } from '$lib/api';
	import { reminderNoun, reminderPhrase } from '$lib/shared';
	import ActivityRules from '$lib/components/logging/ActivityRules.svelte';
	import InventoryRules from '$lib/components/logging/InventoryRules.svelte';
	import { refreshNotificationCount } from '$lib/stores/notificationCount';

	/**
	 * Every notification rule in one place. Activity reminders and inventory
	 * alerts used to be configured in two different Settings tabs and fire in
	 * three different places, which made it hard to see what Nido was watching.
	 */

	let loaded = false;
	let error = '';
	let notice = '';
	let inventoryAlerts: InventoryAlert[] = [];
	let activity: Reminder[] = [];
	let sending = false;
	let emailResult: { sent: number; alerts: number; message: string } | null = null;
	let schedule: NotifySchedule | null = null;

	async function load() {
		try {
			const [alerts, rem, status] = await Promise.all([
				inventoryAPI.list(), remindersAPI.list(), notificationsAPI.status(),
			]);
			inventoryAlerts = alerts.data.alerts ?? [];
			activity = rem.data.reminders ?? [];
			schedule = status.data;
			void refreshNotificationCount();
		} catch (e: any) {
			if (e?.response?.status === 401) { await goto('/login'); return; }
			error = e?.response?.data?.error || 'Could not load notifications.';
		} finally {
			loaded = true;
		}
	}

	async function refresh() {
		await load();
	}

	function describe(r: Reminder): string {
		if (r.kind === 'inactivity') {
			const what = r.conditions?.length
				? reminderPhrase(r.conditions, r.match)
				: reminderNoun(r.category);
			return `No ${what} in ${r.hours}h${r.since ? ` (since ${new Date(r.since).toLocaleString()})` : ' — never recorded'}`;
		}
		return `${r.label || r.category} — every ${r.intervalDays}d${r.since ? ` (last ${new Date(r.since).toLocaleString()})` : ' — never done'}`;
	}

	$: firingActivity = activity.filter((r) => r.enabled && r.overdue);
	$: allQuiet = firingActivity.length === 0 && inventoryAlerts.length === 0;

	async function sendEmail() {
		sending = true;
		notice = '';
		try {
			const res = await inventoryAPI.notify();
			emailResult = res.data;
			notice = res.data.message;
			await load();
		} catch (e: any) {
			error = e?.response?.data?.error || 'Could not send.';
		} finally {
			sending = false;
		}
	}

	onMount(load);
</script>

<svelte:head><title>Notifications · Nido</title></svelte:head>

<div class="max-w-3xl mx-auto px-4 py-4 md:py-6">
	<button type="button" on:click={() => history.back()} class="mb-2 text-ink-soft hover:text-ink text-sm font-semibold">&larr; Back</button>

	<div class="mb-5">
		<h1 class="text-2xl font-display font-semibold text-ink">Notifications</h1>
		<p class="text-sm text-ink-soft mt-1">
			Everything Nido watches, and what it is telling you right now.
			Every rule here belongs to <strong class="font-semibold text-ink">your whole family</strong>, so every caregiver can see
			every rule and every alert. What you choose is <strong class="font-semibold text-ink">who gets emailed</strong> — the
			whole family, or just the people you name. Nothing is hidden from anyone in the family.
		</p>
	</div>

	{#if error}<p class="text-sm text-danger-text mb-3">{error}</p>{/if}

	{#if loaded}
		<section class="bg-surface rounded-lg shadow-card border border-line-soft p-4 md:p-5 mb-4">
			<h2 class="text-lg font-display font-semibold mb-1">Needs attention now</h2>
			{#if allQuiet}
				<p class="text-sm text-ink-soft" data-testid="all-quiet">Nothing is firing. Every rule you have is satisfied.</p>
			{:else}
				<ul class="space-y-1.5 mt-2" data-testid="firing-list">
					{#each firingActivity as r (r.id)}
						<li class="text-sm text-danger-text">{describe(r)}<span class="text-ink-soft"> · set by {r.createdByName ?? 'a caregiver'}</span></li>
					{/each}
					{#each inventoryAlerts as a (a.ruleId + '-' + a.itemId)}
						<li class="text-sm text-danger-text">{a.itemName} — {a.message}</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="bg-surface rounded-lg shadow-card border border-line-soft p-4 md:p-5 mb-4">
			<h2 class="text-lg font-display font-semibold mb-1">Email</h2>
			<p class="text-sm text-ink-soft mb-3">
				Emails each currently firing <strong class="font-semibold text-ink">inventory</strong> alert to whoever that
				rule is addressed to — the whole family, or only the caregivers you picked. Only confirmed
				addresses are emailed, so someone who never verified will not hear about it. Tracking
				reminders below appear here and on the dashboard but are not emailed yet. You only hear
				about an item when it first matches, so an unchanged item will not keep emailing you.
			</p>
			<div class="flex flex-wrap items-center gap-3">
				<button
					type="button"
					on:click={sendEmail}
					disabled={sending}
					data-testid="send-digest"
					class="px-3 py-2 rounded-md bg-primary text-on-primary text-sm font-semibold disabled:opacity-50"
				>{sending ? 'Sending…' : 'Send digest now'}</button>
				{#if notice}<span class="text-sm text-ink-soft" role="status">{notice}</span>{/if}
			</div>
			{#if emailResult && emailResult.sent > 0}
				<p class="text-xs text-ink-soft mt-2">Sent to {emailResult.sent} recipient(s).</p>
			{/if}
			<p class="text-xs text-ink-soft mt-3" data-testid="schedule-note">
				{#if !schedule}
					Checking the schedule…
				{:else if schedule.enabled}
					Nido checks on its own{schedule.running
						? ` every ${schedule.intervalMinutes} minute${schedule.intervalMinutes === 1 ? '' : 's'}`
						: ''}, so you do not need to open the app. You will not be emailed about an item that has not changed since the last time you were told.
				{:else}
					Automatic digests are turned off on this server, so only the button above will send email.
				{/if}
			</p>
		</section>

		<section class="bg-surface rounded-lg shadow-card border border-line-soft p-4 md:p-5 mb-4">
			<h2 class="text-lg font-display font-semibold mb-1">Tracking rules</h2>
			<p class="text-sm text-ink-soft mb-3">
				Nudge everyone when something has not been logged for a while, or when a routine is due.
			</p>
			<ActivityRules on:changed={refresh} />
		</section>

		<section class="bg-surface rounded-lg shadow-card border border-line-soft p-4 md:p-5 mb-4">
			<h2 class="text-lg font-display font-semibold mb-1">Inventory rules</h2>
			<p class="text-sm text-ink-soft mb-3">
				Nudge the family, or one named caregiver, when stock runs low, a date is outgrowing
				its size, or an item expires.
			</p>
			<InventoryRules on:changed={refresh} />
			<p class="text-xs text-ink-soft mt-3">
				Inventory itself, including recounts and resetting a count, lives on the
				<a href="/inventory" class="underline">inventory page</a>.
			</p>
		</section>
	{/if}
</div>
