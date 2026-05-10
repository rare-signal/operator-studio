/**
 * Phase 2 of the plan-cleanup field report.
 *
 * Reads the field report at scripts/data/plan-cleanup-field-report-2026-05-09.md
 * and executes the proposed plan moves in a single transaction.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-plans-2026-05-09.ts          # dry-run, prints plan
 *   pnpm tsx scripts/cleanup-plans-2026-05-09.ts --apply  # commit changes
 */
import { Pool, type PoolClient } from "pg"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env.local" })

const APPLY = process.argv.includes("--apply")

const PLAN_OS = "plan-1777793035871-dkq1b8"
const PLAN_VAL = "plan-valikharlia-agentic-studio-buildout"
const PLAN_CMG = "plan-clarifying-media-group-telegento"
const PLAN_OSS_DRAFT = "plan-draft-t-1776930795204"
const TRASH_PLANS = [
  "plan-draft-global-1776926241051",
  "plan-session-t-2026-04-22T18-15",
  PLAN_OSS_DRAFT,
]

const OS_BUCKETS: Array<{ id: string; title: string }> = [
  {
    id: "step-os-software-factory-spine",
    title: "OS Software Factory spine (F1–F13 + factory plumbing)",
  },
  {
    id: "step-os-agent-orchestration",
    title: "OS Agent orchestration — executive loop, launchers, transports",
  },
  {
    id: "step-os-operations-desk",
    title: "OS Operations desk — bento, mobile cockpit, fallow, executive ops",
  },
  {
    id: "step-os-idea-gravity",
    title: "OS Idea Gravity — semantic surfacing + worker continuation",
  },
  {
    id: "step-os-product-launch-media",
    title: "OS Product launch media factory",
  },
  {
    id: "step-os-context-and-recency",
    title: "OS Context + recency — agent context unfold, hydration, fast state",
  },
]

const CMG_BUCKETS: Array<{ id: string; title: string }> = [
  {
    id: "step-cmg-jsa-product",
    title: "Justin Searcy alliance + per-agent portal generator",
  },
  {
    id: "step-cmg-telegento-pipeline",
    title: "Telegento data pipeline — recording → transcript → enrichment → AI",
  },
  {
    id: "step-cmg-telegento-product",
    title: "Telegento product — agentic loop, factory delivery, parallel lane",
  },
  {
    id: "step-cmg-telegento-demo-readiness",
    title: "Telegento demo-day readiness + ADO/Teams + Gemini lab",
  },
  {
    id: "step-cmg-cd-safety",
    title: "Telegento CD safety rails",
  },
]

// ── OS-era → CMG: lane heads to retire after reparenting children ─────
const OS_ERA_CMG_LANE_MOVES: Array<{
  oldHead: string
  newBucket: string
}> = [
  // Process inner lanes first so step-C only sees its remaining direct
  // children (C1–C10) when its turn comes.
  { oldHead: "step-C-pipeline", newBucket: "step-cmg-telegento-pipeline" },
  { oldHead: "step-C-cd", newBucket: "step-cmg-cd-safety" },
  { oldHead: "step-C", newBucket: "step-cmg-jsa-product" },
  { oldHead: "step-E", newBucket: "step-cmg-telegento-product" },
  { oldHead: "step-H", newBucket: "step-cmg-telegento-demo-readiness" },
]

// ── Valikharlia card classification ───────────────────────────────────
//
// Returns null = card stays in Valikharlia plan (game engine).
// Returns { plan, bucket } for explicit moves.
type Move = { plan: "OS" | "CMG"; bucket: string }

