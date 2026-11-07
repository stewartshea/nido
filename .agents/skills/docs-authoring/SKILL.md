---
name: docs-authoring
description: Write and edit Nido's published documentation in site/src/content/docs. Use when adding or changing a docs page, writing a guide or reference section, fixing prose that reads vague or machine-written, or reviewing docs for tone, structure, and accuracy.
---

# Writing Nido docs

Docs are read once, by someone who is already stuck. They are not read for
pleasure, and nobody reads them top to bottom. Write for the person who
searches, lands halfway down the page, and needs the next command.

## Two jobs

**Write or edit (default).** The user has a page to add or a draft to fix. Make
the smallest change that makes the page useful, then return the full page and a
short **What changed** section. Keep the writer's meaning and the page's voice.
Leave strong sentences alone. Do not invent a claim, an example, a command, or
a number to make a sentence sound more specific.

**Review.** The user asks whether a page reads well, or asks for a docs review
without a rewrite. Name the problem, quote the line, and give the fix in a few
words. Do not rewrite the page unless asked. Do not guess whether AI wrote it;
named patterns are evidence the user can check.

If the reader or the task is unclear, ask one question: who is this for, and
what should they be able to do after reading it?

## Find the reader

Most Nido readers are one of these:

- A parent or caregiver at 3am, on a phone, mid-task.
- Someone installing Nido for the first time, possibly new to Docker.
- A self-hoster responsible for backups, upgrades, and a master key they cannot
  recover.
- A contributor who needs the rule the code depends on.

Write for the reader who is tired, interrupted, and looking for one answer. If
a sentence only makes sense to someone who already read the page above it, move
it or cut it.

## Where docs live

| Path | What it is |
| --- | --- |
| `site/src/content/docs/` | The published docs site (Astro Starlight). This is what readers see. |
| `site/astro.config.mjs` | The sidebar. A new page is not in navigation until it is listed here. |
| `docs/` | Internal design notes and specs. Not published, and not in the sidebar. |
| `README.md` | The front door on GitHub. Short; link out for detail. |

Published pages are the main job of this skill. Internal specs follow the same
plain-language rules, but write them for an implementer deciding what to build,
not for someone using the app.

## Page shape

Every page has one job. Say what it is in the description and the first
paragraph, then do it.

- **Title**: sentence case, names the thing or the task. "Backup & restore", not
  "Backup And Restore".
- **Description**: one sentence for search results and link previews. State the
  outcome, not the category.
- **Opening paragraph**: where the reader is, what this page does, and what to
  read first if they are in the wrong place.
- **Sections**: in the order the reader meets them, not in the order the code is
  organized.
- **Ending**: how to check it worked, what to do next, or the limit they need to
  know. Not a summary of what they just read.

Match the page type:

| Type | Reader's job | Shape |
| --- | --- | --- |
| Getting started | Get to a working instance | Shortest correct path, then a checkpoint |
| Guide | Finish one task | Prerequisites, steps, verification, recovery |
| Reference | Look up one fact | Exhaustive and scannable; exact values, defaults, and what breaks |
| Feature page | Understand what exists | Capability first, then how it behaves and what it costs |
| Project page | Understand a decision | What is true now, why, and what it means for the reader |

Do not document a planned feature as if it exists. If it is not in a tagged
release, say so or leave it out.

## Tone

Write like a competent friend who has done this before. Calm, specific, and
willing to say when something is a bad idea.

- **Use "you" for the reader.** Use "we" only for a decision the project made.
- **Prefer the short word.** "Use", not "utilize". "Help", not "facilitate".
  "Build", not "leverage".
- **One idea per sentence.** If a sentence has two "and"s or a semicolon doing
  structural work, split it.
- **Name the thing.** "The master key", not "the credential". "The diaper log",
  not "the data".
- **Give the number or the label.** "Port 3001", "`NIDO_MASTER_KEY`", "Settings
  → Admin". A reader can act on a name; they cannot act on a category.
