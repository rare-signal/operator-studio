/**
 * Round-5 closing snapshot for Lane H — captures the end-of-work-session
 * state (SA-6) + three handoff cards listing what's owed by the user
 * (step-H-todo-1..3). The handoff cards show the SHAPE of where the
 * lane is sitting between agent-side work being done and human-side
 * verification + decisions still pending.
 *
 * Idempotent on per-step IDs.
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
    id: "step-H-sa-6",
    title:
      "H · SA-6. End-of-morning snapshot — what shipped, what's live, what's verified",
    description:
      "Closing snapshot of Lane H demo-day-readiness work, 2026-05-04 ~10:50 PT.\n\nCOMMITS LANDED ON main (chronological):\n• daf2a61f3  fix(auth): /login → Cognito hosted UI (was breaking on MFA_SETUP)\n• 018d832a7  infra(deploy): bake Dockerfile CMD + prod-web.sh + /api/health public path\n• 0b4bada41  feat(auth): land the Cognito hosted-UI auth routes (rescued from stash)\n• 475f6b6d9  feat(auth): surface authenticated user in sidebar pill (Option B) — sister fork\n• 8539b89c1  feat(admin): /admin/invite — admin-only Cognito invite UI + API\n• 298138a27  feat(seed): bake final-expense bundle into image; FINAL_EXPENSE_SOURCE_ROOT — parallel commit\n\nDEPLOY HISTORY:\n• Build #1 (arm64) — ROLLBACK_SUCCEEDED, exec format error. Codified --platform linux/amd64 in feedback memory.\n• Build #2 (amd64, missing CMD) — ROLLBACK_SUCCEEDED, stash too aggressive (Dockerfile + prod-web.sh were untracked). Rescued in 018d832a7.\n• Build #3 (amd64, /login → 404) — SUCCEEDED but functionally broken; /api/auth/* routes were also untracked-in-stash. Rescued in 0b4bada41.\n• Build #4 (amd64, full auth flow) — SUCCEEDED. User completed MFA enrollment dry-run as smoketest-2026-05-04@telegento.com.\n• Build #5 (amd64, admin invite) — SUCCEEDED. App Runner pulled :latest which had been concurrently retagged by the parallel 298138a27 build, so the deployed image is the union of mine + the FE-bundle commit.\n\nAWS-SIDE PREP (via DataAdministrator-694973467292 SSO role):\n• Cognito group `admins` created in pool us-east-1_NY5wyN8lo\n• dlclark@clarifying.com added to admins group\n• TelegentoCognitoAdmin inline IAM policy attached to TelegentoAppRunnerInstanceRole (Admin* + List* on the pool)\n• smoketest-2026-05-04@telegento.com created with --message-action SUPPRESS + --no-permanent — used for the morning MFA-flow verification\n• msakora@clarifying.com (Mickey) temp password reset to Telegento2026Mx for his first sign-in\n\nLIVE ON app.telegento.com (verified end-to-end via curl + user-driven incognito walk):\n• /login → 307 → /api/auth/sign-in → Cognito hosted UI (MFA enrollment + verification work end-to-end)\n• /api/auth/cognito-callback sets v4_auth=ok + cognito_id_token + cognito_email + cognito_name\n• Sidebar pill renders authenticated user name (per fork's Option B)\n• /admin/invite — admin-only screen, gates on cognito:groups includes 'admins'\n• POST /api/admin/invite — JWT signature verification via aws-jwt-verify; returns 403 with proper error for non-admins (verified with fake JWT)\n• /api/health → 200\n\nFEEDBACK MEMORIES CODIFIED for future agents:\n• feedback_wayseer_context_recovery.md (corrected — Wayseer is operator-studio's pnpm wayseer:* CLIs, not the CCD MCP)\n• feedback_test_user_no_inbox.md (admin-create-user --message-action SUPPRESS pattern)\n• feedback_docker_platform_amd64.md (--platform linux/amd64 on every Telegento build from arm64 hardware)\n\nNOT YET VERIFIED (waiting on user):\n• /admin/invite real walk — David navigating to the page as himself, sending an invite, watching the new user land in Cognito\n• Mickey's first sign-in completing successfully (his account flips FORCE_CHANGE_PASSWORD → CONFIRMED)\n• Mickey added to admins group (gated on the above)\n• Stashed working-tree pre-deploy WIP — ~14 untracked deck files + several modified deck sources still in stash@{0} pending careful pop with conflict triage",
    status: "covered",
    parentStepId: "step-H",
  },
  {
    id: "step-H-todo-1",
    title:
      "H · TODO-1. David — walk /admin/invite end-to-end (browser, smoke-test row)",
    description:
      "What you need to do, ~3 minutes:\n\n1. In the same browser session you're already signed in with this morning, navigate to https://app.telegento.com/admin/invite\n2. You should see 'Invite users' page with 'Signed in as dlclark@clarifying.com' subtitle. If you see 'Not authorized' instead, your cognito_id_token cookie expired — re-sign-in via /login first.\n3. Paste this single throwaway row into the textarea: `inviteapitest@telegento.com, Invite, ApiTest`\n4. Click 'Send 1 invite'.\n5. Tell me the result. Expected: a green checkmark with the email, '1 sent · 0 failed'.\n\nWhen you confirm: agent-side verifies the user landed in Cognito with FORCE_CHANGE_PASSWORD status, then deletes that throwaway user. After this card flips to covered, H4.5 also flips to covered.",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H-todo-2",
    title:
      "H · TODO-2. Mickey — first sign-in, then agent adds him to admins group",
    description:
      "Two-stage handoff:\n\n(A) Mickey side — send him the message that's already drafted with his credentials (msakora@clarifying.com / Telegento2026Mx / https://app.telegento.com/login). He goes through Cognito hosted UI → set permanent password → enroll MFA → land in app. Account flips FORCE_CHANGE_PASSWORD → CONFIRMED.\n\n(B) Agent side — once you confirm Mickey is in, run:\n\n  AWS_PROFILE=DataAdministrator-694973467292 aws cognito-idp admin-add-user-to-group \\\n    --user-pool-id us-east-1_NY5wyN8lo \\\n    --username msakora@clarifying.com \\\n    --group-name admins \\\n    --region us-east-1\n\nAfter that he can hit /admin/invite himself and start inviting people. Acceptance: msakora's admin-list-groups-for-user shows the admins group.\n\nNote: he won't have an admin link in the sidebar yet — that's H4.6 follow-up polish. Send him the URL directly.",
    status: "open",
    parentStepId: "step-H",
  },
  {
    id: "step-H-todo-3",
    title:
      "H · TODO-3. Decide on stash restoration of pre-deploy WIP (stash@{0})",
    description:
      "Background: at the start of this morning's work the agent ran `git stash push --keep-index --include-untracked` to isolate the login-page change for a clean deploy. That stash still exists as `stash@{0}: On main: wip-pre-demo-deploy-2026-05-04`. Some of its contents have since been COMMITTED out of band as part of the deploy chain (Dockerfile, prod-web.sh, middleware.ts /api/health, the /api/auth/* routes, lib/cognito-auth.ts, lib/server/users.ts, app/login/page.tsx). The remaining stash content is genuinely your in-flight WIP:\n\n• ~14 untracked new deck files under apps/v4/app/(app)/telegento/rocketer-runtime/ (deck-call-pair-proof, deck-end-all-be-all, deck-motion-menagerie, deck-motion-showcase-v[123], deck-operating-model, deck-rocketer-demo-v1, deck-rocketer-pitch, deck-sizzle-reel-v1, deck-telegento-language-rollup, deck-vibe-voice-candidates, deck-vibe-voice-demo[-v2], deck-rocketer-demo-v1) plus contact-sheet/ + runtime-audio.ts + runtime-audio-react.tsx + script/ + (print)/\n• Modified existing decks (8 deck-*.tsx files), telegento/components/app-sidebar.tsx (likely overwritten now by 475f6b6d9 — needs merge), telegento/calls/[callId]/page.tsx, lib/telegento/{hydration-engine,viewer-server}.ts, AGENTS.md, .claude/launch.json, apps/v4/package.json (the pdf-lib dep that pnpm pruned)\n\nDecide: (a) `git stash pop` and triage conflicts file-by-file, (b) selectively restore only the deck files (untracked ones are safe — they're new), (c) drop the stash entirely if it's stale, (d) leave it parked indefinitely for later. Recommendation: (b) — `git checkout stash@{0}^3 -- <untracked deck path>` for each new deck file gets your WIP back without merge conflicts. The modified deck files probably need eyeball review since they're entangled with the morning's commits.",
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
    console.log(`All ${STEPS.length} round-5 closing steps already present.`)
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
    `Seeded ${toInsert.length} round-5 step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}).`
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
