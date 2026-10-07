import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createStdoutSink,
  isSecretKey,
  parseFormat,
  parseLevel,
  type LogFields,
  type Logger,
} from './logger';

interface Harness {
  logger: Logger;
  lines: string[];
  records: () => LogFields[];
}

function harness(options: { level?: string; base?: LogFields } = {}): Harness {
  const lines: string[] = [];
  const logger = createLogger({
    level: (options.level as 'info') ?? 'debug',
    format: 'json',
    base: options.base,
    sink: (line) => lines.push(line),
    now: () => '2026-01-02T03:04:05.678Z',
  });
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line) as LogFields) };
}

describe('parseLevel', () => {
  it('accepts the five documented levels, case-insensitively', () => {
    expect(parseLevel('debug', 'info')).toBe('debug');
    expect(parseLevel('  WARN ', 'info')).toBe('warn');
    expect(parseLevel('silent', 'info')).toBe('silent');
  });

  it('falls back rather than trusting unknown or inherited keys', () => {
    expect(parseLevel('verbose', 'info')).toBe('info');
    expect(parseLevel(undefined, 'warn')).toBe('warn');
    expect(parseLevel('', 'error')).toBe('error');
    // `in` on a plain object would resolve these to Object.prototype members.
    expect(parseLevel('toString', 'info')).toBe('info');
    expect(parseLevel('constructor', 'info')).toBe('info');
  });
});

describe('parseFormat', () => {
  it('accepts json and pretty only', () => {
    expect(parseFormat('json', 'pretty')).toBe('json');
    expect(parseFormat('PRETTY', 'json')).toBe('pretty');
    expect(parseFormat('xml', 'json')).toBe('json');
    expect(parseFormat(undefined, 'json')).toBe('json');
  });
});

describe('isSecretKey', () => {
  it('matches whole name segments, not substrings', () => {
    for (const key of [
      'password',
      'passwordHash',
      'smtp_pass',
      'NIDO_MASTER_KEY',
      'Authorization',
      'jwtSecret',
      'apiKey',
      'set-cookie',
      'resetToken',
      'iv',
    ]) {
      expect(isSecretKey(key), key).toBe(true);
    }
  });

  it('leaves names that merely embed a secret word intact', () => {
    for (const key of ['monkeyCount', 'keyboard', 'passenger', 'authorId', 'hawk']) {
      expect(isSecretKey(key), key).toBe(false);
    }
  });

  it('redacts a real secret prefix even when a count follows it', () => {
    // Over-redacting a field is the safe direction for a security control.
    expect(isSecretKey('tokenCount')).toBe(true);
    expect(isSecretKey('keyNumber')).toBe(true);
  });
});

describe('level filtering', () => {
  it('emits at or above the threshold and drops the rest', () => {
    const { logger, records } = harness({ level: 'warn' });
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(records().map((record) => record.level)).toEqual(['warn', 'error']);
  });

  it('emits nothing at silent', () => {
    const { logger, lines } = harness({ level: 'silent' });
    logger.error('boom');
    expect(lines).toEqual([]);
  });
});

describe('record shape', () => {
  it('writes one JSON object per line with a stable envelope', () => {
    const { logger, lines, records } = harness({ base: { service: 'nido-api' } });
    logger.info('baby created', { subjectId: 7 });

    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    expect(records()[0]).toEqual({
      time: '2026-01-02T03:04:05.678Z',
      level: 'info',
      msg: 'baby created',
      service: 'nido-api',
      subjectId: 7,
    });
  });

  it('refuses to let a field overwrite time, level or msg', () => {
    const { logger, records } = harness();
    logger.info('real message', { level: 'fake', msg: 'fake', time: 'fake', ok: true });
    const [record] = records();
    expect(record.level).toBe('info');
    expect(record.msg).toBe('real message');
    expect(record.time).toBe('2026-01-02T03:04:05.678Z');
    expect(record.ok).toBe(true);
  });
});

describe('redaction', () => {
  it('redacts secret-shaped keys at any depth', () => {
    const { logger, records } = harness();
    logger.info('smtp', {
      password: 'hunter2',
      smtp: { host: 'mail.example', pass: 'letmein', user: 'nido' },
      rows: [{ jwtSecret: 'abc' }],
    });
    expect(records()[0]).toEqual({
      time: '2026-01-02T03:04:05.678Z',
      level: 'info',
      msg: 'smtp',
      service: 'nido-api',
      password: '[redacted]',
      smtp: { host: 'mail.example', pass: '[redacted]', user: 'nido' },
      rows: [{ jwtSecret: '[redacted]' }],
    });
  });

  it('redacts the key a redacted value would otherwise survive in', () => {
    const { logger, records } = harness();
    logger.info('headers', { headers: { Authorization: 'Bearer abc.def.ghi' } });
    expect(JSON.stringify(records()[0])).not.toContain('abc.def.ghi');
  });
});

