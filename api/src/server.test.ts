// src/server.test.ts
import { describe, it, expect } from 'vitest';
import app from './server';

// Module scope: Hono locks its router matcher on the first request, so a route
// registered inside an `it` block afterwards throws.
app.get('/api/v1/__test__/boom', () => {
  throw new Error('handler exploded');
});
app.get('/api/v1/__test__/boom-echo', () => {
  throw new Error('handler exploded');
});
app.get('/api/v1/__test__/boom-leak', () => {
  throw new Error('SQLITE_CONSTRAINT on table user_households');
});

describe('Server', () => {
  it('should return welcome message', async () => {
    const req = new Request('http://localhost/', { method: 'GET' });
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    
    const json = await res.json();
    expect(json).toHaveProperty('message');
    expect(json.message).toContain('Welcome to the Nido API');
  });

  it('should return health status', async () => {
    const req = new Request('http://localhost/health', { method: 'GET' });
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    
    const json = await res.json();
    expect(json).toHaveProperty('status');
    expect(json.status).toBe('ok');
  });

  it('should return ready status', async () => {
    const req = new Request('http://localhost/ready', { method: 'GET' });
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    
    const json = await res.json();
    expect(json).toHaveProperty('status');
    expect(json.status).toBe('ready');
  });
});

describe('Auth guard', () => {
  it('rejects protected routes without a token', async () => {
    const req = new Request('http://localhost/api/v1/users/me', { method: 'GET' });
    const res = await app.fetch(req);

    expect(res.status).toBe(401);
  });

  it('rejects protected routes with an invalid token', async () => {
    const req = new Request('http://localhost/api/v1/users/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    const res = await app.fetch(req);

    expect(res.status).toBe(401);
  });

  it('allows public auth endpoints without a token', async () => {
    const req = new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
    });
    const res = await app.fetch(req);

    // Not the auth guard rejecting — a 4xx here comes from validation/credentials.
    expect(res.status).not.toBe(401);
  });
});

describe('Error handling', () => {
  // Guards a regression: `await next()` used to sit inside requireAuth's try/catch,
  // so every 500 was reported as 401 and never reached onError.
  async function registerFamily(email: string): Promise<string> {
    const res = await app.fetch(
      new Request('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'StrongP4ss!', firstName: 'Err', lastName: 'Test' }),
      }),
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  it('propagates a handler throw to onError instead of reporting 401', async () => {
    const token = await registerFamily('err-handler@example.com');
    const res = await app.fetch(
      new Request('http://localhost/api/v1/__test__/boom', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(500);
    expect(res.status).not.toBe(401);
  });

  it('returns a requestId in the 500 body and echoes the inbound one', async () => {
    const token = await registerFamily('err-requestid@example.com');
    const res = await app.fetch(
      new Request('http://localhost/api/v1/__test__/boom-echo', {
        headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': 'test-request-id-123' },
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { requestId?: string };
    expect(body.requestId).toBe('test-request-id-123');
  });

  it('does not leak an internal error message to the client', async () => {
    const token = await registerFamily('err-leak@example.com');
    const res = await app.fetch(
      new Request('http://localhost/api/v1/__test__/boom-leak', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('SQLITE_CONSTRAINT');
    expect(text).not.toContain('user_households');
  });

  it('returns 404 for an unknown path with a requestId', async () => {
    const res = await app.fetch(new Request('http://localhost/definitely-not-a-route'));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { requestId?: string };
    expect(typeof body.requestId).toBe('string');
  });

  it('answers 401 rather than 404 for an unknown /api/v1 path', async () => {
    // The auth guard runs before routing resolves, so an unauthenticated caller
    // cannot probe which API paths exist.
    const res = await app.fetch(new Request('http://localhost/api/v1/does-not-exist'));

    expect(res.status).toBe(401);
  });
});