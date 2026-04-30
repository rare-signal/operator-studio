# Plan page — UX v2 ideation

Status: **brainstorm**, not a spec.
Last updated: 2026-04-24

The user reported the current plan page reads as a list of fields you fill in — competent layout, fine side panel, but eyes glaze. Plans are too important to feel like a form. This doc explores what a v2 could look like, and proposes a **visual language** so plan elements stay recognizable when they show up elsewhere in the app.

## Current state

The page lives at [`app/(operator-studio)/operator-studio/plan/page.tsx`](app/(operator-studio)/operator-studio/plan/page.tsx) and renders [`PlanView`](app/2/v2/components/plan-view.tsx) with two modes:

- **Drafting** — `DraftingPlan` ([lines 83–318](app/2/v2/components/plan-view.tsx:83)). The screenshot the user pushed back on. Field stack: Plan title → Goal (with Target icon) → Outcome (Trophy icon, Textarea) → Steps (each row is two inputs: title + short description). Right rail: three explainer blocks — "Why write this down?", "Measurable goals win", "Pin for multi-day work."
- **Filled** — `FilledPlan` ([lines 395–678](app/2/v2/components/plan-view.tsx:395)). Goal/outcome become side-by-side `ReadOnlyField` cards. Steps render as a numbered card with status icon, status pill (`covered` / `in motion` / `open`), and an `Evidence` blockquote pulled from the latest fulfillment. Right rail flips to a "Plan health" mini-stat grid + Pin/Ship buttons + a "What this plan governs" explainer.

Schema, for grounding:

- `operator_plans`: `id`, `workspaceId`, `title`, `goal`, `outcome`, `state ∈ {drafting, active, paused, shipped, archived}`, `pinned`, `ownerName`, `createdBy`, `shippedAt`, `archivedAt`. ([schema.ts:327–356](lib/server/db/schema.ts:327))
- `operator_plan_steps`: `id`, `planId`, `workspaceId`, `title`, `description`, `stepOrder`, `status ∈ {open, in-motion, covered, skipped}`. ([schema.ts:358–382](lib/server/db/schema.ts:358))
- `operator_step_fulfillments`: join to messages/threads, with `promotedAt`, `promotedBy`, optional `note`. ([schema.ts:389–417](lib/server/db/schema.ts:389))
- Promotion API: `POST /api/operator-studio/sessions/:sessionId/fulfill`. Idempotent on `(sessionId, stepId, targetType, targetId)`. There's no separate "candidate" stage — fulfillment is committed at promotion time.

Plans surface elsewhere via:
- Today's compass strip in [today-view.tsx](app/2/v2/components/today-view.tsx).
- `QuoteToStepPopover` on a thread message — the user selects text, picks a step, fulfills.
- The brief's "Plan coverage" section.
- The sidebar plan card in [workspace.tsx](app/2/v2/components/workspace.tsx).

## What plans mean (user's framing)

You're sketching what you're trying to get done so you can steer the AI toward it. As the conversation unfolds, you (or the AI) flag moments — "this could be the deliverable for step 3" — and the system threads those candidates back to the plan as evidence.

That's two phases:
1. **Live** — the step is in motion, work is happening.
2. **Candidate event** — a message gets flagged as a possible deliverable for the step. Provisional, not committed.

