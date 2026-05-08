/**
 * Round-4 reflection cards for Lane H — captures the admin-invite
 * fork-off (SA-5) + action taken (ACT-4) + concrete H4 sub-cards.
 *
 * Round-3 (step-H-sa-4 + step-H-act-3) was used by a sister fork
 * session for the identity-pill / persona-vs-auth-user beat
 * (commit 475f6b6d9 in nextgen-call-intelligence-shell). This file
 * picks up the next unused sequence numbers (sa-5, act-4) so the two
 * threads coexist without overwriting each other.
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
    id: "step-H-sa-5",
    title:
      "H · SA-5. Fork — admin-invite UI/endpoint required (2026-05-04 mid-AM)",
    description:
      "User forked off mid-smoke-test (during their MFA enrollment dry-run on https://app.telegento.com). Original H4 was a binary 'either ship endpoint or document Cognito console for Mickey'. New scope: build an actual screen in Telegento that admin-tagged users (Mickey, David, future others) can use to invite people via email-list paste OR CSV upload (email, first_name, last_name).\n\nSanity-checked architecture before building, six decisions:\n1. Architecture: Next.js API route (/api/admin/invite), NOT a separate Lambda. App Runner instance role can carry the IAM; one less moving piece; the audio Lambda is a different shape (inbound webhook).\n2. Admin role: Cognito group `admins`. JWT carries cognito:groups claim. Manageable from console.\n3. Auth check: real JWT signature verification via aws-jwt-verify against Cognito JWKS. Privileged actions need real auth, not just middleware-checks-a-cookie.\n4. UI: single page at /admin/invite. Paste rows OR CSV upload. Server fans out admin-create-user calls (concurrency 5, max 100 per request).\n5. Email: Cognito's built-in invite email (current pool config: COGNITO_DEFAULT, 50/day cap — fine short-term, file SES upgrade as follow-up).\n6. Pool ID + region: bake into Dockerfile ENV (non-secret) so JWT verifier + SDK have what they need without an App Runner service-config update round-trip.\n\nProbes confirmed: no existing Cognito groups, instance role had only TelegentoSecretsRead inline policy (missing cognito-idp:Admin* perms), email config is COGNITO_DEFAULT.\n\nNote: this beat coexists with the sister fork's SA-4/ACT-3 (identity-pill, commit 475f6b6d9) — both ride together in the next deploy since both are already in HEAD.",
    status: "covered",
    parentStepId: "step-H",
  },
  {
    id: "step-H-act-4",
    title: "H · ACT-4. Land /admin/invite end-to-end (commit 8539b89c1)",
    description:
      "Action in response to SA-5. Built and committed as 8539b89c1 (1400 lines, 7 files).\n\nAWS side (out of band, via DataAdministrator-694973467292 SSO role):\n• Created Cognito group `admins` in pool us-east-1_NY5wyN8lo with description 'Telegento administrators — can invite new users via /admin/invite'.\n• Added dlclark@clarifying.com to the admins group.\n• Attached new inline policy `TelegentoCognitoAdmin` to TelegentoAppRunnerInstanceRole granting AdminCreateUser/AdminSetUserPassword/AdminDeleteUser/AdminGetUser/AdminAddUserToGroup/AdminRemoveUserFromGroup/AdminListGroupsForUser/ListUsers/ListGroups/ListUsersInGroup, scoped to that one user pool.\n\nCode side:\n• apps/v4/lib/server/admin-auth.ts — getCurrentClaims() + requireAdmin() helpers. JWT verification via aws-jwt-verify (RS256 signature checked against Cognito JWKS, lazy-loaded + cached).\n• apps/v4/app/api/admin/invite/route.ts — POST handler. Auth: requireAdmin. Body: { users: [{email, given_name?, family_name?}] }. Fans out @aws-sdk/client-cognito-identity-provider AdminCreateUserCommand calls (concurrency 5). Returns per-row {email, status, error?}. Caps: max 100 per request; email regex; UsernameExistsException mapped to 'User already exists'.\n• apps/v4/app/(app)/admin/invite/page.tsx — server component, requireAdmin gate, renders InviteForm.\n• apps/v4/app/(app)/admin/invite/invite-form.tsx — client component, paste-rows textarea + CSV upload (auto-skips header row), per-row result display.\n• apps/v4/Dockerfile — added ENV AWS_REGION=us-east-1 + ENV COGNITO_USER_POOL_ID=us-east-1_NY5wyN8lo so the SDK and JWT verifier know the pool/region without a service-config change.\n• apps/v4/package.json + pnpm-lock.yaml — added aws-jwt-verify@5.1.1 and @aws-sdk/client-cognito-identity-provider@3.1041.0.\n\nPending (covered when build #5 deploys + smoke test passes): docker build/push, App Runner start-deployment, end-to-end test via a fresh test admin user. Build #5 also carries the sister fork's identity-pill fix (475f6b6d9).",
    status: "in-motion",
    parentStepId: "step-H",
  },
  {
    id: "step-H4-1",
    title: "H4.1. Cognito group + IAM scaffolding for admin actions",
    description:
      "Create `admins` group in pool us-east-1_NY5wyN8lo; attach TelegentoCognitoAdmin inline policy to TelegentoAppRunnerInstanceRole granting cognito-idp Admin* / List* on the pool. COVERED 2026-05-04 — see H · ACT-4 for specifics.",
    status: "covered",
    parentStepId: "step-H4",
  },
  {
    id: "step-H4-2",
    title: "H4.2. JWT-verified admin auth helper (admin-auth.ts)",
    description:
      "lib/server/admin-auth.ts: getCurrentClaims() decodes the cognito_id_token cookie via aws-jwt-verify (RS256 against Cognito JWKS, lazy + cached). requireAdmin() additionally checks cognito:groups includes 'admins'. Both return null on any failure path (missing cookie, expired token, invalid signature, wrong group) — never throw. COVERED 2026-05-04 (commit 8539b89c1).",
    status: "covered",
    parentStepId: "step-H4",
  },
  {
    id: "step-H4-3",
    title: "H4.3. POST /api/admin/invite endpoint",
    description:
      "Auth: requireAdmin. Body: { users: [{ email, given_name?, family_name? }] }. Validates email regex per row, caps at 100 users per request, fans out AdminCreateUserCommand (concurrency 5) via @aws-sdk/client-cognito-identity-provider, returns per-row { email, status: 'ok'|'error', error? }. Maps UsernameExistsException to a clear error string. COVERED 2026-05-04 (commit 8539b89c1).",
    status: "covered",
    parentStepId: "step-H4",
  },
  {
    id: "step-H4-4",
    title: "H4.4. /admin/invite UI screen",
    description:
      "Server component (page.tsx) gates on requireAdmin — non-admins see a 'Not authorized' panel with instructions to ask an admin. Client form (invite-form.tsx) supports paste-rows (one CSV-style line per invitee, header row auto-skipped) OR file upload. Per-row results render with check/x icons + error reason. COVERED 2026-05-04 (commit 8539b89c1).",
    status: "covered",
    parentStepId: "step-H4",
  },
  {
    id: "step-H4-5",
    title: "H4.5. Build + deploy + smoke-test the admin invite end-to-end",
    description:
      "Build #5 (linux/amd64, commit 8539b89c1) running. After successful deployment: (a) verify /admin/invite renders and gates on admin group, (b) smoke-test POST /api/admin/invite by creating a fake user via the API (acting as David, who is in admins group), (c) verify the new user appears in Cognito with FORCE_CHANGE_PASSWORD status, (d) clean up the smoke-test invitee. Once green, ready to add Mickey to admins group and hand him the URL. Build also carries 475f6b6d9 identity-pill fix.",
    status: "in-motion",
    parentStepId: "step-H4",
  },
  {
    id: "step-H4-6",
    title:
      "H4.6. Follow-up polish — SES email + sidebar link + audit log",
    description:
      "Deferred polish, not blocking demo:\n• Switch Cognito email config from COGNITO_DEFAULT (50/day cap) to SES (no cap) when invite volume exceeds ~30/day. Requires verifying a sender domain in SES.\n• Add a sidebar link to /admin/invite, conditionally visible only when the current user's session has admins group (server-side check to avoid leaking the route to non-admins).\n• Audit log: persist invite events to operator_admin_audit table — who invited whom, when, success/failure. Also flag bulk imports (>10 invitees) for review.\n• Cognito group management UI — add/remove from admins group via the same /admin surface.",
    status: "open",
    parentStepId: "step-H4",
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
    console.log(`All ${STEPS.length} round-4 reflection steps already present.`)
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
    `Seeded ${toInsert.length} round-4 step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}).`
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
