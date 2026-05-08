/**
 * 2026-05-04 evening — capture three new workstreams agreed in conversation
 * after the transcribe-Lambda backfill landed:
 *
 *   1. Admin Callouts pattern (parent step-C-pipeline-E)
 *      - The 77 Unknown-Agent rows were our first concrete example of
 *        "operational metadata that admins need to see but agents don't."
 *        Standing up a generalized "admin callouts" surface so future data-
 *        quality / pipeline / coverage gaps land somewhere predictable.
 *      - Sub-card: quick implementation = unknown-agent count on the admin
 *        homepage of Telegento.
 *
 *   2. Gemini wiring (parent step-C-pipeline-D)
 *      - Locked decision: BAA-compatible Gemini is the formal and only LLM
 *        source for production Telegento features. No LM Studio in cloud.
 *        Key sourced from AIDA's Configuretron prod
 *        (`docker compose run --rm config --env prod dump`, attr
 *        `config.gemini_key`). Mirror into Telegento-prod Secrets Manager.
 *      - This refines the existing step-C-pipeline-D-trigger card and adds
 *        a dedicated step-C-pipeline-D-gemini-source card.
 *
 *   3. App Runner cutover (parent step-C-pipeline-E)
 *      - step-C-pipeline-E-deploy-target gets concrete next steps.
 *      - New sub-card for the Cognito-secret prerequisite (App Runner env
 *        needs cognito_domain / client_id / client_secret packaged as a
 *        Secrets Manager secret — doesn't exist yet).
 *
 * Idempotent on insert + on description rewrites.
 */

