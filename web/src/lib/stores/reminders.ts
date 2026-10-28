import { writable, derived } from 'svelte/store';
import { remindersAPI } from '$lib/api/notifications';
import { milestoneAPI } from '$lib/api/records';
import { DATA_CHANGED } from '$lib/events';
import { refreshNotificationCount } from '$lib/stores/notificationCount';
import type { Reminder } from '$lib/api/types';

/**
 * The family's reminder rules and what it has booked ahead — family-scoped
 * state the family page renders (the overdue banner and the Upcoming card).
 *
 * Kept in a store rather than page state so a DATA_CHANGED dispatch — which
 * the API client fires on every successful mutation — refreshes reminders and
 * the notification badge together, without each page wiring its own listener.
 */
export const reminderRules = writable<Reminder[]>([]);

/** Only the rules that are firing right now; drives the overdue banner. */
export const overdueReminders = derived(reminderRules, (rules) =>
	rules.filter((r) => r.enabled && r.overdue),
);

export async function loadReminders(): Promise<void> {
	try {
		reminderRules.set((await remindersAPI.list()).data.reminders ?? []);
	} catch {
		reminderRules.set([]);
	}
}

// What the family has booked ahead, from the same family-wide query the
// /appointments page and the weekly email use. Family-level information, so
// it lives with Family Overview rather than on the per-member dashboard.
export const upcomingAppointments = writable<any[]>([]);

export async function loadUpcomingAppointments(): Promise<void> {
	try {
		const res = await milestoneAPI.getUpcoming({ days: 30 });
		upcomingAppointments.set(res.data.appointments ?? []);
	} catch {
		upcomingAppointments.set([]);
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener(DATA_CHANGED, () => {
		void loadReminders();
		void refreshNotificationCount();
	});
}
