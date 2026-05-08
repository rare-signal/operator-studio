/**
 * Round-3 reflections: identity-pill decision + Option B implementation.
 * Continues the SA/ACT pattern.
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
    id: "step-H-sa-4",
    title:
      "H · SA-4. Identity-pill shows hardcoded \"David Lin-Clark\" for all signed-in users",
    description:
      "Surfaced 2026-05-04 mid-morning during the test-user smoke walk. After making it through Cognito hosted UI + MFA enrollment cleanly (the H · ACT-2 deploy works end-to-end), the user landed in the app and saw the bottom-left identity pill in apps/v4/app/(app)/telegento/components/app-sidebar.tsx still rendering \"David Lin-Clark / Northstar FE\" — i.e. the demo persona's hardcoded default name from apps/v4/lib/telegento/viewer-server.ts:58 (DEFAULT_TEAM_LEAD_NAME).\n\nRoot cause: the chrome conflates two concepts. (1) Authenticated user identity comes from Cognito ID-token claims and is set into cognito_email + cognito_name cookies on /api/auth/cognito-callback success — but those cookies are SET and never CONSUMED anywhere. (2) Demo \"viewer\" persona (Team Lead at Northstar, an Agent, etc.) is built by viewer-server.ts and rendered in the sidebar pill. Today the pill renders only #2; #1 never appears in the chrome.\n\nDecision (in-chat 2026-05-04): Option B — keep the persona switcher dropdown UX, change the pill TRIGGER to render the authenticated user (name primary, email or persona as sub-line), and add \"Signed in as <email>\" + \"Viewing as <persona>\" labels in the dropdown header so the auth identity vs demo persona separation is unambiguous. Persona names in viewer-server.ts (including the \"David Lin-Clark\" Team Lead default) stay as fictional demo characters — the chrome change just makes it clear which Y you're viewing through, while you remain X.\n\nRejected alternatives: Option A (move persona to a separate banner — cleaner separation but bigger UX change), Option C (drop persona system entirely — large refactor).",
    status: "covered",
    parentStepId: "step-H",
  },
  {
    id: "step-H-act-3",
    title:
      "H · ACT-3. Implement Option B — auth user in pill, persona as sub-line",
    description:
      "Action in response to SA-4. Two-file change:\n\n• apps/v4/app/(app)/telegento/layout.tsx (server component): read cognito_email + cognito_name cookies; build an `authenticatedUser` object (name, email, initials) — defensive fallbacks: name → email → null; pass to <TelegentoSidebar authenticatedUser={...}>.\n\n• apps/v4/app/(app)/telegento/components/app-sidebar.tsx: accept the new prop; in the SidebarFooter pill (lines ~500-512), render `authenticatedUser.initials/name` as the primary line, and `Viewing as {viewer.name} · {viewer.teamLabel}` as the sub-line. Add a \"Signed in as {email}\" DropdownMenuLabel at the top of the dropdown for total clarity. Falls back to the old viewer-only render when authenticatedUser is null (covers local dev without Cognito cookies).\n\nNo backend changes; viewer-server.ts unchanged; persona-switcher behavior unchanged. Pre-deploy verification: typecheck clean + careful diff read. Mark covered after the deploy lands and the user verifies on prod that their own name appears in the pill instead of David's.",
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
    console.log(`All ${STEPS.length} round-3 reflection steps already present.`)
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
    `Seeded ${toInsert.length} round-3 step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}).`
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