describe('value normalisation', () => {
  it('expands an Error into the conventional err shape', () => {
    const { logger, records } = harness();
    const err = Object.assign(new Error('constraint failed'), { code: 'SQLITE_CONSTRAINT' });
    logger.error('write failed', { err });

    const logged = records()[0].err as LogFields;
    expect(logged.type).toBe('Error');
    expect(logged.message).toBe('constraint failed');
    expect(logged.code).toBe('SQLITE_CONSTRAINT');
    expect(String(logged.stack)).toContain('constraint failed');
  });

  it('keeps values JSON cannot represent, instead of losing them to null', () => {
    const { logger, records } = harness();
    logger.info('odd', { big: 10n, nan: Number.NaN, inf: Number.POSITIVE_INFINITY, buf: Buffer.from('abc') });
    expect(records()[0]).toMatchObject({
      big: '10',
      nan: 'NaN',
      inf: 'Infinity',
      buf: '[Buffer 3B]',
    });
  });

  it('survives a circular structure and very deep nesting', () => {
    const { logger, records } = harness();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 12; i += 1) deep = { next: deep };

    logger.info('structures', { circular, deep });

    expect(() => JSON.parse(JSON.stringify(records()[0]))).not.toThrow();
    expect(JSON.stringify(records()[0])).toContain('[circular]');
    expect(JSON.stringify(records()[0])).toContain('[max depth]');
  });

  it('drops a value that throws when its own getters are read', () => {
    const { logger, records } = harness();
    const hostile = {
      safe: 1,
      get boom(): never {
        throw new Error('nope');
      },
    };
    expect(() => logger.info('hostile', { hostile })).not.toThrow();
    expect(records()[0].hostile).toBe('[unserializable]');
  });

  it('truncates a very long string', () => {
    const { logger, records } = harness();
    logger.info('long', { note: 'x'.repeat(5000) });
    expect(String(records()[0].note)).toMatch(/…\[truncated\]$/);
  });
});

describe('child loggers', () => {
  it('inherits base fields and accumulates across generations', () => {
    const { logger, records } = harness({ base: { service: 'nido-api' } });
    const withRequest = logger.child({ requestId: 'req-1' });
    const withUser = withRequest.child({ userId: 'u-9' });

    withUser.info('inside');
    expect(records()[0]).toMatchObject({
      service: 'nido-api',
      requestId: 'req-1',
      userId: 'u-9',
    });

    withRequest.info('outer');
    expect(records()[1]).toMatchObject({ requestId: 'req-1' });
    expect(records()[1].userId).toBeUndefined();
  });

  it('keeps the level and format of its parent', () => {
    const { logger, records } = harness({ level: 'error' });
    logger.child({ userId: 'u-9' }).info('dropped');
    expect(records()).toEqual([]);
  });
});

describe('createStdoutSink', () => {
  it('writes each line as it arrives when the stream keeps up', () => {
    const writes: string[] = [];
    const stream = {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
      on: () => {},
      once: () => {},
    } as unknown as NodeJS.WritableStream;
    const sink = createStdoutSink(stream);

    sink('a\n');
    sink('b\n');
    expect(writes.join('')).toBe('a\nb\n');
  });

  it('buffers while the stream is backpressured instead of interleaving lines', () => {
    const writes: string[] = [];
    const drains: (() => void)[] = [];
    const stream = {
      write: (chunk: string) => {
        writes.push(chunk);
        return writes.length > 1; // first write backpressures
      },
      on: () => {},
      once: (_event: string, handler: () => void) => drains.push(handler),
    } as unknown as NodeJS.WritableStream;
    const sink = createStdoutSink(stream);

    sink('a\n');
    sink('b\n');
    expect(writes).toEqual(['a\n']); // 'b' held back, not interleaved

    drains.forEach((handler) => handler());
    expect(writes).toEqual(['a\n', 'b\n']);
  });

  it('reports how many lines it shed rather than growing without bound', () => {
    const writes: string[] = [];
    const drains: (() => void)[] = [];
    const stream = {
      write: (chunk: string) => {
        writes.push(chunk);
        return false; // permanently backpressured, so the queue fills
      },
      on: () => {},
      once: (_event: string, handler: () => void) => drains.push(handler),
    } as unknown as NodeJS.WritableStream;
    const sink = createStdoutSink(stream);

    const pushed = 10_050;
    for (let i = 0; i < pushed; i += 1) sink(`line-${i}\n`);

    // The shed count is reported on the next flush, so let one happen.
    drains.forEach((handler) => handler());

    const shedReportChunk = writes.find((chunk) => chunk.includes('log lines dropped'));
    expect(shedReportChunk).toBeDefined();
    const [shedReportLine] = (shedReportChunk as string).split('\n');
    const dropped = JSON.parse(shedReportLine).dropped as number;

    const written = writes
      .join('')
      .split('\n')
      .filter((line) => line !== '' && !line.includes('log lines dropped')).length;
    expect(written + dropped).toBe(pushed);
    expect(written).toBeLessThanOrEqual(10_001);
  });

  it('does not throw on a broken pipe', () => {
    const stream = {
      write: () => {
        throw Object.assign(new Error('EPIPE'), { code: 'EPIPE' });
      },
      on: () => {},
      once: () => {},
    } as unknown as NodeJS.WritableStream;
    const sink = createStdoutSink(stream);
    expect(() => sink('a\n')).not.toThrow();
  });
});
