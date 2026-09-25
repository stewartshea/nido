# TODO / Future Work

Backlog of known issues and future improvements, in rough priority order.

## Auth: JWT verification on all user routes — DONE

**Fixed (2026-09):** Replaced the insecure per-handler "read Bearer token, then
trust a client-supplied `X-User-ID` header" pattern with a shared auth
middleware. Every `/api/v1/*` route now requires a verified Bearer JWT
(except the public auth endpoints `register`, `login`, `verify-email`,
`forgot-password`, `reset-password`); the verified `userId` comes from the
token via the request context, never from a client header.

- `api/src/auth.ts` — `requireAuth`, `jwtSecret`, `AuthEnv`, `PUBLIC_AUTH_PATHS`.
- `api/src/server.ts` — global guard mounted on `/api/v1/*`.
- All route groups typed as `Hono<AuthEnv>`; handlers use `c.get('userId')`.
- `web/src/lib/api.ts` — client no longer sends `X-User-ID` (only `Authorization`).

**Residual (worth a follow-up):** `JWT_SECRET` falls back to a well-known
development secret (`fallback-secret-key`) when unset. The deploy compose
already requires it (`${JWT_SECRET:?set JWT_SECRET in .env}`) and production
sets it — but a bare local run without env still signs with the known secret.
Consider failing fast instead of falling back.

## Web client: same-origin API target — DONE

**Fixed (2026-09):** The client previously defaulted to
`http://localhost:3000/api/v1`, so every browser (including phones on the
internet) triggered the Local Network Access permission prompt and targeted a
loopback the phone doesn't have. The client now calls the API **same-origin**
(`/api/v1`) by default; the Vite dev server proxies `/api` to the API
(`API_PROXY_TARGET`); `PUBLIC_API_URL` overrides the origin only when the API
is served from a different host.

- `web/src/lib/api.ts` — `PUBLIC_API_URL || '/api/v1'` (browser), `API_URL` (SSR).
- `web/vite.config.js` — `/api` proxy via `API_PROXY_TARGET` (default `localhost:3000`).
- Deploy files (compose + k8s) set `API_PROXY_TARGET` per topology; docs updated.