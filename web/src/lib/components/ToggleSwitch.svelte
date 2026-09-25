<script lang="ts">
	export let checked: boolean = false;
	export let disabled: boolean = false;
	export let label: string = '';
	export let description: string = '';
	export let onToggle: (() => void) | null = null;

	function toggle() {
		if (disabled) return;
		if (onToggle) onToggle();
	}
</script>

<label class="flex items-center gap-3 cursor-pointer min-h-[44px] {disabled ? 'opacity-50 cursor-not-allowed' : ''}">
	<button
		type="button"
		role="switch"
		aria-checked={checked}
		aria-label={label || description}
		disabled={disabled}
		on:click={toggle}
		class="relative inline-flex items-center justify-center w-11 h-11"
	>
		<div class="absolute w-11 h-6 rounded-full transition-colors {checked ? 'bg-primary' : 'bg-surface2 border border-line-soft'}"></div>
		<span class="absolute left-0 inline-block w-4 h-4 rounded-full transition-transform" style:translate={checked ? '24px 0' : '4px 0'} style:background={checked ? 'rgb(var(--c-on-primary))' : 'rgb(var(--c-ink-soft))'}></span>
	</button>
	{#if label || description}
		<div class="min-w-0">
			{#if label}<p class="text-base font-semibold text-ink">{label}</p>{/if}
			{#if description}<p class="text-sm text-ink-soft">{description}</p>{/if}
		</div>
	{/if}
</label>