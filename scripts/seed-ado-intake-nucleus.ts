/**
 * Seeds the ADO Intake + Change-Tracking Nucleus.
 *
 * - Upserts KB entries (doctrine, patterns, concept, todo) into operator_kb_entries.
 * - Upserts plan steps under the active plan as independent work lanes,
 *   each launchable on its own agent.
 *
 * Run: pnpm tsx scripts/seed-ado-intake-nucleus.ts
 */

import { sql } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { getActivePlan } from "../lib/operator-studio/plans"
import {
  upsertEntry,
  type KbEntryType,
  type KbStability,
} from "../lib/operator-studio/knowledge"
import { upsertPlanStep } from "../lib/operator-studio/plans"

const workspaceId = "global"
const now = new Date()

type EntrySeed = {
  id: string
  entryType: KbEntryType
  stability: KbStability
  title: string
  summary: string
  tags: string[]
  bodyMarkdown: string
  relatedEntryIds?: string[]
}

const entries: EntrySeed[] = [
  {
    id: "kb-ado-ingestion-doctrine",
    entryType: "procedure",
    stability: "draft",
    title: "Azure DevOps ingestion doctrine",
    summary:
      "Operator Studio is the agent-facing read-mirror of Azure DevOps. We own the ingest function (write side) but never auto-write back to ADO. Every change to upstream is captured as immutable revision history so agents can diff before/after.",
    tags: ["ado", "ingestion", "doctrine", "telegento", "operator-studio"],
    relatedEntryIds: [
      "pattern-ado-keyed-intake-bundle",
      "pattern-ado-stakeholder-lens-david-micky",
      "concept-ado-snapshot-diff",
      "todo-ado-intake-nucleus-work-lanes",
    ],
    bodyMarkdown: `# Azure DevOps ingestion doctrine

## Why this exists

ADO is the upstream source of truth for engineering work flowing in from Clarifying / Telegento. Stakeholders (Micky, Rob, etc.) move work through ADO. Operator Studio is the agent-facing read-mirror: when an agent picks up a thread, it must reach the *current* state of any ADO item, plus everything that changed recently, plus enough stakeholder context to know who is asking and how loud.

A fresh-eyes agent told "Mickey says expedite ADO #39" must reach actionable in **one command**, not by fuzzy-grepping chat history. That is the bar.

## Read posture

- **Source of truth:** \`dev.azure.com/ClarifyingMarketingGroup\`, project \`IT\`.
- **Auth:** \`az\` CLI on the operator's machine. No service principal.
- **Read mirror:** Operator Studio's database. We own this. We have write access to the *ingest* function. We do **not** auto-write back to ADO. Comments, state changes, and assignment changes flowing from agent → ADO are always human-gated.

## What we ingest

Beyond the existing one-shot \`@Me\` filter at \`lib/operator-studio/signal-intake/azure-devops.ts\`, the nucleus persists:

- \`ado_items\` — current snapshot keyed by remote id. Title, state, priority, assigned-to, area, iteration, tags, work-item type, created-by, last-changed-by, last-changed-at.
- \`ado_revisions\` — append-only field-change history. Every \`System.Rev\` increment captured with field-level before/after, actor, timestamp.
- \`ado_comments\` — append-only. Comment id, author, body, html, created-at, mentions parsed.
- \`ado_assignment_history\` — denormalized assignment transitions for fast lens queries.
- \`ado_priority_history\` — denormalized priority transitions for fast escalation detection.
- \`ado_state_history\` — denormalized state transitions for fast lifecycle queries.

The existing \`SignalCandidate\` shape is the *display projection* on top of this read mirror, not the storage layer.

## Cadence

- **Background poller:** every 5 minutes, full \`@CurrentProject\` query (not just \`@Me\`), persist into ado_items + revisions/comments tables.
- **On-demand:** \`pnpm os:ado <id>\` and the \`ado_lookup\` MCP tool refresh that single item synchronously before returning.
- **Snapshot stamps:** every poll cycle creates an \`ingest_snapshots\` row (\`snapshot_id, taken_at, item_count\`) so diffs between two arbitrary snapshots are addressable.

## Stakeholder columns indexed

- \`assigned_to\` (with David Lin-Clark identity normalized — see stakeholder-lens KB)
- \`created_by\`
- \`last_commenter\`
- \`mentioned_users\` (parsed from comment bodies)

## Non-goals

- Two-way sync. We mirror, we do not author.
- Replacing ADO. ADO remains the upstream system; agents read here, act in product repos, and humans close the loop in ADO.
`,
  },
  {
    id: "pattern-ado-keyed-intake-bundle",
    entryType: "pattern",
    stability: "draft",
    title: "ADO-keyed intake bundle (`os:ado <id>`)",
    summary:
      "One command turns a stakeholder ping with an ADO id into a complete agent intake bundle: live item, revision diff since last snapshot, last comments, matching plan steps, shipped commits, target product repo, bound agent, expedite/priority signals.",
    tags: [
      "ado",
      "intake",
      "agent-handoff",
      "telegento",
      "ergonomics",
      "operator-studio",
    ],
    relatedEntryIds: [
      "kb-ado-ingestion-doctrine",
      "pattern-ado-stakeholder-lens-david-micky",
      "concept-ado-snapshot-diff",
    ],
    bodyMarkdown: `# Pattern — ADO-keyed intake bundle

## Problem

A fresh-eyes agent told "Mickey says expedite ADO #39" today has to:
1. Fuzzy-grep wayseer chat history for "ado 39" (stale, wrong source of truth).
2. Read \`os:context\` and guess which of N in-motion steps maps to #39.
3. Discover that the actual product engineering lives in a different repo.
4. Discover whether commits already shipped against #39.

That is too many leaps. Each one is a place to lose the agent.

## Pattern

A single deterministic command — \`pnpm os:ado <id>\` and an MCP tool \`ado_lookup\` — returns one structured bundle:

\`\`\`
ADO #39  "Calls Need EnrollHere ID to correlate back to dialer"
state=Active  priority=2  type=Task  area=IT/Telegento  iteration=...
assigned_to: David Lin-Clark
created_by:  Rob Smith
last_changed_by: Micky <name>  at 2026-05-08T14:11Z

REVISION_DIFF since snapshot snap-...prev:
  STATE_TRANSITIONS:    New → Active   by Micky at 2026-05-08T14:11Z
  PRIORITY_TRANSITIONS: 3 → 2          by Micky at 2026-05-08T14:11Z
  ASSIGNMENT_TRANSITIONS: (none)
  NEW_COMMENTS:
    [Micky 2026-05-08T14:12Z] "Please expedite — Rob is blocked on dispute traceability."

PLAN_STEPS_REFERENCING:
  - step-telegento-ado-disputable-call-traceability  [covered]  shipped d1a322d07
  - step-telegento-ado-action-40-38                  [covered]  approved review

SHIPPED_COMMITS:
  - d1a322d07  feat(disputable-calls): expose EnrollHere/dialer correlation ID  (origin/main)

TARGET_PRODUCT_REPO: /Users/smackbook/nextgen-call-intelligence-shell

BOUND_AGENT: claude:de0e08ce... → step-telegento-lead-vendor-queue-name-propagation

STAKEHOLDER_POSTURE:
  expedite_signal: yes (Micky comment 2026-05-08T14:12Z, keyword "expedite")
  david_assigned: yes
  micky_touch_recency: 47s
  inferred_intent: re-raise (already shipped — investigate whether scope changed)
\`\`\`

## Why this shape

- **Single round-trip.** No fuzzy search. No per-source CLIs. No guessing.
- **Stale-truth resolved.** Live ADO read + ingested revision history + git log of shipped commits → the agent can tell whether "expedite" is on already-shipped work or new follow-on.
- **Wrong-repo gravity defused.** Target product repo is in the bundle.
- **Stakeholder posture is a first-class field**, not something the agent has to infer from prose.

## Surfaces

- \`pnpm os:ado <id>\` — CLI for human + scripted use.
- \`ado_lookup\` MCP tool — same payload, agent-callable.
- HTTP \`GET /api/operator-studio/ado/[id]\` — UI consumption.

All three return the same bundle schema.
`,
  },
  {
    id: "pattern-ado-stakeholder-lens-david-micky",
    entryType: "pattern",
    stability: "draft",
    title: "ADO stakeholder lens — David assignee, Micky escalation",
    summary:
      "Ranking and signal-weight rules for ADO items. David Lin-Clark is the primary assignee identity; Micky is the engineering manager owning Telegento priority. Comments on David-assigned cards carry the highest single-event weight.",
    tags: [
      "ado",
      "stakeholder",
      "priority",
      "david",
      "micky",
      "telegento",
      "ranking",
    ],
    relatedEntryIds: [
      "kb-ado-ingestion-doctrine",
      "pattern-ado-keyed-intake-bundle",
    ],
    bodyMarkdown: `# Pattern — ADO stakeholder lens

## Identities

- **David Lin-Clark** — the operator. Primary assignee identity. ADO display name(s) and unique names captured into \`identity_aliases\` so a single canonical id is used everywhere.
- **Micky** — engineering manager. Owns Telegento priority. His comments, assignments, priority shuffles, and state transitions are first-class signals. Aliases captured the same way (Mickey / Micky / Mick / full name).

Other repeat stakeholders (Rob, etc.) are captured but not specially weighted.

## Ranking (David's inbox)

For each ADO item assigned to David:

\`\`\`
score =
    w_micky_recent  * decay(now - last_micky_touch)
  + w_expedite_kw   * has_expedite_keyword(last_micky_comment)
  + w_priority      * (4 - ado_priority_field)        // P1 highest
  + w_state_change  * recent_state_transition_within(24h)
  + w_recency       * decay(now - last_changed_at)
  + w_unread_comment * unread_comment_count
\`\`\`

Weights are tuned in \`lib/operator-studio/ado/lens.ts\` (live constants, not config-file drift).

## Signal weights — single-event scale

- **Comment from Micky on a David-assigned card** — highest weight. Always surfaces.
- **Priority bump on a David-assigned card** — high weight. Always surfaces.
- **Assignment to David (new)** — high weight. Always surfaces.
- **State transition on a David-assigned card** — medium weight.
- **New ADO item created by Micky (unassigned)** — medium weight, watchlist.
- **Any change on a non-David item** — low weight, digest only.

## Expedite keyword set

Case-insensitive match in latest comment body or title:

\`expedite\`, \`escalate\`, \`urgent\`, \`asap\`, \`blocker\`, \`blocked\`, \`p0\`, \`p1\`, \`high priority\`, \`fire\`, \`hot\`, \`pri 1\`.

Match emits \`stakeholder_posture.expedite_signal = yes\` with the originating comment id.

## Why this is codified, not tuned per-call

If every agent prompt has to re-derive "is this a David-assigned, Micky-touched, expedite-flagged item," each agent reaches a different answer. The lens lives in the ingest layer, runs once per snapshot, and is read by every surface (CLI, MCP, UI, active-work-context).
`,
  },
  {
    id: "concept-ado-snapshot-diff",
    entryType: "concept",
    stability: "draft",
    title: "ADO snapshot diff — plain-text format for agent prompts",
    summary:
      "Deterministic plain-text diff between two ingest snapshots, designed for inclusion in agent system prompts. Sections: STATE_TRANSITIONS, ASSIGNMENT_TRANSITIONS, PRIORITY_TRANSITIONS, NEW_COMMENTS, FIELD_CHANGES, ITEMS_NEW, ITEMS_CLOSED.",
    tags: ["ado", "diff", "snapshot", "agent-prompt", "active-work-context"],
    relatedEntryIds: [
      "kb-ado-ingestion-doctrine",
      "pattern-ado-keyed-intake-bundle",
    ],
    bodyMarkdown: `# Concept — ADO snapshot diff

## Output is for agents, not humans

The diff format is text designed to drop into an LLM system prompt. No tables, no ANSI color, no UTF-8 box drawing. Every line is grep-friendly and key=value-ish so the agent can ground references.

## Sections (in fixed order)

\`\`\`
=== ADO_DIFF snap=<old>..<new>  generated=<iso> ===

ITEMS_NEW (n=<count>):
  #<id>  type=<Task|Bug|...>  state=<...>  priority=<n>  assigned=<name>
         title="<...>"  created_by=<name>  created_at=<iso>

ITEMS_CLOSED (n=<count>):
  #<id>  state_final=<Closed|Resolved|Removed>  closed_by=<name>  closed_at=<iso>

STATE_TRANSITIONS (n=<count>):
  #<id>  <old> → <new>  by <actor>  at <iso>

PRIORITY_TRANSITIONS (n=<count>):
  #<id>  <old> → <new>  by <actor>  at <iso>

ASSIGNMENT_TRANSITIONS (n=<count>):
  #<id>  <old or "(unassigned)"> → <new or "(unassigned)">  by <actor>  at <iso>

NEW_COMMENTS (n=<count>):
  #<id>  [<author> <iso>]  "<body, single-quoted, newlines collapsed>"

FIELD_CHANGES (n=<count>, excludes the above sections):
  #<id>  <FieldName>  <old> → <new>  by <actor>  at <iso>

=== END_ADO_DIFF ===
\`\`\`

## Stakeholder annotations

When a diff is rendered for a David-scoped or Micky-scoped agent context, each line is suffixed with stakeholder tags:

\`\`\`
NEW_COMMENTS:
  #39  [Micky 2026-05-08T14:12Z]  "Please expedite — Rob is blocked."   [david_assigned] [micky_touch] [expedite]
\`\`\`

That lets a downstream agent grep for \`[expedite]\` or \`[david_assigned]\` without re-parsing names.

## Where diffs flow

- Pasted into the "what's new since last cycle" digest in \`active-work-context.ts\` (currently a placeholder slot).
- Returned by \`ado_lookup\` as the \`REVISION_DIFF\` section for a single id.
- Available standalone as \`pnpm os:ado-diff --since=<snap>\` for review item generation.
`,
  },
  {
    id: "pattern-agent-deployment-as-bottleneck",
    entryType: "pattern",
    stability: "draft",
    title: "Agent deployment + verification is the bottleneck, not compute",
    summary:
      "Compute parallelism is no longer the constraint. The constraint is conveying intent, deploying agents to independent work lanes, and verifying that the slop they return is actually usable. Every nucleus task ships with fixture-backed tests + a deterministic verification step.",
    tags: ["operator-studio", "agentic-loop", "verification", "doctrine"],
    bodyMarkdown: `# Pattern — Agent deployment + verification is the bottleneck

## Constraint statement

We are not constrained by how many parallel Claude/Codex agents can be running. We are constrained by:

1. **Conveying intent** — the task description must be self-contained for a cold-start agent.
2. **Deploying** — launching the agent with the right repo, the right context bundle, the right plan-step binding.
3. **Verifying** — confirming that the diff/PR/output is actually correct, not just plausible.

Therefore: every nucleus work lane is shaped to be **independently launchable** and **deterministically verifiable**. Cards that fail either property block on rewrite, not on launch.

## Per-lane requirements

Each plan step in the ADO intake nucleus must include:

- **Self-contained brief** — repo, file paths, schema/contract excerpts, expected outputs.
- **Fixture data** — checked-in JSON snapshots so tests can run without live ADO.
- **Test surface** — \`vitest\` test that asserts the contract.
- **Verification step** — a single command (typecheck + test + a smoke script) that returns pass/fail.

When a returned PR is reviewed, the reviewer agent runs the verification step before a human ever looks at it. Slop-without-verification never reaches the David review queue.

## Why this rule lives in the KB, not in CLAUDE.md

Per dogfood-first doctrine, behavioral norms for the agentic loop live in Operator Studio's KB so future agents — Claude, Codex, others — pick them up the same way humans do: by reading the workspace they are operating inside.
`,
  },
  {
    id: "todo-ado-intake-nucleus-work-lanes",
    entryType: "todo",
    stability: "draft",
    title: "ADO intake nucleus — independent work lanes",
    summary:
      "Index of plan steps that build out the ADO ingestion + change-tracking nucleus. Each lane is independently launchable on its own agent. Lanes have explicit pre-conditions so parallelism is safe.",
    tags: ["ado", "nucleus", "work-lanes", "telegento", "operator-studio"],
    relatedEntryIds: [
      "kb-ado-ingestion-doctrine",
      "pattern-ado-keyed-intake-bundle",
      "pattern-ado-stakeholder-lens-david-micky",
      "concept-ado-snapshot-diff",
      "pattern-agent-deployment-as-bottleneck",
    ],
    bodyMarkdown: `# TODO — ADO intake nucleus work lanes

Each child step is independently launchable. The schema lane (L1) is the only hard pre-requisite for ingest-time persistence; lanes that consume the ingest mirror can stub against fixtures (L7) until L1 lands.

## Lanes

### L1 · step-ado-ingest-schema-and-poller
Read-model schema (\`ado_items\`, \`ado_revisions\`, \`ado_comments\`, \`ado_assignment_history\`, \`ado_priority_history\`, \`ado_state_history\`, \`ingest_snapshots\`, \`identity_aliases\`). Drizzle migration. Poller that runs every 5 min, full project query (not just @Me), upserts items, appends revisions/comments. Checkpoint cursor in \`ingest_snapshots\`.

### L2 · step-ado-snapshot-diff-engine
Pure function \`diffAdoSnapshots(oldSnap, newSnap): string\` returning the plain-text diff format defined in \`concept-ado-snapshot-diff\`. No I/O. Fixture-driven tests.

### L3 · step-ado-stakeholder-lens
\`identity_aliases\` resolver. David + Micky canonical ids. Lens scorer \`scoreAdoItem(item, lastTouches): number\` per the formula in \`pattern-ado-stakeholder-lens-david-micky\`. Lens-tagged diff annotations.

### L4 · step-ado-comment-salience
Extractor for expedite/escalate/blocker keywords, @mentions parsing, ETA-ask detection ("by EOD", "before Friday"). Returns structured \`commentSalience\` per comment.

### L5 · step-ado-keyed-intake-cli
\`scripts/ado-lookup.ts\` + \`pnpm os:ado <id>\` script. MCP tool \`ado_lookup\` exposed via \`lib/mcp-server\`. HTTP \`GET /api/operator-studio/ado/[id]\`. All three return the bundle defined in \`pattern-ado-keyed-intake-bundle\`. Includes git-log scan for shipped commits referencing the id and plan-step lookup.

### L6 · step-ado-active-work-context-wiring
Pipe the latest ADO diff (since last cycle) into \`lib/operator-studio/active-work-context.ts\` as the "what's new upstream" digest section. Bounded to David-scoped lens by default.

### L7 · step-ado-ingest-fixtures-and-tests
Checked-in JSON fixtures: \`fixtures/ado/snapshot-a.json\`, \`snapshot-b.json\`, paired comments. Tests for diff engine (L2), lens scorer (L3), salience (L4), bundle assembly (L5). Runs in CI, no live ADO.

### L8 · step-ado-ui-inbox-surface
Operator Studio UI lens. David inbox view (sorted by lens score). Snapshot diff viewer (paste two snap ids → rendered diff). ADO item detail page that shows the same bundle the CLI returns.

## Pre-condition graph

- L1 → enables persistent operation of L2..L8 against live data, but L7 fixtures unblock L2..L5 immediately.
- L3 depends on \`identity_aliases\` from L1 schema (or hardcoded constants until L1 lands — flagged in L3 brief).
- L5 depends on L2 (diff) + L3 (lens) + L4 (salience) for full bundle. Stub to fixtures otherwise.
- L6 depends on L5 (or L2 minimum).
- L8 consumes whatever lanes have shipped; degrades gracefully.

## Out of scope (do not let scope creep here)

- Two-way ADO writes.
- Teams ingest. (Separate nucleus; cross-link only.)
- Cross-project ADO support beyond \`IT\`.
- Auth beyond the operator's local \`az\` CLI.
`,
  },
]

