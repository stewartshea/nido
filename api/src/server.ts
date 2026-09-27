import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

import { requireAuth, jwtSecret, PUBLIC_AUTH_PATHS, type AuthEnv } from './auth';
import { getMasterKeyHex } from './db-core';
import { closeAllClients, ensureRegistry } from './db-namespaces';
import { log } from './logger';
import { onError, onNotFound, requestLogger } from './request-log';
import { installProcessHandlers, installSignalHandlers, logBoot } from './lifecycle';

import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { babyRoutes } from './routes/baby';
import { feedingRoutes } from './routes/feedings';
import { diaperRoutes } from './routes/diapers';
import { sleepRoutes } from './routes/sleep';
import { growthRoutes } from './routes/growth';
import { healthRoutes } from './routes/health';
import { milestoneRoutes } from './routes/milestones';
import { vaccinationRoutes } from './routes/vaccinations';
import { importRoutes } from './routes/imports';
import { familyRoutes } from './routes/families';
import { photoRoutes } from './routes/photos';
import { formulaRoutes } from './routes/formulas';
import { settingsRoutes } from './routes/settings';
import { moodRoutes } from './routes/moods';
import { journalRoutes } from './routes/journal';
import { reminderRoutes } from './routes/reminders';
import { bootstrapAdmin } from './authz';

const app = new Hono<AuthEnv>();

// Middleware. requestLogger() runs first so every downstream handler — including
// requireAuth's 401s and the terminal error handler — has a correlation id.
app.use('*', requestLogger());
app.use(cors());
app.use(secureHeaders());

app.onError(onError);
app.notFound(onNotFound);

// Auth guard: every /api/v1 request needs a valid Bearer JWT, except the
// public auth endpoints (register, login, verify-email, forgot/reset password).
app.use('/api/v1/*', async (c, next) => {
  if (PUBLIC_AUTH_PATHS.has(c.req.path)) return next();
  return requireAuth(c, next);
});

// Health check endpoints
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', (c) => {
  // In a real app, you'd check database connections, etc.
  return c.json({ status: 'ready', timestamp: new Date().toISOString() });
});

// API routes
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/users', userRoutes);
app.route('/api/v1/babies', babyRoutes);
app.route('/api/v1/feedings', feedingRoutes);
app.route('/api/v1/diapers', diaperRoutes);
app.route('/api/v1/sleep', sleepRoutes);
app.route('/api/v1/growth', growthRoutes);
app.route('/api/v1/health', healthRoutes);
app.route('/api/v1/milestones', milestoneRoutes);
app.route('/api/v1/vaccinations', vaccinationRoutes);
app.route('/api/v1/imports', importRoutes);
app.route('/api/v1/families', familyRoutes);
app.route('/api/v1/photos', photoRoutes);
app.route('/api/v1/formulas', formulaRoutes);
app.route('/api/v1/settings', settingsRoutes);
app.route('/api/v1/moods', moodRoutes);
app.route('/api/v1/journal', journalRoutes);
app.route('/api/v1/reminders', reminderRoutes);

// Root endpoint
app.get('/', (c) => {
  return c.json({ 
    message: 'Welcome to the Nido API',
    version: '1.0.0',
    description: 'Self-hosted newborn and infant tracking API'
  });
});

export default app;

const port = Number(process.env.PORT || 3000);

// Do not bind a port when imported by the test suite (vitest sets NODE_ENV=test);
// tests exercise the app via app.fetch and must not race for the listener.
if (process.env.NODE_ENV !== 'test') {
  // Resolve the required secrets before binding a port. A process that serves
  // traffic without a usable master key can only fail later, on first write,
  // with the port already accepting connections.
  getMasterKeyHex();
  jwtSecret();

  installProcessHandlers();

  // The registry is opened before the listener is bound, so a pod with an
  // unwritable data volume exits instead of accepting traffic that 500s.
  void (async () => {
    try {
      await ensureRegistry();
      await bootstrapAdmin();
    } catch (error) {
      log.error('registry database could not be opened — exiting', {
        event: 'boot_failed',
        dataDir: process.env.NIDO_DATA_DIR ?? './data',
        err: error,
      });
      process.exit(1);
    }

    const server = serve({ fetch: app.fetch, port }, (info) => {
      logBoot({ port: info.port, dataDir: process.env.NIDO_DATA_DIR ?? './data' });
    });

    installSignalHandlers({ server, onShutdown: closeAllClients });
  })();
}