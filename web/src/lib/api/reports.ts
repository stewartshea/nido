// src/lib/api/reports.ts — the daily series behind the Reports page. One call
// returns the whole window; the page toggles and drills without re-fetching.
import api from './client';
import type { DailyReport } from './types';

export const reportsAPI = {
	/** `from`/`to` (YYYY-MM-DD) win over `days` when both are given. */
	daily: (opts?: { days?: number; from?: string; to?: string; memberId?: number | null }) => {
		const qs = new URLSearchParams();
		if (opts?.from && opts?.to) {
			qs.set('from', opts.from);
			qs.set('to', opts.to);
		} else if (opts?.days) {
			qs.set('days', String(opts.days));
		}
		if (opts?.memberId) qs.set('memberId', String(opts.memberId));
		const q = qs.toString();
		return api.get<{ report: DailyReport }>(`/reports/daily${q ? `?${q}` : ''}`);
	},
};
