/**
 * "Let people in" sub-cards under Leg E (Telegento UI) and Leg D (Gemini),
 * after the Leg C smoke test passed live 2026-05-04.
 *
 * Captures the actual gaps to take Telegento from local-docker-demo to
 * real-production-data with real authenticated agents:
 *   - Leg B (MWAA transcription DAG) merge to main — only blocker on the data side
 *   - App-side cutover (Aurora, Cognito env, tenant_id resolution)
 *   - App deployment to AWS
 *   - readActiveTenantWorld → tenant_calls path (vs final-expense demo bundle)
 *   - Coaching/QA insights population (Leg D)
 *
 * Idempotent on insert (id-prefix guard step-C-pipeline-{E,D,B}-).
 */

import { and, eq, inArray, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"

type SeedStatus = "open" | "in-motion" | "covered" | "skipped"

interface SeedStep {
  id: string
  parentStepId: string | null
  title: string
  description: string
  status: SeedStatus
}

const NEW_STEPS: SeedStep[] = [
  // ─── Leg B follow-ups (MWAA / transcription) ─────────────────────────────
  {
    id: "step-C-pipeline-B-merge",
    parentStepId: "step-C-pipeline-B",
    status: "open",
    title: "Merge MR !1548 — only thing gating real transcripts in S3",
    description:
      "The Leg B branch (enrollhere-transcription on airflow-scripts) is pushed but unmerged. Until it merges into main on GitLab, MWAA does not pick up the DAG, no recordings get transcribed, and S3 enrollhere/transcripts/ stays empty. With Mike departing and Mickey hands-off, need to identify who has merge rights on airflow-scripts main and request the merge. Once merged: MWAA picks up the DAG within a couple minutes, first run crunches today's 174-call backfill, transcripts land in S3, EventBridge fires our enrichment Lambda for each, tenant_calls fills in.",
  },
  {
    id: "step-C-pipeline-B-replay",
    parentStepId: "step-C-pipeline-B",
    status: "open",
    title: "Backfill replay — process the 174 manifests already in S3",
    description:
      "Once Leg B merges, MWAA's first scheduled run will see ~174 manifests with no matching transcript, batch through them at 8-thread parallelism, and produce 174 transcript JSONs. EventBridge fires Leg C Lambda 174 times in quick succession. Should land smoothly given Lambda's reserved concurrency = 20. Watch for: Lambda DLQ depth (alarm), Aurora ACU usage spike, Snowflake query rate (tiny). If anything fails, DLQ replay drill from step-C-pipeline-observability.",
  },

  // ─── Leg E (Telegento UI cutover) ────────────────────────────────────────
  {
    id: "step-C-pipeline-E-deploy-target",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Pick + provision Telegento app deploy target (App Runner / Lambda+CF / ECS)",
    description:
      "Telegento (apps/v4) is currently only running locally via docker-compose against telegento-db-1. To let users in, app needs a hosted deploy target reachable on the public internet. Options: (a) AWS App Runner — simplest Next.js deploy, integrated TLS + custom domain, $5/mo idle floor. (b) Lambda + CloudFront via OpenNext — purest serverless, zero idle cost, more setup. (c) ECS Fargate behind ALB — full control, ~$25/mo idle. Recommendation: App Runner for v1 (cheapest defensible serverless with good DX), revisit if scale demands.",
  },
  {
    id: "step-C-pipeline-E-cutover-config",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Cutover env: DATABASE_URL → Aurora Proxy + Cognito creds + V4_AUTH_PASSWORD",
    description:
      "In the deploy target's env (Secrets Manager / Parameter Store):\n  DATABASE_URL=postgres://telegento_admin:<from-aurora-master-secret>@telegento-prod-proxy.proxy-chh3sdtbycfs.us-east-1.rds.amazonaws.com:5432/telegento?sslmode=require\n  COGNITO_DOMAIN=<existing pool's hosted-UI domain>\n  COGNITO_CLIENT_ID=6po39ciqktmi4nj355ec3vm3j9 (existing)\n  COGNITO_CLIENT_SECRET=<rotate fresh, store in Secrets Manager>\n  NEXT_SHARED_DEMO=0 (turn off the demo gate)\n  NEXT_PUBLIC_APP_URL=<the deployed origin>\nApp's middleware.ts has a v4_auth password gate AND IP allowlist — both pre-Cognito. Decide whether to keep them as belt-and-suspenders or remove once Cognito is the gate. Lean toward removing for prod simplicity.",
  },
  {
    id: "step-C-pipeline-E-tenant-resolve",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Resolve prod tenant_id in tenant-context registry",
    description:
      "Minted tenant_id 8f4fc459-6a90-4627-bed9-7d254b366f01 stashed at SSM /telegento/prod/enrollhere-tenant-id. Telegento's lib/telegento/tenant-context.ts resolves the 'active tenant' for the current user. Need to either (a) seed the tenants table with a row for this tenant_id mapped to a slug like 'enrollhere' or 'cmg-prod', and have Cognito-authenticated users default to it, OR (b) per-user tenant resolution via the agents.email ↔ tenant_agents join. Either way: agent's Cognito identity needs to map to tenant_id + agent_id from tenant_agents. tenant_agents table is currently empty for prod tenant — needs seeding from GHL or first-login auto-provision.",
  },
  {
    id: "step-C-pipeline-E-agent-identity",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Wire Cognito identity → agent_id via tenant_agents",
    description:
      "When an authenticated user opens /telegento/agent-report-v3, the app needs to know WHICH agent they are. Path: Cognito id_token claims (email) → tenant_agents.email lookup → agent_id → filter tenant_calls by agent_id. tenant_agents table exists but has no rows for the prod tenant. Two seeding options: (a) Bulk-seed from RAW.GO_HIGH_LEVEL.CALLS DISTINCT (agent_id, agent_email, agent_first_name, agent_last_name) — query Snowflake once, INSERT to tenant_agents. (b) Just-in-time on first login — if Cognito email matches a recent tenant_calls row's call_data.ghl.agent_email, create the tenant_agents row on the fly. (a) is cleaner, has a timing dimension (re-seed periodically) — we already have the Lambda's Snowflake access to do this.",
  },
  {
    id: "step-C-pipeline-E-data-source-flag",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "readActiveTenantWorld: ditch demo bundle for tenant_calls in prod",
    description:
      "lib/telegento/tenant-data.ts:readActiveTenantWorld currently composes from the final-expense-demo-bundle (mounted from /demo-data/final-expense in docker-compose). For prod, it must read from tenant_calls + tenant_agents instead. Code path likely already supports this (NEXT_SHARED_DEMO check exists in lib/runtime-mode.ts) but needs verifying that all surfaces (calls list, agent-report-v3, coaching-report, workbook-chat) read from the DB path when isSharedDemoBuild=false. Audit each /telegento/* route and confirm.",
  },
  {
    id: "step-C-pipeline-E-route-canonicalize",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Pick canonical agent surface — v1 vs v2 vs v3 of agent-report",
    description:
      "Three versions of /telegento/agent-report exist (v1, v2, v3) plus /telegento/agent. For 'letting people in', need to choose the canonical landing surface and document the decision. Likely v3 since it's most recent. Other versions either delete or move to /telegento/_archive/. Same audit needed for /telegento/coaching-report vs /telegento/coaching-hub vs /flow/coaching — three coaching surfaces.",
  },

  // ─── Leg D (Gemini insights) ────────────────────────────────────────────
  {
    id: "step-C-pipeline-D-trigger",
    parentStepId: "step-C-pipeline-D",
    status: "open",
    title: "Insight Lambda — triggered after enrichment Lambda writes tenant_calls",
    description:
      "Second Lambda fires on Aurora INSERT to tenant_calls (DynamoDB Streams-style for Aurora) OR on a scheduled batch every 5 min. Reads new rows, sends transcript + GHL context to Gemini, parses structured response, UPDATEs tenant_calls.aggregate_score / theme / opportunity_bucket and INSERTs into coaching_report_calls. Cleanest trigger: a second EventBridge rule on tenant_calls insert, but Aurora doesn't natively emit those — alternative is Aurora Activity Stream → Kinesis → Lambda, or just have enrichment Lambda chain-invoke the insight Lambda. Chain-invoke is simplest day-1.",
  },
  {
    id: "step-C-pipeline-D-prompts",
    parentStepId: "step-C-pipeline-D",
    status: "open",
    title: "Initial Gemini prompt set — summary, QA score, coaching, compliance",
    description:
      "Four output dimensions for v1: (1) call summary (≤3 sentences), (2) aggregate QA score 0-100 with rubric breakdown, (3) coaching feedback (1-2 specific areas to improve), (4) compliance flag (TPMO/recording-disclosure/eligibility-verification compliance — feeds the SCORECARD_DEFINITIONS already in tenant-data.ts). Prompts live in apps/v4/lib/telegento/insights/prompts.ts (new). Use Anthropic-style structured output via JSON schema enforcement so we can store each dimension as a typed column.",
  },
  {
    id: "step-C-pipeline-D-cost-guardrails",
    parentStepId: "step-C-pipeline-D",
    status: "open",
    title: "Cost guardrails — token budget, Gemini quota, kill-switch",
    description:
      "Per-call: ~5K tokens in, ~500 tokens out → ~$0.01-0.02 per call at Gemini 2.5 Pro pricing. At today's volume (174 calls), ~$2-4 to backfill. At 1000 calls/day, ~$20-40/day. Set a daily token cap in Lambda env, fail-fast if exceeded, and a CloudWatch alarm for daily spend. Also: per-call timeout (Gemini can hang on bad inputs) — 30s ceiling.",
  },
]

const PARENT_DESC_REFRESH = {
  "step-C-pipeline-E": [
    "Per-agent UI surface. Telegento app (apps/v4) already has substantial UI built —",
    "  /telegento/agent-report-v3 (canonical?), /telegento/coaching-report,",
    "  /telegento/coaching-hub, /telegento/workbook-chat, /telegento/calls, etc.",
    "Auth via Cognito callback at /api/auth/cognito-callback (existing handler).",
    "",
    "Gap to 'letting people in' is plumbing, not net-new code:",
    "  E-deploy-target  pick + provision App Runner / Lambda+CF / ECS",
    "  E-cutover-config DATABASE_URL → Aurora Proxy, Cognito env vars, drop demo flag",
    "  E-tenant-resolve seed prod tenant + tenant-context resolution",
    "  E-agent-identity wire Cognito email → tenant_agents.agent_id",
    "  E-data-source    audit each /telegento route reads tenant_calls (not demo bundle)",
    "  E-canonicalize   pick v3 vs v2 vs v1 of agent-report; same for coaching surfaces",
  ].join("\n"),
  "step-C-pipeline-D": [
    "AI/Gemini insight layer over tenant_calls. Reads transcript + GHL context already",
    "joined by Leg C, produces summary + QA score + coaching feedback + compliance flags,",
    "writes back to tenant_calls (aggregate_score / theme / opportunity_bucket) and to",
    "coaching_report_calls table (already in schema, migration 0008).",
    "",
    "Per LLM-layering rule: this is additive — Legs A-C stand without it. Insights",
    "make the per-agent UI useful, not functional.",
    "",
    "  D-trigger        chain-invoke from enrichment Lambda OR scheduled batch",
    "  D-prompts        initial prompt set (summary, QA, coaching, compliance)",
    "  D-cost           daily token cap + CloudWatch spend alarm + per-call timeout",
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

  // Refresh parent descriptions
  for (const [id, desc] of Object.entries(PARENT_DESC_REFRESH)) {
    await db
      .update(operatorPlanSteps)
      .set({ description: desc, updatedAt: new Date() })
      .where(eq(operatorPlanSteps.id, id))
    console.log(`Refreshed ${id} description`)
  }

  // Insert new sub-cards (idempotent)
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(and(eq(operatorPlanSteps.planId, planId), like(operatorPlanSteps.id, "step-C-pipeline-%")))
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = NEW_STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log("All new sub-cards already present.")
    return
  }

  const baseOrder = ((await db.select({ max: max(operatorPlanSteps.stepOrder) }).from(operatorPlanSteps).where(eq(operatorPlanSteps.planId, planId)))[0]?.max ?? -1) + 1
  const now = new Date()
  await db.insert(operatorPlanSteps).values(
    toInsert.map((s, i) => ({
      id: s.id,
      planId,
      workspaceId: WORKSPACE_ID,
      title: s.title,
      description: s.description,
      stepOrder: baseOrder + i,
      status: s.status,
      parentStepId: s.parentStepId,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, planId))

  console.log(`Seeded ${toInsert.length} 'let people in' sub-cards`)
  for (const s of toInsert) console.log(`  ${s.id}  [${s.status}]  ${s.title}`)
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
