<script lang="ts">
	import { themeStore, themeActions, PRESETS, DEFAULT_THEME } from '$lib/theme';
	import { onMount } from 'svelte';

	let isOpen = false;

	function toggle() {
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && isOpen) {
			close();
		}
	}

	const families = Array.from(new Set(PRESETS.map(p => p.family)));
	
	$: currentPreset = PRESETS.find(p => p.id === $themeStore.mode) || PRESETS.find(p => p.id === DEFAULT_THEME)!;
	$: currentFamily = currentPreset.family;
	$: isDark = currentPreset.dark;

	function setDark(dark: boolean) {
		const preset = PRESETS.find(p => p.family === currentFamily && p.dark === dark);
		if (preset) {
			themeActions.setMode(preset.id);
		}
	}

	let probe: HTMLElement;
	let presetColors: Record<string, { page: string, primary: string, accent: string }> = {};

	onMount(() => {
		for (const preset of PRESETS) {
			probe.setAttribute('data-theme', preset.id);
			const style = getComputedStyle(probe);
			presetColors[preset.id] = {
				page: style.getPropertyValue('--c-page').trim(),
				primary: style.getPropertyValue('--c-primary').trim(),
				accent: style.getPropertyValue('--c-accent').trim(),
			};
		}
		probe.removeAttribute('data-theme');
		presetColors = presetColors;
		updateCurrentColors();
	});

	const customKeys = [
		{ key: 'page', label: 'Page' },
		{ key: 'surface', label: 'Cards' },
		{ key: 'ink', label: 'Text' },
		{ key: 'primary', label: 'Primary' },
		{ key: 'accent', label: 'Accent' },
		{ key: 'accent-soft', label: 'Accent soft' },
	] as const;

	function rgbToHex(rgb: string): string {
		if (!rgb) return '#000000';
		const parts = rgb.split(' ').map(s => parseInt(s, 10));
		if (parts.length !== 3 || parts.some(isNaN)) return '#000000';
		return '#' + parts.map(x => x.toString(16).padStart(2, '0')).join('');
	}

	function hexToRgb(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `${r} ${g} ${b}`;
	}

	let currentColors: Record<string, string> = {};

	function updateCurrentColors() {
		if (typeof document === 'undefined') return;
		requestAnimationFrame(() => {
			const style = getComputedStyle(document.documentElement);
			for (const { key } of customKeys) {
				currentColors[key] = style.getPropertyValue(`--c-${key}`).trim();
			}
		});
	}

	$: $themeStore, updateCurrentColors();

	function handleCustomChange(key: string, hex: string) {
		themeActions.setCustomPatch({ [key]: hexToRgb(hex) });
	}

	function resetCustom() {
		themeActions.setMode(DEFAULT_THEME);
	}

	let showCustom = false;
</script>

<svelte:window on:keydown={handleKeydown} />

<div bind:this={probe} class="hidden" aria-hidden="true"></div>

<div class="relative">
	<button
		type="button"
		class="w-11 h-11 flex items-center justify-center rounded-full text-accent hover:bg-surface2 transition-colors"
		on:click={toggle}
		aria-label="Theme settings"
		aria-expanded={isOpen}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 2.5a9.5 9.5 0 0 0-9.5 9.5c0 5.25 4.25 9.5 9.5 9.5a9.5 9.5 0 0 0 9.5-9.5c0-1.5-1-2.5-2.5-2.5h-1.5a1.5 1.5 0 0 1-1.5-1.5v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5c1.5 0 2.5-1 2.5-2.5a9.5 9.5 0 0 0-9.5-9.5z"/>
		</svg>
	</button>

	{#if isOpen}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
			on:click={close}
			aria-hidden="true"
		></div>

		<div
			class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-md max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-soft border border-line p-6"
			role="dialog"
			aria-modal="true"
			aria-labelledby="theme-modal-title"
		>
			<div class="flex items-center justify-between mb-6">
				<h2 id="theme-modal-title" class="text-2xl font-display text-ink">Theme</h2>
				<button
					type="button"
					class="w-11 h-11 flex items-center justify-center rounded-full text-ink-soft hover:text-ink hover:bg-surface2 transition-colors"
					on:click={close}
					aria-label="Close theme settings"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
				</button>
			</div>

			<div class="flex items-center justify-center gap-2 mb-8">
				<button
					type="button"
					class="px-4 min-h-[44px] rounded-full text-base font-medium transition-colors { !isDark ? 'bg-accent text-on-primary' : 'text-ink-soft hover:text-ink hover:bg-surface2' }"
					on:click={() => setDark(false)}
				>
					Light
				</button>
				<button
					type="button"
					class="px-4 min-h-[44px] rounded-full text-base font-medium transition-colors { isDark ? 'bg-accent text-on-primary' : 'text-ink-soft hover:text-ink hover:bg-surface2' }"
					on:click={() => setDark(true)}
				>
					Dark
				</button>
			</div>

			<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
				{#each families as family}
					{@const preset = PRESETS.find(p => p.family === family && p.dark === isDark)}
					{#if preset}
						{@const isActive = !$themeStore.isCustom && $themeStore.mode === preset.id}
						{@const colors = presetColors[preset.id]}
						<button
							type="button"
							class="flex flex-col items-center gap-2 p-3 min-h-[44px] rounded-xl border transition-all {isActive ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line hover:border-line-soft hover:bg-surface2'}"
							on:click={() => themeActions.setMode(preset.id)}
						>
							<div class="flex h-12 w-full rounded-lg overflow-hidden border border-line-soft">
								{#if colors}
									<div class="flex-1" style="background-color: rgb({colors.page})"></div>
									<div class="flex-1" style="background-color: rgb({colors.primary})"></div>
									<div class="flex-1" style="background-color: rgb({colors.accent})"></div>
								{:else}
									<div class="flex-1 bg-surface2"></div>
									<div class="flex-1 bg-primary"></div>
									<div class="flex-1 bg-accent"></div>
								{/if}
							</div>
							<span class="text-sm font-medium text-ink flex items-center gap-1">
								{family}
								{#if isActive}
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><polyline points="20 6 9 17 4 12"></polyline></svg>
								{/if}
							</span>
						</button>
					{/if}
				{/each}
			</div>

			<div class="border-t border-line pt-6">
				<div class="flex items-center justify-between mb-4">
					<button
						type="button"
						class="text-lg font-display text-ink flex items-center gap-2 hover:text-accent transition-colors min-h-[44px]"
						on:click={() => showCustom = !showCustom}
					>
						Customize
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="transition-transform {showCustom ? 'rotate-180' : ''}"><polyline points="6 9 12 15 18 9"></polyline></svg>
					</button>
					{#if $themeStore.isCustom}
						<button
							type="button"
							class="text-base text-accent hover:underline min-h-[44px]"
							on:click={resetCustom}
						>
							Reset custom
						</button>
					{/if}
				</div>

				{#if showCustom}
					<div class="grid grid-cols-2 gap-4">
						{#each customKeys as { key, label }}
							<div class="flex flex-col gap-1.5">
								<label for="custom-{key}" class="text-sm text-ink-soft">{label}</label>
								<div class="flex items-center gap-2">
									<input
										id="custom-{key}"
										type="color"
										value={rgbToHex(currentColors[key])}
										on:input={(e) => handleCustomChange(key, e.currentTarget.value)}
										class="w-11 h-11 rounded cursor-pointer border-0 p-0 bg-transparent"
									/>
									<span class="text-sm text-ink uppercase font-mono">{rgbToHex(currentColors[key])}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
