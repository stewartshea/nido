# Agent Rules for Nido

## UX Rules

- **Never use a wrapped/multi-row pill or chip list as a primary selector**
  (e.g. category/tab pickers). It breaks on mobile web (wraps unpredictably,
  wastes vertical space, hard to scan/tap). This has been flagged multiple
  times — do not reintroduce it.
  - For a plain enum with no icons (member type, gender, feed type, diaper
    consistency, etc.), use a native `<select class="w-full px-3 py-2 border
    border-line rounded-md">` (see `member-type`, `member-gender`, `feedType`
    selects in `family/+page.svelte`).
  - For a picker that needs an icon per option (category/tab selection), use
    the custom trigger-button + backdrop-dismiss listbox pattern in
    `family/+page.svelte` (the category dropdown) — native `<select>` can't
    render icons, and a wrapped pill row is banned regardless.
  - Segmented/toggle buttons (2-3 options max, e.g. Cards/Table view) are
    fine and should stay compact, not wrap.
  - Multi-select tag/filter chips (e.g. the "Mobile quick links" picker in
    Settings) are a different pattern and are fine to wrap — the ban above
    is specifically about *single-value* navigation/selection pickers.

## Design Principles

- **Never hardcode colors.** This app has a full theme engine: 7 palettes ×
  light/dark (14 presets — forest/sage/slate/espresso/terracotta/ocean/blush)
  defined as CSS variables in `web/src/app.css` under `[data-theme='...']`,
  switchable at runtime via `ThemePicker.svelte` + `theme.ts`, with a
  matching custom-theme editor. Tailwind exposes them as semantic classes in
  `tailwind.config.js`: `bg-page`, `bg-surface`, `bg-surface2`, `text-ink`,
  `text-ink-soft`, `bg-primary`/`text-on-primary`, `bg-accent`/
  `text-on-accent`/`bg-accent-soft`, `border-line`/`border-line-soft`,
  `bg-danger`/`text-danger-text`/`border-danger-line`, `bg-ok`/`text-ok-text`/
  `border-ok-line`. A hardcoded hex or raw Tailwind palette color (e.g.
  `bg-green-600`, `#2f6d3f`) renders wrong (or invisibly) in every theme
  except the one you happened to eyeball.
- **Typography**: headings/display text use `font-display` (Lora, serif);
  body/UI text uses the default `font-sans` (Inter). Don't add a third
  family.
- **Card shell**: `bg-surface rounded-xl shadow-sm border border-line-soft
  p-4` is the standard content-card pattern (used consistently across
  family/dashboard). Match it for new cards rather than inventing a new
  radius/shadow/border combination.
- **Tap targets**: primary actions use `h-11` (44px); secondary/segmented
  controls use `h-9` (36px, only for non-primary actions). Don't ship a
  tappable element smaller than `h-9` on a page that renders on mobile.
- **Forms/log entry**: `LogSheet.svelte` (a `vaul-svelte` bottom drawer) is
  the one established pattern for "add/edit a record" — feed, diaper, sleep,
  growth, milestone, and vaccination forms all use it. Don't introduce a
  second modal/dialog primitive for the same job.
- **Mobile nav**: `BottomNav.svelte` is `md:hidden` with 48×48px minimum
  touch targets and is the only primary navigation surface on mobile. Route
  new top-level destinations through it instead of bolting on a separate
  mobile nav.
- **Feedback**: use the existing toast pattern for save/delete confirmations
  and errors — fixed top-right, `Check`/`AlertCircle` icon, 6s auto-dismiss
  (`feedbackTimer` + `setTimeout`), driven by the page's `notice`/`error`
  state (already wired into family/dashboard/home/settings). Don't add a
  second alert/toast mechanism.
- **Widths**: page content is capped at `max-w-6xl` (root `<main>` in
  `+layout.svelte`); individual form/log cards are capped at `max-w-2xl` —
  match whichever cap the equivalent card uses elsewhere so the same content
  doesn't render at two different widths depending on view mode. On a
  `max-w-6xl`-wide container, avoid `justify-between` on a row that has a
  fixed-width control next to a small one — it stretches them apart on wide
  screens (this exact bug hit the Cards/Table toggle next to the category
  dropdown; fixed by dropping `justify-between` in favor of `gap-3`).

## Data Management Principles

- **Per-family encrypted namespaces are the tenant boundary.** Every family
  gets its own SQLCipher-encrypted SQLite file (`{familyId}.db` under
  `NIDO_DATA_DIR/db/`), opened via `getFamilyClient(familyId)`
  (`api/src/db-namespaces.ts`). There is no `WHERE family_id = ?` filter
  inside a family DB because the file itself *is* the boundary — never open
  another family's DB file to answer a request; access control belongs in
  `authz.ts`, before `getFamilyClient()` is ever called.
- **Key derivation**: each family DB is keyed by an HKDF-SHA256 subkey
  derived from a single `NIDO_MASTER_KEY` (`deriveKey()` in
  `api/src/db-core.ts`, salt = familyId, info = `'nido:db'`; the registry
  DB uses its own fixed salt/info). Never derive a key any other way, never
  reuse a subkey across families or purposes, and never log or expose
  `NIDO_MASTER_KEY` or a derived key. The dev fallback key
  (`DEV_FALLBACK_MASTER_KEY`) logs a loud warning on use — never silence or
  remove that warning, and `NIDO_MASTER_KEY` must be set via env in any
  deployed environment (enforced by the comment/convention in
  `docker-compose.yml`, generate with `openssl rand -hex 32`).
