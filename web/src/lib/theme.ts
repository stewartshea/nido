// Nido theme engine — apply/persist a named or custom theme.
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface ThemeColors {
	page: string;
	surface: string;
	surface2: string;
	ink: string;
	'ink-soft': string;
	primary: string;
	'primary-hover': string;
	'on-primary': string;
	accent: string;
	'accent-soft': string;
	line: string;
	'line-soft': string;
	'ok-bg': string;
	'ok-text': string;
	'ok-line': string;
	'danger-bg': string;
	'danger-text': string;
	'danger-line': string;
}

export interface ThemeState {
	mode: string; // preset id (e.g. 'forest-light') or 'custom'
	custom: Partial<ThemeColors>;
}

export const THEME_KEYS = [
	'page', 'surface', 'surface2', 'ink', 'ink-soft', 'primary', 'primary-hover',
	'on-primary', 'accent', 'accent-soft', 'line', 'line-soft',
	'ok-bg', 'ok-text', 'ok-line', 'danger-bg', 'danger-text', 'danger-line',
] as const;

export const PRESETS = [
	{ id: 'forest-light', name: 'Forest', dark: false, family: 'Forest' },
	{ id: 'forest-dark', name: 'Forest · Dark', dark: true, family: 'Forest' },
	{ id: 'sage-light', name: 'Sage', dark: false, family: 'Sage' },
	{ id: 'sage-dark', name: 'Sage · Dark', dark: true, family: 'Sage' },
	{ id: 'slate-light', name: 'Slate', dark: false, family: 'Slate' },
	{ id: 'slate-dark', name: 'Slate · Dark', dark: true, family: 'Slate' },
	{ id: 'espresso-light', name: 'Espresso', dark: false, family: 'Espresso' },
	{ id: 'espresso-dark', name: 'Espresso · Dark', dark: true, family: 'Espresso' },
	{ id: 'terracotta-light', name: 'Terracotta', dark: false, family: 'Terracotta' },
	{ id: 'terracotta-dark', name: 'Terracotta · Dark', dark: true, family: 'Terracotta' },
	{ id: 'ocean-light', name: 'Ocean', dark: false, family: 'Ocean' },
	{ id: 'ocean-dark', name: 'Ocean · Dark', dark: true, family: 'Ocean' },
	{ id: 'blush-light', name: 'Blush', dark: false, family: 'Blush' },
	{ id: 'blush-dark', name: 'Blush · Dark', dark: true, family: 'Blush' },
];

export const DEFAULT_THEME = 'forest-light';
// DO NOT CHANGE these keys. They are persisted in users' browsers, not in the
// database, so there is no migration path: renaming them silently resets
// everyone's theme to the default.
const STORE_KEY = 'nido.theme';
const CUSTOM_KEY = 'nido.theme.custom';

function readState(): ThemeState {
	const out: ThemeState = { mode: DEFAULT_THEME, custom: {} };
	if (!browser) return out;
	try {
		const mode = localStorage.getItem(STORE_KEY);
		if (mode) out.mode = mode;
		const custom = localStorage.getItem(CUSTOM_KEY);
		if (custom) out.custom = JSON.parse(custom);
	} catch {
		// corrupted storage — fall back to defaults
	}
	return out;
}

export function applyTheme(raw: ThemeColors | Partial<ThemeColors>, root: HTMLElement = document.documentElement): void {
	for (const key of THEME_KEYS) {
		const v = raw[key];
		if (v && typeof v === 'string') {
			root.style.setProperty(`--c-${key}`, v);
		}
	}
}

// Works for both presets (uses data-theme blocks) and custom (inline vars).
export function applyThemeState(state: ThemeState, root: HTMLElement | null = null): void {
	if (typeof document === 'undefined') return; // SSR — no DOM yet
	const el = root ?? document.documentElement;
	el.setAttribute('data-theme', state.mode);
	if (state.mode === 'custom') {
		applyTheme(state.custom, el);
	}
}

export function saveThemeState(state: ThemeState): void {
	if (!browser) return;
	try {
		localStorage.setItem(STORE_KEY, state.mode);
		localStorage.setItem(CUSTOM_KEY, JSON.stringify(state.custom));
	} catch {
		// storage unavailable — in-memory only
	}
}

export function getInitialThemeState(): ThemeState {
	return readState();
}

export function restoreThemeEarly(): void {
	if (typeof document === 'undefined') return; // SSR
	const state = readState();
	applyThemeState(state);
}

interface ThemeStore extends ThemeState {
	isCustom: boolean;
}
const initial = getInitialThemeState();
export const themeStore = writable<ThemeStore>({
	mode: initial.mode,
	custom: initial.custom,
	isCustom: initial.mode === 'custom',
});

export const themeActions = {
	setMode(mode: string) {
		themeStore.update((s) => ({ ...s, mode, isCustom: mode === 'custom' }));
		const state = readState();
		state.mode = mode;
		applyThemeState(state);
		saveThemeState(state);
	},
	setCustomPatch(patch: Partial<ThemeColors>) {
		themeStore.update((s) => ({
			...s,
			isCustom: true,
			mode: 'custom',
			custom: { ...s.custom, ...patch },
		}));
		const state = readState();
		state.mode = 'custom';
		state.custom = { ...state.custom, ...patch };
		applyThemeState(state);
		saveThemeState(state);
	},
};