const planSteps: Array<{
  id: string
  title: string
  description: string
  parentStepId?: string
  status?: "open" | "in-motion"
}> = [
  {
    id: "step-ado-intake-nucleus",
    title: "ADO intake + change-tracking nucleus (parent)",
    description: `Build the ADO ingestion, snapshot, diff, and intake-bundle layer that lets a fresh-eyes agent go from "stakeholder pinged about ADO #N" to actionable in one command.

Doctrine + spec live in KB:
- kb-ado-ingestion-doctrine
- pattern-ado-keyed-intake-bundle
- pattern-ado-stakeholder-lens-david-micky
- concept-ado-snapshot-diff
- pattern-agent-deployment-as-bottleneck
- todo-ado-intake-nucleus-work-lanes

Children L1..L8 are independently launchable; see todo-ado-intake-nucleus-work-lanes for the pre-condition graph.`,
    status: "in-motion",
  },
  {
    id: "step-ado-ingest-schema-and-poller",
    title: "L1 · ADO read-model schema + 5-min poller",
    parentStepId: "step-ado-intake-nucleus",
    description: `Drizzle schema for the ADO read mirror.

Tables: ado_items, ado_revisions (append-only field changes), ado_comments (append-only), ado_assignment_history, ado_priority_history, ado_state_history, ingest_snapshots, identity_aliases.

Poller: scripts/ado-poll.ts, every 5 min, full \`SELECT [System.Id], ... FROM WorkItems WHERE [System.TeamProject] = 'IT'\` (drop the @Me filter). Use az CLI like the existing lib/operator-studio/signal-intake/azure-devops.ts. Persist current state into ado_items, append into history tables, write ingest_snapshots row.

Reuse SignalCandidate projection layer on top — do not break the existing /api/operator-studio/signal-intake bucket.

Verification: poll twice, confirm ado_items count stable, ado_revisions count grows when an item is touched in ADO between polls, ingest_snapshots has two rows.`,
  },
  {
    id: "step-ado-snapshot-diff-engine",
    title: "L2 · Snapshot diff engine (plain-text, agent-prompt format)",
    parentStepId: "step-ado-intake-nucleus",
    description: `Implement \`diffAdoSnapshots(oldSnap, newSnap): string\` per the format in concept-ado-snapshot-diff.

Pure function. No DB I/O — caller passes hydrated snapshot objects. Sections in fixed order: ITEMS_NEW, ITEMS_CLOSED, STATE_TRANSITIONS, PRIORITY_TRANSITIONS, ASSIGNMENT_TRANSITIONS, NEW_COMMENTS, FIELD_CHANGES.

Tests: fixture-backed (see L7), assert exact string output for representative pairs.`,
  },
  {
    id: "step-ado-stakeholder-lens",
    title: "L3 · Stakeholder lens — David + Micky weighting",
    parentStepId: "step-ado-intake-nucleus",
    description: `lib/operator-studio/ado/lens.ts.

Resolve David Lin-Clark and Micky to canonical identity ids via identity_aliases (or hardcoded constants until L1 lands — flag at top of file).

Implement scoreAdoItem(item, history) per the formula in pattern-ado-stakeholder-lens-david-micky. Implement annotateDiffLines(diff, lens) that suffixes diff lines with [david_assigned], [micky_touch], [expedite] tags.

Tests: lens-scoring fixtures asserting top-N ordering for known stakeholder events.`,
  },
  {
    id: "step-ado-comment-salience",
    title: "L4 · Comment salience extractor",
    parentStepId: "step-ado-intake-nucleus",
    description: `lib/operator-studio/ado/salience.ts.

Per ado_comments row, return { expediteSignal: boolean, mentions: string[], etaAsk: { phrase, deadline?: ISO } | null, escalationKeyword: string | null }.

Keyword set in pattern-ado-stakeholder-lens-david-micky. Tests: fixture comment bodies including the canonical Micky "please expedite — Rob is blocked" form.`,
  },
  {
    id: "step-ado-keyed-intake-cli",
    title: "L5 · `pnpm os:ado <id>` + ado_lookup MCP tool + HTTP route",
    parentStepId: "step-ado-intake-nucleus",
    description: `Three surfaces, one bundle shape (see pattern-ado-keyed-intake-bundle):

1. scripts/ado-lookup.ts wired as \`pnpm os:ado <id>\`.
2. MCP tool \`ado_lookup\` in lib/mcp-server/tools/.
3. HTTP \`GET /api/operator-studio/ado/[id]\`.

Bundle assembly:
- Live ADO read for the id (single-item az boards work-item show).
- Latest revision diff vs previous snapshot (call L2).
- Last N comments with salience tags (L4).
- Lens posture (L3).
- Plan-step references — query operator_plan_steps where description or title mentions the id.
- Shipped commit references — \`git log --all -G "ADO ?#?<id>" -G "#<id>"\` against the registered product repos. Product-repo registry lives next to the importer registry.
- Bound agent — query the same source operator-context.ts uses for "Bound agents".
- Stakeholder posture — david_assigned, micky_touch_recency, expedite_signal, inferred_intent.

Verification: \`pnpm os:ado 39\` returns a bundle that includes the d1a322d07 shipped commit and the matching plan steps.`,
  },
  {
    id: "step-ado-active-work-context-wiring",
    title: "L6 · Pipe ADO diff into active-work-context",
    parentStepId: "step-ado-intake-nucleus",
    description: `lib/operator-studio/active-work-context.ts gains a "WHAT_S_NEW_UPSTREAM" section.

Default: latest diff since the previous os:context invocation, filtered to David-scoped lens (assigned-to-David items + Micky-touched items + expedite-flagged anywhere).

Bounded character budget so the section never blows the prompt.

Verification: \`pnpm os:context\` after a deliberate state change in ADO surfaces the change in the WHAT_S_NEW_UPSTREAM block.`,
  },
  {
    id: "step-ado-ingest-fixtures-and-tests",
    title: "L7 · Fixtures + vitest suites for the nucleus",
    parentStepId: "step-ado-intake-nucleus",
    description: `Checked-in JSON fixtures under fixtures/ado/:
- snapshot-a.json, snapshot-b.json — paired ado_items snapshots.
- comments-a.json, comments-b.json.
- expected-diff.txt — golden diff string for snapshot-a → snapshot-b.

Vitest suites:
- diff engine (L2) — string equality vs expected-diff.txt.
- lens scoring (L3) — top-N ordering assertions.
- salience (L4) — expedite/eta detection.
- bundle assembly (L5) — uses fixtures, no live ADO.

Runs in CI. Zero live ADO calls.`,
  },
  {
    id: "step-ado-ui-inbox-surface",
    title: "L8 · Operator Studio UI — David inbox + diff viewer",
    parentStepId: "step-ado-intake-nucleus",
    description: `New surface inside app/(operator-studio)/operator-studio/:
- /ado — David's lens-sorted inbox.
- /ado/[id] — item detail rendering the same bundle the CLI returns.
- /ado/diff?from=<snap>&to=<snap> — paste two snapshot ids, render the diff.

Degrades gracefully if L1..L5 are not all shipped (uses whatever subset is available).`,
  },
]

