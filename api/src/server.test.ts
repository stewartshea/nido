// src/server.test.ts
import { describe, it, expect } from 'vitest';
import app from './server';

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