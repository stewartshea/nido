import { getFamilyClient } from './db-namespaces';
import {
	clearStaleNotifications, collectSignals, dueRecipients, evaluateAlerts, loadRulesForFamily,
	recordNotified, resolveRecipients, type Recipient,
} from './inventory-eval';
import { getAppSettings, smtpConfigured, sendMail, baseUrl } from './mail';
import { renderInventoryAlertsEmail } from './mail-templates';
import type { InventoryRule } from './inventory-signals';
import { log } from './logger';

/**
 * The notification digest for one family.
 *
 * Deliberately takes a familyId and nothing else: no request, no session, no
 * user. That is what lets the same function back both the "Send digest now"
 * button and a background sweep, and it is the seam a dedicated worker or queue
 * consumer would call instead of the in-process timer.
 *
 * Notification state is only ever written here. The read paths evaluate without
 * recording anything, so looking at the page cannot consume a notification.
 */

export interface DigestOutcome {
	familyId: string;
	/** Set when there was nothing to do, with the reason. */
	skipped?: 'smtp' | 'no-rules' | 'no-items' | 'nobody-to-tell';
	/** Rules matching right now, whether or not anyone has been told. */
	firing: number;
	/** Alerts emailed in this run. */
	alerts: number;
	/** Recipients successfully emailed. */
	sent: number;
	failed: string[];
	message: string;
}

interface DigestLogger {
	warn(msg: string, extra?: Record<string, unknown>): void;
	info(msg: string, extra?: Record<string, unknown>): void;
}

export async function runFamilyDigest(
	familyId: string,
	opts: { actorId?: string | null; nowMs?: number; logger?: DigestLogger } = {},
): Promise<DigestOutcome> {
	const logger = opts.logger ?? log;
	const nowMs = opts.nowMs ?? Date.now();
	const result = (o: { message: string } & Partial<Omit<DigestOutcome, 'message'>>): DigestOutcome =>
		({ familyId, firing: 0, alerts: 0, sent: 0, failed: [], ...o } as DigestOutcome);

	const settings = await getAppSettings();
	if (!smtpConfigured(settings)) {
		return result({ skipped: 'smtp', message: 'SMTP is not configured; no email sent' });
	}

	const db = getFamilyClient(familyId);

	// Checked before walking any items: most families will never configure a
	// rule, and a sweep across every family should not pay to read their stock.
	const rules = await loadRulesForFamily(db);
	if (!rules.some((r) => r.enabled)) return result({ skipped: 'no-rules', message: 'No rules configured' });

	const rows = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE active = 1' })).rows as any[];
	if (rows.length === 0) return result({ skipped: 'no-items', message: 'Nothing is being tracked' });

	// The sweep applies cadence with no actor: nobody recorded that use, and a
	// fabricated user id in the ledger would be a lie the UI later repeats.
	const { valuesByItem, namesByItem } = await collectSignals(db, rows, nowMs, opts.actorId ?? null);
	const { alerts, rules: applicable } = await evaluateAlerts(db, nowMs, valuesByItem, namesByItem);

	const firing = new Set(alerts.map((a) => `${a.ruleId}:${a.itemId}`));
	// A rule that has cleared must forget who it told, or the next crossing would
	// be treated as already reported.
	await clearStaleNotifications(db, applicable.map((r) => r.id), firing);

	if (alerts.length === 0) return result({ message: 'Nothing is firing' });

	const byRule = new Map<number, InventoryRule>(applicable.map((r) => [r.id, r]));
	// Grouped by person, not by rule: two rules firing for the same caregiver are
	// one email to them, not two.
	const pending = new Map<string, { recipient: Recipient; lines: typeof alerts }>();
	const noOneEligible = new Set<number>();

	for (const alert of alerts) {
		const rule = byRule.get(alert.ruleId);
		if (!rule) continue;
		const eligible = await resolveRecipients(db, rule);
		const due = await dueRecipients(db, rule, alert.itemId, eligible, nowMs);
		if (eligible.length === 0) noOneEligible.add(rule.id);
		for (const recipient of due) {
			const entry = pending.get(recipient.userId) ?? { recipient, lines: [] };
			entry.lines.push(alert);
			pending.set(recipient.userId, entry);
		}
	}

	const addressed = new Set<number>();
	for (const { lines } of pending.values()) for (const l of lines) addressed.add(l.ruleId);

	if (pending.size === 0) {
		// Either everyone eligible has already been told, or every address on this
		// rule is unverified. Both are "nothing to do", not an error.
		return result({
			firing: firing.size,
			skipped: noOneEligible.size > 0 && addressed.size === 0 ? 'nobody-to-tell' : undefined,
			message: noOneEligible.size > 0 ? 'Nobody is eligible to be emailed about these' : 'Nothing new to send',
		});
	}

	let sent = 0;
	const failed: string[] = [];
	for (const { recipient, lines } of pending.values()) {
		const message = renderInventoryAlertsEmail({
			firstName: recipient.firstName,
			alerts: lines.map((a) => ({
				itemName: a.itemName, signalLabel: a.signalLabel, value: a.value,
				threshold: a.threshold, comparator: a.comparator, unit: a.unit,
			})),
			inventoryUrl: `${baseUrl()}/inventory`,
		});
		try {
			await sendMail(settings, recipient.email, message);
			sent += 1;
			// Recorded per person, and only for someone who actually received it.
			// A bounce must not mark them as told forever.
			const byItem = new Map<number, InventoryRule>();
			for (const alert of lines) {
				const rule = byRule.get(alert.ruleId);
				if (rule) byItem.set(alert.itemId, rule);
			}
			for (const [itemId, rule] of byItem) await recordNotified(db, rule.id, itemId, [recipient.userId], nowMs);
		} catch (err: any) {
			failed.push(`${recipient.email}: ${err?.message ?? 'failed'}`);
			logger.warn('inventory alert email failed', { err, familyId, ruleId: lines[0]?.ruleId });
		}
	}

	const alertCount = new Set<string>();
	for (const { lines } of pending.values()) for (const l of lines) alertCount.add(`${l.ruleId}:${l.itemId}`);

	return result({
		firing: firing.size,
		alerts: alertCount.size,
		sent,
		failed,
		message: sent
			? `Sent to ${sent} of ${pending.size} recipient${pending.size === 1 ? '' : 's'}`
			: 'Could not send',
	});
}
