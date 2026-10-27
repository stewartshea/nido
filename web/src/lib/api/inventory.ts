// src/lib/api/inventory.ts — the family's stock: items, categories, alerts,
// consumption rules, and diaper size bands.
import api from './client';
import type {
	ConsumableActivity,
	ConsumptionRule,
	DiaperBand,
	InventoryAlert,
	InventoryItem,
	InventoryRule,
} from './types';

export const inventoryAPI = {
	categories: () => api.get('/inventory/categories'),
	list: () => api.get<{ items: InventoryItem[]; alerts: InventoryAlert[] }>('/inventory'),
	categoriesInUse: () => api.get<{ categories: string[] }>('/inventory/categories'),
	addCategory: (name: string) => api.post('/inventory/categories', { name }),
	removeCategory: (name: string) => api.delete(`/inventory/categories/${encodeURIComponent(name)}`),
	signals: () => api.get<{ signals: { name: string; label: string; unit: string; describe: string }[] }>('/inventory/signals'),
	rules: () => api.get<{ rules: InventoryRule[] }>('/inventory/rules'),
	createRule: (data: {
		itemId?: number | null; category?: string | null; signal: string;
		comparator?: 'lt' | 'lte' | 'gt' | 'gte'; threshold: number; repeatDays?: number | null;
		audienceKind?: 'family' | 'users'; audienceIds?: string[];
	}) => api.post('/inventory/rules', data),
	deleteRule: (id: number) => api.delete(`/inventory/rules/${id}`),
	recount: (id: number, quantity: number, note?: string | null) =>
		api.post(`/inventory/${id}/recount`, { quantity, note: note ?? null }),
	resetHistory: (id: number, quantity: number, note?: string | null) =>
		api.post(`/inventory/${id}/reset-history`, { quantity, note: note ?? null }),
	resetAll: () => api.post('/inventory/reset', { confirm: 'RESET' }),
	notify: () => api.post<{ message: string; sent: number; alerts: number }>('/inventory/notify'),
	create: (data: {
		memberId?: number | null; name: string; category: string; variant?: string | null;
		quantity?: number; unit?: string; packSize?: number | null; leadDays?: number | null;
		/** Preferred: the full rule. Conditions optional; empty matches every event of the activity. */
		consumptionRule?: Omit<ConsumptionRule, 'consumeCarry'> | null;
		/** Flattened Phase-1 fields, still accepted; ignored when consumptionRule is present. */
		eventCategory?: string | null; eventOption?: string | null; unitsPerDecrement?: number | null;
		decrementPerEvent?: number | null; consumeIntervalDays?: number | null;
		expiresAt?: string | null; notes?: string | null;
	}) => api.post('/inventory', data),
	update: (id: number, data: Partial<{
		name: string; variant?: string | null; unit: string; packSize?: number | null;
		leadDays?: number | null;
		/** Replaces the rule wholesale when present; null unlinks the activity. */
		consumptionRule?: Omit<ConsumptionRule, 'consumeCarry'> | null;
		eventCategory?: string | null; eventOption?: string | null;
		unitsPerDecrement?: number | null; decrementPerEvent?: number | null;
		consumeIntervalDays?: number | null; expiresAt?: string | null; notes?: string | null; active: boolean;
	}>) => api.put(`/inventory/${id}`, data),
	// The logged activities an item can be consumed by — served by the API so
	// the picker never offers an activity that would not actually fire.
	activities: () => api.get<{ activities: ConsumableActivity[] }>('/inventory/activities'),
	adjust: (id: number, data: { change: number; reason: 'purchase' | 'used' | 'manual' | 'correction'; note?: string | null }) =>
		api.post(`/inventory/${id}/adjust`, data),
	adjustments: (id: number) => api.get(`/inventory/${id}/adjustments`),
	diaperSizes: (memberId: number) =>
		api.get<{ sizes: any[]; signals: Record<string, number | null>; linkedItemId: number | null }>(
			`/inventory/diaper-sizes?memberId=${memberId}`),
	diaperSizePresets: () => api.get<{ presets: DiaperBand[] }>('/inventory/diaper-size-presets'),
	preloadDiaperSizes: (data: { memberId: number; sizes?: { size: string; weightBandMinKg?: number | null; weightBandMaxKg?: number | null }[]; itemId?: number | null }) =>
		api.post('/inventory/diaper-sizes/preload', data),
	addDiaperSize: (data: { memberId: number; size: string; itemId?: number | null; weightBandMinKg?: number | null; weightBandMaxKg?: number | null }) =>
		api.post('/inventory/diaper-sizes', data),
	updateDiaperSize: (id: number, data: Partial<{ size: string; itemId?: number | null; active: boolean; weightBandMinKg?: number | null; weightBandMaxKg?: number | null }>) =>
		api.put(`/inventory/diaper-sizes/${id}`, data),
	retireDiaperSize: (id: number) => api.delete(`/inventory/diaper-sizes/${id}`),
};
