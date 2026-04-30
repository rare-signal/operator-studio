# AGENTS.md

Guidance for any agent (human or LLM) writing code in this repo. Short list, enforced in review.

## UI rules

### 1. Empty states are part of the feature

Every container that renders dynamic data has at least three states: **loading**, **populated**, and **empty**. Skipping the third is the most common shirt-booger in this codebase.

- If a list, card, metrics row, counter, or section can be reached with zero matching rows, it must show a deliberate empty state — not a blank box, not "0 of 0", not a header followed by void.
- The empty state should tell the user *why* it's empty and, where possible, *what to do next* (e.g., "No active plan yet — sketch one in Today's Compass" with a link).
- Counters of the form "X of Y" must hide or rewrite themselves when `Y === 0`. "0 of 0 steps in motion" reads as broken; "No steps yet" reads as empty.
- "Empty" is not the same as "loading". A skeleton during fetch and a message when the fetch returns `[]` are different artifacts.

When you add a component, ask: *what does this look like for a brand-new user with no data?* If the answer is "weird," go fix it before you ship.

### 2. Cryptic labels need explanations

Single-word callouts like **keepers**, **loose ends**, **decisions**, **candidates**, **promotions**, **fulfillments** are jargon to a new user. They are fine as labels — but they require an inline affordance so a curious user can find out what they mean.

- Wrap any one-word metric or status pill that isn't standard English in a `Tooltip` from [`registry/new-york-v4/ui/tooltip.tsx`](registry/new-york-v4/ui/tooltip.tsx).
- The tooltip body should be one short sentence: a definition, not a tutorial.
- This applies to *labels visible to users*, not internal variable names.
- If the same metric is shown in three places, define the tooltip text once (a constants module) and reuse it. Do not let three places drift into three different definitions.

If a label needs more than one sentence to explain, the label is wrong — rename it.

### 3. Don't leak internal labels into user-facing text

Field names, system reasons, and signal labels are debugging artifacts. They should never reach a rendered card unless deliberately formatted for end users.

A real example: the brief preview's one-liner once read literally `Has TLDR / summary` because the gold-extractor's internal signal *label* was being piped into a user-visible position. The label was correct for the system; the placement was wrong for the user.

When a placeholder is unavoidable (e.g., an LLM pipeline isn't wired yet), make it look like a placeholder, not like real content. Italics, "—", a skeleton — anything that signals "this slot is intentionally empty right now."

## Process rules

### 4. When in doubt, scope it down

Operator Studio is in active feedback-and-fix mode, not greenfield. A bug fix doesn't need a refactor. A new feature doesn't need a new abstraction. Ship the smallest change that resolves the report, then reassess.

### 5. Run it before claiming it's done

UI work isn't done when the types compile. If a change is observable in the browser, exercise it in the browser (use the preview tools). State explicitly when verification was skipped and why.

### 6. Studio decks: one visual concern per scene

If you're writing or editing a deck under [`app/(studio)/studio/`](app/(studio)/studio/), read [`app/(studio)/studio/DECK_PRINCIPLES.md`](app/(studio)/studio/DECK_PRINCIPLES.md) before you start. The short version: each scene must hold exactly one visual concern — not two, not "one plus chrome in the corners." Most existing decks violate this. Don't add more violators; fix when you touch.
