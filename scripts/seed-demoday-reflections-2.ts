/**
 * Round-2 reflection cards for Lane H, captured live during the
 * smoke-test deploy. Continues the SA/ACT pattern from
 * seed-demoday-reflections.ts.
 *
 * Idempotent on the per-step IDs.
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
    id: "step-H-sa-2",
    title:
      "H · SA-2. Webcam / local-network prompt verified GONE on prod (2026-05-04 AM)",
    description:
      "User opened https://app.telegento.com in incognito on a clean second machine and reported no permission prompt. Confirms the hypothesis from SA-1 that the webcam fix had already shipped in code — only Chrome's cached permission state on the original machine made it look unfixed. H1 (verify webcam/local-network prompt is gone in fresh browsers) is now satisfied; flip to covered. No code change required for this beat.",
    status: "covered",
    parentStepId: "step-H",
  },
  {
    id: "step-H-sa-3",
    title:
      "H · SA-3. First deploy attempt rolled back — wrong CPU arch (2026-05-04 AM)",
    description:
      "Built apps/v4 docker image on the local arm64 Mac without --platform; image pushed cleanly, App Runner pulled it, container failed at startup with `exec /usr/local/bin/docker-entrypoint.sh: exec format error`, App Runner auto-rolled back to f9413c516-cognito3. Operation 14fb1acefe4b46abbe9b8cb2e662f2ca reports ROLLBACK_SUCCEEDED. Service Status returned to RUNNING against the OLD image — no production impact, but the misleading status nearly caused us to declare success.\n\nRoot cause: AWS App Runner runs linux/amd64 only, but the local Mac is arm64 — `docker build` without --platform produces an arm64 image. Lesson codified in feedback memory `feedback_docker_platform_amd64.md` — every future telegento build from this machine MUST use --platform linux/amd64.\n\nDiagnostic that surfaced root cause: CloudWatch logs at `/aws/apprunner/telegento/<service-id>/application` (latest stream) — single line `exec format error`. Without checking the operation Status (vs trusting only Service.Status) and pulling those logs, the deploy looked successful while serving stale code.",
    status: "covered",
    parentStepId: "step-H",
  },
  {
    id: "step-H-act-2",
    title:
      "H · ACT-2. Rebuild --platform linux/amd64, re-push, re-deploy",
    description:
      "Action in response to SA-3. Same image tags (:latest, :daf2a61f3) — overwrite ECR. Cross-build via QEMU on arm64 host is ~3-5x slower than native (5-10 min vs 1-2 min). Tag 0001 SUCCEEDED criteria: Operation Status = SUCCEEDED (not ROLLBACK_SUCCEEDED), service running new image digest, https://app.telegento.com/login responds with 307 redirect to /api/auth/sign-in (vs current 200 with LoginForm). Then proceed to test-user creation.",
    status: "in-motion",
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
        `No active plan found in workspace "${opts.workspaceId}". Pass --plan-id=<id>.`
      )
      process.exit(1)
    }
    targetPlanId = candidate.id
    console.log(`Target plan: ${candidate.id} — "${candidate.title}"`)
  }

  const targetIds = STEPS.map((s) => s.id)
  const existingRows = await Promise.all(
    targetIds.map((id) =>
      db
        .select({ id: operatorPlanSteps.id })
        .from(operatorPlanSteps)
        .where(
          and(
            eq(operatorPlanSteps.planId, targetPlanId),
            like(operatorPlanSteps.id, id)
          )
        )
    )
  )
  const existingIds = new Set(existingRows.flat().map((r) => r.id))
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(`All ${STEPS.length} round-2 reflection steps already present. Nothing to do.`)
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
    `Seeded ${toInsert.length} new round-2 reflection step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}).`
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
