// appointments.ts
//
// What is booked ahead, and the email that reminds a family about it.
//
// "Upcoming" is not its own entity and not its own log category: it is any
// open plan (§3.6) — whatever category the family booked, a medical visit or
// a routine or an appointment — so all of them surface here with no second
// table and no special option to hunt for in the log sheet. Booking is the
// same gesture as recording, with a different verb.
//
// The reminder is deliberately separate from the inventory digest in
// notifications.ts: they gate on different settings and different columns, and
// one family may want a weekly nudge about what is coming up while keeping its
// inventory digest quiet (or the other way round). The scheduler calls both,
// one family at a time, for the reasons recorded in AGENTS.md.

import { getFamilyClient } from './namespaces';
import { familyRecipients, type Recipient } from './inventory-eval';
import { getAppSettings, smtpConfigured, sendMail, baseUrl } from './mail';
import { renderUpcomingAppointmentsEmail, type AppointmentEmailLine } from './mail-templates';
import { effectiveTimezone, withinSendHour, zonedParts } from './timezone';
import { CATEGORY_OPTION_KEY } from './category-registry';
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
 * What is booked for one tracked profile: open plans. "Appointment" here is not
 * a log category — it is anything the family booked (§3.6), a plan whose status
 * is still `planned`, whatever category it was booked under, so a booked
 * medical visit or routine shows up beside a scheduled appointment with no
 * extra plumbing. Overdue plans (scheduled_at already past, still open) are
 * included on purpose: they are the prompt, and the mail is the thing that
 * should be nagging about them, not silently letting them age out.
 *
 * Scoped by `subject_id`, the way every other member read is, because the
 * caller has already been through resolveTrackableMember.
 */
export async function upcomingAppointmentsForSubject(
	db: any,
	subjectId: number,
	opts: QueryOptions = {},
): Promise<UpcomingAppointment[]> {
	const nowMs = opts.nowMs ?? Date.now();
	const days = opts.days ?? APPOINTMENT_LIST_LOOKAHEAD_DAYS;
	const to = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();

	const res = await db.execute({
		sql: `
			SELECT id, title, notes, category, data, scheduled_at, status
			FROM plans
			WHERE subject_id = ?
			  AND status = 'planned'
			  AND scheduled_at <= ?
			ORDER BY scheduled_at ASC, id ASC
		`,
		args: [subjectId, to],
	});
	return (res.rows as any[]).map((r) => planToAppointment(r));
}

/**
 * What is booked across every trackable member of a family: open plans. The
 * scheduler — which has a family id and no session — calls this too, so the
 * weekly email and the in-app list read the same rows. The join mirrors
 * resolveTrackableMember's write path: a plan lands on
 * `COALESCE(legacy_subject_id, the member's aligned subject id)`.
 */
export async function upcomingAppointmentsForFamily(
	db: any,
	opts: QueryOptions = {},
): Promise<UpcomingAppointment[]> {
	const nowMs = opts.nowMs ?? Date.now();
	const days = opts.days ?? APPOINTMENT_LIST_LOOKAHEAD_DAYS;
	const to = new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();

	const res = await db.execute({
		sql: `
			SELECT p.id, p.title, p.notes, p.category, p.data, p.scheduled_at, p.status,
			       fm.id AS member_id, fm.name AS member_name
			FROM plans p
			JOIN family_members fm
			  ON COALESCE(fm.legacy_subject_id, fm.id) = p.subject_id
			WHERE COALESCE(fm.trackable, 1) = 1
			  AND p.status = 'planned'
			  AND p.scheduled_at <= ?
			ORDER BY p.scheduled_at ASC, p.id ASC
		`,
		args: [to],
	});
	return (res.rows as any[]).map((r) => planToAppointment(r));
}

/**
 * A plan row in the appointments response shape, which the web and the email
 * already speak: `kind` is the plan's category, `category` its option value
 * (under the category's own data key), `date` the booked-for time. `overdue`
 * is additive — the plan is the prompt once its time has passed — and callers
 * that ignore it are unaffected.
 */
function planToAppointment(r: any): UpcomingAppointment & { overdue?: boolean } {
	const data = typeof r.data === 'string' && r.data ? (JSON.parse(r.data) as Record<string, unknown>) : {};
	const optionKey = (CATEGORY_OPTION_KEY as Record<string, string>)[r.category] ?? 'type';
	return {
		id: Number(r.id),
		title: String(r.title ?? ''),
		date: String(r.scheduled_at ?? ''),
		kind: String(r.category ?? ''),
		category: (data[optionKey] as string | undefined) ?? null,
		description: r.notes ?? null,
		memberId: r.member_id != null ? Number(r.member_id) : null,
		memberName: r.member_name != null ? String(r.member_name) : null,
		overdue: r.status === 'planned' && new Date(String(r.scheduled_at)).getTime() <= Date.now(),
	};
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
		sql: 'SELECT appointment_notifications, appointment_notifications_sent_at, timezone, appointment_send_hour FROM family_settings WHERE family_id = ? LIMIT 1',
		args: [1],
	})).rows[0] as { appointment_notifications?: number | null; appointment_notifications_sent_at?: string | null; timezone?: string | null; appointment_send_hour?: number | null } | undefined;

	const enabled = Number(row?.appointment_notifications ?? 0) === 1;
	// Read before walking any appointments: most families never opt in, and a
	// sweep should not pay to read their milestones.
	if (!enabled) return result({ skipped: 'disabled', message: 'Appointment emails are turned off' });

	// The family's clock, read once and used for every line of every recipient's
	// mail. Without it the mail renders on the API server's zone, which is a
	// different day for a family that is not standing next to it.
	const timeZone = effectiveTimezone(row?.timezone);

	if (hoursUntilAppointmentEmailDue(true, row?.appointment_notifications_sent_at, nowMs) !== 0) {
		return result({ skipped: 'not-due', message: 'The next appointment email is not due yet' });
	}

	// The family's chosen local hour, if it set one. A weekly nudge reads better
	// at a chosen hour than at whatever hour the sweep happens to run, and the
	// cadence above is still what keeps it from arriving more than weekly.
	const sendHour = row?.appointment_send_hour == null ? null : Number(row.appointment_send_hour);
	if (sendHour !== null && !withinSendHour(nowMs, timeZone, sendHour)) {
		const local = zonedParts(nowMs, timeZone);
		return result({ skipped: 'not-due', message: `Waiting for ${sendHour}:00 on the family's clock (now ${local.hour}:00)` });
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
		const message = renderUpcomingAppointmentsEmail({
			firstName: recipient.firstName,
			appointments: lines,
			appointmentsUrl: url,
			timeZone,
		});
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
