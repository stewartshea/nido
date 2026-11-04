# Navigation, Header, and Zero-Bloat Page Flow Design

**Status:** Approved Architecture · Ready for Agent Implementation  
**Target Workspace:** `web/` (SvelteKit + Svelte 4 + TypeScript)  
**Primary Pillar Order:** `Household` → `Family` → `Inventory` → `Reports` → `Notifications`

## Steps

- [x] Step 1: Update `web/src/lib/nav.ts` to the 5-pillar model (`Household` → `Family` → `Inventory` → `Reports` → `Notifications`) with `matchPrefixes` and `isNavItemActive()`, keeping existing `lucide-svelte` stroke icons (`Home`, `Users`, `Package`, `ChartLine`, `Bell`).
- [x] Step 2: Retire `/dashboard` completely:
  - In `web/src/lib/startPage.ts`, remove `'/dashboard'` from `ALLOWED_START_PAGES` (valid start pages: `'/family'`, `'/home'`, `'/inventory'`, `'/reports'`; default `'/family'`). If `localStorage` has `'nido.startPage' === '/dashboard'`, fall back to `'/family'`.
  - In `web/src/routes/login/+page.svelte` (`nextPath()`), replace the hardcoded `'/dashboard'` fallback (lines 51 and 59) with `getStartPage()`.
  - Replace `web/src/routes/dashboard/+page.svelte` with a lightweight redirect to `getStartPage()` (just like `web/src/routes/+page.svelte`).
- [x] Step 3: Strip all bloat from `web/src/routes/family/+page.svelte` so `/family` is a pure, fast 2-click care & logging page:
  - Replace the top pill row and `familyView` toggle with a single compact top bar: `<MemberSwitcher>` on the left (1-click `★` favorite + member dropdown) and `Edit {selectedMember.name}` (opens `EditMemberModal`) + `Manage members` (`/settings`) on the right.
  - Remove the `Family Overview` card grid, the `Quick reports · feeds` card, `<StockGlance />`, `<Trends />`, and `<GrowthChart />` from `/family`.
  - Render `<MemberActivity>` with **nothing** in its `<slot />` so the vertical stack on `/family` is strictly: `MemberSwitcher` → (conditional `reminders-banner`) → `QuickActions` → `RunningTimers` → `TodaySummary` → (conditional `MedicationsPanel`) → `ActivityHistory`.
- [x] Step 4: Move `<Trends />` and `<GrowthChart />` to `web/src/routes/reports/+page.svelte` so all charts, rates, and percentiles live in **Reports**.
- [x] Step 5: Remove the dead bottom placeholder cards (`Property Assets` and `Manuals & Routines`) from `web/src/routes/home/+page.svelte` and keep `<HouseholdNav>`'s `h1` as `Household`.
- [x] Step 6: Redesign `web/src/lib/components/logging/InventoryPanel.svelte` so "Cards" mode renders real scannable Nido cards (`grid-cols-1 md:grid-cols-2 gap-3`) with prominent tabular quantities, a proportional 30-day cover bar + badge, a grouped `[ −1 | +1 | ⋯ ]` stepper bar, and an **inline** `manage-panel` drawer inside the clicked card (instead of detached at the bottom of the page), while collapsing `Diaper sizes` and `Categories` setup blocks behind compact toolbar buttons.
- [x] Step 7: Update the Playwright E2E tests (`web/tests/e2e/smoke.spec.ts`, `web/tests/e2e/assets.spec.ts`, `web/tests/e2e/care.spec.ts`) to match the retired `/dashboard` redirect (`**/family`), the lean `/family` layout (`MemberSwitcher` + `Edit`), and the `Household` heading on `/home` & `/assets`.
- [x] Step 8: Update the website documentation (`site/src/content/docs/guides/user-guide.md`, `site/src/content/docs/features.md`, and `site/src/content/docs/index.mdx`) to document the 5 unified pillars (`Household`, `Family`, `Inventory`, `Reports`, `Notifications`), configurable start page (`nido.startPage`), interactive Inventory stat filter cards & scannable item cards with inline recount/sparkline drawers, multi-formula + category line overlays in `/reports`, and the child Age tile showing the latest growth measurement.
- [x] Step 9: Regenerate all mobile screenshots in `site/src/assets/screenshots/` (`390×844`, `deviceScaleFactor: 2`, `blush-light` and `blush-dark` themes) using Playwright against realistic seeded data (positive weight gain, visible scannable inventory cards, `<NidoMark />` egg-in-nest header, new 5-pillar `BottomNav`, and rules visible on `/notifications`), plus add `phone-reports-{light,dark}.jpg` and `phone-household-{light,dark}.jpg` slides to the landing page carousel in `site/src/content/docs/index.mdx` and verify `npm run build --workspace=site` (or `cd site && npm run build`).

