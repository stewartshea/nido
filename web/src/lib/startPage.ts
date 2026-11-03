import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type StartPagePath = '/family' | '/home' | '/inventory' | '/reports' | '/dashboard';

export const ALLOWED_START_PAGES: { path: StartPagePath; label: string }[] = [
	{ path: '/family', label: 'Family' },
	{ path: '/home', label: 'Household' },
	{ path: '/inventory', label: 'Inventory' },
	{ path: '/reports', label: 'Reports' },
	{ path: '/dashboard', label: 'Compact Dashboard' },
];

const STORAGE_KEY = 'nido.startPage';
export const DEFAULT_START_PAGE: StartPagePath = '/family';

export function isStartPagePath(path: string): path is StartPagePath {
	return ALLOWED_START_PAGES.some((p) => p.path === path);
}

export function getStartPage(): StartPagePath {
	if (!browser) return DEFAULT_START_PAGE;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw && isStartPagePath(raw)) return raw;
	} catch {
		// Private browsing or storage failure fallback
	}
	return DEFAULT_START_PAGE;
}

export const startPageStore = writable<StartPagePath>(getStartPage());

export function setStartPage(path: StartPagePath): void {
	startPageStore.set(path);
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, path);
	} catch {
		// Private browsing or quota fallback
	}
}