import { and, eq, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"

type SeedStatus = "open" | "in-motion" | "covered" | "skipped"

interface SeedStep {
  id: string
  parentStepId: string
  title: string
  description: string
  status: SeedStatus
}

const ADMIN_CALLOUTS_DESC = [
  "A generalized surface inside Telegento for showing admins (team leads,",
  "operations, ourselves during build-out) operational facts they need to be",
  "aware of but that agents shouldn't see in their own per-agent view.",
  "",
  "First concrete trigger: the 77 / 188 Unknown-Agent rows from the",
  "2026-05-04 backfill. Those exist because the Snowflake GHL export",
  "(RAW.GO_HIGH_LEVEL.CALLS) doesn't have a row for ~41% of the call_ids in",
  "S3. The pipeline gracefully degrades, so a silent failure mode is hidden.",
  "We need a place where it's loud.",
  "",
  "Best-practice principles for this surface:",
  "  - Severity ladder: info / warn / action-required. The Unknown-Agent",
  "    case starts at 'info' (system handled it) and bumps to 'warn' if the",
  "    rate exceeds a threshold (e.g. >25% in a rolling 7-day window).",
  "  - Each callout owns its query — pure SQL or a typed query function in",
  "    lib/telegento/admin-callouts/ that returns a Callout object",
  "    {id, severity, title, body, since, count, links[]}. The UI just",
  "    renders the list — never embeds business logic.",
  "  - Dismissible per-callout per-admin (persisted in a small table) so we",
  "    don't pile up noise. Re-shown when count crosses threshold again.",
  "  - Each callout links to a 'why this happens / what to do' explainer.",
  "    For Unknown-Agent that's: 'Mickey owns the GHL export; ping him in",
  "    Slack if rate climbs.' (or whatever we determine).",
  "  - Surface count = bigger callouts roll up to a single header chip on",
  "    the per-agent UI too, so even a non-admin can see 'system has",
  "    issues' without being shown the details.",
  "  - Future callouts this same shape can serve: DLQ depth > 0,",
  "    enrichment Lambda error rate, Aurora ACU spikes, transcript freshness",
  "    lag, Snowflake query failures, Cognito callback errors.",
  "",
  "Per the LLM-layering rule, this whole surface is non-LLM core. AI summaries",
  "of the callouts come later as an additive layer.",
].join("\n")

const ADMIN_CALLOUTS_UNKNOWN_DESC = [
  "Quick first implementation of the admin-callouts surface to prove the",
  "shape. Single callout: 'Unknown-Agent rows: N of M total (P%)' rendered",
  "on whichever Telegento page we pick as the admin homepage (likely",
  "command-center; resolve during build).",
  "",
  "Concrete shape:",
  "  - lib/telegento/admin-callouts/unknown-agent.ts exports a typed query",
  "    function returning {count, total, rate, since} from tenant_calls.",
  "  - lib/telegento/admin-callouts/index.ts registers it in a callouts",
  "    array (mirror the importer-registry pattern).",
  "  - Server component on the admin home reads the registry, renders a",
  "    list of callouts with severity-colored chip + count.",
  "  - No write side yet (no dismiss table) — just read. We'll add dismiss",
  "    persistence when the second callout shows up and we feel the noise.",
].join("\n")

const D_GEMINI_SOURCE_DESC = [
  "LOCKED 2026-05-04: production LLM = BAA-compatible Gemini. Not LM Studio,",
  "not OpenAI direct, not local Ollama. Single source for compliance,",
  "billing visibility, and request-batching leverage.",
  "",
  "Sourcing the key (one-time op):",
  "  1. From /Users/smackbook/aida:",
  "       docker compose run --rm config --env prod dump",
  "     The attribute is `gemini_key` (lowercase). Same value AIDA already",
  "     uses in disposition/, so we're piggybacking on the existing BAA",
  "     contract — no new procurement needed.",
  "  2. Mirror into Telegento-prod Secrets Manager — name suggestion:",
  "       telegento-prod/gemini/api-key",
  "     KMS key = the same CMK already used by enrichment/transcribe",
  "     secrets. IAM: only the insight Lambda role gets Decrypt + GetValue.",
  "  3. Insight Lambda fetches at cold start, caches in module-scope.",
  "     Never log the key, never embed in CloudWatch error messages.",
  "",
  "Local dev: LM Studio still allowed for prompt iteration; production path",
  "must call Gemini. Mirror this in any future Lambdas we add.",
  "",
  "Cost / batching plan: even Gemini 2.5 Flash @ $0.075 / 1M input tokens",
  "is small per call but adds up on backfills. Plan from day one for",
  "request batching (Gemini batch API or our own time-windowed coalescer)",
  "and per-tenant daily token caps surfaced via the admin-callouts pattern.",
].join("\n")

const D_TRIGGER_NEW_DESC = [
  "Insight Lambda triggered after enrichment writes a tenant_calls row.",
  "Two trigger options on the table:",
  "  (a) Direct chain: enrichment Lambda invokes insight Lambda async at",
  "      end-of-handler. Lowest latency to insights.",
  "  (b) Aurora-backed batch: scheduled Lambda picks up rows where",
  "      tenant_call_insights.id IS NULL and processes in batches.",
  "      Plays better with Gemini's batch API and per-day token caps.",
  "",
  "Lean toward (b) for cost / batching. Build (a) only if SLOs need it.",
  "",
  "Reads from Aurora tenant_calls (Leg C output). Gemini produces structured",
  "insights using the prompt set at apps/v4/lib/telegento/insights/prompts.ts",
  "(summary, QA score, coaching feedback, compliance flags). Writes back to",
  "a sibling Aurora table tenant_call_insights and updates",
  "tenant_calls.aggregate_score / theme / opportunity_bucket.",
  "",
  "LLM layering: this is the additive enhancement layer. Legs A–C must",
  "stand on their own without it. The non-LLM admin homepage shows raw",
  "tenant_calls data (per Leg E); insights are a richer overlay.",
].join("\n")

const E_DEPLOY_TARGET_NEW_DESC = [
  "Pick + provision the Telegento app deploy target. App Runner CFN already",
  "drafted at infra/app-runner-telegento.cfn.yml in nextgen-call-intelligence",
  "-shell. App Runner chosen over Lambda+CF because the Next.js app needs",
  "long-lived processes for streaming responses and predictable cold-start.",
  "",
  "Concrete next steps (in order):",
  "  1. ECR: create repo telegento/v4, push the apps/v4 Docker image.",
  "  2. Cognito secret prerequisite — see step-C-pipeline-E-cognito-secret.",
  "  3. DATABASE_URL secret — already exists at",
  "     telegento-prod/db/master-VKsSDg; reuse the secret value but pointing",
  "     URL at the RDS Proxy endpoint.",
  "  4. Deploy stack: aws cloudformation create-stack",
  "       --stack-name telegento-prod-app",
  "       --template-body file://infra/app-runner-telegento.cfn.yml",
  "  5. Verify Cognito callback: agent logs in via Cognito hosted UI →",
  "     /api/auth/cognito-callback → telegento_tenant + telegento_agent_id",
  "     cookies set → /telegento/agent-report-v3 shows their own calls only.",
  "  6. Smoke a real agent (Adam, Aimee, Brudara — pick one with seeded",
  "     calls) end-to-end. Confirm calls list, transcript preview,",
  "     scorecard placeholder all render.",
].join("\n")

const NEW_STEPS: SeedStep[] = [
  {
    id: "step-C-pipeline-admin-callouts",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Admin Callouts surface — generalized 'things admins should know'",
    description: ADMIN_CALLOUTS_DESC,
  },
  {
    id: "step-C-pipeline-admin-callouts-unknown-agent",
    parentStepId: "step-C-pipeline-admin-callouts",
    status: "open",
    title: "First callout: Unknown-Agent rows on Telegento admin homepage",
    description: ADMIN_CALLOUTS_UNKNOWN_DESC,
  },
  {
    id: "step-C-pipeline-D-gemini-source",
    parentStepId: "step-C-pipeline-D",
    status: "open",
    title: "Gemini key sourcing — AIDA Configuretron → Telegento Secrets Manager",
    description: D_GEMINI_SOURCE_DESC,
  },
  {
    id: "step-C-pipeline-E-cognito-secret",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Cognito secret prerequisite for App Runner env",
    description: [
      "App Runner needs a Secrets Manager secret containing Cognito config",
      "for the Next.js app to bootstrap auth. Doesn't exist yet.",
      "",
      "Shape (JSON):",
      "  {",
      '    "cognito_domain": "<hosted-ui-domain>",',
      '    "user_pool_id":   "us-east-1_NY5wyN8lo",',
      '    "client_id":      "6po39ciqktmi4nj355ec3vm3j9",',
      '    "client_secret":  "<from console — never logged>"',
      "  }",
      "",
      "Suggested secret name: telegento-prod/cognito/app-runner-config.",
      "Same KMS CMK as the rest of the Telegento secrets. App Runner role",
      "gets Decrypt + GetSecretValue.",
    ].join("\n"),
  },
]

async function main() {
  const db = getDb()

  const planRows = await db
    .select({ id: operatorPlans.id, updatedAt: operatorPlans.updatedAt, pinned: operatorPlans.pinned })
    .from(operatorPlans)
    .where(and(eq(operatorPlans.workspaceId, WORKSPACE_ID), eq(operatorPlans.state, "active")))
  const targetPlan =
    planRows.filter((r) => r.pinned === 1).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
    planRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  if (!targetPlan) throw new Error("No active plan")
  const planId = targetPlan.id
  console.log(`Target plan: ${planId}`)

  const now = new Date()

  // Refresh existing card descriptions
  await db
    .update(operatorPlanSteps)
    .set({ description: D_TRIGGER_NEW_DESC, updatedAt: now })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-D-trigger"))
  console.log("Refreshed step-C-pipeline-D-trigger description")

  await db
    .update(operatorPlanSteps)
    .set({ description: E_DEPLOY_TARGET_NEW_DESC, updatedAt: now })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-E-deploy-target"))
  console.log("Refreshed step-C-pipeline-E-deploy-target description")

  // Insert new sub-cards (idempotent — refresh-on-conflict)
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(like(operatorPlanSteps.id, "step-C-pipeline-%"))
  const existingIds = new Set(existing.map((r) => r.id))

  let nextOrder =
    ((
      await db
        .select({ max: max(operatorPlanSteps.stepOrder) })
        .from(operatorPlanSteps)
        .where(eq(operatorPlanSteps.planId, planId))
    )[0]?.max ?? -1) + 1

  for (const s of NEW_STEPS) {
    if (existingIds.has(s.id)) {
      await db
        .update(operatorPlanSteps)
        .set({
          title: s.title,
          description: s.description,
          status: s.status,
          parentStepId: s.parentStepId,
          updatedAt: now,
        })
        .where(eq(operatorPlanSteps.id, s.id))
      console.log(`Refreshed ${s.id}`)
    } else {
      await db.insert(operatorPlanSteps).values({
        id: s.id,
        planId,
        workspaceId: WORKSPACE_ID,
        title: s.title,
        description: s.description,
        stepOrder: nextOrder++,
        status: s.status,
        parentStepId: s.parentStepId,
        createdAt: now,
        updatedAt: now,
      })
      console.log(`Inserted ${s.id} [${s.status}] under ${s.parentStepId}`)
    }
  }
  await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, planId))
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
