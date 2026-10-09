import { Hono } from 'hono';
import { type AuthEnv } from '../auth';
import { schedulerStatus } from '../scheduler';
import { evaluateReminder } from '../reminder-conditions';
import { collectSignals, evaluateAlerts, loadRulesForFamily } from '../inventory-eval';

const notificationStatusRoutes = new Hono<AuthEnv>();

/**
 * How the notification schedule is actually configured on this instance, so the
 * UI can describe it instead of telling users to wire up their own cron. Instance
 * level, not family level: the timer sweeps every family.
 */
notificationStatusRoutes.get('/status', (c) => c.json(schedulerStatus()));

/**
 * How many things are firing right now, for the navigation badge.
 *
 * Deliberately a count and not a list: every page renders the badge, so it must
 * be cheap, and it is computed with the same evaluation the notifications page
 * uses so the two cannot disagree about what is firing.
 */
notificationStatusRoutes.get('/summary', async (c) => {
	const db = c.get('db');
	const userId = c.get('userId');
	const nowMs = Date.now();

	const famRes = await db.execute({
		sql: 'SELECT household_id FROM user_households WHERE user_id = ?',
		args: [userId],
	});
	const fam = famRes.rows[0];
	if (!fam) return c.json({ total: 0, activity: 0, inventory: 0 });
	const familyId = Number((fam as any).household_id);

	const reminderRows = (await db.execute({
		sql: 'SELECT * FROM reminders WHERE family_id = ? AND enabled = 1',
		args: [familyId],
	})).rows as any[];
	let activity = 0;
	for (const r of reminderRows) {
		if ((await evaluateReminder(db, r)).overdue) activity += 1;
	}

	// Inventory is skipped entirely when nothing is watched, so a family that
	// only uses tracking rules never pays for a stock walk on every page.
	let inventory = 0;
	const rules = await loadRulesForFamily(db);
	if (rules.some((r) => r.enabled)) {
		const rows = (await db.execute({ sql: 'SELECT * FROM inventory_items WHERE active = 1' })).rows as any[];
		if (rows.length > 0) {
			const { valuesByItem, namesByItem } = await collectSignals(db, rows, nowMs, null);
			const { alerts } = await evaluateAlerts(db, nowMs, valuesByItem, namesByItem);
			inventory = new Set(alerts.map((a) => `${a.ruleId}:${a.itemId}`)).size;
		}
	}

	return c.json({ total: activity + inventory, activity, inventory });
});

export { notificationStatusRoutes };
