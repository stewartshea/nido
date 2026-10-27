// src/lib/api/client.ts — the shared axios instance, its interceptors, and
// the JWT helpers built on the token every authenticated request carries.
// Every domain module (records, family, ...) imports this default instance.
import axios from 'axios';
import { DATA_CHANGED } from '$lib/events';

// Same-origin (relative /api/v1); Vite proxies /api to the API. PUBLIC_ prefix
// is the only one exposed to the client (vite config envPrefix).
const API_BASE_URL = typeof window !== 'undefined'
  ? (import.meta.env.PUBLIC_API_URL || '/api/v1')
  : process.env.API_URL || 'http://localhost:3000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

type JwtPayload = { userId?: number; exp?: number; familyId?: string };

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.prototype.map.call(atob(b64), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The signed-in user's family, read from the JWT every authenticated request
 * already carries.
 *
 * Deliberately not from `localStorage['nido.familyId']`: that key is written by
 * the family page alone, so it is empty on a fresh sign-in — precisely when the
 * app is loading the family's settings. The token is authoritative and always
 * present.
 */
export function currentFamilyId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const token = localStorage.getItem('token');
  if (!token) return null;
  return decodeJwtPayload(token)?.familyId ?? null;
}

// Request interceptor: attach the stored JWT. The backend derives the user
// from the verified token — identity is never taken from a client header.
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload || !payload.exp) return false;
    return payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

export function tokenExpired(): boolean {
  const t = localStorage.getItem('token');
  return !!t && isTokenExpired(t);
}

// Response interceptor handles errors. A 401 only logs the user out when the
// JWT is genuinely expired; transient 401s (pod restart, proxy blip, instance
// redeploy) leave the token intact so the client retries on the next request
// instead of flip-flopping to the login page.
api.interceptors.response.use(
  (response) => {
    const method = (response.config.method || 'get').toLowerCase();
    const url = response.config.url || '';
    if (method !== 'get' && typeof window !== 'undefined' && !url.startsWith('/auth')) {
      window.dispatchEvent(new Event(DATA_CHANGED));
    }
    return response;
  },
  (error) => {
    const status = error.response?.status;
    if (status === 401 && isTokenExpired(localStorage.getItem('token') || '')) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('unauthorized'));
    }
    return Promise.reject(error);
  }
);

export default api;
