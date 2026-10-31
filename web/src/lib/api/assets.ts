// src/lib/api/assets.ts — the family's home assets: the car, the furnace,
// the house itself (HOME module 1, issue #65). Not inventory stock: nothing
// here is counted or consumed. Meters (#66), schedules (#67), and the
// maintenance log (#68) hang off these rows.
import api from './client';
import type {
	Asset, AssetCare, AssetCategoryId, DueItem, MaintenanceEntry, Meter, Schedule, ScheduleCondition,
} from './types';

export const assetsAPI = {
	/** The category vocabulary, served by the API so the client never hardcodes it. */
	categories: () => api.get<{ categories: { id: AssetCategoryId; label: string }[] }>('/home-assets/meta/categories'),
	list: (includeArchived = false, homeId?: number | null) => {
		const params = new URLSearchParams();
		if (includeArchived) params.set('includeArchived', 'true');
		if (homeId != null) params.set('homeId', String(homeId));
		const qs = params.toString();
		return api.get<{ assets: Asset[] }>(`/home-assets${qs ? `?${qs}` : ''}`);
	},
	get: (id: number) => api.get<{ asset: Asset }>(`/home-assets/${id}`),
	create: (data: {
		name: string;
		category: AssetCategoryId;
		homeId?: number | null;
		identity?: Partial<{ manufacturer: string | null; model: string | null; modelYear: number | null; serial: string | null }>;
		acquiredAt?: string | null;
		purchasePrice?: number | null;
		notes?: string | null;
	}) => api.post<{ asset: Asset }>('/home-assets', data),
	update: (id: number, data: Partial<{
		name: string;
		category: AssetCategoryId;
		homeId?: number | null;
		identity?: Partial<{ manufacturer: string | null; model: string | null; modelYear: number | null; serial: string | null }>;
		acquiredAt?: string | null;
		purchasePrice?: number | null;
		notes?: string | null;
	}>) => api.put<{ asset: Asset }>(`/home-assets/${id}`, data),
	archive: (id: number) => api.post<{ asset: Asset }>(`/home-assets/${id}/archive`),
	unarchive: (id: number) => api.post<{ asset: Asset }>(`/home-assets/${id}/unarchive`),

	// --- The care loop (#66, #67, #68) ---

	/** Everything one asset's page needs, in one round trip. */
	care: (id: number) => api.get<AssetCare>(`/home-assets/${id}/care`),

	addMeter: (assetId: number, data: { kind: 'distance' | 'time' | 'count'; unit: string; label?: string | null }) =>
		api.post<{ meter: Meter }>(`/home-assets/${assetId}/meters`, data),
	addReading: (meterId: number, data: { value: number; recordedAt?: string }) =>
		api.post<{ meter: Meter }>(`/home-assets/meters/${meterId}/readings`, data),

	createSchedule: (assetId: number, data: {
		task: string;
		conditions: ScheduleCondition[];
		match?: 'any' | 'all';
		leadDays?: number;
	}) => api.post<{ schedule: Schedule }>(`/home-assets/${assetId}/schedules`, data),
	updateSchedule: (scheduleId: number, data: Partial<{
		task: string;
		conditions: ScheduleCondition[];
		match: 'any' | 'all';
		leadDays: number;
	}>) => api.put<{ schedule: Schedule }>(`/home-assets/schedules/${scheduleId}`, data),
	archiveSchedule: (scheduleId: number) =>
		api.post<{ schedule: Schedule }>(`/home-assets/schedules/${scheduleId}/archive`),
	unarchiveSchedule: (scheduleId: number) =>
		api.post<{ schedule: Schedule }>(`/home-assets/schedules/${scheduleId}/unarchive`),
	/** "Not this season" — recorded, so the checklist can be satisfied honestly. */
	skipSeason: (scheduleId: number, windowStart: string, reason?: string | null) =>
		api.post<{ schedule: Schedule }>(`/home-assets/schedules/${scheduleId}/skip`, { windowStart, reason: reason ?? null }),
	unskipSeason: (scheduleId: number, windowStart: string) =>
		api.delete<{ schedule: Schedule }>(`/home-assets/schedules/${scheduleId}/skip?windowStart=${encodeURIComponent(windowStart)}`),

	logMaintenance: (assetId: number, data: {
		scheduleId?: number | null;
		task: string;
		performedAt: string;
		cost?: number | null;
		notes?: string | null;
		meterReadings?: { meterId: number; value: number }[];
		consumedItems?: { itemId: number; quantity: number }[];
	}) => api.post<{ entry: MaintenanceEntry }>(`/home-assets/${assetId}/maintenance`, data),
	updateEntry: (entryId: number, data: Partial<{
		scheduleId: number | null;
		task: string;
		performedAt: string;
		cost: number | null;
		notes: string | null;
	}>) => api.put<{ entry: MaintenanceEntry }>(`/home-assets/maintenance/${entryId}`, data),
	deleteEntry: (entryId: number) => api.delete<{ deleted: boolean }>(`/home-assets/maintenance/${entryId}`),

	/** Across every asset: overdue first, then due. */
	due: () => api.get<{ today: string; items: DueItem[] }>('/home-assets/due'),

	/**
	 * The asset's cover photo, uploaded as multipart. Content-Type must be
	 * cleared so the browser adds the boundary; the instance default of
	 * application/json makes the API reject the body (see uploadAvatar).
	 */
	uploadPicture: (id: number, file: File) => {
		const form = new FormData();
		form.set('file', file);
		return api.post<{ picture: number }>(`/home-assets/${id}/picture`, form, {
			headers: { 'Content-Type': undefined },
		});
	},
	/** The decrypted bytes, through the authenticated client. */
	picture: (id: number) => api.get(`/home-assets/${id}/picture`, { responseType: 'blob' }),
};