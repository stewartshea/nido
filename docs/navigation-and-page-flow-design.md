# Navigation, Header, and Top-to-Bottom Page Flow Design

**Status:** Proposed · Ready for Agent Implementation  
**Target Workspace:** `web/` (SvelteKit + Svelte 4 + TypeScript)  
**Primary Pillar Order:** `Household` → `Family` → `Inventory` → `Reports` → `Notifications`

## Steps

- [x] Step 1: Update `web/src/lib/nav.ts` to the 5-pillar model (`Household` → `Family` → `Inventory` → `Reports` → `Notifications`) with `matchPrefixes` and `isNavItemActive()`, keeping existing `lucide-svelte` stroke icons (`Home`, `Users`, `Package`, `ChartLine`, `Bell`).
- [x] Step 2: Create `web/src/lib/startPage.ts` (`nido.startPage`, defaulting to `'/family'`) and wire root redirect (`web/src/routes/+page.svelte`), header logo link + pin indicator + account menu action (`web/src/routes/+layout.svelte`), and Settings selector (`web/src/lib/components/settings/AccountPanel.svelte`).
- [x] Step 3: Update `web/src/lib/components/BottomNav.svelte` to use `isNavItemActive()` so all 5 pillars (including `Reports`) are accessible on mobile and `Household` stays active on `/assets`.
- [x] Step 4: Create `web/src/lib/components/HouseholdNav.svelte` (`[ Residences & Upkeep | Property Assets ]` 2-button segmented switcher) and apply top-to-bottom layout improvements to `web/src/routes/home/+page.svelte` and `web/src/routes/assets/+page.svelte` (plus remove dead baby-tracking fetches and static placeholder cards from `/home`).
- [x] Step 5: Refactor `web/src/routes/family/+page.svelte` so `/family` cleanly separates `Care & Log` (fast 2-click logging at top with QuickActions, Timers, TodaySummary, and Activities) from `Family Overview` (member cards with Favorite toggle, Upcoming appointments, and Quick reports) via a top segmented toggle and member cards, with 1-click `★` favoriting.
- [x] Step 6: Apply top-to-bottom layout cleanups to `web/src/routes/inventory/+page.svelte`, `web/src/routes/reports/+page.svelte`, and `web/src/routes/notifications/+page.svelte` (remove top-level `← Back` buttons, standardize `max-w-4xl`, elevate urgent alerts/rules above explanatory text, and wire `?memberId=` on `/reports`).

---

## 1. Problem Statement & Audit Findings

1. **Reports (`/reports`) is unreachable on mobile (`<768px`):**
   - On `main`, `PRIMARY_NAV` has 7 items (`Dashboard`, `Reports`, `Family`, `Home`, `Inventory`, `Assets`, `Notifications`) while `BOTTOM_NAV` filters out `assets` and `reports` to fit a 5-column mobile bar (`grid-cols-5`).
   - On `/family` (`web/src/routes/family/+page.svelte`, line 604), the **"Quick reports · feeds →"** header is wired to `<button on:click={() => { familyView = 'detail'; }}>` instead of linking to `/reports`. Mobile users have no primary or contextual path to `/reports`.

2. **"Home" vs. "Dashboard" Terminology Collision:**
   - Users expect **Home** to mean the landing/start page, whereas `/home` in Nido is the **Residences, Property Assets & Maintenance** domain (*"Your residences and what lives at them"*, `"What's due"`).
   - Renaming the `/home` navigation pillar to **Household** (while keeping `/home` and `/assets` routes intact) removes the collision with the user's pinned start page.

3. **Duplication Between `/dashboard` and `/family` & Buried Logging Controls:**
   - `/dashboard` duplicates `/family`'s `<MemberSwitcher>`, `<MemberActivity>`, and `<StockGlance>`, followed by a stub "Home" section that links to `/home` and `/assets`.
   - Meanwhile, on `/family`, `<MemberActivity>` (which holds the 1-tap `QuickActions` log tiles and `RunningTimers`) is buried ~800px down the page below a redundant `Family Overview` member directory card grid, `Upcoming Appointments`, `Quick reports`, and `StockGlance` — and `<GrowthChart>` is trapped at the very bottom below the entire paginated `<ActivityHistory>` list.
   - Additionally, `web/src/routes/home/+page.svelte` still carries ~160 lines of dead copy-pasted baby-tracking state (`feedingAPI.getAll`, `diaperAPI.getAll`, etc.) that fires 8 unused API requests on mount.

