// appointments.ts
//
// What is booked ahead, and the email that reminds a family about it.
//
// "Upcoming" is not its own entity and not its own log category: it is any
// milestone row whose `achieved_date` is still in the future, whatever kind it
// was recorded under. Logging a forward-dated medical visit, routine or
// appointment is the same "schedule this" gesture, so all of them surface here
// with no second table and no special option to hunt for in the log sheet.
//
// The reminder is deliberately separate from the inventory digest in
// notifications.ts: they gate on different settings and different columns, and
// one family may want a weekly nudge about what is coming up while keeping its
// inventory digest quiet (or the other way round). The scheduler calls both,
// one family at a time, for the reasons recorded in AGENTS.md.

import { getFamilyClient } from './db-namespaces';
import { familyRecipients, type Recipient } from './inventory-eval';
import { getAppSettings, smtpConfigured, sendMail, baseUrl } from './mail';
import { renderUpcomingAppointmentsEmail, type AppointmentEmailLine } from './mail-templates';
import { log } from './logger';

/**
 * How far ahead the weekly email looks.
 *
 * Two weeks, not one: the mail goes out weekly, so a one-week window would miss
 * an appointment booked for the morning of the day after it was sent. Two weeks
 * gives every appointment at least one clear reminder, and the list stays short
 * enough to read in a glance.
 */
export const APPOINTMENT_EMAIL_LOOKAHEAD_DAYS = 14;

/** The default window for the in-app list, which is a browse rather than a nudge. */
export const APPOINTMENT_LIST_LOOKAHEAD_DAYS = 30;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface UpcomingAppointment {
	id: number;
	title: string;
	/** ISO 8601, as stored on the milestone row. */
	date: string;
	/** The milestone kind (medical, appointments, routines, ...) that got the future date. */
	kind: string;
	category: string | null;
	description: string | null;
	/** Set by the family-wide queries; null for a single member's list. */
	memberId: number | null;
	memberName: string | null;
}

interface QueryOptions {
	nowMs?: number;
	days?: number;
}

/**
 * What is booked for one tracked profile: milestone rows of any kind whose
 * date is still ahead. "Appointment" here is not a log category — it is simply
 * a future-dated entry, however it was recorded, so a forward-dated medical
 * visit or routine shows up next to a scheduled appointment with no extra
 * plumbing.
 *
 * Scoped by `subject_id`, the way every other milestone read is, because the
 * caller has already been through resolveTrackableMember.
 */
export async function upcomingAppointmentsForSubject(
	db: any,
	subjectId: number,
	opts: QueryOptions = {},
): Promise<UpcomingAppointment[]> {
	const nowMs = opts.nowMs ?? Date.now();
	const days = opts.days ?? APPOINTMENT_LIST_LOOKAHEAD_DAYS;
	const from = new Date(nowMs).toISOString();
	const to = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();

	const res = await db.execute({
		sql: `
			SELECT id, title, description, achieved_date, kind, category
			FROM milestones
			WHERE subject_id = ?
			  AND achieved_date >= ? AND achieved_date <= ?
			ORDER BY achieved_date ASC, id ASC
		`,
		args: [subjectId, from, to],
	});
	return (res.rows as any[]).map((r) => ({
		id: Number(r.id),
		title: String(r.title ?? ''),
		date: String(r.achieved_date ?? ''),
		kind: String(r.kind ?? ''),
		category: r.category ?? null,
		description: r.description ?? null,
		memberId: null,
		memberName: null,
	}));
}

/**
 * What is booked across every trackable member of a family: any milestone-kind
 * row whose date is still ahead. The scheduler — which has a family id and no
 * session — calls this too, so the weekly email and the in-app list read the
 * same rows. The join mirrors resolveTrackableMember's write path: a record
 * lands on `COALESCE(legacy_subject_id, the member's aligned subject id)`.
 */
export async function upcomingAppointmentsForFamily(
	db: any,
	opts: QueryOptions = {},
): Promise<UpcomingAppointment[]> {
	const nowMs = opts.nowMs ?? Date.now();
	const days = opts.days ?? APPOINTMENT_LIST_LOOKAHEAD_DAYS;
	const from = new Date(nowMs).toISOString();
	const to = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();

	const res = await db.execute({
		sql: `
			SELECT m.id, m.title, m.description, m.achieved_date, m.kind, m.category,
			       fm.id AS member_id, fm.name AS member_name
			FROM milestones m
			JOIN family_members fm
			  ON COALESCE(fm.legacy_subject_id, fm.id) = m.subject_id
			WHERE COALESCE(fm.trackable, 1) = 1
			  AND m.achieved_date >= ? AND m.achieved_date <= ?
			ORDER BY m.achieved_date ASC, m.id ASC
		`,
		args: [from, to],
	});
	return (res.rows as any[]).map((r) => ({
		id: Number(r.id),
		title: String(r.title ?? ''),
		date: String(r.achieved_date ?? ''),
		kind: String(r.kind ?? ''),
		category: r.category ?? null,
		description: r.description ?? null,
		memberId: r.member_id != null ? Number(r.member_id) : null,
		memberName: r.member_name != null ? String(r.member_name) : null,
	}));
}

