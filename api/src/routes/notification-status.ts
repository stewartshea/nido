import { Hono } from 'hono';
import { type AuthEnv } from '../auth';
import { schedulerStatus } from '../scheduler';

const notificationStatusRoutes = new Hono<AuthEnv>();

/**
 * How the notification schedule is actually configured on this instance, so the
 * UI can describe it instead of telling users to wire up their own cron. Instance
 * level, not family level: the timer sweeps every family.
 */
notificationStatusRoutes.get('/status', (c) => c.json(schedulerStatus()));

export { notificationStatusRoutes };
