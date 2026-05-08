/**
 * 2026-05-04 evening — codify realistic shape of remaining Lane C work after
 * the App Runner deploy lands.
 *
 * Honest about which items are flips (config / one-shot Lambda tweak) vs
 * intermediate engineering lifts (multi-hour, multi-file, schema or
 * dependency work). Earlier estimates undersold several items; this card
 * set fixes that.
 *
 * Flips:
 *   - step-C-pipeline-D-auto-chain   (NEW, open)        ~30 min
 *   - step-C-pipeline-admin-callouts-more (NEW, open)   ~30 min each
 *
 * Intermediate lifts:
 *   - step-C-pipeline-E-cutover-config (refresh)        2-4 hours
 *   - step-C-pipeline-E-insight-surfacing (NEW, open)   2-4 hours per page
 *   - step-C-pipeline-D-rescore-buttons (NEW, open)     1-2 hours
 *   - step-C-pipeline-D-cost-guardrails (refresh)       half day
 *
 * Idempotent.
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

const NEW_STEPS: SeedStep[] = [
  {
    id: "step-C-pipeline-D-auto-chain",
    parentStepId: "step-C-pipeline-D",
    status: "open",
    title: "Auto-chain insight Lambda from enrichment (FLIP, ~30 min)",
    description: [
      "TRUE FLIP. End of enrichment Lambda's _process_event handler:",
      "  boto3 lambda client → invoke('telegento-prod-insight',",
      "    InvocationType='Event', Payload=json.dumps({'mode':'single',",
      "    'call_id': event_id}))",
      "",
      "Plus: IAM grant on enrichment role for lambda:InvokeFunction on",
      "the insight Lambda ARN. Plus: ENV var INSIGHT_LAMBDA_NAME on the",
      "enrichment Lambda. Then rebuild + update-function-code.",
      "",
      "Idempotency: insight Lambda's tenant_call_insights upsert is ON",
      "CONFLICT (call_id) DO UPDATE — re-firing is safe.",
      "",
      "Defensive: wrap the invoke in try/except and log on failure;",
      "never let an insight failure block the enrichment row from",
      "being committed (insights are an additive layer per the LLM-",
      "layering rule).",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-D-rescore-buttons",
    parentStepId: "step-C-pipeline-D",
    status: "open",
    title: "Per-call + batch rescore buttons (LIFT, 1-2 hours)",
    description: [
      "INTERMEDIATE LIFT. Three pieces that have to land together:",
      "",
      "1. Next.js API route /api/insights/rescore that signs an AWS",
      "   request and invokes the insight Lambda (single or backfill",
      "   modes). App Runner instance role needs new IAM perm for",
      "   lambda:InvokeFunction.",
      "",
      "2. Admin gate. Today the demo gates on BRAND_WORLD_PASSWORD",
      "   shared-secret cookies. We need either an explicit admin-only",
      "   gate (Cognito group 'admins' check via aws-jwt-verify, like",
      "   the /admin/invite route already does in commit 8539b89c1) or",
      "   accept any logged-in user can rescore their own calls.",
      "   Decide before building.",
      "",
      "3. UI buttons. Per-call: small 'rescore' icon on the call detail",
      "   row in agent-report. Batch: 'rescore last N calls' on a",
      "   command-center admin panel.",
      "",
      "Cost guard: rate-limit at the API route layer (max 1 rescore",
      "per call_id per 5min) so admins can't blow tokens by spamming.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-E-insight-surfacing",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Surface score / theme / coaching in agent-report + coaching-hub (LIFT, 2-4 hrs per page)",
    description: [
      "INTERMEDIATE LIFT, two pages:",
      "",
      "1. /telegento/agent-report-v3 — list of calls per agent. Add a",
      "   score chip + theme tooltip + opportunity_bucket badge to each",
      "   row. Source change: query joins tenant_call_insights ON",
      "   call_id (LEFT JOIN — calls without insights still render).",
      "",
      "2. /telegento/coaching-hub — coaching feedback surface. New",
      "   panel rendering insight.coaching.{strength, improvement,",
      "   next_call_focus} + insight.scorecard_breakdown table +",
      "   insight.compliance_flags chips. Per-call drill-down.",
      "",
      "Today these pages read from the demo-data shape (per the",
      "step-C-pipeline-E-data-source-flag work). Real-data queries",
      "need to be built and the demo path kept as a fallback for now.",
      "",
      "Defensive: when insight row is null (e.g. very short call",
      "skipped by Lambda), UI shows 'not yet scored' rather than",
      "blank — admins know it wasn't a UI bug.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-admin-callouts-more",
    parentStepId: "step-C-pipeline-admin-callouts",
    status: "open",
    title: "Round out admin callouts: DLQ, Lambda errors, freshness (FLIP each, ~30 min)",
    description: [
      "TRUE FLIP per callout, registry pattern is already in place.",
      "",
      "Callouts to add (each one file under lib/telegento/admin-callouts/",
      "and one line in index.ts):",
      "",
      "  - dlq-depth.ts — count messages in either Lambda's DLQ via",
      "    SQS GetQueueAttributes. severity=warn at >0,",
      "    action_required at >5.",
      "  - lambda-errors.ts — CloudWatch Lambda Errors metric over",
      "    last hour. severity=warn at >5/hr, action_required >25/hr.",
      "  - transcript-freshness.ts — max(now() - tenant_calls.created_",
      "    at) over last 7 days. severity=warn if >2hr lag (pipeline",
      "    backed up), action_required >24hr.",
      "  - snowflake-query-failures.ts — enrichment Lambda log-based",
      "    metric. Future once we wire log-metric filter.",
      "  - aurora-acu-spike.ts — RDS metric, peak ACU over 1hr.",
      "    severity=warn near max scale-out.",
    ].join("\n"),
  },
]

const REFRESH_DESCRIPTIONS: Record<string, string> = {
  "step-C-pipeline-E-cutover-config": [
    "INTERMEDIATE LIFT (2-4 hours), not a flip. Earlier estimate of",
    "'just swap the secret value' was wrong because telegento-pg and",
    "telegento-prod-cluster have drifted in both directions.",
    "",
    "Reality of what's in each DB right now:",
    "  telegento-pg (db.t3.micro standalone Postgres, current app",
    "    DATABASE_URL):",
    "    - Drizzle migrations 0000-0010 + David's 0012_chat_sessions",
    "    - Whatever demo / brand-world / chat-session data has",
    "      accumulated locally and in deploys",
    "    - NO migrations 0011_tenant_call_insights",
    "    - NO real call data (the 188 calls are not here)",
    "  telegento-prod-cluster (Aurora SLv2, where pipeline writes):",
    "    - Drizzle migrations 0000-0010 + my 0011_tenant_call_insights",
    "    - 188 tenant_calls, 106 tenant_call_insights, 17",
    "      tenant_agents, 1 tenant",
    "    - NO 0012_chat_sessions migration",
    "",
    "Steps to actually do the cutover:",
    "  1. Apply David's 0012_chat_sessions to Aurora (via enrichment",
    "     Lambda's migrate action — drop SQL into",
    "     infra/enrichment-lambda/migrations/ and re-zip enrichment).",
    "  2. Decide: do we migrate any data from telegento-pg to Aurora",
    "     (chat sessions in flight, demo seeds we want to keep)? Most",
    "     likely: nothing; both are low-stakes today.",
    "  3. Update telegento/DATABASE_URL secret value to Aurora proxy",
    "     endpoint. Username + password from telegento-prod/db/master",
    "     (different creds than current).",
    "  4. App Runner: bump REDEPLOY_NONCE to 3 to force restart with",
    "     new env (or aws apprunner start-deployment).",
    "  5. Smoke: log in via Cognito, hit /telegento/command-center,",
    "     /agent-report-v3, /coaching-hub, /workbook-chat. Watch",
    "     CloudWatch for connection errors during cold start.",
    "  6. If anything breaks: roll back DATABASE_URL secret to the",
    "     telegento-pg value and force another deploy. Reversible in",
    "     ~5 min.",
    "",
    "Risk: RDS Proxy enforces IAM auth for the new role we created",
    "if configured — confirm the proxy accepts username/password from",
    "the master secret. If not, switch to the proxy's IAM auth path",
    "and the App Runner instance role gets rds-db:connect on it.",
  ].join("\n"),

  "step-C-pipeline-D-cost-guardrails": [
    "INTERMEDIATE LIFT (half day). Earlier card was a stub.",
    "",
    "Three layers to wire up:",
    "  1. Storage. New Aurora table tenant_token_usage(tenant_id,",
    "     date, input_tokens, output_tokens, request_count, model)",
    "     UPSERTed by the insight Lambda after each call.",
    "  2. Per-tenant daily cap. Insight Lambda reads",
    "     tenant_token_usage at start, compares to per-tenant cap",
    "     stored in tenants table (new column daily_token_cap, NULL",
    "     = unlimited, default 5_000_000 = ~$1.50/day at 2.5-flash).",
    "     If exceeded, Lambda returns {ok:false, error:'cap_exceeded'}",
    "     without calling Gemini. Auto-chain logs the cap-exceeded",
    "     message to enrichment's CloudWatch and surfaces as an",
    "     admin-callout (severity=action_required).",
    "  3. Kill switch. SSM parameter /telegento/insight/enabled (string",
    "     'true'/'false'). Insight Lambda reads at module scope (cold-",
    "     start cached) and bails fast if false. Set via aws ssm",
    "     put-parameter, no Lambda redeploy needed.",
    "",
    "Defensible: dollar amounts are predictable. 2.5-flash is",
    "$0.075/1M input + $0.30/1M output. A 1M-input + 200k-output day =",
    "~$0.14. The 5M-token default cap = ~$1.50 worst case per tenant",
    "per day. Surface the running total + remaining budget on the",
    "command-center, alongside the unknown-agent callout.",
  ].join("\n"),
}

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
  for (const [id, desc] of Object.entries(REFRESH_DESCRIPTIONS)) {
    await db
      .update(operatorPlanSteps)
      .set({ description: desc, updatedAt: now })
      .where(eq(operatorPlanSteps.id, id))
    console.log(`Refreshed ${id}`)
  }

  // Insert new sub-cards (idempotent)
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
      console.log(`Inserted ${s.id} [${s.status}]`)
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