4. **Hardcoded Landing Page (`/` → `/dashboard`):**
   - `web/src/routes/+page.svelte` hardcodes `goto('/dashboard')`. Users should be able to pin their preferred start page (`nido.startPage`), defaulting to **`/family`**.

---

## 2. Guardrails from `AGENTS.md` (Mandatory)

- **No `$app/stores`:** Never import `$app/stores` (triggers Svelte 5 runes SSR crash with Rollup `4.63.4`). Always track `currentPath` via `afterNavigate`.
- **No hardcoded colors:** Use only semantic Tailwind theme classes (`bg-page`, `bg-surface`, `bg-surface2`, `text-ink`, `text-ink-soft`, `bg-primary`, `text-on-primary`, `bg-accent`, `text-on-accent`, `bg-accent-soft`, `border-line`, `border-line-soft`, `bg-danger`, `text-danger-text`, `border-danger-line`, `bg-ok`, `text-ok-text`).
- **Icon consistency:** Keep the existing `lucide-svelte` stroke icons (`Home`, `Users`, `Package`, `ChartLine`, `Bell`, `Star`, `CalendarClock`, `Wrench`) and `<NidoMark />`. Do not introduce custom or emoji icons.
- **No wrapped pill rows for single-value selection:** Use native `<select>` for plain enums or compact 2–3 item segmented controls (`h-9` / `h-11`).
- **Tap targets:** Minimum `h-11` (44px) for primary actions on mobile; `h-9` (36px) for secondary/segmented controls.

---

## 3. Navigation Model (`web/src/lib/nav.ts`)

Both the desktop top header (`+layout.svelte`) and mobile bottom bar (`BottomNav.svelte`) render the exact same 5 pillars in this order:

**`Household` → `Family` → `Inventory` → `Reports` → `Notifications`**

```ts
import { Users, Package, Home, Bell, ChartLine } from 'lucide-svelte';

export interface NavItem {
	id: string;
	label: string;
	href: string;
	matchPrefixes: string[];
	icon: typeof Users;
}

/**
 * Destinations reachable from both the header and the mobile bottom bar.
 * Order: Household -> Family -> Inventory -> Reports -> Notifications.
 */
export const PRIMARY_NAV: NavItem[] = [
	{
		id: 'home',
		label: 'Household',
		href: '/home',
		matchPrefixes: ['/home', '/assets'],
		icon: Home,
	},
	{
		id: 'family',
		label: 'Family',
		href: '/family',
		matchPrefixes: ['/family', '/appointments', '/dashboard'],
		icon: Users,
	},
	{
		id: 'inventory',
		label: 'Inventory',
		href: '/inventory',
		matchPrefixes: ['/inventory'],
		icon: Package,
	},
	{
		id: 'reports',
		label: 'Reports',
		href: '/reports',
		matchPrefixes: ['/reports'],
		icon: ChartLine,
	},
	{
		id: 'notifications',
		label: 'Notifications',
		href: '/notifications',
		matchPrefixes: ['/notifications'],
		icon: Bell,
	},
];

export const BOTTOM_NAV: NavItem[] = PRIMARY_NAV;

export function isNavItemActive(item: NavItem, pathname: string): boolean {
	if (!pathname) return false;
	return item.matchPrefixes.some((prefix) => pathname.startsWith(prefix));
}
```

---

## 4. Pinned Start Page (`web/src/lib/startPage.ts`)

Create `web/src/lib/startPage.ts`:

```ts
import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type StartPagePath = '/family' | '/home' | '/inventory' | '/reports' | '/dashboard';

export const ALLOWED_START_PAGES: { path: StartPagePath; label: string }[] = [
	{ path: '/family', label: 'Family' },
	{ path: '/home', label: 'Household' },
	{ path: '/inventory', label: 'Inventory' },
	{ path: '/reports', label: 'Reports' },
	{ path: '/dashboard', label: 'Compact Dashboard' },
];

const STORAGE_KEY = 'nido.startPage';
export const DEFAULT_START_PAGE: StartPagePath = '/family';

export function isStartPagePath(path: string): path is StartPagePath {
	return ALLOWED_START_PAGES.some((p) => p.path === path);
}

export function getStartPage(): StartPagePath {
	if (!browser) return DEFAULT_START_PAGE;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw && isStartPagePath(raw)) return raw;
	} catch {
		// Private browsing fallback
	}
	return DEFAULT_START_PAGE;
}

export const startPageStore = writable<StartPagePath>(getStartPage());

export function setStartPage(path: StartPagePath): void {
	startPageStore.set(path);
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, path);
	} catch {
		// Ignore quota/private mode errors
	}
}
```