The current schema collapses these into one. v2 likely needs a separate "candidate" notion — see [§ Two-phase model](#two-phase-model).

## Where the drafting form glazes

The form is *correct*. Plan title is required. Goal is one measurable sentence. Outcome describes the world after. Steps are optional. Each input has a hint. There is nothing factually wrong with it.

What's missing is **authorial momentum**:

- **The fields are stacked vertically with equal visual weight.** Plan title and Goal aren't more important than the step title row, even though they should be. Your eye moves down a list, not across a structure.
- **The hints sit *below* the inputs.** You read the input → fill it → look down for confirmation you did the right thing. It's a serial loop, not a glance-and-go.
- **Steps are two inputs per row.** The dual-field row (title + short description) makes you decide twice per step whether you have something to say. Most people will fill the title and leave the description blank, then feel guilty about it.
- **The rail is a wall of explainer text.** Three paragraphs telling the user *why* the form matters. If the form felt fun, the rail wouldn't need to argue for it.
- **No AI lever.** The whole product is about steering an AI, but the moment of authoring the steering target is unaided.
- **No spatial story for the steps.** A plan is a *shape* (start → middle → done). The drafting view shows a list. The filled view shows the same list with status icons.

## Three directions for the drafting flow

Not exclusive. The right v2 probably borrows from two of them.

### A. The single composer

Replace the Plan title / Goal / Outcome triad with **one large textarea** at the top of the page, plus an inline "Help me sketch this" button.

- The user types whatever they want. "Ship the OSS treatment of Operator Studio by Friday — README, CONTRIBUTING, and a working demo. Two external contributors should open issues."
- An LLM call (gated by `WORKBOOK_CLUSTER_ENDPOINTS`, gracefully off in echo mode) parses that into title / goal / outcome / suggested steps and renders them as **draft cards** below — visually distinct (dashed border, faded), each with a thumb-up to accept or X to dismiss.
- Accepting a draft card commits it as a real plan field. The user retains authorship; the AI is offering, not deciding.

Pros: single input is dramatically less form-like. The AI is doing the work the user asked it to do. Echo-mode degrades cleanly to "type your title here" with the suggestion button hidden.

Cons: feels magical when it works, broken when the LLM misparses. Needs a "edit raw" escape hatch.

### B. Step-first, fields-as-affordance

Invert the page: steps come first, goal/outcome come last (or are inferred). The user's mental model when they sit down to plan is usually a list of things to do — they reach the abstract goal/outcome only after sketching.

- Top of the page: a `+ Add a step` row, focused on load.
- After 2–3 steps are in, the system suggests a title and goal/outcome based on the steps. Same draft-card pattern as A.
- Goal/outcome live in a collapsed section below; expand to write manually.

Pros: matches how people actually think. Lower bar to commitment — adding a step is cheap, writing a goal feels heavy.

Cons: an unprincipled plan with no goal is easy to ship. Need to nudge people to fill it.

### C. The author's table

Treat the page as a **physical workspace** (a desk, a corkboard). Each step is a card you can pick up, rearrange, mark up. The plan title is a label at the top of the corkboard. Goal/outcome are pinned notes.

- Drag-and-drop reordering with a satisfying physical feel.
- Each step card has a flip side — write a description there if you want, leave it blank otherwise.
- The "Add step" button is a paper card you pull off a stack.

Pros: most "fun." Maximum tactile feedback. The handcrafted feel the user asked for.

Cons: the most ambitious. Mobile/touch is non-trivial. Can over-collide with the **filled** view (which already has a different shape). Probably v2.5, not v2.

**Recommended pick: A + B.** A gets the user past the field-stack feel, B aligns with how people actually think. Together: a single composer at the top + a step-first list below, with goal/outcome as inferred-but-editable. Save C for later.

## What the filled view should evolve into

The filled view is already much closer to "handcrafted" than the drafting view — the goal/outcome cards, the evidence blockquote, the status pills are doing real work. Two changes for v2:

1. **A spatial progress indicator.** The status icons on each step are correct but flat. A small horizontal **chevron stack** glyph (1 chevron = open, 2 = in-motion, 3 = covered) lets you eyeball the plan's overall shape in one glance. Same glyph reused everywhere plans appear.
2. **A candidates strip.** When the system flags a message as a candidate for a step (see [§ Two-phase model](#two-phase-model)), it shows up as a small **filled diamond** badge on the step row, with a count. Click → opens a side panel listing the candidates with thumb-up / dismiss controls. This is where the live → candidate → fulfilled story lives in the UI.

## Visual language for plan elements

Whatever the layout becomes, the *atomic visual treatments* need to be tight enough that plan elements are unmistakable when they show up in Today, Pulse, Brief, the thread reader. Proposed primitives:

| Element | Treatment | Why |
|---|---|---|
| The plan compass mark | Small `Compass` glyph (already used in `FilledHeader` and Today's CompassStrip) — keep | Already an emerging mark; reinforce it. |
| Step state | A **chevron stack** glyph (1 / 2 / 3 chevrons) instead of (or in addition to) the `covered` / `in motion` / `open` text pill | One mark to read, not a word to parse. Glanceable. The pill stays for accessibility / explicitness. |
| Step number | Two-digit zero-padded mono numerals (`01`, `02`) — keep, already used | Distinctive, already in place. |
| Candidate event | A small **filled diamond** in the step's accent color | New, distinct shape — readers will learn "diamond = candidate." Doesn't collide with check / dot / circle markers already in use. |
| Confirmed fulfillment | Diamond → fills with a checkmark on confirmation | Visual lineage from candidate to confirmed. A beat the user can feel. |
| Plan-flavored color | Reserve **emerald** for plan accents (already the brand-y color in `FilledHeader.pinned` and the "covered" pill) | If you see emerald in the app, plan content is involved. |

The key idea: **shape (not color alone) carries meaning**, so the language survives in light/dark mode and for color-blind users. Color is reinforcement.

Where the language shows up:
- **Today's compass** — already does. Tighten the glyphs.
- **Thread reader** — when a message is a candidate or fulfillment for a step, render a small diamond/check next to the message gutter, with a hover affordance to see which step.
- **Brief** — the "Plan coverage" section uses the same chevron stack icons; covered/in-motion/open read identically across surfaces.
- **Pulse** — see [§ Pulse integration](#pulse-integration) below.
- **Sidebar plan card** ([workspace.tsx](app/2/v2/components/workspace.tsx)) — render the chevron stack at small sizes; collapse the "covered/total" string into the glyph.

## Two-phase model

### Schema change required

Today: `operator_step_fulfillments` is created at promotion time. There's no notion of a candidate that hasn't yet been confirmed.

Proposed:

```
operator_step_candidates  (new)
  id, workspace_id, session_id, step_id,
  target_type ('thread' | 'message'),
  target_id,
  flagged_by ('user' | 'system'),
  flagged_at,
  reason (text, optional — why the system thinks this is a candidate),
  resolved_at, resolved_as ('confirmed' | 'dismissed', null while pending)

operator_step_fulfillments  (existing, additive)
  ...
  source_candidate_id (NEW, nullable FK)
```

Two distinct lifecycle events:
- **Flag a candidate** — cheap, automatic-friendly. The system can flag aggressively; the user can flag with one click. No commitment.
- **Confirm a fulfillment** — deliberate. Promotes the candidate (or skips the candidate stage, for direct manual promotion).

Rationale: candidates can be *noisy* and *automatic*. Fulfillments must be *deliberate* — they're the deliverable. Conflating them means the system can't speculate without making commitments, which means it stays quiet, which means the user does all the work.

### What this unlocks

- A **candidates strip** on each step in the filled view (small diamond badge + count → click expands inline).
- **Real-time signals** as the conversation unfolds — a diamond appears next to a message the moment the system suspects it's a candidate, *before* anyone commits.
- The system can be more aggressive with detection (more recall) without flooding the plan with false positives.
- Backfill: existing fulfillments are treated as `source_candidate_id IS NULL`. No data migration pain.

## AI-assisted sketching

Two surfaces:

1. **At drafting time** (per direction A above). Single composer → "Help me sketch this" → draft cards for title / goal / outcome / steps. Thumb-up to accept.
2. **While in motion**. The filled view gains a "Suggest a step" affordance below the step list. Pulls context from the live session and suggests a step the user might be missing ("Ship a CHANGELOG entry?" "Add a smoke test?"). Same draft-card pattern, same accept/dismiss.

Both gated on `WORKBOOK_CLUSTER_ENDPOINTS`. Echo-mode hides the affordances and shows a tooltip pointing at the env var.

The key principle, stated explicitly: **the AI suggests; the user commits**. Suggested cards are visually distinct (dashed border, faded) until accepted. They never silently become real data.

## Pulse integration

Out of scope for the plan page itself, but the visual language should make this trivial later:

- Pulse already shows session-level activity. Add a **plan-progression lane** below the activity ribbon — small markers (chevron stack glyphs) at the timestamps when a step changed state (open → in-motion → covered).
- **Threshold pings**. When a step covers, that's a moment of progress: "Step 03 covered at 14:23 — message #42 in thread X." Surface it on Pulse as a small marker the user can click. The plan animates over the course of the day, not just on the plan page.

## Data-model accessibility (user's explicit ask)

The user said the back-end model needs to be "very accessible, very sensible, and easy to work with on the rest of the screens." Concrete asks for the v2 schema work:

- Expose a `getPlanWithCoverage(planId)` query that returns plan + steps + per-step `{candidatesPending, candidatesDismissed, fulfillments}` counts in a single round trip. Today the brief, today-view, and plan-view each compute coverage separately.
- Add a `getCurrentPlanForWorkspace(workspaceId)` resolver that's the canonical answer to "which plan should this surface read?" — so Today, Brief, Pulse, and Sidebar all get the same plan with the same shape.
- Add a `getCandidatesForStep(stepId)` query and an `/api/operator-studio/plans/:planId/steps/:stepId/candidates` route, mirroring the existing fulfill route. Plan UIs across the app can then page through pending candidates without each surface re-implementing the join.

If those three exist, dropping plan UI into a new screen is "render and bind," not "re-derive everything."

## What v2 is *not*

- Not a project-management replacement (Linear/Asana/Notion exist).
- Not multiplayer in this iteration (that's the [Operator Studio Server](operator-studio-server-spec.md) story).
- Not real-time collaborative cursors. Plans are a personal sketch artifact for now.
- Not a Gantt chart. We're tracking provisional progress, not committed delivery dates.

## Open questions

1. **Should candidates be visible on the plan page itself, or only in a dedicated candidate review surface?** Tradeoff: visibility (yes) vs. signal-to-noise (no).
2. **Is `skipped` a useful step state, or noise?** Currently in the schema; rarely surfaced. Could merge with `archived`.
3. **Plan templates** ("Ship a feature," "Investigate a bug," "Write a doc") — accelerate blank-page or feel patronizing? Probably worth a behind-a-feature-flag spike.
4. **Drag-and-drop on touch.** Direction C leans hard on it. Mobile fallback?
5. **Goal/outcome — single composer (A), or kept as discrete fields with a lighter touch?** I lean toward A. The user gets to override per-field if they want.

## Recommended next move

Pick directions A + B. Ship a hidden-by-default `/plan/v5` route inside this same `app/2/v2/components/` surface. Build the **visual language atomics** there first — chevron stack, candidate diamond, the consistent emerald accent — in isolation, without breaking the live `/plan` page. Then wire AI-assisted sketching, then the candidate strip. Once the language is set and the schema migration for `operator_step_candidates` is in, dropping the new treatments into Today / Brief / Pulse / Thread reader becomes mechanical.
