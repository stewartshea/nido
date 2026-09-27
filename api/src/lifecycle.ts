// lifecycle.ts
// Process-level observability and shutdown: the boot record, the handlers for
// events that have no request to hang them off, and a graceful drain on
// SIGTERM.
//
// Kubernetes sends SIGTERM and then SIGKILLs after the grace period. Without a
// handler the pod is killed mid-request: in-flight writes are lost, WAL files
// are left for recovery on restart, and the only trace is the kubelet event.
// With one, a rolling deploy logs every connection it drained.

import type { ServerType } from '@hono/node-server';
import { log } from './logger';

/** How long to wait for in-flight requests before giving up on a clean exit. */
function shutdownTimeout(): number {
  const raw = Number(process.env.LOG_SHUTDOWN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

let shuttingDown = false;

/** Boot record: the first thing anyone looks for in a fresh pod's logs. */
export function logBoot(details: Record<string, unknown> = {}): void {
  log.info('server started', {
    event: 'server_start',
    nodeVersion: process.version,
    logLevel: log.level,
    ...details,
  });
}

export function logShutdown(reason: string, outcome: 'clean' | 'timeout' | 'forced'): void {
  log.info('server stopped', { event: 'server_stop', reason, outcome });
}

/**
 * Uncaught exceptions leave the process in an unknown state, so the only
 * correct response is to log everything available and exit — the supervisor
 * restarts us. `unhandledRejection` is treated as an error but not fatal: a
 * detached promise rejecting should not take a baby tracker offline, and the
 * rejection is still recorded at error level for alerting on.
 */
export function installProcessHandlers(): void {
  process.on('uncaughtException', (error) => {
    log.error('uncaught exception — exiting', {
      event: 'process_uncaught_exception',
      err: error,
    });
    // The stdout queue is asynchronous; a bare process.exit can truncate the
    // record that explains why the process died.
    flushThenExit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled promise rejection', {
      event: 'process_unhandled_rejection',
      err: reason,
    });
  });
}

export interface ShutdownOptions {
  server: ServerType;
  /** Close DB handles and any other held resource. Must not throw. */
  onShutdown?: () => Promise<void> | void;
}

/**
 * Drain on SIGTERM/SIGINT: stop accepting connections (so readiness fails and
 * the endpoint controller removes this pod), let in-flight requests finish,
 * release resources, exit 0.
 */
export function installSignalHandlers({ server, onShutdown }: ShutdownOptions): void {
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      log.warn('second signal received — exiting immediately', {
        event: 'server_stop_forced',
        signal,
      });
      process.exit(1);
    }
    shuttingDown = true;

    log.info('shutdown signal received — draining', {
      event: 'server_drain_start',
      signal,
      timeoutMs: shutdownTimeout(),
    });

    const forceExit = setTimeout(() => {
      log.error('shutdown timed out — exiting with connections still open', {
        event: 'server_stop',
        reason: signal,
        outcome: 'timeout',
      });
      process.exit(1);
    }, shutdownTimeout());
    // Do not let the force-exit timer itself keep the event loop alive.
    forceExit.unref();

    server.close(() => {
      void (async () => {
        try {
          await onShutdown?.();
          clearTimeout(forceExit);
          logShutdown(String(signal), 'clean');
          process.exit(0);
        } catch (error) {
          log.error('shutdown failed while releasing resources', {
            event: 'server_stop_failed',
            err: error,
          });
          process.exit(1);
        }
      })();
    });

    // Close keep-alive sockets sitting between requests; in-flight ones finish.
    // Http2Server lacks this, hence the optional lookup.
    const closable = server as { closeIdleConnections?: () => void };
    closable.closeIdleConnections?.();
  };

  process.on('SIGTERM', handle);
  process.on('SIGINT', handle);
}

/** Export for tests / non-fatal paths. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

function flushThenExit(code: number): void {
  // Give the stdout write queue one turn of the event loop, then leave
  // regardless — a wedged pipe must not prevent the restart.
  const timer = setTimeout(() => process.exit(code), 2_000);
  timer.unref();
  process.stdout.write('', () => process.exit(code));
}