### Wiring Details
1. **`web/src/routes/+page.svelte`:** Replace `goto('/dashboard')` with `goto(getStartPage())`.
2. **`web/src/routes/+layout.svelte`:**
   - Brand link: `<a href={$authStore.isAuthenticated ? $startPageStore : '/'} class="flex items-center gap-2">`.
   - Nav items: Use `isNavItemActive(item, currentPath)` for `aria-current="page"` and active classes. Render a `w-1.5 h-1.5 rounded-full bg-accent` indicator dot inside the nav link when `item.href === $startPageStore`.
   - Account dropdown (`showAccountMenu`): If `isStartPagePath(currentPath)`, show a button to pin `currentPath` as the start page (or a muted `Pinned as start page` indicator if `currentPath === $startPageStore`).
3. **`web/src/lib/components/settings/AccountPanel.svelte`:**
   - Add a **Start page** section with a native `<select class="w-full max-w-sm px-3 py-2 border border-line rounded-md">` bound to `$startPageStore` calling `setStartPage(...)` and `notify('Start page updated.')`.

---

## 5. Top-to-Bottom Page Layout Specifications

### Global Page Container Standards
- Standardize the main page container width across all primary pillars to `max-w-4xl mx-auto` (currently `/inventory`, `/assets`, and `/notifications` use `max-w-3xl` while `/home` and `/dashboard` use `max-w-4xl`, causing horizontal layout shifts when navigating).
- Remove `<button type="button" on:click={() => history.back()}>&larr; Back</button>` from top-level pillar pages (`inventory/+page.svelte` line 63, `notifications/+page.svelte` line 113, `assets/+page.svelte` line 160).

---

### 5.1 Pillar 1: Household (`web/src/routes/home/+page.svelte` & `web/src/routes/assets/+page.svelte`)

Create `web/src/lib/components/HouseholdNav.svelte` to unify `/home` and `/assets` on both desktop and mobile:

```svelte
<script lang="ts">
	import { Home } from 'lucide-svelte';
	export let current: 'home' | 'assets' = 'home';
</script>

<div class="flex flex-wrap items-center justify-between gap-3 mb-6">
	<div class="flex items-center gap-3">
		<span class="w-11 h-11 rounded-full border-2 border-accent text-accent flex items-center justify-center shrink-0" aria-hidden="true">
			<Home class="w-5 h-5" />
		</span>
		<div>
			<h1 class="text-2xl font-display font-semibold text-ink">Household</h1>
			<p class="text-ink-soft text-sm">Residences, property assets, and upkeep schedules.</p>
		</div>
	</div>

	<div class="inline-flex rounded-lg border border-line-soft bg-surface2 p-1" role="group" aria-label="Household view">
		<a
			href="/home"
			aria-current={current === 'home' ? 'page' : undefined}
			class="h-9 px-3 rounded-md text-sm font-semibold inline-flex items-center transition-colors {current === 'home' ? 'bg-primary text-on-primary shadow-sm' : 'text-ink-soft hover:text-ink'}"
		>Residences &amp; Upkeep</a>
		<a
			href="/assets"
			aria-current={current === 'assets' ? 'page' : undefined}
			class="h-9 px-3 rounded-md text-sm font-semibold inline-flex items-center transition-colors {current === 'assets' ? 'bg-primary text-on-primary shadow-sm' : 'text-ink-soft hover:text-ink'}"
		>Property Assets</a>
	</div>
</div>
```

#### Top → Bottom Stack on `/home`:
1. **`<HouseholdNav current="home" />`**
2. **Urgent Upkeep First:** When `dueItems.length > 0`, render the **`What's due` card (`data-testid="due-card"`) above the `Homes` card (`data-testid="homes-card"`)** so overdue maintenance is visible above the fold. When `dueItems.length === 0`, render `homes-card` first and `due-card` second.
3. **Residences Card (`data-testid="homes-card"`):** Homes list, `+ Add home`, per-residence asset count links (`/assets?homeId={home.id}`), and `Family-wide` assets.
4. **Dead Code Removal in `home/+page.svelte`:**
   - Remove the bottom static placeholder grid (`Property Assets` + unclickable `Manuals & Routines` `<div>`, lines 397–406).
   - Remove unused baby-tracking API imports and state (`feedingAPI`, `diaperAPI`, `sleepAPI`, `growthAPI`, `milestoneAPI`, `vaccinationAPI`, `moodAPI`, `journalAPI`, `computeFeedReports`, `refreshLists()`, and unused timer variables).