const VAL_OVERRIDES: Record<string, Move | null> = {
  // Game-engine keepers — explicit
  "step-side-game-engine-lane": null,

  // Software-factory split: parent → CMG, the 13 children → OS
  "step-software-factory-clarifying-telegento": {
    plan: "CMG",
    bucket: "step-cmg-telegento-product",
  },

  // Telegento temporal preview — orphaned by software-factory split
  "step-telegento-temporal-preview-dimension": {
    plan: "CMG",
    bucket: "step-cmg-telegento-product",
  },

  // OS roadmap-class meta cards
  "step-operator-studio-audio-event-engine": { plan: "OS", bucket: "step-B" },
  "step-operator-studio-plan-snapshot-duplicate": { plan: "OS", bucket: "step-B" },
  "step-operator-studio-plan-sprawl-merge-cleanup": { plan: "OS", bucket: "step-B" },
  "step-operator-studio-work-work-priority-model": { plan: "OS", bucket: "step-B" },
  "step-plan-merge-backup-and-sprawl-cleanup": { plan: "OS", bucket: "step-B" },
  "step-plan-sprawl-inventory-merge-prune": { plan: "OS", bucket: "step-B" },
  "step-plan-card-list-cli": { plan: "OS", bucket: "step-B" },
  "step-binding-detach-reason-column": { plan: "OS", bucket: "step-os-operations-desk" },

  // Teams graph child of telegento-ado lane — moves with that lane to CMG
  "step-teams-graph-readonly": { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" },

  // Cockpit-class cards → operations desk
  "step-cockpit-collapse-back-affordance": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cockpit-history-anchor-on-last-user-message": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cockpit-lane-management-mvp": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cockpit-review-status-on-worker-rows": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cockpit-show-worker-numbers-on-rows": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cockpit-spawned-by-recency-independence": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cockpit-split-view-routing-bug": { plan: "OS", bucket: "step-os-operations-desk" },

  "step-exec-chip-system": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-exec-chip-system-v2": { plan: "OS", bucket: "step-os-operations-desk" },

  // Specifically-called-out moves
  "step-active-work-context-scope-routing": { plan: "OS", bucket: "step-os-context-and-recency" },
  "step-claude-compact-context-hydration": { plan: "OS", bucket: "step-os-context-and-recency" },
  "step-fast-operator-state-cli": { plan: "OS", bucket: "step-os-context-and-recency" },
  "step-os-hydrate-factory-scope-resolution": { plan: "OS", bucket: "step-os-context-and-recency" },
  "step-operator-studio-recency-context-front-door": { plan: "OS", bucket: "step-os-context-and-recency" },
  "step-wayseer-fallow-next-prompt-engine": { plan: "OS", bucket: "step-os-context-and-recency" },
  "step-recency-first-agent-context": { plan: "OS", bucket: "step-os-context-and-recency" },

  "step-worker-continuation-detector": { plan: "OS", bucket: "step-os-idea-gravity" },

  "step-autolink-urls-in-chat-components": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-autonomous-claude-launch-flow": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-autonomy-policy-bounds": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-claude-berthier-backend-spike": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-claude-berthier-opstu-spawn-battle-test": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-coverage-provenance-hardening": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-cross-machine-agent-thread-sharing-spike": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-david-review-queue-category": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-factory-package-review-fixes": { plan: "OS", bucket: "step-os-software-factory-spine" },
  "step-fallow-next-prompt-pane-footer-ui": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-fallow-thread-opportunity-cost-visuals": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-fallow-thread-sla-policy": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-first-class-cli-agent-sources": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-hide-unready-today-rail": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-hot-mode-leakage-alarm-and-focus-guard": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-launch-wave-ledger-all-agent-sources": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-live-token-piggyback-experiment": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-lm-studio-planner-backend-spike": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-local-hermes-router-agent-evaluation": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-ops-dream-paradise-hygiene-pass": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-outbox-smoke-row-cleanup": { plan: "OS", bucket: "step-os-software-factory-spine" },
  "step-runway-compute-planner": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-session-aware-agent-start-contract": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-sound-attention-layer": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-thread-quality-flags-slop-session": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-agent-startup-tool-manifest": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-executive-ops-philosophy-alignment-pass": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-executive-observation-tap-in-policy": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-executive-three-lane-operating-snapshot": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-executive-planning-thread-water-spider-loop": { plan: "OS", bucket: "step-os-agent-orchestration" },
  "step-operations-kb-lane-links": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operations-lane-classification": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operations-live-event-feed": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operations-mobile-first-experience": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operations-object-model-reset": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operations-passage-evidence-attach": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operations-schema-status-flags": { plan: "OS", bucket: "step-os-operations-desk" },
  "step-operator-studio-timeline-story-surface": { plan: "OS", bucket: "step-os-operations-desk" },
}

// ── Prefix rules — applied if no override matches ────────────────────
// First-match wins. Each rule says where the entire prefix family goes.
const PREFIX_RULES: Array<{
  prefix: string
  move: Move | "KEEP" // KEEP = stay in Valikharlia
}> = [
  { prefix: "step-valikharlia-", move: "KEEP" },

  // Telegento subtree → CMG
  { prefix: "step-telegento-agentic-loop-", move: { plan: "CMG", bucket: "step-cmg-telegento-product" } },
  { prefix: "step-telegento-ado-", move: { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" } },
  { prefix: "step-telegento-gemini-", move: { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" } },
  { prefix: "step-telegento-preview-", move: { plan: "CMG", bucket: "step-cmg-telegento-product" } },
  { prefix: "step-telegento-protected-preview-", move: { plan: "CMG", bucket: "step-cmg-telegento-product" } },
  { prefix: "step-telegento-csv-", move: { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" } },
  { prefix: "step-telegento-lambda-", move: { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" } },
  { prefix: "step-telegento-lead-vendor-", move: { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" } },
  { prefix: "step-telegento-work-work-", move: { plan: "CMG", bucket: "step-cmg-telegento-demo-readiness" } },
  { prefix: "step-telegento-", move: { plan: "CMG", bucket: "step-cmg-telegento-product" } },

  // Software-factory non-clarifying → OS spine
  { prefix: "step-software-factory-", move: { plan: "OS", bucket: "step-os-software-factory-spine" } },

  // Agent / berthier → OS agent orchestration
  { prefix: "step-berthier-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-claude-berthier-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-agent-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-backend-registry-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-agent-loop", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-agent-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-cycle-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-decision-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-planner-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-planning-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-thread-", move: { plan: "OS", bucket: "step-os-agent-orchestration" } },
  { prefix: "step-executive-", move: { plan: "OS", bucket: "step-os-operations-desk" } },

  // Bento / mobile cockpit / operations / tactical → operations desk
  { prefix: "step-bento-", move: { plan: "OS", bucket: "step-os-operations-desk" } },
  { prefix: "step-mobile-executive-cockpit", move: { plan: "OS", bucket: "step-os-operations-desk" } },
  { prefix: "step-mobile-cockpit-", move: { plan: "OS", bucket: "step-os-operations-desk" } },
  { prefix: "step-tactical-operations-", move: { plan: "OS", bucket: "step-os-operations-desk" } },
  { prefix: "step-operations-", move: { plan: "OS", bucket: "step-os-operations-desk" } },
  { prefix: "step-fallow-", move: { plan: "OS", bucket: "step-os-operations-desk" } },

  // Idea gravity
  { prefix: "step-idea-gravity-", move: { plan: "OS", bucket: "step-os-idea-gravity" } },

  // Product launch media
  { prefix: "step-product-launch-media-", move: { plan: "OS", bucket: "step-os-product-launch-media" } },

  // Context / recency
  { prefix: "step-recency-", move: { plan: "OS", bucket: "step-os-context-and-recency" } },

  // ADO intake nucleus → software factory spine (per field report — alternative bucket)
  { prefix: "step-ado-", move: { plan: "OS", bucket: "step-os-software-factory-spine" } },

  // Operator-studio-prefixed → step-B fallback
  { prefix: "step-operator-studio-", move: { plan: "OS", bucket: "step-B" } },
  { prefix: "step-operator-", move: { plan: "OS", bucket: "step-os-operations-desk" } },
]

function classifyValCard(id: string): Move | null {
  if (id in VAL_OVERRIDES) return VAL_OVERRIDES[id]!
  for (const rule of PREFIX_RULES) {
    if (id.startsWith(rule.prefix)) {
      return rule.move === "KEEP" ? null : rule.move
    }
  }
  // Unknown — surface so we can decide
  return { plan: "OS", bucket: "__UNKNOWN__" }
}

interface CardRow {
  id: string
  plan_id: string
  workspace_id: string
  parent_step_id: string | null
  status: string
  title: string
}

const PROVENANCE_LINE = (src: string, dst: string) =>
  `\n\n> _2026-05-10 plan-cleanup: moved from ${src} to ${dst} per scripts/data/plan-cleanup-field-report-2026-05-09.md._`

async function fetchAllActive(client: PoolClient): Promise<CardRow[]> {
  const r = await client.query(
    `SELECT id, plan_id, workspace_id, parent_step_id, status, title
       FROM operator_plan_steps
      WHERE deleted_at IS NULL
      ORDER BY plan_id, id`
  )
  return r.rows
}

async function descendantsOf(
  client: PoolClient,
  planId: string,
  rootId: string
): Promise<string[]> {
  // Walk children iteratively so we collect deep descendants.
  const r = await client.query<CardRow>(
    `SELECT id, plan_id, workspace_id, parent_step_id, status, title
       FROM operator_plan_steps
      WHERE plan_id = $1 AND deleted_at IS NULL`,
    [planId]
  )
  const byParent = new Map<string | null, string[]>()
  for (const row of r.rows) {
    const p = row.parent_step_id
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(row.id)
  }
  const out: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()!
    const kids = byParent.get(cur) ?? []
    for (const k of kids) {
      out.push(k)
      stack.push(k)
    }
  }
  return out
}

async function ensurePlan(client: PoolClient): Promise<void> {
  const r = await client.query(
    `SELECT id FROM operator_plans WHERE id = $1`,
    [PLAN_CMG]
  )
  if (r.rowCount && r.rowCount > 0) return
  console.log(`[cmg] creating plan ${PLAN_CMG}`)
  if (!APPLY) return
  await client.query(
    `INSERT INTO operator_plans
       (id, workspace_id, title, goal, outcome, state, pinned,
        created_by, created_at, updated_at)
     VALUES ($1, 'global', $2, $3, $4, 'active', 0,
             'plan-cleanup-2026-05-10', NOW(), NOW())`,
    [
      PLAN_CMG,
      "Clarifying Media Group + Telegento",
      "Ship Telegento + the JSA / per-agent portal product line as one durable plan.",
      "JSA agent-onboarding + Telegento pipeline + Telegento product land in front of paying stakeholders.",
    ]
  )
}

async function ensureBucket(
  client: PoolClient,
  planId: string,
  bucket: { id: string; title: string },
  workspaceId: string
): Promise<void> {
  const r = await client.query(
    `SELECT id FROM operator_plan_steps WHERE id = $1`,
    [bucket.id]
  )
  if (r.rowCount && r.rowCount > 0) {
    // If already exists, ensure its parent is null (top-level) and plan_id is right
    if (APPLY) {
      await client.query(
        `UPDATE operator_plan_steps
            SET plan_id = $1, workspace_id = $2, parent_step_id = NULL,
                deleted_at = NULL, updated_at = NOW()
          WHERE id = $3`,
        [planId, workspaceId, bucket.id]
      )
    }
    return
  }
  console.log(`[bucket] creating ${bucket.id} in ${planId}`)
  if (!APPLY) return
  await client.query(
    `INSERT INTO operator_plan_steps
       (id, plan_id, workspace_id, title, description, step_order,
        status, parent_step_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 0, 'open', NULL, NOW(), NOW())`,
    [
      bucket.id,
      planId,
      workspaceId,
      bucket.title,
      `> _2026-05-10 plan-cleanup: bucket card created per scripts/data/plan-cleanup-field-report-2026-05-09.md._`,
    ]
  )
}

async function moveCard(
  client: PoolClient,
  ids: string[],
  destPlan: string,
  destWorkspace: string,
  newParentForDirectChildren: { directParentId: string; bucketId: string } | null,
  srcLabel: string,
  dstLabel: string
): Promise<void> {
  if (ids.length === 0) return
  if (!APPLY) return
  await client.query(
    `UPDATE operator_plan_steps
        SET plan_id = $1,
            workspace_id = $2,
            description = COALESCE(description,'') || $3,
            updated_at = NOW()
      WHERE id = ANY($4::text[])`,
    [destPlan, destWorkspace, PROVENANCE_LINE(srcLabel, dstLabel), ids]
  )
  if (newParentForDirectChildren) {
    // Reparent any card whose current parent is the directParentId → bucketId
    await client.query(
      `UPDATE operator_plan_steps
          SET parent_step_id = $1, updated_at = NOW()
        WHERE id = ANY($2::text[])
          AND parent_step_id = $3`,
      [
        newParentForDirectChildren.bucketId,
        ids,
        newParentForDirectChildren.directParentId,
      ]
    )
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const allBefore = await fetchAllActive(client)
    console.log(`[before] ${allBefore.length} active cards across all plans`)

    // ── 1) Create CMG plan + all bucket cards ──────────────────────
    await ensurePlan(client)
    for (const b of OS_BUCKETS) await ensureBucket(client, PLAN_OS, b, "global")
    for (const b of CMG_BUCKETS) await ensureBucket(client, PLAN_CMG, b, "global")

    // ── 2) OS-era → CMG: process from deepest lane heads outward ──
    // Order: pipeline + cd first (children of step-C), then C itself, then E, H.
    for (const { oldHead, newBucket } of OS_ERA_CMG_LANE_MOVES) {
      const desc = await descendantsOf(client, PLAN_OS, oldHead)
      const allMoving = [oldHead, ...desc]
      console.log(
        `[os→cmg] lane ${oldHead} → ${newBucket}: ${allMoving.length} cards`
      )
      // Move all to CMG
      await moveCard(
        client,
        desc,
        PLAN_CMG,
        "global",
        { directParentId: oldHead, bucketId: newBucket },
        PLAN_OS,
        PLAN_CMG
      )
      // Soft-delete the old lane head
      if (APPLY) {
        await client.query(
          `UPDATE operator_plan_steps
              SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1`,
          [oldHead]
        )
      }
    }

    // ── 3) Valikharlia → OS / CMG / KEEP ───────────────────────────
    const valCards = allBefore.filter((c) => c.plan_id === PLAN_VAL)
    const movesByDest = new Map<
      string,
      { plan: string; bucket: string; ids: string[] }
    >()
    const keep: CardRow[] = []
    const unknowns: CardRow[] = []

    for (const card of valCards) {
      const m = classifyValCard(card.id)
      if (m === null) {
        keep.push(card)
        continue
      }
      if (m.bucket === "__UNKNOWN__") {
        unknowns.push(card)
        continue
      }
      const key = `${m.plan}::${m.bucket}`
      if (!movesByDest.has(key)) {
        movesByDest.set(key, {
          plan: m.plan === "OS" ? PLAN_OS : PLAN_CMG,
          bucket: m.bucket,
          ids: [],
        })
      }
      movesByDest.get(key)!.ids.push(card.id)
    }

    if (unknowns.length > 0) {
      console.error("[val] UNCLASSIFIED CARDS — aborting")
      for (const u of unknowns) console.error(`  ${u.id}  // ${u.title}`)
      throw new Error(`${unknowns.length} unclassified Valikharlia card(s)`)
    }

    console.log(
      `[val] keep=${keep.length}, moving=${valCards.length - keep.length}`
    )
    // Apply Valikharlia moves: each card → target plan, parent = bucket
    for (const [key, group] of movesByDest) {
      console.log(`[val→${key}] ${group.ids.length} cards`)
      if (APPLY) {
        await client.query(
          `UPDATE operator_plan_steps
              SET plan_id = $1,
                  workspace_id = 'global',
                  parent_step_id = $2,
                  description = COALESCE(description,'') || $3,
                  updated_at = NOW()
            WHERE id = ANY($4::text[])`,
          [
            group.plan,
            group.bucket,
            PROVENANCE_LINE(PLAN_VAL, group.plan),
            group.ids,
          ]
        )
      }
    }

    // ── 4) Status normalization on Valikharlia keepers ─────────────
    if (APPLY) {
      const statusMap: Array<[string, string]> = [
        ["done", "covered"],
        ["todo", "open"],
        ["in_progress", "in-motion"],
      ]
      for (const [from, to] of statusMap) {
        const r = await client.query(
          `UPDATE operator_plan_steps
              SET status = $1, updated_at = NOW()
            WHERE plan_id = $2 AND status = $3 AND deleted_at IS NULL`,
          [to, PLAN_VAL, from]
        )
        console.log(`[val-status] ${from} → ${to}: ${r.rowCount} cards`)
      }
    }

    // ── 5) plan-draft-t (OSS) → 6 named cards to OS step-B ─────────
    const ossKeepIds = [
      "step-plan-draft-t-1776930795204-1777138610782-0", // Code cleanliness
      "step-plan-draft-t-1776930795204-1777138610782-1", // Finish the plan builder
      "step-plan-draft-t-1776930795204-1777182056768-4", // vidi vici
      "step-plan-draft-t-1776930795204-1777329481066-5", // Hook up Amir
      "step-plan-draft-t-1776930795204-1777329600750-6", // Build the ingestion pipeline
      "step-plan-draft-t-1776930795204-1777335998043-8", // Check for code sanity before sharing
    ]
    console.log(`[oss→os] migrating ${ossKeepIds.length} OSS-draft cards under step-B`)
    if (APPLY) {
      await client.query(
        `UPDATE operator_plan_steps
            SET plan_id = $1,
                workspace_id = 'global',
                parent_step_id = 'step-B',
                description = COALESCE(description,'') || $2,
                updated_at = NOW()
          WHERE id = ANY($3::text[])`,
        [PLAN_OS, PROVENANCE_LINE(PLAN_OSS_DRAFT, PLAN_OS), ossKeepIds]
      )
    }

    // ── 6) Soft-delete trash plans + remaining steps in them ──────
    for (const planId of TRASH_PLANS) {
      console.log(`[trash] archiving plan ${planId}`)
      if (APPLY) {
        await client.query(
          `UPDATE operator_plan_steps
              SET deleted_at = NOW(), updated_at = NOW()
            WHERE plan_id = $1 AND deleted_at IS NULL`,
          [planId]
        )
        await client.query(
          `UPDATE operator_plans
              SET state = 'archived', archived_at = NOW(),
                  pinned = 0, updated_at = NOW()
            WHERE id = $1`,
          [planId]
        )
      }
    }

    // ── 7) Pin OS plan, unpin Valikharlia ─────────────────────────
    if (APPLY) {
      await client.query(
        `UPDATE operator_plans
            SET pinned = CASE WHEN id = $1 THEN 1 ELSE 0 END,
                updated_at = NOW()
          WHERE state IN ('active','drafting','paused')`,
        [PLAN_OS]
      )
    }

    // ── Final sanity check & commit ───────────────────────────────
    const allAfter = await fetchAllActive(client)
    console.log(`[after] ${allAfter.length} active cards across all plans (in-tx)`)

    if (APPLY) {
      await client.query("COMMIT")
      console.log("[commit] applied")
    } else {
      await client.query("ROLLBACK")
      console.log("[rollback] dry-run only; pass --apply to commit")
    }
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("[abort]", err)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
