// logger.ts
// Zero-dependency structured logger for the Nido API.
//
// One record per line: JSON by default so log shippers (Fluent Bit, Loki,
// Cloud Logging) and `kubectl logs` can parse it without a regex, and a
// human-readable form when stdout is a terminal. Everything goes to stdout —
// a single stream, in order, which is what a container runtime expects.
//
// Two rules the rest of the codebase relies on:
//
//   1. Anything that looks like a credential is redacted before serialisation.
//      This process holds NIDO_MASTER_KEY, JWT_SECRET, SMTP credentials and
//      password hashes, so a log line is a place all of them can leak by
//      accident. Enforcing it here means a new call site cannot forget.
//   2. Fields are typed as `unknown` and normalised on the way out, so a
//      logger call can never throw and take down the request it was
//      describing.

import { hostname } from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogFormat = 'json' | 'pretty';
export type LogFields = Record<string, unknown>;
/** Receives one fully serialised line, newline included. */
export type LogSink = (line: string) => void;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  // Operator escape hatch: `LOG_LEVEL=silent` emits nothing at all, which is
  // also what the test suite defaults to.
  silent: 100,
};

const LEVEL_NAMES = Object.keys(LEVELS) as LogLevel[];

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that carries `fields` on every subsequent record. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  /** Fields merged into every record from this logger and its children. */
  base?: LogFields;
  /** Overridden by tests; defaults to a backpressure-safe stdout writer. */
  sink?: LogSink;
  /** Overridden by tests so timestamps are deterministic. */
  now?: () => string;
}

export function parseLevel(value: string | undefined, fallback: LogLevel): LogLevel {
  const candidate = value?.trim().toLowerCase();
  // LEVEL_NAMES.includes rather than `in LEVELS`: a prototype key like
  // "toString" must not resolve to a number.
  if (candidate && LEVEL_NAMES.includes(candidate as LogLevel)) return candidate as LogLevel;
  return fallback;
}

export function parseFormat(value: string | undefined, fallback: LogFormat): LogFormat {
  const candidate = value?.trim().toLowerCase();
  return candidate === 'json' || candidate === 'pretty' ? candidate : fallback;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = '[redacted]';

/**
 * Matched as whole segments of a field name, so `passwordHash` and
 * `smtp_pass` redact while `monkeyCount` and `tokenCount` do not. Splitting on
 * camelCase and separators keeps the rule from being a blunt substring match.
 */
const SECRET_SEGMENTS = new Set([
  'auth',
  'authorization',
  'apikey',
  'bearer',
  'cipher',
  'cookie',
  'credential',
  'credentials',
  'hash',
  'iv',
  'jwt',
  'key',
  'nonce',
  'otp',
  'pass',
  'passwd',
  'password',
  'pin',
  'pwd',
  'salt',
  'secret',
  'session',
  'token',
]);

export function isSecretKey(key: string): boolean {
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const segment of segments) {
    if (SECRET_SEGMENTS.has(segment)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Value normalisation
// ---------------------------------------------------------------------------

const MAX_DEPTH = 6;
const MAX_STRING = 4096;

function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) return true;
  // Errors can cross a realm boundary (worker, vm, a native addon), where
  // `instanceof` is false but the shape is still right.
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.toString.call(value) === '[object Error]'
  );
}

function serializeError(err: Error, depth: number, seen: Set<object>): LogFields {
  // pino's `err` shape — grep-friendly and already understood by most
  // collectors' default field extractors.
  const out: LogFields = { type: err.name || 'Error', message: err.message || String(err) };
  const code = (err as Error & { code?: unknown }).code;
  if (code !== undefined) out.code = typeof code === 'string' ? code : normalize(code, depth + 1, seen);
  if (err.stack) out.stack = err.stack;
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause !== undefined) out.cause = normalize(cause, depth + 1, seen);
  return out;
}

/**
 * Turn an arbitrary value into something `JSON.stringify` can always handle.
 * Never throws: a field that cannot be serialised is dropped or described, not
 * raised, because losing one field is better than losing the request.
 */