#### Top → Bottom Stack on `/assets`:
1. **`<HouseholdNav current="assets" />`** (replaces the old `← Back` button + `Home assets` header; container widened from `max-w-3xl` to `max-w-4xl`).
2. **Scoped Home Filter Banner** (`#if filterHomeId !== null`: `Showing assets at {homeName(filterHomeId)} · Show all`).
3. **Action Bar:** `+ Add asset` primary button + `Show archived` checkbox.
4. **Asset Form** (when `showForm` is open) + **Asset Cards List** (`data-testid="asset-{asset.id}"`).

---

### 5.2 Pillar 2: Family (`web/src/routes/family/+page.svelte`) — Redesigned Clean 2-Mode Architecture

#### Why the Previous Implementation Was Rejected (Anti-Pattern Warning)
Do **not** stuff `Family Overview` (member directory cards, family-wide `Upcoming` card, `Quick reports`) inside `<MemberActivity>`'s `<slot />` between `TodaySummary` and `Activities`, and do **not** keep the old horizontal member pill row + bolted-on "Favorite" button. That created a cluttered Franken-page where `Today for {name}` was separated from `Activities` by 1,200px of family-wide overview cards.

#### Core Design Principle
`/dashboard` was fast because it used `<MemberSwitcher>` (a single compact pill with inline + dropdown `★` favoriting) followed immediately by `<MemberActivity>` (`QuickActions` → `RunningTimers` → `TodaySummary` → `Activities`).
`/family` must **be** that exact clean, 2-click recording experience by default (`familyView === 'care'`), with a compact 2-option segmented switcher in the top bar to switch to **`Family Overview`** (`familyView === 'overview'`) when the user wants to manage members, resend invites, or view family-wide cards.

#### Required Top Bar on `/family` (When Family & Members Exist):
Render a single `flex flex-wrap items-center justify-between gap-3 mb-6` top bar:
1. **Left — `<MemberSwitcher>` (imported from `$lib/components/logging/MemberSwitcher.svelte`):**
   - Pass `members={profiles.map((b) => ({ id: Number(b.id), name: b.name, avatar: b.avatar, stage: b.stage }))}`, `selectedId={selectedMemberId}`, `starredId={starredMemberId}`, `familyId={activeFamilyId}`.
   - Wire `on:select={(e) => selectMember(e.detail.memberId)}` and `on:star={(e) => { setStarred(e.detail.memberId); selectMember(e.detail.memberId); }}`.
   - `MemberSwitcher` already provides:
     - Inline avatar, name, stage badge, and `★` Star button (`Make {name} the default`) on the main pill.
     - Dropdown listbox (`aria-label="Switch person"`) where **every** member has their own `★` Star button + name/stage option + `"Opens on {starred.name}"` footer.
   - If `families.length > 1`, render a compact family selector beside it.
2. **Right — 2-Option Segmented View Toggle (`role="group" aria-label="Family view"`):**
   - `Care & Log` (`familyView = 'care'`, **default on load**)
   - `Family Overview` (`familyView = 'overview'`)

#### Mode A: `familyView === 'care'` (Default — Clean 2-Click Recording)
Nothing sits between the top bar and `<QuickActions>` except the conditional overdue-reminders banner (`#if $overdueReminders.length > 0`).
The vertical stack in `Care & Log` mode is:
1. **Conditional Overdue Reminders Banner** (`data-testid="reminders-banner"`).
2. **`<MemberActivity>`** (which renders `<QuickActions>` → `<RunningTimers>` → `<TodaySummary>` → `<MedicationsPanel>` → `<slot />` → `<ActivityHistory>`):
   - Keep `<MemberActivity>`'s `<slot />` **empty** (or only `<Trends>`), and place `<Trends>` and `<GrowthChart>` in a clean section **below** `<MemberActivity>` (or inside the slot *without* any Family Overview cards) so `QuickActions` → `Today for {name}` → `Activities` flows uninterrupted!
   - Add a `Full reports →` link (`href={selectedMemberId ? `/reports?memberId=${selectedMemberId}` : '/reports'}`) in the header above `<Trends>` / `<GrowthChart>`.