---

## 1. Root Cause Diagnosis (Why Previous Iterations Failed)

1. **`login/+page.svelte` still routed to `/dashboard`:**
   - Lines 51 and 59 of `web/src/routes/login/+page.svelte` hardcoded `return '/dashboard'`. Signing in or registering dropped the user onto the old `/dashboard` god-page with its duplicate `Family` section and fake `Home` placeholder boxes (`Property Assets`, `Maintenance`, `Manuals & Routines`).
2. **`/family` was carrying 4 other pages' content on its back:**
   - Before `/inventory` and `/reports` existed as first-class navigation tabs, `StockGlance`, `Quick reports · feeds`, `Trends`, and `GrowthChart` were bolted onto `/family` and `/dashboard`.
   - Now that **Inventory** (`/inventory`) and **Reports** (`/reports`) are primary tabs in both the desktop header and mobile bottom bar, keeping `StockGlance`, `Quick reports`, `Trends`, and `GrowthChart` on `/family` is pure duplication and visual bloat.
   - Similarly, the giant `Family Overview` member card grid on `/family` only existed to click `Edit` or `Switch member` — which `<MemberSwitcher>` + an inline `Edit` button does in a single 44px bar.
3. **E2E tests were dictating dead UI:**
   - The previous agent put dead `Property Assets` and `Manuals & Routines` boxes back onto `/home` and kept the `Family Overview` mode on `/family` just to appease old assertions in `smoke.spec.ts`. **Fix the tests to match the clean UX, never bloat the UI to match legacy tests.**

---

## 2. Exact Page-by-Page Specification

### 2.1 Retiring `/dashboard` (`web/src/routes/dashboard/+page.svelte` & `web/src/routes/login/+page.svelte`)

- **`web/src/lib/startPage.ts`:**
  ```ts
  export type StartPagePath = '/family' | '/home' | '/inventory' | '/reports';

  export const ALLOWED_START_PAGES: { path: StartPagePath; label: string }[] = [
  	{ path: '/family', label: 'Family' },
  	{ path: '/home', label: 'Household' },
  	{ path: '/inventory', label: 'Inventory' },
  	{ path: '/reports', label: 'Reports' },
  ];
  ```
- **`web/src/routes/login/+page.svelte`:**
  - Import `getStartPage` from `$lib/startPage`.
  - In `nextPath()`, replace both `return '/dashboard'` fallbacks with `return getStartPage()`.
