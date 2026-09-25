import { Milk, Baby, Moon, TrendingUp, Calendar, Star, Trophy, Stethoscope, Syringe, Smile, Book } from 'lucide-svelte';
import { authStore } from '$lib/stores/authStore';
import { get } from 'svelte/store';

export const CATEGORIES = [
    { id: 'feeds', label: 'Feeds', icon: Milk },
    { id: 'diapers', label: 'Diapers', icon: Baby },
    { id: 'sleep', label: 'Sleep', icon: Moon },
    { id: 'growth', label: 'Growth', icon: TrendingUp },
    { id: 'pumping', label: 'Pumping', icon: Milk },
    { id: 'routines', label: 'Routines', icon: Calendar },
    { id: 'firsts', label: 'Firsts', icon: Star },
    { id: 'milestones', label: 'Milestones', icon: Trophy },
    { id: 'medical', label: 'Medical', icon: Stethoscope },
    { id: 'vaccines', label: 'Vaccines', icon: Syringe },
    { id: 'moods', label: 'Moods', icon: Smile },
    { id: 'journal', label: 'Journal', icon: Book },
];

export const QUICK_LINK_DEFAULT = ['feeds', 'diapers', 'sleep'];

export function quickLinksKey(userId: number | null) {
    // DO NOT CHANGE the 'kamori.' prefix — see note in lib/theme.ts. Quick links
    // are browser-persisted with no migration, so a rename drops them silently.
    return `kamori.quicklinks.${userId}`;
}

export function loadQuickLinks(userId: number | null): string[] {
    const key = quickLinksKey(userId);
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        return [...QUICK_LINK_DEFAULT];
    } catch {
        return [...QUICK_LINK_DEFAULT];
    }
}

export function saveQuickLinks(userId: number | null, next: string[]) {
    try {
        localStorage.setItem(quickLinksKey(userId), JSON.stringify(next));
    } catch {}
}
