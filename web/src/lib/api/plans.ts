// src/lib/api/plans.ts — a booking and its answers (design §3.6).
// "done" writes the ordinary event through the shared path and links it;
// reschedule/missed/cancel close the question without one.
import api from './client';
import type { Plan } from './types';

export const planAPI = {
  list: (opts?: { memberId?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set('status', opts.status);
    if (opts?.memberId) qs.set('memberId', String(opts.memberId));
    const q = qs.toString();
    return api.get<{ plans: Plan[]; total: number }>(`/plans${q ? `?${q}` : ''}`);
  },
  book: (plan: { memberId: number; category: string; scheduledAt: string; title?: string; notes?: string; data?: Record<string, unknown> }) =>
    api.post<{ plan: Plan }>('/plans', plan),
  fulfil: (id: number, answer?: { occurredAt?: string; title?: string; notes?: string; data?: Record<string, unknown> }) =>
    api.post<{ plan: Plan; event: unknown }>(`/plans/${id}/fulfil`, answer ?? {}),
  reschedule: (id: number, scheduledAt: string) =>
    api.post<{ plan: Plan }>(`/plans/${id}/reschedule`, { scheduledAt }),
  missed: (id: number) => api.post<{ plan: Plan }>(`/plans/${id}/missed`, {}),
  cancel: (id: number) => api.post<{ plan: Plan }>(`/plans/${id}/cancel`, {}),
};