- **Show the consequence.** "The family databases become unreadable" beats "this
  is important". Let the fact carry the weight.
- **Say what is hard.** If a step fails silently, needs a backup first, or has
  no recovery path, write that next to the step.
- **Use commands for steps.** "Run `docker compose up -d`", not "you will want
  to start the containers".
- **Do not anthropomorphize the software.** Nido reads, stores, and subtracts.
  It does not want, think, or care.
- **Match the spelling already in use.** Prose uses Canadian spellings such as
  `colour` and `behaviour`. UI labels, code, and product names stay exactly as
  the app writes them.

### Bad and good

| Bad | Good |
| --- | --- |
| Nido seamlessly leverages your existing family data to deliver a robust inventory experience. | A logged diaper change subtracts one from your diaper stock, so the count stays right without a second step. |
| It is important to note that the master key cannot be rotated. | You cannot rotate the master key. If you lose it, the family databases are unreadable. |
| Getting started is easy and straightforward. | Run `./scripts/init-env.sh`, then `docker compose up -d`. |
| This powerful feature streamlines your workflow. | Logging a feed takes two taps. |
| The system may experience issues if misconfigured. | If `PUBLIC_URL` is wrong, password reset links point at the wrong host. |

## Words to cut

Banned outright: seamless, robust, powerful, comprehensive, cutting-edge,
state-of-the-art, best-in-class, revolutionary, game changer, effortless,
supercharge, unlock, elevate, empower, streamline, leverage, utilize, facilitate,
harness, foster, delve, tapestry, realm, beacon, multifaceted, meticulous,
intricate, paramount, transformative, delight, excite.

Cut these when they add nothing: just, simply, easily, actually, truly,
basically, obviously, importantly, crucially, fundamentally. Keep one when it
carries real contrast or uncertainty: "Just back up first" is a warning.
"Simply run the command" assumes the reader finds it simple.

Cut these phrases: it's worth noting, it's important to note, at the end of the
day, when it comes to, at its core, in today's world, the reality is, in terms
of, with regard to, in order to, going forward, let's dive in.

Also cut: "excited to announce", "we're thrilled", "we've been hard at work",
"this changes everything", "and more". If the list has an end, write the end.

## Patterns to cut

**Binary contrasts.** "This isn't just a log. It's a household record." State
the second half: "The log also tracks household stock."

**Throat-clearing openers.** "Here's the thing", "Let me be clear", "The
uncomfortable truth is". Delete the opener and start with the point.

**Faux insight.** "What most people miss is...", "The part everyone skips..."
These flatter the writer. Make the claim stand alone.

**Colon reveals.** "One decision makes this work: the family database." Write a
plain sentence: "The family database is what makes this work." Use colons for
lists, labels, and quotes.

**Trailing `-ing` clauses that pretend to explain.** "Nido stores the key on a
volume, keeping it safe." Say what happens: "Nido stores the key on a volume so
it survives a container restart."

**Importance puffery.** "This marks a big step forward", "plays a vital role",
"stands as a testament". State the fact and let the reader judge.

**Metadiscourse.** "This distinction matters", "That last part is key", "As you
can see". If the point is clear, delete the aside. If it is not, add the fact
that makes it clear.

**Weasel attribution.** "Many users find", "experts recommend", "it is widely
considered". Name the case or the source, or cut the claim. Do not invent one.

**Synonym cycling.** If "family database" is the right term, repeat it. Do not
rotate in "tenant store", "data silo", and "encrypted file" for variety.

**Rhetorical setups.** "Wondering how this works?", "What if you need to...?",
"Plot twist:". Ask the real question or state the answer.

**Fake-profound kickers.** Cut the final line that turns the point into a cute
metaphor or mic drop. End on the clearest concrete sentence already there.

