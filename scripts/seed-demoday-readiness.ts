/**
 * Seed Lane H — Telegento demo-day readiness (2026-05-04) — into the
 * active dogfood plan. Mirrors seed-continuum-plan.ts: append-only,
 * idempotent on the `step-H` / `step-H%-readiness-` prefix.
 *
 * Cards are anchored to prior Wayseer-recovered context (thread URLs in
 * the descriptions) so a fresh agent can pick up without re-discovery.
 *
 * Usage:
 *   pnpm tsx ./scripts/seed-demoday-readiness.ts
 *   pnpm tsx ./scripts/seed-demoday-readiness.ts --workspace=global --plan-id=<id>
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
  status: "open" | "in-motion" | "covered" | "skipped"
  parentStepId: string | null
}

const STEPS: SeedStep[] = [
  {
    id: "step-H",
    title: "H. Telegento demo-day readiness · 2026-05-04",
    description:
      "Recordings are likely coming in today and Telegento needs to process them through end-to-end. Lane H tracks the table-stakes that need to be true before we let real users into the instance and before tomorrow's demo walkthrough. Each child card has its own Wayseer anchor (prior thread) so a fresh agent can pick up without re-discovery.",
    status: "in-motion",
    parentStepId: null,
  },
  {
    id: "step-H1",
    title: "H1. Verify webcam / local-network prompt is gone in fresh browsers",
    description:
      "Per thread-3a38bdb3 msg@158, the code-side fix shipped (\"Webcam request ✅ Removed in code (your Chrome just remembers)\"). Likely current breakage is just Chrome's cached permission state. Acceptance: open app.telegento.com in a clean Chrome profile (or after clearing site data + permissions for the host), walk the login → demo route, confirm no permission prompt. Re-test in Safari for parity.",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H2",
    title: "H2. Push rebuilt Docker container — verify disk-space fix held",
    description:
      "Prior blocker was Docker Desktop's internal disk image being full, not the host (thread-d6525a88 msg@58 has the diagnosis: Settings → Resources → Advanced → Disk image size). Acceptance: docker build + push completes locally, the new image deploys to app.telegento.com, /api/health returns 200, sidebar pill shows current Cognito user. If the disk-space failure recurs, escalate before continuing.",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H3",
    title: "H3. MFA enrollment dry-run as test user (~20 min)",
    description:
      "Cognito TOTP setup is documented in thread-1fd838ce msg@1 — two-part toggle (pool-level enforcement + per-user enrollment). Acceptance: a single test user account walks the full flow (admin invite email → first login → MFA enroll → QR scan → second-factor challenge → in-app landing) on the live app.telegento.com instance. Do this BEFORE bringing in Mickey or any real user — gates H4.",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H4",
    title: "H4. Ship an invite path for Mickey (or document Cognito console)",
    description:
      "Today there is no in-app invite UI — the only path is Mickey logging into the AWS console and using Cognito's user-create flow. Decide today: (A) ship a small admin-only invite endpoint (POST email, server creates Cognito user + sends invite via Cognito's hosted-UI invite email — see thread-1fd838ce msg@3 and thread-3a38bdb3 msg@95), or (B) write Mickey a one-page console runbook. Either way, deliverable is in Mickey's hands before tomorrow's walkthrough.",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H5",
    title: "H5. Connect Telegento consumer to EnrollHere S3 recording bucket",
    description:
      "Producer-side pipeline exists: EnrollHere → API Gateway → Lambda → s3://cmg-enrollhere-call-recordings-prod/ (architecture in thread-82b6ac19 msg@19/30/40, audit in thread-a00663fa msg@19/40). Bucket has objects (thread-3e73ce38 msg@43 shows live `aws s3 ls` output). Missing: Telegento-side consumer that lists/pulls new recordings from that bucket, runs them through the existing transcription/processing path, and registers the resulting calls. This card is the parent for whatever child plan emerges — first sub-task is scoping (read perms, dedupe ledger, polling vs S3 event notifications).",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H6",
    title: "H6. Demo-walkthrough rehearsal for tomorrow's presentation",
    description:
      "Pick the canonical demo route(s) and rehearse end-to-end on app.telegento.com from a guest-equivalent browser profile. Existing Product Walkthrough deck reachable via `?deck=product-walkthrough` (thread-b5a3076b msg@87). Acceptance: full walkthrough runs without a surface regression, login + MFA path works in the rehearsal browser, no localhost or local-network prompt fires. Surface any regressions to dedicated cards before the presentation.",
    status: "open",
    parentStepId: "step-H",
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
        like(operatorPlanSteps.id, "step-H%")
      )
    )
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(
      `All ${STEPS.length} demo-day-readiness steps already present. Nothing to do.`
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
      status: s.status,
      parentStepId: s.parentStepId,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, targetPlanId))

  console.log(
    `Seeded ${toInsert.length} new Lane H step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}). ${existingIds.size} already present.`
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
