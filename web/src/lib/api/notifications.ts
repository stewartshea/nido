// src/lib/api/notifications.ts — the notification sweep's status/summary and
// the inactivity/interval reminders it fires for.
import api from './client';
import type {
	NotifySchedule,
	NotifySummary,
	Reminder,
	ReminderCatalogCategory,
	ReminderCondition,
	ReminderMatch,
} from './types';

export const notificationsAPI = {
  status: () => api.get<NotifySchedule>('/notifications/status'),
  summary: () => api.get<NotifySummary>('/notifications/summary'),
};

export const remindersAPI = {
  list: () => api.get<{ reminders: Reminder[] }>('/reminders'),
  catalog: () => api.get<{ categories: ReminderCatalogCategory[] }>('/reminders/catalog'),
  create: (data: { kind: 'inactivity' | 'interval'; category?: string; conditions?: ReminderCondition[]; match?: ReminderMatch; targetType?: 'member' | 'home'; targetId?: number; label?: string; hours?: number; intervalDays?: number }) =>
    api.post('/reminders', data),
  update: (id: number, data: Partial<{ kind: 'inactivity' | 'interval'; category?: string; conditions?: ReminderCondition[]; match?: ReminderMatch; targetType?: 'member' | 'home'; targetId?: number; label?: string; hours?: number; intervalDays?: number; enabled?: boolean }>) =>
    api.put(`/reminders/${id}`, data),
  done: (id: number) => api.post(`/reminders/${id}/done`),
  remove: (id: number) => api.delete(`/reminders/${id}`),
};
