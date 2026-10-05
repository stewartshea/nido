<script lang="ts">
	import { page } from '$app/stores';
	import { BOTTOM_NAV } from '$lib/nav';

	const navItems = BOTTOM_NAV;
</script>

<nav class="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-line-soft pb-safe md:hidden">
	<div class="grid grid-cols-5 h-20 px-1">
		{#each navItems as item}
			{@const isActive = $page.url.pathname.startsWith(item.href)}
			<a
				href={item.href}
				class="flex flex-col items-center justify-center gap-1 h-full text-ink"
				aria-current={isActive ? 'page' : undefined}
			>
				<span class="flex items-center justify-center w-11 h-11 rounded-full transition-colors {isActive ? 'bg-accent text-on-accent' : 'text-ink-soft'}">
					<svelte:component this={item.icon} size={22} strokeWidth={isActive ? 2.4 : 2} />
				</span>
				<span class="text-[11px] font-medium leading-none {isActive ? 'text-ink' : 'text-ink-soft'}">{item.label}</span>
			</a>
		{/each}
	</div>
</nav>

<style>
	.pb-safe {
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>