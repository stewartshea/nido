---
name: pwa
description: Ensure the Nido web app remains PWA compatible. Use when modifying the web frontend, adding assets, changing build/vite config, or reviewing changes to guarantee installability (manifest, service worker, icons, meta tags, and offline behavior).
---

# PWA Compatibility Checklist

Nido is a mobile-first PWA. Any changes to `web/` must keep it installable on Chrome/Android (and iOS) and preserve offline behavior.

## Core Requirements

- **Web App Manifest**: Keep `web/static/manifest.webmanifest` valid JSON with `name`, `short_name`, `start_url`, `scope`, `display: "standalone"`, `theme_color`, `background_color`, and at least one icon in `icons`. `id` should remain stable (e.g. `"nido"`).
- **Service Worker**: `web/static/sw.js` must register and cache the app shell (at minimum `/`, `favicon.ico`, `favicon.svg`, `favicon.png`, `apple-touch-icon.png`, `manifest.webmanifest`, `robots.txt`). Never cache `/api/*`; only cache GET same-origin requests with 200 status. Increment `CACHE_NAME` only if the cache strategy intentionally changes.
- **Registration**: Service worker must be registered from the client (e.g. in `web/src/routes/+layout.svelte`) with `navigator.serviceWorker.register('/sw.js', { scope: '/' })` and only run in the browser (`$app/environment.browser`).
- **HTML Head**: `web/src/app.html` must include manifest link, theme-color, `mobile-web-app-capable`/`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, and `apple-mobile-web-app-title`. Preserve existing asset paths.
- **Icons**: Keep `web/static/apple-touch-icon.png`, `favicon.png`, `favicon.svg`, `favicon.ico` available and referenced consistently. Use maskable icons when possible; ensure SVG is valid.

## Verification Steps

1. Build: `cd web && npx vite build`
2. Check manifest: load `/manifest.webmanifest` in dev or built output; validate JSON and required fields.
3. Check service worker: confirm `/sw.js` is served and registers without errors.
4. Check head: inspect built HTML for manifest/theme-color/meta tags.
5. Type check: `cd web && npx svelte-check --tsconfig ./tsconfig.json`
6. Manual spot-check: in Chrome DevTools → Application → Manifest/Service Workers, verify installability.

## Notes

- Don't add large bundles to precache unless necessary; keep the shell minimal.
- Preserve existing offline queue/outbox behavior (changes must not interfere with auth or localStorage outbox).
- If you change theme colors, keep `theme_color` in manifest and `meta[name="theme-color"]` in sync.