export interface AppointmentDigestOutcome {
	familyId: string;
	skipped?: 'smtp' | 'disabled' | 'not-due' | 'no-appointments' | 'nobody-to-tell';
	/** Upcoming appointments considered. */
	upcoming: number;
	sent: number;
	failed: string[];
	message: string;
}

interface DigestLogger {
	warn(msg: string, extra?: Record<string, unknown>): void;
	info(msg: string, extra?: Record<string, unknown>): void;
}

/**
 * Whether a family is due its appointment email, as a pure function of the
 * clock so the weekly rule can be reasoned about (and tested) on its own.
 *
 * `0` for "never sent" is deliberate and matches the inventory digest: turning
 * the setting on should deliver the next email when there is something to say,
 * not start a week-long wait.
 */
export function hoursUntilAppointmentEmailDue(
	enabled: boolean,
	lastSentIso: string | null | undefined,
	nowMs: number,
): number {
	if (!enabled) return Number.POSITIVE_INFINITY;
	const last = lastSentIso ? Date.parse(lastSentIso) : NaN;
	if (!Number.isFinite(last)) return 0;
	const waited = nowMs - last;
	if (waited >= WEEK_MS) return 0;
	return Math.ceil((WEEK_MS - waited) / 3_600_000);
}

/**
 * The opt-in weekly appointment email for one family.
 *
 * Takes a familyId and nothing else, like runFamilyDigest, so a sweep and any
 * future queue consumer share one implementation. Only a real send advances
 * `appointment_notifications_sent_at`: a week with nothing booked must not
 * consume the slot and push the next reminder out by another week.
 */
export async function runAppointmentDigest(
	familyId: string,
	opts: { nowMs?: number; logger?: DigestLogger } = {},
): Promise<AppointmentDigestOutcome> {
	const logger = opts.logger ?? log;
	const nowMs = opts.nowMs ?? Date.now();
	const result = (o: { message: string } & Partial<Omit<AppointmentDigestOutcome, 'message'>>): AppointmentDigestOutcome =>
		({ familyId, upcoming: 0, sent: 0, failed: [], ...o });

	const settings = await getAppSettings();
	if (!smtpConfigured(settings)) {
		return result({ skipped: 'smtp', message: 'SMTP is not configured; no email sent' });
	}

	const db = getFamilyClient(familyId);
	const row = (await db.execute({
		sql: 'SELECT appointment_notifications, appointment_notifications_sent_at FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [1],
	})).rows[0] as { appointment_notifications?: number | null; appointment_notifications_sent_at?: string | null } | undefined;

	const enabled = Number(row?.appointment_notifications ?? 0) === 1;
	// Read before walking any appointments: most families never opt in, and a
	// sweep should not pay to read their milestones.
	if (!enabled) return result({ skipped: 'disabled', message: 'Appointment emails are turned off' });

	if (hoursUntilAppointmentEmailDue(true, row?.appointment_notifications_sent_at, nowMs) !== 0) {
		return result({ skipped: 'not-due', message: 'The next appointment email is not due yet' });
	}

	const upcoming = await upcomingAppointmentsForFamily(db, { nowMs, days: APPOINTMENT_EMAIL_LOOKAHEAD_DAYS });
	if (upcoming.length === 0) return result({ skipped: 'no-appointments', message: 'No upcoming appointments' });

	const recipients = await familyRecipients(db);
	if (recipients.length === 0) {
		return result({ upcoming: upcoming.length, skipped: 'nobody-to-tell', message: 'Nobody has a confirmed email address' });
	}

	const lines: AppointmentEmailLine[] = upcoming.map((a) => ({
		title: a.title,
		when: a.date,
		category: a.category,
		memberName: a.memberName,
	}));
	const url = `${baseUrl()}/appointments`;

	let sent = 0;
	const failed: string[] = [];
	for (const recipient of recipients) {
		const message = renderUpcomingAppointmentsEmail({ firstName: recipient.firstName, appointments: lines, appointmentsUrl: url });
		try {
			await sendMail(settings, recipient.email, message);
			sent += 1;
		} catch (err: any) {
			failed.push(`${recipient.email}: ${err?.message ?? 'failed'}`);
			logger.warn('appointment email failed', { err, familyId, email: recipient.email });
		}
	}

	if (sent > 0) {
		await db.execute({
			sql: 'UPDATE family_settings SET appointment_notifications_sent_at = ? WHERE family_id = ?',
			args: [new Date(nowMs).toISOString(), 1],
		});
	}

	return result({
		upcoming: upcoming.length,
		sent,
		failed,
		message: sent
			? `Sent to ${sent} of ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`
			: 'Could not send',
	});
}
