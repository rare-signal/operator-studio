/**
 * Seed the CMG/JSA software factory battle-test scope KB entry.
 *
 *   pnpm tsx scripts/seed-cmg-jsa-battle-test-scope-kb.ts
 *
 * Idempotent — re-running upserts the entry. Discovery output for
 * `step-cmg-jsa-battle-test-discovery` per
 * `scripts/spawn-cmg-jsa-discovery-worker.ts`.
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

const ENTRY_ID = "kb-2026-05-10-cmg-jsa-battle-test-scope"

const BODY = `# CMG/JSA Software Factory — Battle-Test Scope

## TL;DR

The "software factory" is the loop where an ADO ticket from CMG (or a Teams signal from Telegento stakeholders) lands in Operator Studio, gets triaged, routes to a JSA-flavored Berthier executive, spawns worker agents against the Telegento codebase, stages outbound replies (ADO comment, Teams post) behind David's keys, and closes the loop with a visible "what shipped" trail.

**What the battle test IS:** end-to-end exercise of ONE real ADO ticket from intake → triage → spawned worker → David-approved outbound — proving each handoff works against synthetic-safe data on the existing scaffolding.

**What it IS NOT:** building the JSA per-agent portal generator (that's the C5 lane), shipping new Telegento product features, or wiring auto-send. Outbound stays gated.

**Smallest first ship that demonstrates the loop:** pick one already-ingested ADO work-item from the operator inbox, run \`pnpm os:ado-triage\`, promote one bucket-item into a spawned worker via the cockpit Berthier rail, let it draft an ADO comment, route through \`outbound-gate\`, and post via a (still-stubbed) Teams notifier that David approves. Every node already exists except the Teams writer; that gap is the headline finding below.

## Existing surface inventory

ADO ingest + triage (live, dogfooded today):

- \`lib/operator-studio/ingest/ado-poller.ts\` — \`az\` CLI shell-out + \`ADO_PAT\` comment fetch against \`dev.azure.com/ClarifyingMarketingGroup\` / project \`IT\`. Works; depends on local \`az\` auth and optional PAT.
- \`lib/operator-studio/ingest/ado-read-model.ts\` — persists work-item + comment snapshots into the inbox tables.
- \`lib/operator-studio/ingest/ado-scheduler.ts\` — 5-min background poll, opt-in via \`OPERATOR_STUDIO_ADO_AUTOPOLL=true\`. Single hardcoded factory \`factory-clarifying-telegento\` + workspace \`global\`.
- \`lib/operator-studio/ado-triage.ts\` — heuristic bucketing into \`quick_lift\` / \`investigation\` / \`in_motion\` with suggested next move per item.
- \`lib/operator-studio/ado-keyed-intake.ts\` — L5 keyed-intake bundle builder for a single work-item id (comments, related work, git log).
- \`app/api/operator-studio/ado/[id]/route.ts\` — read-only HTTP wrapper around \`buildAdoIntakeBundle\`.
- \`pnpm os:ado\` and \`pnpm os:ado-triage\` — operator CLIs over the same primitives.

Teams (signals manifested, no live ingest, no writer):

- \`lib/operator-studio/signal-intake/teams-manifest.ts\` — \`TELEGENTO_TEAMS_CHANNELS\` constant with 4 channels (Feedback, Lead Disputes, Misc System Alerts, Performance), real \`groupId\` / \`tenantId\` / \`channelId\` / \`webUrl\`.
- \`lib/operator-studio/signal-intake/teams-seed.ts\` — hand-curated \`SignalCandidate[]\` fixtures (Mitch / Robert / Micky feedback as of 2026-05-05). Used by signal-intake UI today.
- \`app/api/operator-studio/signal-intake/route.ts\` — pulls the seeded list; not a live Graph poll.
- \`lib/operator-studio/outbound-gate.ts\` — \`teams.postMessage\` is enumerated as a verb-noun pair, but no implementer is registered.
- \`app/api/operator-studio/outbound/route.ts\` — accepts \`surface: "teams"\` and stages the queue row, but there is no Teams writer downstream.

JSA lane structure (read-only, do not mutate):

- Plan \`plan-clarifying-media-group-telegento\` (142 cards) holds the surface area. JSA-specific bucket: \`step-cmg-jsa-product\` with children C1–C10.
  - C1 plug toolkit into Justin's 1099 post-licensure agent-onboarding site.
  - C4 scrape Justin's site → Justin-Searcy context pack.
  - C5 per-agent turn-key portal generator (the headline C-lane deliverable).
  - C6 insurance template menagerie (CodePen MIT seed, AI-tailored).
  - C7 tiered offering (standard library vs generative credits).
  - C8 compliance lattice (2026 CMS TPMO + MA/PDP rules).
  - C10 Justin → Gary demo arc.
- Adjacent: \`step-cmg-telegento-pipeline\` (the data plane: transcribe → enrich → insight Lambda → Aurora), \`step-cmg-telegento-product\` (the Telegento UI), \`step-cmg-telegento-demo-readiness\` (Mitch / Mickey onboarding), \`step-cmg-cd-safety\` (gating prod merges).
- \`scripts/seed-software-factory-nucleus.ts\` — the 2026-05-08 brief seeded as KB doctrine + plan steps; reference for "what the factory is supposed to be."

Cockpit / Berthier executive scaffolding (already powers other lanes):

- \`lib/operator-studio/thread-card-bindings.ts\` — binds a spawned worker thread to a plan step + records \`spawnedByAgentId\` / \`spawnOrigin\`. Already used by every \`scripts/spawn-*-worker.ts\`.
- \`scripts/spawn-cmg-jsa-discovery-worker.ts\` — this very spawn; exists, runs, binds. Reusable pattern for next worker.
- \`COCKPIT_EXEC_AGENT_ID\` — env-overridden executive Berthier id, currently the shared cockpit exec. No JSA-flavored Berthier yet.

## The end-to-end loop we're battle-testing

Concrete narrative, with works-today vs aspirational annotated per step:

1. **Signal lands.** ADO ticket arrives in CMG/IT (or Teams message in Telegento Feedback channel).
   - Works today: ADO poller ingests every 5 min when autopoll is on; \`os:ado\` for ad-hoc.
   - Aspirational: live Teams ingest. Today only the seeded snapshot exists.
2. **Triage compresses noise.** \`ado-triage.ts\` bucket + reason + suggested-action; signal-intake list for Teams.
   - Works today for ADO. Teams side is a static fixture.
3. **JSA-Berthier executive picks one up.** A lane Berthier (scoped to \`step-cmg-jsa-product\` membership) reads the triage report, picks the lift, drafts the worker brief.
   - Aspirational: no JSA-flavored exec yet — the cockpit exec is generic and not scoped to the JSA lane membership.
4. **Worker spawn.** \`createNewAppSessionAndSend\` opens a Claude/Codex desktop session; \`upsertThreadCardBinding\` records the plan-step + spawn origin.
   - Works today; this very worker is proof.
5. **Worker ships.** Worker writes code in Operator Studio (or in the Telegento subtree), runs \`pnpm typecheck\`, drafts an acceptance script, posts task_done.
   - Works today.
6. **Outbound staging.** Reply is enqueued via \`POST /api/operator-studio/outbound\` with \`surface: "ado"\` or \`"teams"\` + verb-noun action; \`outbound-gate\` records, waits for David key.
   - Works today for ADO. Teams \`postMessage\` is enumerated but has no downstream writer.
7. **David approves → send.** Outbound writer is invoked, comment lands on the ticket, Teams post lands in the channel; the binding is closed.
   - Works today for ADO. Teams send is the headline gap.
8. **Visible close.** Cockpit shows the worker's task_done parrot, the ADO/Teams send confirmation, and the plan-step status flip.
   - Works today for ADO/plan-step; Teams confirmation surface is missing.

## Gaps blocking the battle test

Each gap below is a concrete blocker on running the loop end-to-end with one real ticket. Fix proposals are scoped to the smallest correct change, not the larger product vision.

1. **No Teams writer.** \`outbound-gate\` and the outbound route both enumerate \`teams.postMessage\` but no \`lib/operator-studio/outbound-teams.ts\` exists.
   - Fix: stub \`postTeamsMessage({ channelId, body })\` against Microsoft Graph \`/teams/{groupId}/channels/{channelId}/messages\` using the same \`groupId\` / \`tenantId\` already in \`teams-manifest.ts\`. App-only auth via a Graph app registration the CMG tenant admin can grant. Synthetic-only smoke against a dedicated "Operator Studio sandbox" channel before pointing at Feedback.
2. **No live Teams ingest.** \`teams-seed.ts\` is a hand-curated fixture; the signal-intake list never refreshes from Graph.
   - Fix: add \`lib/operator-studio/ingest/teams-poller.ts\` modeled on \`ado-poller.ts\` — pull recent messages from each \`TELEGENTO_TEAMS_CHANNELS\` entry via Graph delta queries, persist into the inbox tables. Scheduler env flag \`OPERATOR_STUDIO_TEAMS_AUTOPOLL\`.
3. **No JSA-flavored Berthier executive.** \`COCKPIT_EXEC_AGENT_ID\` is a generic cockpit exec; nothing scopes its reads to \`step-cmg-jsa-product\` membership or biases its suggested-action set to insurance/JSA doctrine.
   - Fix: promote a lane-scoped Berthier on \`step-cmg-jsa-product\` (use existing exec-anointing flow that landed 2026-05-08 in \`91a8ccf\` / \`9f1e2fe\`), bind it via lane membership, give it a JSA system prompt that references the C-lane KB and the 2026 CMS compliance lattice.
4. **ADO autopoll is hardcoded to a single factory + workspace.** \`ado-scheduler.ts\` hardwires \`factory-clarifying-telegento\` / \`global\`.
   - Fix: low priority for the battle test (one factory is enough) — note for after the loop closes.
5. **No "battle test" trace surface.** The cockpit has lane rails + task_done parrots, but nothing renders the specific shape "ticket X → worker Y → outbound Z → confirmation W" as a single trace for after-action review.
   - Fix: a thin read-only \`/work/factory-trace/[adoId]\` page joining \`operator_inbox_events\` + thread-card bindings + outbound-gate rows + plan-step status. Deferred unless David wants it in the first ship.

## Risks + open questions

- **Teams Graph app registration ownership.** Posting requires either an app registration with \`ChannelMessage.Send\` (app-only, needs CMG tenant admin grant) or delegated permissions (needs a signed-in user, e.g. David). Which path does David want for the battle test? Delegated is faster to greenlight; app-only is the right long-term answer.
- **Outbound key custody.** \`outbound-gate\` already enforces David-key approval. Verify the key story works the same for Teams as it does for ADO before pointing at a real channel.
- **Synthetic-only safety.** Battle-test smoke must post to a sandbox Teams channel and a sandbox ADO work-item, not Feedback or a live IT ticket. Confirm a sandbox exists (or carve one) before the first send.
- **JSA lane scope creep.** It is tempting to fold the C5 portal generator into the battle test. Don't. The battle test is the loop, not the C5 deliverable; the loop existing is what unblocks C5.
- **Prod-vs-staging considerations.** Telegento itself runs on App Runner with real CMG transcripts. The factory must never write code that ships outside the worker's local branch without David's explicit merge — re-confirm \`step-cmg-cd-safety\` is the gate.
- **Open question — which ticket?** David hasn't named the specific ADO work-item to use for the battle test. Picking one is a precondition; suggest \`os:ado-triage\` against the current inbox to choose.

## Recommended implementation cards

Ranked by leverage (highest first). David greenlights what to spawn — these are proposals, not commitments.

1. **Title:** Teams writer — \`outbound-teams.ts\` against Microsoft Graph
   **Rationale:** the single biggest gap. Without this, the loop's outbound leg is half-closed. Smallest correct version is a stub that posts to one sandbox channel; the existing outbound-gate enum entry already reserves the slot.
   **Dependencies:** Graph app registration decision (app-only vs delegated). Tenant admin grant if app-only.
2. **Title:** JSA-flavored Berthier executive anointed on \`step-cmg-jsa-product\`
   **Rationale:** the factory needs an executive that knows it's the JSA lane — different doctrine (CMS compliance lattice, Justin → Gary demo arc) than generic cockpit exec.
   **Dependencies:** none — exec-anointing landed 2026-05-08. System prompt seed only.
3. **Title:** Battle-test rehearsal — one real ADO ticket end-to-end against sandbox Teams channel
   **Rationale:** the actual battle test. Picks a triaged ticket, spawns a worker, drafts ADO comment + Teams post, runs through David-key approval, lands sends in sandbox. Closes the loop once.
   **Dependencies:** cards 1 and 2 above; David picks the ticket; sandbox channel exists.
4. **Title:** Teams live ingest — \`teams-poller.ts\` modeled on \`ado-poller.ts\`
   **Rationale:** retires the static \`teams-seed.ts\` fixture so Feedback / Lead Disputes signals are real-time. Symmetric with ADO; same scheduler shape.
   **Dependencies:** Graph app registration (shared with card 1). Inbox table migration if message snapshots need new columns.
5. **Title:** Factory trace surface — read-only \`/work/factory-trace/[adoId]\`
   **Rationale:** after-action review for the first battle test and every one after. Currently the loop's history is scattered across inbox events, bindings, outbound rows.
   **Dependencies:** none beyond existing tables. Can ship after the first rehearsal as the after-action capture surface.
6. **Title:** Multi-factory ADO scheduler — un-hardcode \`factory-clarifying-telegento\` / \`global\`
   **Rationale:** lower leverage today (one factory is enough for the battle test) but unlocks the CMG-vs-other-tenants story Justin's portal generator will need.
   **Dependencies:** factory registry shape — defer until after the first send lands.
7. **Title:** Sandbox provisioning — dedicated Teams channel + ADO test work-item
   **Rationale:** safety prerequisite for card 3. Cheap; just needs the channel created and a placeholder ticket filed. May already exist — verify before creating.
   **Dependencies:** none.

## Provenance

Spawned 2026-05-10 by \`scripts/spawn-cmg-jsa-discovery-worker.ts\` per David's "80% of compute" directive. Discovery only — no implementation, no cards auto-created, no production scope mutated.
`

async function main() {
  await upsertEntry(GLOBAL_WORKSPACE_ID, {
    id: ENTRY_ID,
    entryType: "report",
    stability: "draft",
    title: "CMG/JSA Software Factory — Battle-Test Scope",
    summary:
      "Scoping report for the CMG/JSA software factory battle test: existing surface inventory (ADO ingest + triage + outbound, Teams signals manifested but no writer/ingest, JSA lane structure), the end-to-end loop, gaps blocking the test (no Teams writer is the headline), risks, and ranked implementation-card proposals.",
    bodyMarkdown: BODY,
    tags: [
      "cmg",
      "jsa",
      "software-factory",
      "battle-test",
      "discovery",
      "ado",
      "teams",
      "berthier",
    ],
    sourcePassageIds: [],
    citations: [],
    metadata: {
      planStepId: "step-cmg-jsa-battle-test-discovery",
      planId: "plan-1777793035871-dkq1b8",
      surfacedBy: "David",
      surfacedAt: "2026-05-10",
    },
  })
  console.log(`upserted ${ENTRY_ID} (body ${BODY.length} chars)`)
}

try {
  await main()
} finally {
  await getPgPool().end()
}
