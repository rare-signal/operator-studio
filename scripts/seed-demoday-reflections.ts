/**
 * Append situational-awareness + action cards to Lane H, plus a meta
 * card under Lane B requesting a card-type taxonomy in the planning
 * surface. Idempotent on the per-step prefixes.
 *
 * Pattern set today (per user direction): each lane gets paired
 * `step-<lane>-sa-N` (situational awareness — what we learned) and
 * `step-<lane>-act-N` (action — what we did about it) cards over time,
 * preserving the audit trail of how the lane evolved.
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
    id: "step-H-sa-1",
    title: "H · SA-1. AWS probe (2026-05-04 AM) — what's actually live",
    description:
      "Situational awareness from morning AWS probe via DataAdministrator SSO role.\n\n• Cognito pool us-east-1_NY5wyN8lo (telegento-users): MfaConfiguration: ON, SoftwareTokenMfaConfiguration enabled (TOTP, no SMS). 15 users seeded; only dlclark@clarifying.com is CONFIRMED — the other 14 are FORCE_CHANGE_PASSWORD with temp passwords from 2026-04-30 (expire 2026-05-07).\n\n• App Runner service `telegento` (id 0dac790a8d244b0a83764c1646cd44f1): RUNNING, image 694973467292.dkr.ecr.us-east-1.amazonaws.com/telegento:latest, AutoDeploymentsEnabled: FALSE, last UpdatedAt 2026-04-30 08:23 PT. ECR has 4 image pushes all on 2026-04-30 (latest tag f9413c516-cognito3 at 11:04 PT). Nothing has been pushed since the disk-space block. HEAD locally is f9413c516, with uncommitted working-tree changes on top.\n\n• Lambda `enrollhere-recording-intake-prod` (python3.12, last modified 2026-04-30 18:31 PT) confirmed; bucket `cmg-enrollhere-call-recordings-prod` confirmed (objects exist).\n\n• BLOCKER discovered: apps/v4/app/api/auth/login/route.ts only handles NEW_PASSWORD_REQUIRED. With pool MFA on, every user's second sign-in step is MFA_SETUP — the route falls through to a generic error and the form silently fails. As a result, NO USER besides the one CONFIRMED account can complete sign-in through the deployed stack.\n\n• Adjacent finding: /api/auth/sign-in and /api/auth/cognito-callback already implement the full Cognito hosted-UI OAuth code flow correctly. The hosted UI handles MFA enrollment + verification natively. The login page just isn't wired to use it.",
    status: "covered",
    parentStepId: "step-H",
  },
  {
    id: "step-H-act-1",
    title: "H · ACT-1. Pivot login to Cognito hosted UI (keeps MFA on)",
    description:
      "Action taken in response to SA-1. Goal: keep MfaConfiguration ON, get the team able to log in this morning, smallest possible change.\n\n• Edited apps/v4/app/login/page.tsx: server-side redirect to /api/auth/sign-in?next=… on the happy path; render an error pane (with Try-again button to /api/auth/sign-in) when the Cognito callback bounces us back with ?error=. Hosted UI handles MFA_SETUP + SOFTWARE_TOKEN_MFA challenges natively.\n\n• The legacy inline form at apps/v4/app/login/login-form.tsx and the routes apps/v4/app/api/auth/login/{route.ts,challenge/route.ts} are now unwired but left on disk for safe rollback. Cleanup card to delete them once hosted-UI flow has been exercised by real users.\n\n• Deploy chain (still pending this card's completion): commit → docker build → push to ECR → aws apprunner start-deployment (AutoDeploymentsEnabled is FALSE, so the manual trigger is required).\n\n• Verification (gates flip-to-covered): real test user walks invite-email → first sign-in → MFA enrollment via authenticator app → second sign-in → lands in app, all on https://app.telegento.com.",
    status: "in-motion",
    parentStepId: "step-H",
  },
  {
    id: "step-B-card-types-1",
    title:
      "B-card-types. Codify card-type taxonomy in the planning surface",
    description:
      "Feature ask for the OS planning surface itself. Cards in a lane today are all the same type (an undifferentiated 'card'). Add an optional card-type field with at least:\n\n  • situational-awareness — what we learned (a probe, a discovery, a status snapshot at a moment in time)\n  • action — what we did about it (a change made, a deploy triggered, a decision recorded)\n  • (default: card) — when no type is specified, behaves exactly like today\n\nLane H now uses an ad-hoc prefix convention (step-H-sa-N, step-H-act-N) to express this distinction in card IDs. That convention should graduate into a real first-class field on operator_plan_steps so the UI can render the SA→ACT pairing visually (e.g. SA cards rendered as observations with timestamps, ACT cards rendered as decisions with linked code/commits, untyped cards rendered as today). Default-to-current-behavior keeps the change additive and non-breaking. Backfill is opt-in.",
    status: "open",
    parentStepId: "step-B",
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
  const existingIds = new Set(
    existingRows.flat().map((r) => r.id)
  )
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(`All ${STEPS.length} reflection/action/meta steps already present. Nothing to do.`)
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
    `Seeded ${toInsert.length} new reflection/action/meta step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}). ${existingIds.size} already present.`
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
