/**
 * Seed the meta-Berthier design KB entry.
 *
 *   pnpm tsx scripts/seed-meta-berthier-design-kb.ts
 *
 * Idempotent — re-running upserts the entry. Discovery output for
 * `step-meta-berthier-discovery` per
 * `scripts/spawn-meta-berthier-discovery-worker.ts`.
 */

import { createRequire } from "node:module"
const requireFromHere = createRequire(import.meta.url)
const serverOnlyId = requireFromHere.resolve("server-only")
requireFromHere.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })

const { upsertEntry } = await import("../lib/operator-studio/knowledge")
const { GLOBAL_WORKSPACE_ID } = await import(
  "../lib/operator-studio/workspaces"
)
const { getPgPool } = await import("../lib/server/db/client")

const ENTRY_ID = "kb-2026-05-10-meta-berthier-design"

const BODY = `# Meta-Berthier — Orchestrator-of-Orchestrators Design

## TL;DR

Meta-Berthier is a Berthier-shape executive whose **read scope is the entire workspace's set of active work lanes**, not a single lane. It watches every lane's exec, worker rail, ready-for-review queue, pulled-in members, and recent task_done parrots, and surfaces a single 30,000-foot view to David. It **decides nothing autonomously** — it produces ranked suggestions (move worker, archive lane, spawn new lane, surface phone-priority) that David approves before any state mutation. Architecturally it is the same agent kind as a lane Berthier; the only differences are system prompt and connector scope.

## Read scope

Meta-Berthier reads, but never mutates, the following surfaces. All reads are workspace-scoped (a meta-Berthier belongs to one workspace and never crosses the workspace boundary).

### Per-workspace lane index

For each row in \`operator_work_lanes\` where \`archived_at IS NULL\` and \`workspace_id = $workspace\`:

- \`laneId\`, \`name\`, \`description\`, \`createdAt\`
- \`execAgentId\` (nullable — meta-Berthier flags lanes with no promoted exec as a soft anomaly)
- \`memberCounts\`: \`{ planSteps: number, kbEntries: number }\` — derived from \`operator_work_lane_membership\`
- \`workerCounts\`: \`{ active: number, readyForReview: number, idle: number, archived: number }\` — derived by joining \`operator_thread_card_bindings\` (lane filter via \`spawnedByAgentId == lane.execAgentId\`) against the cockpit review-status / activity tables that already power the lane rail
- \`lastActivityAt\`: max of (lane creation, latest worker task_done, latest member add, latest exec turn) — drives the "stale lane" signal
- \`recentTaskDoneParrots\`: array of last N task_done summary lines from this lane's workers (newest first, capped at ~10) — what the lane has *just* finished, in worker voice

### Per-lane pulled-in members

For each lane, the materialized pulled-in scope (what the lane is *working on*):

- Plan step rows from \`operator_work_lane_membership\` joined to \`plan_steps\` — id, title, status, parent
- KB entries from \`operator_work_lane_membership\` joined to \`operator_kb_entries\` — id, title, entryType

This is what makes meta-Berthier's suggestions concrete instead of abstract: it can say "lane A and lane C are both pulling in plan card step-X-foo-bar" rather than "two lanes seem to overlap."

### Cross-lane signals (derived)

Meta-Berthier pre-computes three cross-lane signals so it does not have to re-derive them every turn:

1. **Membership conflict** — same plan step or KB entry pulled into ≥2 active lanes. Returns \`{ memberKind, memberId, laneIds: string[] }\`. Not always a problem (lanes can independently care about a card) but worth surfacing because it often indicates one lane should absorb the other.
2. **Stale lane** — \`lastActivityAt < now - N days\` (N defaults to 7, configurable). Returns the lane row plus the staleness duration. Suggestion path: archive, or spawn a fresh worker against the longest-stalled member.
3. **Idle-with-workers** — lane has \`workerCounts.active > 0\` but \`lastActivityAt < now - 24h\`, meaning workers are bound but nobody's parroting task_done. Likely a stuck or detached worker; worth a phone-priority surface.

### Out of read scope (deliberately)

- Worker JSONL turn content beyond the most-recent task_done parrots. Meta-Berthier is a coordinator, not a code reviewer; it should not be reading worker diffs. If David wants per-worker depth, he opens the worker rail in that lane.
- Other workspaces. A meta-Berthier for "global" never sees "clarifying" lanes. Cross-workspace orchestration is a future card and would require a meta-meta-Berthier.

## Write scope

Meta-Berthier produces **suggestions**, never state changes. Every action below is a structured proposal that lands in a queue David approves from his phone.

### Suggestion types

1. **\`move_worker\`** — \`{ agentId, fromLaneId, toLaneId, rationale }\`. Reasoning: a worker bound to a card that is now pulled into another lane, or a worker that has gone idle in a stale lane while the destination lane is hot.
2. **\`archive_lane\`** — \`{ laneId, rationale }\`. Reasoning: stale + zero active workers + zero ready-for-review.
3. **\`create_lane\`** — \`{ proposedName, proposedDescription, seedMembers: { planSteps?: string[], kbEntries?: string[] }, rationale }\`. Reasoning: emerging cluster of activity around members not yet bound to any lane, or a single lane that has accumulated two distinct themes that should split.
4. **\`promote_phone_priority\`** — \`{ laneId, signal: "ready-for-review-spike" | "stuck-worker" | "stalled-card", payload, rationale }\`. The aggregated phone surface — meta-Berthier's primary daily output.
5. **\`spawn_worker\`** — \`{ laneId, planStepId, prompt, rationale }\`. Reasoning: a member is pulled in but has no worker assigned and is the longest-stalled card in the lane.

### Approval flow

Suggestions land in a workspace-scoped queue (\`operator_meta_berthier_suggestions\` — table TBD in implementation card). David's phone shows them in priority order; tap-to-approve dispatches to existing routes (\`POST /work-lanes/:id/members\`, the existing spawn pipeline, etc.). Nothing meta-Berthier emits is auto-applied.

### Out of write scope

- Editing plan card content, KB entry bodies, worker prompts. Meta-Berthier is a router, not an author.
- Cross-workspace anything. A suggestion is always scoped to one workspace.
- Killing or detaching workers. That stays on the per-lane Berthier; meta-Berthier can suggest "this looks stuck" but the kill action belongs to the lane.

## Connectors

Three GET endpoints, all workspace-scoped, all read-only. Response shapes specified.

### \`GET /api/operator-studio/meta/all-lanes-snapshot?workspaceId=…\`

The single-shot read meta-Berthier issues at the start of each turn.

\`\`\`ts
type AllLanesSnapshot = {
  workspaceId: string
  generatedAt: string // ISO
  lanes: Array<{
    laneId: string
    name: string
    description: string | null
    createdAt: string
    execAgentId: string | null
    memberCounts: { planSteps: number; kbEntries: number }
    workerCounts: { active: number; readyForReview: number; idle: number; archived: number }
    lastActivityAt: string | null
    recentTaskDoneParrots: Array<{ agentId: string; summary: string; at: string }>
    pulledInMembers: {
      planSteps: Array<{ id: string; title: string; status: string }>
      kbEntries: Array<{ id: string; title: string; entryType: string }>
    }
  }>
}
\`\`\`

### \`GET /api/operator-studio/meta/cross-lane-conflicts?workspaceId=…\`

Pre-computed membership conflicts. Cheap to derive from the snapshot but worth its own endpoint so meta-Berthier can poll it independently when deciding whether to recommend a merge.

\`\`\`ts
type CrossLaneConflicts = {
  workspaceId: string
  conflicts: Array<{
    memberKind: "plan_step" | "kb_entry"
    memberId: string
    memberTitle: string
    laneIds: string[]
    laneNames: string[]
  }>
}
\`\`\`

### \`GET /api/operator-studio/meta/stale-lanes?workspaceId=…&staleDays=7\`

Lanes with \`lastActivityAt < now - staleDays\`, plus the idle-with-workers subset.

\`\`\`ts
type StaleLanes = {
  workspaceId: string
  staleDays: number
  stale: Array<{ laneId: string; name: string; lastActivityAt: string | null; daysIdle: number }>
  idleWithWorkers: Array<{ laneId: string; name: string; activeWorkerCount: number; hoursSinceActivity: number }>
}
\`\`\`

### Implementation note

All three are derivable from a single SQL view that joins \`operator_work_lanes\`, \`operator_work_lane_membership\`, \`operator_thread_card_bindings\`, and the cockpit review-status table. Build the view first; the three endpoints are thin projections over it. This keeps meta-Berthier's read cost O(1) per turn regardless of how many lanes a workspace has.

## Architecture

**Recommendation: meta-Berthier is the same agent kind as a lane Berthier.** It is a Claude session promoted as the workspace's meta-exec, with two differences from a regular lane Berthier:

1. **System prompt** templates the meta-orchestrator role — "you are watching N lanes, you produce suggestions only, you never mutate, here are the three endpoints you call on every turn, here is the suggestion schema."
2. **Connector allowlist** points at \`/meta/*\` endpoints instead of (or in addition to) the lane-scoped \`/work-lanes/:id/*\` endpoints.

### Why same kind, not new kind

David's "recursive excursion" framing is the tell. The whole point is that the same orchestration shape works at higher zoom levels. If we forked a new agent kind we would:

- Duplicate the spawn pipeline, the chip-emission contract, the task_done parroting, the role-conflict guard, the binding tables.
- Lose the property that *every* Berthier could in principle be promoted to meta-Berthier given the right scope.
- Make meta-meta-Berthier (the workspace-of-workspaces orchestrator David will eventually want) a third agent kind instead of the same shape with a wider scope.

Same kind, different scope is the right factoring. Concretely: meta-Berthier reuses \`operator_cockpit_execs\` (or its lane-scoped successor) with a new column or sentinel \`role: "meta" | "lane"\`, and reuses the existing thread-card-binding model with \`planStepId\` set to a meta-card placeholder rather than a real step.

### Single architectural surprise

The work-lanes MVP card already plans for one exec per lane. Meta-Berthier introduces **a second tier**: one exec per workspace (the meta), N execs per workspace (one per lane). The role-conflict guard from the earlier lane-management MVP needs to know about this tier so it does not reject promoting a session as meta when it is already a lane exec — *that combination should be allowed*, because in practice David may want to promote a Claude session as both. Or it may want to be forbidden (forces clean separation). Flag for David's call during implementation; either rule is defensible.

## Recommended next moves

The smallest first-ship of meta-Berthier that delivers value is **read-only, single-endpoint, no write surface, no suggestion queue**. Concretely:

1. **Ship \`GET /api/operator-studio/meta/all-lanes-snapshot\` only.** Skip cross-lane-conflicts and stale-lanes for v1; both are cheap derivations meta-Berthier can compute in-context from the snapshot.
2. **Ship a system-prompt template** \`lib/operator-studio/meta-berthier-prompt.ts\` that promotes a Claude session as workspace meta-exec. The template tells the session: hit the snapshot endpoint at the start of every turn, summarize the workspace state in markdown (per the markdown-summaries doctrine), surface the top 1–3 things David should care about. No suggestion schema yet — meta-Berthier just *talks* about lanes; David acts.
3. **Defer the suggestion queue table** until v2. The phone surface in v1 is just "the meta-Berthier session itself, opened on phone." This dogfoods the same chat surface for both lane Berthiers and meta-Berthier — exactly the point of the same-kind architecture.
4. **Defer the role-conflict tier-2 question** until v2. v1 promotes meta-Berthier as a brand-new Claude session, so there is no conflict to resolve.

### Implementation card scope (David creates, not the worker)

Recommended title: *Meta-Berthier v1: workspace-scoped all-lanes snapshot endpoint + system-prompt template*. Estimated single-worker scope. Acceptance: snapshot endpoint returns the documented shape against a synthetic workspace with 2 lanes, prompt template loads cleanly, no UI yet.

### Out of v1

- Suggestion queue table, suggestion approval UI on phone.
- \`cross-lane-conflicts\` and \`stale-lanes\` endpoints (compute in-context from snapshot until a model context cost shows up).
- Tier-2 role-conflict rule for meta + lane exec on the same session.
- Cross-workspace meta-meta-Berthier. Real, but not now.
`

async function main() {
  const entry = await upsertEntry(GLOBAL_WORKSPACE_ID, {
    id: ENTRY_ID,
    entryType: "concept",
    stability: "draft",
    title: "Meta-Berthier — Orchestrator-of-Orchestrators Design",
    summary:
      "Meta-Berthier is a Berthier-shape executive that watches every active work lane in a workspace and surfaces a 30,000-foot view of cross-lane state. Read-only; suggestions only; same agent kind as a lane Berthier with a different system prompt and connector scope.",
    bodyMarkdown: BODY,
    tags: [
      "meta-berthier",
      "work-lanes",
      "orchestration",
      "cockpit",
      "discovery",
      "design",
    ],
    relatedEntryIds: [],
  })
  console.log(`Upserted KB entry: ${entry.id} (body=${entry.bodyMarkdown?.length ?? 0} chars)`)
}

await main()
await getPgPool().end()
