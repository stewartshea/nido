# Mobile & Offline Plan (PARKED)

**Status:** Parked — captured for later, not scheduled.
**Date:** 2026-09-27

## Context

Mobile is the primary use case. Two recurring pain points:

1. Users get signed out on mobile and have to log in repeatedly.
2. Timing a feed with no internet is fragile — the user wants a
   semi-offline mode that syncs when connectivity returns.

This doc records the current state and the cheapest path forward, so the
decision does not have to be re-derived later.

## Current state (as of 2026-09-27)

- **JWT expires in 24h**, with no refresh token — issued in
  `api/src/routes/auth.ts` (register, login) and `api/src/routes/families.ts`
  (join). This is the direct cause of "logged out on mobile".
- **Timers are client-side and persisted** to `localStorage`
  (`nido.timer.<memberId>`), so a feed timer keeps running across reloads and
  works with no network.
- **An offline outbox already exists** (`enqueueRecord` / `flushOutbox` in
  `web/src/routes/dashboard/+page.svelte`): failed writes are queued in
  `localStorage` (`nido.outbox`) and replayed on a 60s interval.
- **No service worker and no PWA manifest** — the app shell is not cached, so
  a cold start with no internet cannot even load.
- `tokenExpired()` (`web/src/lib/api.ts`) hard-logs-out on clock time in the
  root and login pages, even when offline.

## a) Keeping mobile users signed in

| Option | Effort | Trade-off |
| --- | --- | --- |
| Long-lived JWT (e.g. 90d) | ~0.5 day | Cheapest. There is no revocation list today, so marginal risk is low for a family app. |
| Sliding expiry — re-issue a fresh token on requests past half-life | ~1 day | Good UX, no new tables; still no true revocation. |
| Refresh token (short access ~15m + long rotated refresh) | ~3–5 days | Correct answer: long sessions and revocable. Needs a token table, an endpoint, a client interceptor, logout/rotation. |

Mobile-specific gotchas regardless of choice:

- **iOS web-app storage can be evicted** after ~7 days of non-use (ITP). A
  native shell (Capacitor) avoids this.
- Logging out purely on clock time is hostile offline; base it on a real 401
  instead where possible.

## b) Starting the mobile app plan

Do not rewrite. Ranked by effort:

1. **PWA** (service worker + manifest + install prompt) — ~2–4 days. Reuses the
   whole app. Good on Android; iOS is usable (push since 16.4) but has the
   storage-eviction caveat.
2. **Capacitor wrapper** — ~1–2 weeks, mostly packaging/signing. Same codebase
   in a native WebView, but gains secure Keychain/Keystore storage, a reliable
   local DB (SQLite), native push, and app-store distribution.
3. **React Native / Flutter rewrite** — 1–2 months+. Duplicates the UI. Avoid.

Recommendation: ship the **PWA** as the shared foundation (it also delivers c),
and treat **Capacitor** as the later "stores + bulletproof sessions" step. The
same service worker, offline store, and sync layer carry over.

## c) Least-effort "time a feed while the internet is out"

The timer and the save queue already work offline. The two real gaps are
*loading the app* and *staying signed in*.

1. **Cache the app shell** with a service worker so it opens offline — ~1–2 days.
2. **Keep the session past 24h** (long-lived or refresh token) so an offline
   cold start is not logged out — 0.5–1 day.
3. **Extend the existing outbox** beyond the dashboard (family page, other
   record types) — ~1 day. It is currently page-local; lift it into `$lib`.
4. **Make replay idempotent** — a client-generated UUID per record plus a
   unique index server-side, so a "saved but response lost" record cannot
   double-insert on flush — ~1–2 days. Do this before offline becomes a habit.

## Recommended first slice

Service worker + longer/refreshable session + widen the existing outbox
≈ **3–4 engineering days**, no native app required. This covers the exact
"time a feed with the internet out" scenario.

Candidate first steps, cheapest/highest-impact first:

- **Session** — refresh token, or a long-lived token as the quick win.
- **Service worker + manifest** — app shell caching and installability.

## Open questions

- Refresh token vs long-lived token: is revocation ever needed for this app?
- PWA only, or PWA now and Capacitor later for stores and push?
- Should offline writes cover all record types or just feed timing first?