**Summary recaps.** "In conclusion", "Overall", a final paragraph that repeats
the page. The reader was just there. End on the next action or the limit.

**Formatting slop.** Emoji headings, bold sprinkled mid-sentence for emphasis,
a bullet list where two sentences of prose read better, and a heading over a
two-sentence section. Format follows the content.

**Em dashes as a rhythm tic.** Nido's docs use them, and an occasional one is
fine where a comma or period would be clumsier. Clusters and decorative dashes
are not.

## Formatting

The site is Astro Starlight, not a generic Markdown renderer.

- **Frontmatter is required.** Every page starts with `title` and
  `description`. Add `head` only for structured data, as
  `reference/agent-access.md` does.
- **Use `.md` by default.** Use `.mdx` only when the page needs an Astro
  component. Starlight asides work in both.
- **Start headings at `##`.** The title is the only `#`. Do not skip levels.
- **Sentence case for headings.** "What a release is", not "What A Release Is".
  Keep product names and code as they are.
- **Asides are for consequences, not decoration.** Use `:::caution` for
  something that can break, `:::danger` for irreversible data loss,
  `:::note` for context that changes how the reader reads the page (including
  a release highlight), and `:::tip` for advice that saves a step. Give each
  one a short title: `:::caution[Back up first]`.
- **Links are relative and end with a slash.** `[Upgrading](../guides/upgrading/)`
  from a page under `reference/`. Same-page anchors are `#notifications`.
  External links are full URLs.
- **Code fences get a language.** `bash`, `json`, `yaml`, `sql`, `text`. Do not
  use a fence for a single inline value; use backticks.
- **Bold is for UI labels and first use of a term.** `**Settings → Admin**`,
  `**NIDO_MASTER_KEY**`. Not for emphasis in the middle of a sentence.
- **Tables are for comparisons and lookups.** If the content is a procedure,
  use steps.
- **No screenshots unless they add something the text cannot.** Screenshots go
  stale; exact labels do not.
- **Keep prose in the page, not in a component.** A reusable component is worth
  it only when the same interaction repeats across pages.

## Accuracy before style

A clear sentence that is wrong is worse than a clumsy sentence that is right.

- **Run every command you write.** If you cannot run it here, trace it through
  the script or config that implements it.
- **Match labels to the app.** Check the Svelte component or route before
  writing `**Settings → Family & tracking**`. A plausible label is still a
  wrong label.
- **Match defaults and requirements to the code.** Check `api/src`,
  `docker-compose.yml`, `.env.example`, and `reference/configuration.md`.
- **Check the release.** A feature is documented when it is in a tagged release,
  not when its PR merged.
- **If you cannot verify a claim, say so.** Ask, or mark it as unconfirmed in
  your reply. Do not smooth it into a confident sentence.

## Workflow

1. Read the whole page, plus the pages it links to. You cannot fix flow you have
   not seen.
2. Write down the reader, the task, and the one thing they must leave with. If
   you cannot, ask.
3. Find the shortest correct path. Cut steps that exist only because the code is
   organized that way.
4. Draft in the order the reader acts.
5. Cut the words and patterns above.
6. Check every command, label, default, and link against the code.
7. Build the site when you can: `npm --prefix site run build`. It catches a
   broken MDX page or a link that does not resolve.
8. Re-read the opening and the ending. They are the only parts most readers
   will see.
9. Return the full page and a short **What changed** section. For a review, name
   the patterns and quote the lines instead.

## Self-check

- Can a reader find the next action within five seconds?
- Is every command copy-pasteable, and does it run?
- Does every paragraph contain a fact, a step, or a consequence?
- Could a sentence move unchanged to another product? Cut it or make it
  specific to Nido.
- Did you explain why, or only that?
- Are the limits and failure modes stated where the reader hits them?
- Is any banned word or pattern still in the page?
- Does the page end on an action or a limit, not a recap?

For the short release highlight that sits above a page's intro, use
`feature-update`.