async function main() {
  const db = getDb()

  await db.execute(sql`
    INSERT INTO workspace_modules (
      workspace_id,
      module_key,
      enabled,
      config_json,
      enabled_at,
      enabled_by
    )
    VALUES (${workspaceId}, 'knowledge_base', 1, '{}'::jsonb, ${now}, 'claude-ado-nucleus-seed')
    ON CONFLICT (workspace_id, module_key) DO UPDATE SET
      enabled = 1,
      enabled_at = EXCLUDED.enabled_at,
      enabled_by = EXCLUDED.enabled_by
  `)

  for (const e of entries) {
    await upsertEntry(workspaceId, {
      id: e.id,
      entryType: e.entryType,
      stability: e.stability,
      title: e.title,
      summary: e.summary,
      bodyMarkdown: e.bodyMarkdown,
      tags: e.tags,
      relatedEntryIds: e.relatedEntryIds ?? [],
    })
  }

  const activePlan = await getActivePlan(workspaceId, null, "claude-ado-nucleus-seed")
  if (!activePlan) {
    throw new Error("No active plan in workspace 'global' — cannot upsert plan steps.")
  }
  const planId = activePlan.id

  for (const step of planSteps) {
    await upsertPlanStep(workspaceId, planId, {
      id: step.id,
      title: step.title,
      description: step.description,
      parentStepId: step.parentStepId,
      status: step.status ?? "open",
    })
  }

  console.log(
    `Seeded ${entries.length} KB entries and ${planSteps.length} plan steps under plan "${planId}".`
  )

  await getPgPool().end()
}

main().catch(async (error) => {
  console.error(error)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
