---
name: feature-update
description: Add or remove the "New in <release>" highlight at the top of the Nido docs page a release changes. Use when a release ships a user-visible feature, when asked to announce a new feature in the docs, or when an old highlight is stale.
---

# Feature updates

A feature update is a short callout at the top of the page a release changes.
It is not a changelog and not an announcement. It exists so a reader who
already knows Nido sees three things:

1. What changed.
2. Why it can exist now.
3. One simple thing to try.

One feature, one page, three sentences. If the block needs more than that, the
detail belongs in the page body.

Read `docs-authoring` first. This skill adds the highlight; that skill decides
how the page is written.

## Where it goes

Put the callout first on the page, under the title and before the page's own
intro. A returning reader should meet it before they re-read what the page is
for.

Wrap it in comment markers so the next release can find it:

```md
<!-- feature-update: v2026.11.06 -->
:::note[New in v2026.11.06: <plain feature name>]
<What changed.> <Why it can exist.> <One example.>

[Where to go next →](../path/to/page/)
:::
<!-- /feature-update -->
```

Use `note`, not `caution`, `danger`, or `tip`. A new feature is not a warning,
and `tip` is for advice. The marker's version is the clock for removing it
later, so it must be the release tag that actually contains the feature.

The link is optional. Use it when the detail lives on another page. Do not link
to the same page the reader is already on.

If a release changes several pages, put the full block on the page where the
reader lands first. Link to it from the other pages instead of repeating it.

## What changed

One sentence, in the reader's terms. Name the action or the screen, not the
subsystem.

- Good: "A formula bottle now subtracts the ounces it used from the can you
  picked."
- Bad: "Inventory consumption rules now support feed-sourced amount
  attributes."
- Bad: "We've made inventory better."

## Why it can exist

This is the sentence that makes the update worth reading. Name the existing
decision or mechanism the feature builds on. It answers "why is this possible
now?" without talking about effort, and it shows the reader that the product
has a shape rather than a pile of features.

- Good: "A bottle feed already records an amount, so the can it came from can
  lose those ounces without a second step."
- Good: "Agent tools call the same validated routes as the web app, so a token
  grants exactly the access a signed-in member has."
- Bad: "This was made possible by months of work."
- Bad: "We're excited to finally ship this."
- Bad: "Nido is now more powerful than ever."

The good versions name a real mechanism. Check it in the code or the docs
before you write it. If the feature is genuinely new from nothing, say what it
reuses: the member model, the record table, the notification sweep, the
per-family database. Most features in Nido exist because something already did.

If the why needs more than two sentences, put it in the page body under a short
heading and keep the highlight to what changed, one example, and a link.

## The simple example

One action the reader can take today. Use exact UI labels or a copy-paste
command. Do not tour every option.

- Good: "Set **Bottle contents** to **Formula**, pick the can, then save the
  feed and watch the can drop."
- Good: "Run `docker compose pull && docker compose up -d`, then check the
  image tag in `docker compose ps`."
- Bad: "Explore the new inventory capabilities."
- Bad: "There are many ways to use this."

If the example needs a placeholder, mark it clearly: `<your-family-id>`, not
`abc123`.

## What to highlight

Highlight a release when a reader can do one of these:

- Do something they could not do before.
- Do something with fewer steps.
- See different information on an existing screen.
- Recover from a failure they used to be stuck with.

Do not highlight:

- Refactors, tests, dependency bumps, or internal renames.
- Bug fixes that restore documented behavior. Fix the page instead.
- A feature behind a flag that is off by default, unless the highlight tells
  the reader how to turn it on.
- A feature that is not in a tagged release.
- Five unrelated changes in one block. Five changes get five pages, or no
  highlight.

When in doubt, ask: would a reader change what they do after reading this? If
not, leave it out.

## Find the material

Start from the release, not from the pull-request title. PR titles are written
for reviewers and are full of scope labels.

1. Find the tag: `git tag --sort=-creatordate | head -5`.
2. Check the feature is in it:
   `git merge-base --is-ancestor <sha> v2026.11.06 && echo "in the release"`.
3. Read the merged PR and the code path it touched.
4. Confirm the labels, defaults, required config, and whether a flag gates it.
5. Run the example, or trace it through the component that implements it.

If the feature did not ship in the tag, stop. Do not write around it.

## Release hook

The release workflow runs `node scripts/docs-release.mjs --release <tag>` and
puts the merged pull requests, the live highlights, and the checklist in the
run summary. Start there after a release; the writing is still manual.

- `npm run docs:check` validates every block and warns after 60 days.
- `npm run docs:release` prints the same checklist locally.

The docs home (`site/src/content/docs/index.mdx`) also carries one `.nido-new`
card for the latest release. Update it in the same pass. It is the front door;
the page-level block is for someone who lands on the detail page.

## Lifecycle

A highlight is a pointer, not the documentation.

- **Add it after the tag exists.** One block per page.
- **Keep it until the page changes again, or 60 days, whichever comes first.**
  The version inside the marker starts the clock. A release that does not
  change the page does not expire its highlight.
- **Before removing it, fold anything durable into the page body.** The feature
  should already be described where it belongs. If it is not, the page is
  incomplete without the callout.
- **Do not stack highlights.** A new release that changes the same page
  replaces the old block.
- **Find stale blocks** with `npm run docs:check`. It prints every block with
  its version and age, and warns past 60 days.

## Worked example

This is the shape, using the MCP release:

```md
<!-- feature-update: v2026.11.06 -->
:::note[New in v2026.11.06: an agent can read and log for your family]
Nido now exposes its operations over MCP. It can do that because an agent
calls the same validated routes as the web app and opens only the family
database named in its token. Generate a token under **Settings → Agents →
Agent access**, paste the config into your client, then ask it to list today's
feeds.
:::
<!-- /feature-update -->
```

The first sentence is the change. The second is why it can exist. The third is
one example. There is no link: the detail is already on this page. If the
feature is documented elsewhere, link there instead.

## Self-check

- Is the feature in the tagged release?
- Is the version in the title the same as the marker?
- Does the why name a real existing mechanism, not effort?
- Is the example one action, with exact labels?
- Would a reader change what they do after reading it?
- Is it under the title and above the page intro?
- Could it be shorter without losing the why?
- Does it avoid "excited", "proud", "powerful", "seamless", and "and more"?
