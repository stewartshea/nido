<script lang="ts">
	// No `$app/stores` (see +layout.svelte): the active path is tracked with
	// `afterNavigate` instead. It settles on hydration, so the server-rendered
	// bar shows no active item until the client takes over — the bar is
	// mobile-only and the highlight is decoration, not content.
	import { afterNavigate } from '$app/navigation';
	import { BOTTOM_NAV } from '$lib/nav';
	import { notificationCount } from '$lib/stores/notificationCount';

	const navItems = BOTTOM_NAV;

	let pathname = '';
	afterNavigate(({ to }) => {
		pathname = to?.url.pathname ?? '';
	});
</script>

<nav class="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-line-soft pb-safe md:hidden">
	<div class="grid grid-cols-5 h-20 px-1">
		{#each navItems as item}
			{@const isActive = pathname.startsWith(item.href)}
			<a
				href={item.href}
				class="flex flex-col items-center justify-center gap-1 h-full text-ink"
				aria-current={isActive ? 'page' : undefined}
			>
				<span class="relative flex items-center justify-center w-11 h-11 rounded-full transition-colors {isActive ? 'bg-accent text-on-accent' : 'text-ink-soft'}">
					<svelte:component this={item.icon} size={22} strokeWidth={isActive ? 2.4 : 2} />
					{#if item.id === 'notifications' && $notificationCount > 0}
						<span class="absolute top-0.5 right-0.5 min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-danger text-danger-text text-[10px] font-bold flex items-center justify-center border border-surface" aria-label="{$notificationCount} need attention">{$notificationCount > 9 ? '9+' : $notificationCount}</span>
					{/if}
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