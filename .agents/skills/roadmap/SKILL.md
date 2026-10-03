---
name: roadmap
description: Keep ROADMAP.md in sync with the Nido GitHub Projects board and the feature-request issues. Use when adding, triaging, labelling, shipping or closing a roadmap item, when asked what is planned or what is next, or when the roadmap table has drifted from the board or the issues.
---

# Nido Roadmap

Three things, one source of truth each. This skill is what stops them disagreeing.

| Thing | Source of truth |
| --- | --- |
| The design conversation | One issue per capability |
| The schedule | GitHub Projects board ("Nido Roadmap", project 2) |
| The published table in `ROADMAP.md` | **Generated** — never hand-edited |

`ROADMAP.md` only has one generated block, between the `roadmap:start` and
`roadmap:end` markers. Everything else in that file is hand-written and is for
the *shape* of the roadmap, not for per-item status.

## Setup

- Repo: `stewartshea/nido`
- Board: project **2** (`PVT_kwHOARdzuM4Blknm`), "Nido Roadmap"
- `gh` authenticated with the `project` scope

The script resolves the owner from the git remote, so it is not hardcoded.

**`gh project field-list` takes the project number, not the node id.** Passing
the id fails with `invalid number`. And `field-create` needs
`--data-type SINGLE_SELECT` with `--single-select-options`; it fails silently
otherwise. Both cost time to rediscover.

## Labels

| Label | Meaning |
| --- | --- |
| `feature request` | A request for a new capability. Triaged onto the board. |
| `roadmap: candidate` | Proposed. Not committed to a release. |
| `roadmap: planned` | Committed, not yet started. |
| `roadmap: shipped` | Delivered in a release. |
| `needs design` | Needs a spec/design pass before implementation. |

The `roadmap: *` labels mirror the board's Status field. The label is what makes
state visible from inside the issue, which is where people actually work; the
field is what makes it sortable.

## Board fields

- **Status** — `Todo` / `In Progress` / `Done`
- **Priority** — `P0-Urgent` / `P1-High` / `P2-Medium` / `P3-Low`
- **Area** — `Family tracking` / `Home and inventory` / `Platform`

`Area` exists because the roadmap spans two horizons, the family tracking loop
and the widening into the home. An item with no area is missing a decision.

## The sync script

`scripts/roadmap-sync.mjs` rewrites the generated block from the board and
reports drift between the board and the issues.

```bash
node scripts/roadmap-sync.mjs           # rewrite the table
node scripts/roadmap-sync.mjs --check   # non-zero exit if ROADMAP.md is stale (CI)
node scripts/roadmap-sync.mjs --add 12  # put issue 12 on the board, then add it to the table
```

It is idempotent, and it preserves everything outside the markers, so
hand-written prose survives a regeneration.

**Run it after any board or issue change.** The table in the README is not
updated by hand and is not per-item, so nothing else needs touching.

### Drift it reports

- An issue labelled `feature request` that is not on the board
- A board item with no `feature request` issue behind it
- An issue closed while the board still says `In Progress` / `Todo`
- A board item marked `Done` while the issue is still open
- An item in progress or done but missing the `roadmap: planned` label

When it reports drift, the board is the authority on **status** and the issues
are the authority on **detail**. Fix whichever side is actually wrong — the
report is a symptom, not an instruction to edit the generated block.

### Known wart

GitHub is eventually consistent. Running the script immediately after creating an
issue or adding a board item can report drift that has already resolved. Re-run
before acting on it.

## Workflow

### Taking a feature request

1. Check the open issues and the board first — it may already exist under a
   different title.
2. Write the issue around the **user journey**, not the schema. "Add a pack of
   diapers and it goes down every time you log a change" tells a reader more than
   a table definition.
3. Name the subsystem it leans on. Most roadmap items are cheaper because
   something already exists.
4. Put unresolved questions in the issue. An open question is a reason to stay at
   `roadmap: candidate`, not a reason to guess quietly.
5. Create it, label it, put it on the board, set Priority and Area, then sync.

```bash
gh issue create --title "Feature: <capability>" --body-file /tmp/req.md \
  --label "feature request" --label "roadmap: candidate"

node scripts/roadmap-sync.mjs --add <N>

ITEM=$(gh project item-list 2 --owner "$(gh repo view --json owner --jq .owner.login)" \
  --format json | jq -r ".items[] | select(.content.number==<N>) | .id")
gh project field-list 2 --owner <owner> --format json   # look up field/option ids
gh project item-edit --id "$ITEM" --project-id PVT_kwHOARdzuM4Blknm \
  --field-id <FIELD_ID> --single-select-option-id <OPTION_ID>

node scripts/roadmap-sync.mjs
```

### Promoting a candidate

An item moves to `planned` when there is enough decided to build: journey agreed,
open questions resolved, and an `Area` set. Write the decisions into the issue
before promoting it — a planned item with unresolved questions is a broken
promise.

### Shipping

On merge: set the board item to `Done`, add `roadmap: shipped`, close the issue,
then sync. If what shipped diverged from the issue, update the issue first so the
history reflects reality.

## Answering "what's next?"

Read the board, sorted by Priority then Status. Do not answer from memory or from
the prose in `ROADMAP.md` — if the board and the prose disagree, the board wins
and the prose is stale.

## Future: a roadmap page on the site

`site/` is deployed to GitHub Pages by `.github/workflows/deploy-site.yml` on
every push to `main`. A public roadmap page is a natural extension of this: render
the same data the sync script already produces, as a static page.

When that happens, keep one generator. The page should read the board too, rather
than scraping `ROADMAP.md`, so the page and the repo cannot drift apart.