// src/lib/api/assets.ts — the family's home assets: the car, the furnace,
// the house itself (HOME module 1, issue #65). Not inventory stock: nothing
// here is counted or consumed. Meters and maintenance (#66, #68) hang off
// these rows.
import api from './client';
import type { Asset, AssetCategoryId } from './types';

export const assetsAPI = {
	/** The category vocabulary, served by the API so the client never hardcodes it. */
	categories: () => api.get<{ categories: { id: AssetCategoryId; label: string }[] }>('/home-assets/meta/categories'),
	list: (includeArchived = false) =>
		api.get<{ assets: Asset[] }>(`/home-assets${includeArchived ? '?includeArchived=true' : ''}`),
	get: (id: number) => api.get<{ asset: Asset }>(`/home-assets/${id}`),
	create: (data: {
		name: string;
		category: AssetCategoryId;
		identity?: Partial<{ manufacturer: string | null; model: string | null; modelYear: number | null; serial: string | null }>;
		acquiredAt?: string | null;
		purchasePrice?: number | null;
		notes?: string | null;
	}) => api.post<{ asset: Asset }>('/home-assets', data),
	update: (id: number, data: Partial<{
		name: string;
		category: AssetCategoryId;
		identity?: Partial<{ manufacturer: string | null; model: string | null; modelYear: number | null; serial: string | null }>;
		acquiredAt?: string | null;
		purchasePrice?: number | null;
		notes?: string | null;
	}>) => api.put<{ asset: Asset }>(`/home-assets/${id}`, data),
	archive: (id: number) => api.post<{ asset: Asset }>(`/home-assets/${id}/archive`),
	unarchive: (id: number) => api.post<{ asset: Asset }>(`/home-assets/${id}/unarchive`),
};