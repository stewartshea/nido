<script lang="ts">
	import { page } from '$app/stores';
	import { LayoutDashboard, Users, Home, Settings } from 'lucide-svelte';

	const navItems = [
		{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
		{ id: 'family', label: 'Family', icon: Users, href: '/family' },
		{ id: 'home', label: 'Home', icon: Home, href: '/home' },
		{ id: 'settings', label: 'Settings', icon: Settings, href: '/settings' }
	];
</script>

<nav class="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-line-soft pb-safe md:hidden">
	<div class="flex items-center justify-around h-20 px-2">
		{#each navItems as item}
			{@const isActive = $page.url.pathname.startsWith(item.href)}
			<a
				href={item.href}
				class="flex flex-col items-center justify-center w-full h-full min-w-[48px] min-h-[48px] gap-1 text-ink"
				aria-current={isActive ? 'page' : undefined}
			>
				<div class="flex items-center justify-center w-16 h-8 rounded-full transition-colors {isActive ? 'bg-accent-soft text-accent' : 'text-ink-soft'}">
					<svelte:component this={item.icon} size={24} strokeWidth={isActive ? 2.5 : 2} />
				</div>
				<span class="text-[12px] font-medium {isActive ? 'text-ink' : 'text-ink-soft'}">{item.label}</span>
			</a>
		{/each}
	</div>
</nav>

<style>
	.pb-safe {
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>