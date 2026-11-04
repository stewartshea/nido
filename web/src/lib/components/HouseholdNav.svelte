<script lang="ts">
	import { Home } from 'lucide-svelte';
	export let current: 'home' | 'assets' = 'home';
</script>

<div class="flex flex-wrap items-center justify-between gap-3 mb-6">
	<div class="flex items-center gap-3">
		<span class="w-11 h-11 rounded-full border-2 border-accent text-accent flex items-center justify-center shrink-0" aria-hidden="true">
			<Home class="w-5 h-5" />
		</span>
		<div>
			<h1 class="text-2xl font-display font-semibold text-ink">Household</h1>
			<p class="text-ink-soft text-sm">Residences, property assets, and upkeep schedules.</p>
		</div>
	</div>

	<div class="inline-flex rounded-lg border border-line-soft bg-surface2 p-1" role="group" aria-label="Household view">
		<a
			href="/home"
			aria-current={current === 'home' ? 'page' : undefined}
			class="h-9 px-3 rounded-md text-sm font-semibold inline-flex items-center transition-colors {current === 'home' ? 'bg-primary text-on-primary shadow-sm' : 'text-ink-soft hover:text-ink'}"
		>Residences &amp; Upkeep</a>
		<a
			href="/assets"
			aria-current={current === 'assets' ? 'page' : undefined}
			class="h-9 px-3 rounded-md text-sm font-semibold inline-flex items-center transition-colors {current === 'assets' ? 'bg-primary text-on-primary shadow-sm' : 'text-ink-soft hover:text-ink'}"
		>Property Assets</a>
	</div>
</div>