- **`familyId` is attacker-influenceable** (it comes straight from the JWT
  payload) and is used to build a filesystem path. It must pass
  `assertFamilyId()` / `FAMILY_ID_RE` (`^[A-Za-z0-9-]{10,64}$`) before it
  touches the filesystem or a SQL statement. Never interpolate a raw
  `familyId`, or any other request-derived string, into a file path or a SQL
  string.
- **Parameterized queries only.** Every existing route uses `execute({ sql:
  '... WHERE x = ?', args: [...] })` — never string-concatenate user input
  into SQL. Keep it that way for every new route.
- **Validate every mutating request body with `zod`** before it touches the
  DB — this is already the pattern in all route files that accept a body;
  don't hand-roll validation for a new one.
- **Registry vs. family data**: `registry.db` only maps email →
  familyId/userId and holds instance-wide settings (`app_settings`). Never
  write per-family application data (records, photos, settings) there — it
  belongs in the family namespace DB.
- **Uploads**: photo uploads are validated by MIME type
  (`mime.startsWith('image/')` in `api/src/routes/photos.ts`) and scoped to
  the family via the `photos.family_id` column — never trust a client-
  supplied filename or path. There is currently no max-file-size check; add
  one before exposing an upload path to untrusted or high-volume traffic.
- **Offline queueing**: client-side writes that might fail offline are
  queued under the `nido.outbox` localStorage key (capped to the most
  recent 200 entries) and flushed on page mount plus every 60s
  (`enqueueRecord()` / `flushOutbox()`, currently duplicated per-page in
  family/dashboard/home/settings). Reuse this exact shape for new
  offline-capable mutations rather than inventing a new queue — and prefer
  extracting it to `$lib/shared.ts` the next time one of these files is
  touched, since it's already duplicated 4x.
- **Auth tokens**: JWTs are signed with a 24h expiry
  (`jwt.sign(..., { expiresIn: '24h' })` in `api/src/routes/auth.ts`) and
  carry `userId`/`email`/`familyId`/`role`. Never mint a token without an
  expiry, and never trust a `familyId` from anywhere except a verified JWT.
- **Bulk data escape hatch**: `GET /families/:id/export` and `POST
  /families/:id/restore` (owner/admin-gated) are the sanctioned way to move
  data in/out of a family in bulk. Extend these instead of adding a parallel
  bulk-import/export mechanism.

## Key Derivation & Persistence Contracts

The values in this table look like ordinary strings, but they are data-format
and key-derivation contracts. A find-and-replace across any of them silently
destroys user data with no error at the point of change. If you touch one, you
are editing stored data, not source.

| Value | Where | What breaks if changed |
| --- | --- | --- |
| `DEV_FALLBACK_MASTER_KEY`'s `'nido-dev-insecure-key'` | `api/src/db-core.ts` | Re-derives every subkey → all dev databases undecryptable |
| `'nido:db'` (HKDF info) | `api/src/db-core.ts`, `api/src/db-namespaces.ts` (2 call sites) | Re-derives every family subkey → all family DBs undecryptable |
| `'nido:registry'` (salt + info) | `api/src/db-namespaces.ts` | `registry.db` undecryptable |
| `NIDO_MASTER_KEY` | env, all deploy manifests | If a deployment still sets only the old name, the API silently falls back to the public dev key → corruption. Rename in the manifest and the environment together. |
| `NIDO_DATA_DIR` | env, all deploy manifests | Data dir resets to `./data` → app looks empty |
| `'nido_restore'`, `'nido-backup.json'` | `api/src/routes/families.ts` | `import_runs` rows no longer match prior history |
| `nido.theme`, `nido.theme.custom` | `web/src/lib/theme.ts` | Every user's saved theme silently resets (no migration exists) |
| `nido.quicklinks.*` | `web/src/lib/shared.ts` + 4 routes | Saved quick links silently reset |
| `nido.familyId`, `nido.defaultProfile`, `nido.lastFeed`, `nido.timer.*`, `nido.outbox`, `nido.section` | `web/src/routes/{home,dashboard,family,settings}`, `web/src/lib/stores/uiStore.ts` | Queued offline writes, timers and selected family are lost |

The two `deriveKey(..., familyId, 'nido:db')` call sites in
`db-namespaces.ts` (attach vs. provision) must also stay **identical to each
other** — if they drift, an existing database opens on one path and fails to
decrypt on the other.

Changing any key-derivation value is a **re-encryption migration**, not a
rename: read each database with the old derived key and rewrite it with the
new one. Never rotate a key derivation input in place.

### Re-encrypting after a key-derivation change

`api/scripts/rekey-databases.ts` (`npm run db:rekey` from `api/`) performs that
migration. The previous scheme is supplied entirely through flags, so the
script carries no hardcoded legacy values and stays correct across renames.

Stop the API and back up the data directory first — this rewrites every
database file in place.

```bash
# 1. Prove the old key opens everything. Writes nothing.
npm run db:rekey -- \
  --data-dir ./data \
  --from-master-key <old-64-hex> \
  --from-db-info <old-info> \
  --from-registry-salt <old-salt> \
  --from-registry-info <old-info> \
  --dry-run

# 2. Same command without --dry-run to rewrite in place.
```

The target scheme defaults to the current constants
(`nido:db` / `nido:registry`), so only the `--from-*` side and the old master
key are needed. Pass `--to-master-key` as well to rotate the master key at the
same time. The script fails loudly rather than silently skipping a file it
cannot decrypt, so a partial migration cannot pass unnoticed.