- **`web/src/routes/dashboard/+page.svelte`:**
  - Replace the entire 403-line file with a simple client redirect to `getStartPage()` (identical in shape to `web/src/routes/+page.svelte`) so old bookmarks to `/dashboard` land cleanly on `/family` (or the user's pinned start page).

---

### 2.2 The Lean `/family` Page (`web/src/routes/family/+page.svelte`)

When a family and its members exist, `/family` has **one unified view** (delete `let familyView` completely).

#### Top-to-Bottom Anatomy of `/family`:
1. **Row 1 — Compact Member Bar (`flex flex-wrap items-center justify-between gap-3 mb-6`):**
   - **Left:**
     - If `families.length > 1`, show the compact family switcher pills.
     - `<MemberSwitcher>` (`import MemberSwitcher from '$lib/components/logging/MemberSwitcher.svelte'`):
       ```svelte
       <MemberSwitcher
       	members={profiles.map((b) => ({ id: Number(b.id), name: b.name, avatar: b.avatar, stage: b.stage }))}
       	selectedId={selectedMemberId}
       	starredId={starredMemberId}
       	familyId={activeFamilyId}
       	on:select={(e) => selectMember(e.detail.memberId)}
       	on:star={(e) => { setStarred(e.detail.memberId); selectMember(e.detail.memberId); }}
       />
       ```
   - **Right:**
     - If `selectedMember` is present:
       - If `selectedMember.email`: `<button type="button" on:click={() => inviteMemberEmail(selectedMember.email)} class="h-9 px-3 rounded-md bg-surface border border-line-soft text-xs font-semibold text-accent hover:bg-surface2">Invite</button>`
       - `<button type="button" data-testid="edit-selected-member" on:click={() => openEditMember(selectedMember)} class="h-9 px-3 rounded-md bg-surface border border-line-soft text-xs font-semibold text-ink-soft hover:text-ink">Edit {selectedMember.name}</button>`
       - `<a href="/settings" class="h-9 px-3 rounded-md bg-surface border border-line-soft text-xs font-semibold text-ink-soft hover:text-ink inline-flex items-center">Members &rarr;</a>`
2. **Row 2 — Conditional Overdue Reminders Banner (`#if $overdueReminders.length > 0`):**
   - Renders `data-testid="reminders-banner"` with link to `/notifications`. Takes 0px when no reminders are overdue.
3. **Row 3 — `<MemberActivity>` (with NO slot children!):**
   - Renders:
     1. `<QuickActions>` (1-tap category tiles + `+ Log activity` button)
     2. `<RunningTimers>` (0px when no timer is running)
     3. `<TodaySummary>` (`Today for {selectedMember.name}` — Last Feed, Last Diaper, Last Sleep, Upcoming tile linking to `/appointments`, etc.)
     4. `<MedicationsPanel>` (only when `activeCategories.includes('medication')`)
     5. `<ActivityHistory>` (`#activities` — directly below `TodaySummary`!)

#### What Must Be Removed from `web/src/routes/family/+page.svelte`:
- Remove `let familyView`.
- Remove the `Family Overview` heading and `member-card` grid.
- Remove the `upcoming-appointments-card` block (`TodaySummary` already includes the `Upcoming` tile linking to `/appointments`).
- Remove the `Quick reports · feeds` card (`computeFeedReports` moves to `/reports`).
- Remove `<StockGlance />`, `<Trends />`, and `<GrowthChart />` imports and usage from `/family`.

---

### 2.3 Consolidating Analytics on `/reports` (`web/src/routes/reports/+page.svelte`)

Move the look-back components that were cluttering `/family` into `/reports`:
1. Keep the top filter bar (`[ 7d | 30d | 90d | Custom ]` + `For: [ Whole family | Member ]` `<select>`).
2. Keep the 4 KPI summary cards (`Pumped`, `Formula`, `Bottled milk`, `Inventory used`) and `<DailySeriesChart />` (with `By category` toggles below the chart).
3. Below the `What got used` table (or when a specific member is selected / for the active child):
   - Render `<Trends memberId={effectiveMemberId} memberName={effectiveMemberName} categories={effectiveCategories} />`.
   - If the member is a child (`type === 'child'`) and tracks `growth`, render `<GrowthChart memberId={effectiveMemberId} memberName={effectiveMemberName} />`.

---

### 2.4 Cleaning Up `/home` (`Household`) (`web/src/routes/home/+page.svelte` & `HouseholdNav.svelte`)

1. In `web/src/lib/components/HouseholdNav.svelte`, set the heading to `Household` (or `Household` on `/home` and `Property Assets` on `/assets`).
2. In `web/src/routes/home/+page.svelte`, delete the bottom 2-column placeholder grid (`Property Assets` and `Manuals & Routines`, lines 269–278).

---

### 2.5 Redesigning Inventory Cards & Panel (`web/src/lib/components/logging/InventoryPanel.svelte`)

#### Audit of Current Friction in `InventoryPanel.svelte`
1. **Setup sections push items below the fold (lines 623–774):** The `Diaper sizes` weight-band preset checklist (`data-testid="size-presets"`) and the `Categories` chip manager (`data-testid="manage-categories"`) sit permanently expanded above the stock list.
2. **"Cards" mode is not cards (lines 845–896):** It renders a flat `divide-y` `<ul>` where the two most important numbers (`item.quantity` and `item.daysOfCover`) are buried inside a 12px `text-xs text-ink-soft` run-on sentence.
3. **Detached Manage Drawer (lines 898–930):** Clicking `⋯` (`data-testid="manage-item"`) opens `data-testid="manage-panel"` at the very bottom of the entire component (outside the `{#each}` loop!) rather than on the item that was clicked.

#### Required Redesign in `InventoryPanel.svelte`
1. **Top Toolbar (Collapse Setup Sections by Default):**
   - Introduce `let showDiaperSizes = false;` alongside existing `let showCategories = false;`.
   - In the top header bar of `InventoryPanel.svelte`, provide compact secondary toggle buttons:
     - `Diaper sizes` (`on:click={() => (showDiaperSizes = !showDiaperSizes)}`)
     - `Categories` (`data-testid="manage-categories"`, `on:click={() => (showCategories = !showCategories)}`)
     - `[ Cards | Table ]` segmented toggle + `+ Add item` primary button (`on:click={openAdd}`).
   - Render the Diaper Sizes panel only when `showDiaperSizes` is true, and the Categories panel only when `showCategories` is true.
2. **True Scannable Inventory Cards (`viewMode === 'cards'`):**
   - Group by category (`#each grouped() as [cat, catItems]`), and render `catItems` inside `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">`.
   - Each card uses the standard Nido card shell with a semantic left-border accent indicating health:
     - `border-l-4 border-danger` if `item.alerting || (item.daysOfCover !== null && item.daysOfCover <= 3)`
     - `border-l-4 border-accent` if `item.daysOfCover !== null && item.daysOfCover <= 7`
     - `border-l-4 border-ok-line` if `item.daysOfCover !== null && item.daysOfCover > 7`
     - `border-l-4 border-line` if `item.daysOfCover === null`
   - **Card Top Row:**
     - Left: `<p class="font-display font-semibold text-base text-ink">` with `{item.name}` and, if `item.variant`, a `<span class="ml-1.5 text-xs font-sans font-semibold bg-surface2 text-ink-soft border border-line-soft px-2 py-0.5 rounded-full">{item.variant}</span>`. Below the title, show `needs attention` (`#if item.alerting`) or drift warning (`#if item.drift`).
     - Right: Prominent tabular quantity display:
       ```svelte
       <div class="text-right shrink-0">
       	<p class="text-xl font-display font-semibold tabular-nums text-ink leading-tight">{item.quantity}</p>
       	<p class="text-xs text-ink-soft leading-tight">{item.unit}</p>
       </div>
       ```
   - **Card Middle Row (Proportional 30-Day Cover Bar + Cover Pill):**
     - Horizontal progress track (`h-1.5 flex-1 rounded-full bg-surface2 overflow-hidden`) with fill width `Math.min(100, Math.max(6, Math.round(((item.daysOfCover ?? 0) / 30) * 100)))%` when `item.daysOfCover !== null`.
     - Cover badge (`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums`): shows `{cover(item)}` (`~14d left`, `runs out today`, or `no forecast yet`).
   - **Card Bottom Row (Rule Summary + Grouped Stepper Controls):**
     - Left: Concise rule & expiry metadata (`uses {linkRule(item)}`, `expires ...`).
     - Right: Tactile grouped stepper (`inline-flex rounded-lg border border-line-soft bg-surface2 overflow-hidden shrink-0`):
       - `−1` button (`data-testid="record-use"`, `aria-label="Record using one {item.name}"`, `h-8 px-2.5 text-xs font-semibold tabular-nums hover:bg-line-soft border-r border-line-soft`)
       - `+1` button (`aria-label="Add one {item.name}"`, `h-8 px-2.5 text-xs font-semibold text-accent tabular-nums hover:bg-line-soft border-r border-line-soft`)
       - `⋯` / `Recount` button (`data-testid="manage-item"`, `aria-label="Manage {item.name}"`, `h-8 px-2.5 text-xs font-semibold text-ink-soft hover:text-ink hover:bg-line-soft`)
   - **Inline Manage Drawer (`#if managingId === item.id`):**
     - Render `data-testid="manage-panel"` **directly inside the card** (and in Table mode, right below the table or active row) so recounting, viewing `<UsageSparkline />`, resetting history, or stopping tracking happens in-place on the item you clicked!

---

### 2.6 Updating E2E Tests (`web/tests/e2e/`)

Update the Playwright E2E tests so they test the new, clean architecture:
1. **`web/tests/e2e/assets.spec.ts`:**
   - Line 25: Change `await page.waitForURL('**/dashboard')` to `await page.waitForURL('**/family')`.
   - Line 30: Match the heading in `HouseholdNav.svelte`.
2. **`web/tests/e2e/care.spec.ts`:**
   - Line 30: Change `await page.waitForURL('**/dashboard')` to `await page.waitForURL('**/family')`.
3. **`web/tests/e2e/smoke.spec.ts`:**
   - Test 1 (`register lands on the family page...`): `await page.waitForURL('**/family')`, assert `Switch person` (`MemberSwitcher`) and `Activities` heading are visible.
   - Test 2 (`family page...`): Assert `Switch person`, `Quick Actions`, and no `reminders-banner`.
   - Test 4 (`family page: MemberSwitcher switches and stars a member`): Open `Switch person`, select `CHILD`, verify `Today for ${CHILD}` renders.
   - Test 5 (`family page: EditMemberModal renames a member`): Click `Edit ${CHILD}` (`getByTestId('edit-selected-member')`), rename to `CHILD_RENAMED`, verify toast and updated name in `Switch person` / `Today for ${CHILD_RENAMED}`.
   - Test 8 (`family and home render the family data without the setup empty states`): Check `/family` and `/home` (`Homes` heading, `What's due` heading) without checking for the deleted `Property Assets` placeholder card.

---

## 3. Website Documentation & Mobile Screenshots Specification (Steps 8 & 9)

### 3.1 Audit of Outdated Website Content (`site/src/`)

1. **`site/src/content/docs/guides/user-guide.md`:**
   - **`## The five places` (lines 28–36):** Still describes the old 7-item split (`Dashboard`, `Family`, `Home`, `Inventory`, `Notifications` on mobile, with `Reports` and `Assets` desktop-only). Update to describe the unified 5 pillars shared across desktop and mobile in order: **Household** (Residences, Upkeep & Property Assets), **Family** (members, 2-tap logging, Today tiles, Trends, Stock glance, and WHO Growth curves), **Inventory** (stock cards, cover bars, interactive stat filters, and inline recounts), **Reports** (daily series, multi-formula breakdown, category overlays), and **Notifications** (firing alerts, tracking/inventory rules, and email digests). Document pinning any pillar as your default **Start page** from the account menu or **Settings → Profile**.
   - **`## Inventory` (lines 165–218):** Document the interactive metric filter cards at the top of `/inventory` (clicking `Needs attention`, `Counts disagree`, `Expiring soon`, `No forecast yet`, or `Auto-decrementing` filters the items below in 1 tap), the scannable inventory cards with 30-day cover bars and `[ −1 | +1 | ⋯ ]` steppers, and the inline recount & 30-day usage sparkline drawer. Also mention the `📏 Diaper sizes` and `🏷️ Categories` toolbar toggles.
   - **`## Reports` (lines 219–243):** Document the **Formula** row when a family uses two or more formula cans (`All combined` plus individual toggles for each formula item on the volume axis) alongside the `By category` inventory lines.
   - **`## Home` → `## Household` (lines 276–308):** Update section heading and navigation references to **Household**, noting the `[ Residences & Upkeep | Property Assets ]` switcher and that **What's due** rises to the top whenever maintenance schedules are due or overdue.
   - **`## Working offline` (line 313):** Update `Dashboard or Family page` to `Family page`.

2. **`site/src/content/docs/features.md`:**
   - **`## Today` (lines 121–133):** Note that the **Age** tile for a child now displays both their age in weeks/months and their **latest growth measurement** (weight/length and how long ago it was recorded) right on the tile, plus the **Upcoming** tile for booked appointments.
   - **`## Inventory` (lines 161–204):** Mention the interactive stat filter tiles, scannable cards with proportional 30-day cover bars, formula cans linked directly to bottle feeds, and inline 30-day usage sparklines.
   - **`## Reports` (lines 275–280):** Replace the outdated 4-line stub (which only mentioned 24h/30d rollups on Family) with the full `/reports` feature set: 7d / 30d / 90d / Custom date windows, whole-family or per-member filtering, overlaid daily series (`Pumped`, `Formula`, `Bottled milk`, `Inventory used`), per-formula breakdown when feeding multiple formulas (`All combined` + each formula can), `By category` inventory lines, interactive day drill-down, and the `What got used` ledger table.
   - **`## Home` → `## Household` (lines 239–274):** Align heading and navigation references with **Household** (`Residences & Upkeep` and `Property Assets`).

3. **Outdated Screenshots in `site/src/assets/screenshots/` & `site/src/content/docs/index.mdx`:**
   - Every existing screenshot (`phone-feeds-{light,dark}.jpg`, `phone-pumping-{light,dark}.jpg`, `phone-trends-{light,dark}.jpg`, `phone-growth-{light,dark}.jpg`, `phone-inventory-{light,dark}.jpg`, `phone-family-members-{light,dark}.jpg`, `phone-notifications-{light,dark}.jpg`) was captured before the new product mark and navigation landed:
     - Header still shows the old `巣` kanji instead of `<NidoMark />` (egg in a nest).
     - Bottom bar still shows `Dashboard | Family | Home | Inventory | Notifications` instead of `Household | Family | Inventory | Reports | Notifications`.
     - `phone-feeds` shows the retired `/dashboard` header and `Add measurement` on the Age tile instead of the latest weight.
     - `phone-trends` shows negative weight gain (`-36 g / day`).
     - `phone-inventory` shows `← Back` and the expanded `DIAPER SIZES` form pushing all stock cards off-screen.
     - `phone-family-members` shows the deleted `Family Overview` with `152.5oz` average feed size.
     - `phone-notifications` shows `← Back` and the `Email` essay above the rules.
   - Furthermore, the landing page carousel in `site/src/content/docs/index.mdx` has **no slide for Reports** (`/reports`) and **no slide for Household** (`/home` & `/assets`).

---

### 3.2 Regenerating Mobile Screenshots (`site/src/assets/screenshots/`)

Write a repeatable Playwright capture script (or spec) that boots or connects to the running app, seeds a realistic household (**The Carter Family**: baby **Wren** at 12 weeks with steady positive weight gain `+28 g/day`, realistic 3–5 oz feeds across two formula cans + breast/pumped sessions, active diaper/wipes/formula inventory with healthy & low-stock items, 2 active tracking/inventory rules, and a primary residence with a car & furnace schedule), and captures `390×844` (`deviceScaleFactor: 2`, JPEG quality `88`) screenshots in both `blush-light` and `blush-dark` themes (`localStorage.setItem('nido.theme', 'blush-light' | 'blush-dark')`):

| Asset Pair (`light` & `dark`) | Route & Scroll Position | What Must Be Visible in Frame (`390×844`) |
| :--- | :--- | :--- |
| `phone-feeds-{light,dark}.jpg` | `/family` (top of page) | `<NidoMark />` header, `<MemberSwitcher>` (`Wren · infant ★`), `Edit Wren` / `Members →`, `Quick Actions` tiles, `Today for Wren` showing `AGE 12 weeks` **with latest weight (`5.8 kg`)** and `LAST FEED 45 min ago`, and the new 5-pillar `BottomNav` (`Household`, `Family`, `Inventory`, `Reports`, `Notifications`). |
| `phone-pumping-{light,dark}.jpg` | `/family` (with Pump logger sheet or `LAST PUMP` tile + `Quick Actions`) | Pumping logger / session view in `blush-light` & `blush-dark`. |
| `phone-trends-{light,dark}.jpg` | `/family` (scrolled to `Trends for Wren` & `Stock`) | `Trends for Wren` showing realistic positive weight gain (`+28 g / day`) and `Stock` glance cards below it. |
| `phone-growth-{light,dark}.jpg` | `/family` (scrolled to `Growth for Wren`) | `Growth for Wren` WHO percentile chart with upward weight curve, plus new `BottomNav`. |
| `phone-inventory-{light,dark}.jpg` | `/inventory` (top of page, with `📏 Diaper sizes` collapsed!) | Interactive `InventoryStats` filter tiles + the new scannable **Inventory Cards** with large tabular quantities, 30-day cover progress bars (`~4d left`, `~22d left`), and `[ −1 | +1 | ⋯ ]` steppers clearly visible above the fold. |
| `phone-reports-{light,dark}.jpg` *(New)* | `/reports` | Range selector (`30d`), 4 KPI summary cards (`Pumped`, `Formula`, `Bottled milk`, `Inventory used`), multi-formula + `By category` toggles, and `<DailySeriesChart />`. |
| `phone-household-{light,dark}.jpg` *(New)* | `/home` | `Household` header with `[ Residences & Upkeep | Property Assets ]` switcher, `What's due` maintenance items, and `Homes` residence card with photo & asset count. |
| `phone-family-members-{light,dark}.jpg` | `/family` (with `<MemberSwitcher>` dropdown open or `/settings` Members view) | Multiple family members (`Wren · infant`, `Sam Carter · adult`, `Milo · pet`) with `★` favorite indicators and member management. |
| `phone-notifications-{light,dark}.jpg` | `/notifications` | `Needs attention now` firing box followed immediately by `Tracking rules` and `Inventory rules` (with the `Email` section moved to the bottom). |

Update `site/src/content/docs/index.mdx` to include the new **Reports** (`#slide-reports`) and **Household** (`#slide-household`) slides in the carousel and dot nav, then run `npm run build` in `site/` to verify all Astro image imports and links compile cleanly.