function normalize(value: unknown, depth: number, seen: Set<object>): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    case 'boolean':
      return value;
    case 'number':
      // NaN/Infinity serialise to null in JSON, which reads as "no value" and
      // hides a real bug. Keep them as text.
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength}B]`;
  if (isErrorLike(value)) return serializeError(value, depth, seen);
  if (depth >= MAX_DEPTH) return '[max depth]';

  const asObject = value as object;
  if (seen.has(asObject)) return '[circular]';
  seen.add(asObject);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const normalized = normalize(entry, depth + 1, seen);
        return normalized === undefined ? null : normalized;
      });
    }
    const out: LogFields = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      const normalized = normalize(entry, depth + 1, seen);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  } catch {
    return '[unserializable]';
  } finally {
    seen.delete(asObject);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// SGR codes built from a char code so no raw escape byte ends up in the source.
const ESC = String.fromCharCode(27);

const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: `${ESC}[90m`,
  info: `${ESC}[36m`,
  warn: `${ESC}[33m`,
  error: `${ESC}[31m`,
  silent: DIM,
};

function paint(text: string, color: string, useColor: boolean): string {
  return useColor ? `${color}${text}${RESET}` : text;
}

function inline(value: unknown): string {
  if (typeof value === 'string') {
    return /^[^\s"'=]*$/.test(value) ? value : JSON.stringify(value);
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value) ?? 'null';
}

function formatPretty(record: LogFields, level: LogLevel, useColor: boolean): string {
  const time = typeof record.time === 'string' ? record.time : '';
  const message = typeof record.msg === 'string' ? record.msg : '';
  const rest: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === 'time' || key === 'level' || key === 'msg') continue;
    rest.push(`${key}=${inline(value)}`);
  }
  const head = `${paint(time.slice(11, 23), DIM, useColor)} ${paint(
    level.toUpperCase(),
    LEVEL_COLOR[level],
    useColor,
  )} ${message}`;
  return rest.length > 0 ? `${head}  ${paint(rest.join(' '), DIM, useColor)}` : head;
}

// ---------------------------------------------------------------------------
// stdout sink
// ---------------------------------------------------------------------------

/** Cap on buffered lines; past this the sink sheds load rather than memory. */
const MAX_QUEUED_LINES = 10_000;

// Marked on the stream itself rather than in module state, so the guard still
// holds when a test runner gives each test file a fresh module registry.
const GUARDED = Symbol.for('nido.logger.stdoutGuarded');

/**
 * Serialise writes to stdout. `stream.write` is asynchronous for pipes, so
 * concurrent calls can interleave partial lines and produce log records that no
 * parser can read. Queueing until `drain` keeps each line atomic.
 */
export function createStdoutSink(stream: NodeJS.WritableStream = process.stdout): LogSink {
  let pending: string[] = [];
  let flushing = false;
  let dropped = 0;

  // Without a listener, an EPIPE on a closed pipe would be an unhandled 'error'
  // event and would take the process down. Attached at most once per stream:
  // a sink is built per logger, and repeat listeners trip MaxListeners.
  const marked = stream as unknown as Record<symbol, unknown>;
  if (!marked[GUARDED]) {
    marked[GUARDED] = true;
    stream.on('error', () => {
      pending = [];
    });
  }

  const flush = (): void => {
    flushing = true;
    try {
      if (dropped > 0) {
        const count = dropped;
        dropped = 0;
        pending.unshift(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'log lines dropped: stdout backpressure', service: 'nido-api', dropped: count })}\n`);
      }
      if (pending.length === 0) {
        flushing = false;
        return;
      }
      const chunk = pending.join('');
      pending = [];
      if (stream.write(chunk)) {
        flushing = false;
        return;
      }
      stream.once('drain', () => {
        flushing = false;
        if (pending.length > 0 || dropped > 0) flush();
      });
    } catch {
      flushing = false;
    }
  };

  return (line: string): void => {
    if (pending.length >= MAX_QUEUED_LINES) {
      dropped += 1;
      return;
    }
    pending.push(line);
    if (!flushing) flush();
  };
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const threshold = LEVELS[level];
  const format = options.format ?? 'json';
  const sink = options.sink ?? createStdoutSink();
  const now = options.now ?? (() => new Date().toISOString());
  const useColor = format === 'pretty' && process.stdout.isTTY === true;
  const base: LogFields = { service: 'nido-api', ...options.base };

  const emit = (recordLevel: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVELS[recordLevel] < threshold) return;
    const seen = new Set<object>();
    // Normalise the merged context so a redacted key stays redacted and an
    // unserialisable value cannot throw from inside a log call.
    const context = normalize({ ...base, ...fields }, 0, seen);
    const merged: LogFields =
      context && typeof context === 'object' && !Array.isArray(context)
        ? (context as LogFields)
        : { context: context as LogFields };
    const record: LogFields = { time: now(), level: recordLevel, msg: message };
    for (const [key, value] of Object.entries(merged)) {
      // The envelope is not overridable; a field named `level` is a bug at the
      // call site, not a reason to corrupt the record.
      if (key === 'time' || key === 'level' || key === 'msg') continue;
      record[key] = value;
    }
    const line =
      format === 'pretty'
        ? formatPretty(record, recordLevel, useColor)
        : JSON.stringify(record);
    sink(`${line}\n`);
  };

  return {
    level,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ ...options, level, format, sink, now, base: { ...base, ...fields } }),
  };
}

/**
 * The process-wide logger. Resolved once from the environment:
 *
 *   LOG_LEVEL   debug | info | warn | error | silent  (default `info`)
 *   LOG_FORMAT  json | pretty                          (default: pretty on a
 *                                                        TTY, else json)
 *
 * Tests are silent unless LOG_LEVEL says otherwise, so a failing assertion is
 * not buried in log noise.
 */
function defaultLevel(): LogLevel {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  return parseLevel(process.env.LOG_LEVEL, isTest ? 'silent' : 'info');
}

function defaultFormat(): LogFormat {
  const fallback: LogFormat = process.stdout.isTTY === true ? 'pretty' : 'json';
  return parseFormat(process.env.LOG_FORMAT, fallback);
}

export const log: Logger = createLogger({
  level: defaultLevel(),
  format: defaultFormat(),
  base: { env: process.env.NODE_ENV ?? 'development', pid: process.pid, host: hostname() },
});
