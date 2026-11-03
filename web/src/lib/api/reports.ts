// src/lib/api/reports.ts — the daily series behind the Reports page. One call
// returns the whole window; the page toggles and drills without re-fetching.
import api from './client';
import type { DailyReport } from './types';

export const reportsAPI = {
	daily: (opts?: { days?: number; memberId?: number | null }) => {
		const qs = new URLSearchParams();
		if (opts?.days) qs.set('days', String(opts.days));
		if (opts?.memberId) qs.set('memberId', String(opts.memberId));
		const q = qs.toString();
		return api.get<{ report: DailyReport }>(`/reports/daily${q ? `?${q}` : ''}`);
	},
};
