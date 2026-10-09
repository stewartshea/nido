<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import '../app.css';
	import { restoreThemeEarly } from '$lib/theme';
	import ThemePicker from '$lib/components/ThemePicker.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import { PRIMARY_NAV } from '$lib/nav';
	import { authStore, authActions } from '$lib/stores/authStore';
	import { notificationCount, refreshNotificationCount, startNotificationCount, stopNotificationCount } from '$lib/stores/notificationCount';

	// Apply saved theme early on the client (avoids a flash of the default palette)
	restoreThemeEarly();

	let showAccountMenu = false;

	// The badge polls while signed in, and refreshes on every navigation so
	// leaving a page where a rule just fired updates the count without a wait.
	$: if (browser) {
		if ($authStore.isAuthenticated) startNotificationCount();
		else stopNotificationCount();
	}
	$: if (browser && $authStore.isAuthenticated && $page.url.pathname) void refreshNotificationCount();

	function handleLogout() {
		authActions.logout();
		showAccountMenu = false;
		goto('/login');
	}

	onMount(() => {
		if (browser) {
			restoreThemeEarly();
			// Auth has settled: reveal the app shell. Until now SSR/hydration renders
			// the loading splash, so the logged-out shell never flashes pre-bootstrap.
			authActions.setLoading(false);
			// A genuinely expired JWT gets cleared by the API client, which then fires
			// `unauthorized`; without a listener the UI stayed on a dead page.
			window.addEventListener('unauthorized', () => {
				authActions.logout();
				goto('/login');
			});
			console.log('Nido app initialized');
		}
	});
</script>

{#if $authStore.loading}
	<div class="min-h-[80vh] flex items-center justify-center">
		<div class="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
	</div>
{:else}
	<header class="sticky top-0 z-50 bg-primary border-b border-line">
		<div class="mx-auto max-w-6xl px-4 py-2 md:py-3 flex items-center justify-between">
			<div class="flex items-center gap-3">
				<a href="/" class="flex items-center gap-2">
					<span class="w-9 h-9 rounded-full border border-accent/50 text-accent flex items-center justify-center text-lg font-light" aria-hidden="true">巣</span>
					<span class="text-xl md:text-2xl font-display text-on-primary tracking-wide">Nido</span>
				</a>
				<span class="hidden md:inline text-sm text-accent italic ml-2">tending to the home</span>
			</div>
			<div class="flex items-center gap-4">
				{#if $authStore.isAuthenticated}
					<nav aria-label="Main" class="hidden md:flex bg-surface2 rounded-md p-1">
						{#each PRIMARY_NAV as item (item.id)}
							<a
								href={item.href}
								aria-current={$page.url.pathname.startsWith(item.href) ? 'page' : undefined}
								class="{item.href !== '/' && $page.url.pathname.startsWith(item.href) ? 'bg-primary text-on-primary shadow-sm' : 'text-ink-soft hover:text-ink'} relative px-4 py-1 rounded text-sm font-semibold transition-colors"
							>{item.label}{#if item.id === 'notifications' && $notificationCount > 0}<span class="absolute -top-1.5 -right-1.5 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-danger text-danger-text text-[10px] font-bold flex items-center justify-center" aria-label="{$notificationCount} need attention">{$notificationCount > 9 ? '9+' : $notificationCount}</span>{/if}</a>
						{/each}
					</nav>
				{/if}
				<ThemePicker />
				{#if $authStore.isAuthenticated}
					<div class="relative">
						<button type="button" on:click={() => (showAccountMenu = !showAccountMenu)} class="w-11 h-11 rounded-full bg-accent text-on-accent flex items-center justify-center font-semibold text-base">
							{$authStore.user?.firstName?.[0] || 'U'}
						</button>
						{#if showAccountMenu}
							<div class="absolute right-0 mt-2 w-48 bg-surface rounded-lg shadow-card border border-line-soft py-1 z-50">
								<a href="/settings" on:click={() => (showAccountMenu = false)} class="block w-full text-left px-4 py-2 text-base text-ink hover:bg-surface2">Settings</a>
								<button type="button" on:click={handleLogout} class="w-full text-left px-4 py-2 text-base text-danger-text hover:bg-surface2">Sign Out</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-6xl px-4 pt-3 pb-24 md:pt-8 md:pb-8">
		<slot />
	</main>

	{#if $authStore.isAuthenticated}
		<BottomNav />
	{/if}

	<footer class="mt-8 md:mt-16 border-t border-line bg-primary py-4 md:py-6 text-center text-sm text-accent mb-20 md:mb-0">
		<span class="text-accent font-display">Nido</span> · tending to the home
		<a href="https://www.nido-app.ca" target="_blank" rel="noopener noreferrer" class="ml-3 underline hover:opacity-80">Docs</a>
	</footer>
{/if}