#### Mode B: `familyView === 'overview'` (Secondary — Family Roster & Household Overview)
When the user clicks **`Family Overview`** in the top segmented bar, render the family-level overview cards cleanly without `<MemberActivity>` duplicated underneath:
1. **Family Roster (`grid-cols-1 md:grid-cols-2 gap-4 mb-6`):**
   - Each member card (`data-testid="member-card"`) shows:
     - `<Avatar>`, Name (with a filled `<Star />` badge if `starredMemberId === Number(baby.id)`), and `Born YYYY-MM-DD` / stage.
     - Actions: `★` Star toggle button (`on:click={() => setStarred(Number(baby.id))}`), `Invite` (if `baby.email`), `Edit` (`openEditMember(baby)`), and `Log Activity` (`on:click={() => { selectMember(Number(baby.id)); familyView = 'care'; }}`).
2. **Upcoming Appointments Card (`data-testid="upcoming-appointments-card"`):**
   - Next 30 days of family-wide booked plans + `See all →` (`href="/appointments"`).
3. **Quick Reports Card (`feeds`):**
   - 24h and 30d feed counts/averages + `Full reports →` (`href={selectedMemberId ? `/reports?memberId=${selectedMemberId}` : '/reports'}`).
4. **Household Stock Glance (`<StockGlance />`):**
   - At-risk stock items + links to `/inventory` and `/notifications`.

---

### 5.3 Pillar 3: Inventory (`web/src/routes/inventory/+page.svelte`)

#### Top → Bottom Stack on `/inventory`:
1. **Row 1 — Header (`max-w-4xl mx-auto`):**
   - Remove the `← Back` button.
   - Title `h1` **Inventory** + subtitle on the left; cross-links on the right:
     - `<a href="/reports" class="text-sm font-semibold text-accent hover:underline">Usage reports &rarr;</a>`
     - `<a href="/notifications" class="text-sm font-semibold text-accent hover:underline">Notification rules &rarr;</a>`
2. **Row 2 — Firing Alerts First (`#if alerts.length > 0`, `data-testid="page-alerts"`):**
   - Placed **above** `<InventoryStats {items} {alerts} />` so low-stock warnings appear immediately at the top.
3. **Row 3 — `<InventoryStats {items} {alerts} />`**
4. **Row 4 — `<InventoryPanel {members} />`**

---

### 5.4 Pillar 4: Reports (`web/src/routes/reports/+page.svelte`)

#### Top → Bottom Stack on `/reports`:
1. **Row 1 — Header & Filter Bar (`max-w-4xl mx-auto`):**
   - Title `h1` **Reports** + subtitle.
   - Range segmented control (`[ 7d | 30d | 90d | Custom ]`, `h-9`) + `For` member `<select>`.
   - **Deep-link support:** In `onMount`, read `new URLSearchParams(window.location.search).get('memberId')`; if present and matching a trackable member, set `memberId = Number(param)` before calling `loadReport()`.
2. **Row 2 — 4 Summary KPI Cards (`grid-cols-2 sm:grid-cols-4 gap-2 mb-4`):**
   - `Pumped`, `Formula`, `Bottled milk`, `Inventory used`.
3. **Row 3 — Daily Series Chart Card:**
   - Top of card: Primary 4 series toggle pills (`Pumped`, `Formula`, `Bottled milk`, `Inventory used`).
   - Middle: `<DailySeriesChart />` + axis note.
   - Bottom of card (below chart): `By category` inventory line toggles (`report.categories`), acting as an interactive legend so two wrapped rows of chips don't push the chart down on mobile screens.
4. **Row 4 — Selected Day Detail Card (`#if selected`, `data-testid="day-detail"`)**
5. **Row 5 — "What got used" Table** (with header link `<a href="/inventory">Manage inventory &rarr;</a>`).

---

### 5.5 Pillar 5: Notifications (`web/src/routes/notifications/+page.svelte`)

#### Top → Bottom Stack on `/notifications`:
1. **Row 1 — Header (`max-w-4xl mx-auto`):**
   - Remove the `← Back` button.
   - Title `h1` **Notifications** + concise subtitle.
2. **Row 2 — "Needs attention now" Card (`data-testid="firing-list"` / `data-testid="all-quiet"`):**
   - Immediately shows firing activity reminders, inventory alerts, and due medications (with inline `Mark taken` action).
3. **Row 3 — "Tracking rules" Card (`<ActivityRules on:changed={refresh} />`):**
   - Elevated above the Email explanation card so rule management is near the top of the page.
4. **Row 4 — "Inventory rules" Card (`<InventoryRules on:changed={refresh} />`):**
   - Directly below Tracking rules.
5. **Row 5 — "Email" Digest & Schedule Card (`data-testid="send-digest"`, `data-testid="schedule-note"`):**
   - Moved to the bottom of the page so its 8-line explanatory paragraph and server schedule status don't push rule editors below the fold.
