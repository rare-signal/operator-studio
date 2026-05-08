/**
 * Seed Continuum plan steps into the active dogfood plan.
 *
 * Continuum is a fresh-agent handoff layer for stalled threads — see the
 * step descriptions below. We append it as a new vertical (Lane B) within
 * the existing pinned plan rather than creating a separate plan, matching
 * the dogfood-first convention of one OS plan with multiple lanes.
 *
 * Idempotent: if any step with the `step-B-cont-` prefix already exists,
 * the script exits without mutating.
 *
 * Usage:
 *   pnpm tsx ./scripts/seed-continuum-plan.ts
 *   pnpm tsx ./scripts/seed-continuum-plan.ts --workspace=global --plan-id=<id>
 */

import { and, eq, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

interface CliOptions {
  workspaceId: string
  planId: string | null
}

function parseArgs(argv: string[]): CliOptions {
  let workspaceId = "global"
  let planId: string | null = null
  for (const arg of argv) {
    if (arg.startsWith("--workspace=")) workspaceId = arg.slice("--workspace=".length)
    else if (arg.startsWith("--plan-id=")) planId = arg.slice("--plan-id=".length)
  }
  return { workspaceId, planId }
}

interface SeedStep {
  id: string
  title: string
  description: string
}

const STEPS: SeedStep[] = [
  {
    id: "step-B-cont-0",
    title: "Acceptance test — Continuum the broken PowerPoint thread",
    description:
      "First Continuum proves itself on the broken Claude Code thread titled \"Add new lane for automated web PowerPoint system\". Hitting Continuum on that thread should produce a paste-ready resume prompt + one-screen digest a fresh agent can act on without reading the source thread.",
  },
  {
    id: "step-B-cont-1",
    title: "Schema — operator_continuums table",
    description:
      "Drizzle migration 0021_continuums.sql. Columns: id, workspace_id, source_thread_id, created_at, digest_json, resume_prompt, status (draft|published|consumed), created_by. Indexed by workspace_id + source_thread_id.",
  },
  {
    id: "step-B-cont-2",
    title: "Heuristic digest core — buildContinuumDigest(threadId)",
    description:
      "lib/operator-studio/continuum.ts. Pure (no LLM). Stitches: thread title, last user direction, last assistant move, current session's open plan steps, any cached wayseer rollup beats. Returns a structured digest + a heuristic resume-prompt template. The LLM-drafted version (step 6) is an additive enhancement, not a replacement.",
  },
  {
    id: "step-B-cont-3",
    title: "API — POST /api/operator-studio/continuum + GET [id]",
    description:
      "POST takes a threadId, builds the digest, persists it, returns the handoff. GET [id] returns the published handoff (used by the read-only page). Auth-scoped to workspace.",
  },
  {
    id: "step-B-cont-4",
    title: "\"Continuum this thread\" button on thread detail",
    description:
      "Button in the thread-detail header. Opens a dialog with the digest pane on the left, paste-ready resume prompt on the right, and a break-glass link back to the source thread inside Operator Studio.",
  },
  {
    id: "step-B-cont-5",
    title: "/operator-studio/continuum/[id] read-only page",
    description:
      "Standalone shareable URL — drop this URL into a fresh Claude/Codex agent and it reads the digest + resume prompt without compaction noise. Page also exposes the break-glass link for when the digest isn't enough.",
  },
  {
    id: "step-B-cont-6",
    title: "LLM enhancement — rollup-derived resume prompt",
    description:
      "Replace the heuristic resume prompt with one drafted from the wayseer thread-rollup beats (especially the \"what to carry forward\" beat). Additive layer per the LLM-layering rule — Continuum still works in echo mode without it.",
  },
  {
    id: "step-B-cont-7",
    title: "Digest v2 — active plan snapshot in handoff",
    description:
      "Pull the workspace's pinned active plan into the digest: title, goal, outcome, and OPEN steps grouped by lane (A/B/C…). Lets the fresh agent see where the work sits and which lane the source thread belongs to. No LLM. Bumps digest to version: 2; v1 rows remain readable.",
  },
  {
    id: "step-B-cont-8",
    title: "Digest v2 — coherence-ranked operator framings + recent decisions",
    description:
      "Replace the single \"last user direction\" with three picks scored by extractGoldCandidates: earliest coherent framing, highest-scored direction, most recent. Plus 2–3 explicit decision moments via extractDecisions. Surfaces \"when I wasn't tired\" instead of just the tail.",
  },
  {
    id: "step-B-cont-9",
    title: "Digest v2 — agent spin-up hints + sibling-thread context",
    description:
      "Heuristic spin-up suggestions: for each lane OTHER than the source thread's lane with open in-motion steps, generate a \"kick off a fresh CLI agent for lane X step N\" hint. Plus the top 2 sibling threads in the same time-bracketed session so the fresh agent knows what other work is in flight.",
  },
]

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const db = getDb()

  let targetPlanId = opts.planId
  if (!targetPlanId) {
    const rows = await db
      .select({
        id: operatorPlans.id,
        title: operatorPlans.title,
        pinned: operatorPlans.pinned,
        state: operatorPlans.state,
        updatedAt: operatorPlans.updatedAt,
      })
      .from(operatorPlans)
      .where(
        and(
          eq(operatorPlans.workspaceId, opts.workspaceId),
          eq(operatorPlans.state, "active")
        )
      )
    const pinned = rows.filter((r) => r.pinned === 1)
    const candidate =
      pinned.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
      rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    if (!candidate) {
      console.error(
        `No active plan found in workspace "${opts.workspaceId}". Pass --plan-id=<id> to target one explicitly.`
      )
      process.exit(1)
    }
    targetPlanId = candidate.id
    console.log(`Target plan: ${candidate.id} — "${candidate.title}"`)
  }

  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.planId, targetPlanId),
        like(operatorPlanSteps.id, "step-B-cont-%")
      )
    )
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(
      `All ${STEPS.length} Continuum steps already present. Nothing to do.`
    )
    return
  }

  const maxOrderRow = await db
    .select({ max: max(operatorPlanSteps.stepOrder) })
    .from(operatorPlanSteps)
    .where(eq(operatorPlanSteps.planId, targetPlanId))
  const baseOrder = (maxOrderRow[0]?.max ?? -1) + 1

  const now = new Date()
  await db.insert(operatorPlanSteps).values(
    toInsert.map((s, i) => ({
      id: s.id,
      planId: targetPlanId!,
      workspaceId: opts.workspaceId,
      title: s.title,
      description: s.description,
      stepOrder: baseOrder + i,
      status: "open",
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, targetPlanId))

  console.log(
    `Seeded ${toInsert.length} new Continuum step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}). ${existingIds.size} already present.`
  )
  for (const s of toInsert) console.log(`  ${s.id}  ${s.title}`)
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
