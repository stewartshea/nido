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

export type MilestoneKind = 'milestones' | 'firsts' | 'routines' | 'medical';

/**
 * Per-kind category vocabularies. The logger and the edit dialog both draw
 * their choices from here, so a category is always one of a known set and can
 * be reported on. These mirror DEFAULT_CATEGORY_OPTIONS on the API.
 */
export const DEFAULT_CATEGORY_OPTIONS: Record<string, Record<string, string[]>> = {
    feeds: { type: ['breast', 'formula', 'bottle', 'pump', 'solid'], side: ['left', 'right', 'both'] },
    diapers: { consistency: ['mushy', 'runny', 'formed', 'soft', 'blowout', 'other'], color: ['yellow', 'brown', 'green', 'black', 'red'] },
    sleep: { location: ['crib', 'bassinet', 'stroller', 'carrier', 'other'] },
    growth: { unit: ['metric', 'imperial'] },
    pumping: { type: ['left', 'right', 'both'] },
    routines: { type: ['tummy time', 'bath', 'story time', 'walk', 'other'] },
    firsts: { type: ['smile', 'roll over', 'crawl', 'first step', 'tooth', 'other'] },
    milestones: { category: ['physical', 'social', 'language', 'cognitive', 'other'] },
    medical: { visitType: ['wellness', 'sick visit', 'follow-up', 'other'] },
    vaccines: { route: ['oral', 'intramuscular', 'subcutaneous', 'dermal'] },
    moods: { mood: ['happy', 'fussy', 'sleepy', 'unwell', 'content', 'unsettled'] },
};

/** Which option list holds a kind's categories. */
export function milestoneCategoryKey(kind: MilestoneKind): string {
    return kind === 'milestones' ? 'category' : kind === 'medical' ? 'visitType' : 'type';
}

export function isMilestoneKind(value: string): value is MilestoneKind {
    return value === 'milestones' || value === 'firsts' || value === 'routines' || value === 'medical';
}

/**
 * Which tab a stored row belongs to. The row's own kind is authoritative;
 * older rows without one are classified from their category word so existing
 * data keeps showing up in the right place.
 */
export function milestoneCategory(r: { kind?: string | null; category?: string | null }): string {
    if (r?.kind && isMilestoneKind(String(r.kind))) return String(r.kind);
    const c = String(r?.category || '').toLowerCase();
    if (c === 'firsts') return 'firsts';
    if (c === 'vitamin' || c === 'medication' || c === 'bath' || c === 'tummy time'
        || c === 'story time' || c === 'walk' || c === 'appointment') return 'routines';
    if (c === 'medical') return 'medical';
    return 'milestones';
}

export function quickLinksKey(userId: number | null) {
    // DO NOT CHANGE the 'nido.' prefix — see note in lib/theme.ts. Quick links
    // are browser-persisted with no migration, so a rename drops them silently.
    return `nido.quicklinks.${userId}`;
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
