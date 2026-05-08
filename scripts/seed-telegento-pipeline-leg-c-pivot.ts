/**
 * Pivot Leg C from "transcripts → Snowflake" to "event-driven Lambda → Aurora
 * Serverless v2" per the 30-second sidebar architecture lock 2026-05-04.
 *
 * Actions:
 *   - Mark old C1–C5 sub-cards (Snowflake-target) as skipped, with reason
 *   - Rewrite step-C-pipeline-C parent description to the new direction
 *   - Add 6 new sub-cards covering the locked architecture
 *   - Refresh step-C-pipeline-D and step-C-pipeline-E descriptions to read from Aurora
 *
 * Idempotent on insert (id-prefix guard) and on the description rewrites.
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

const NEW_C_PARENT_DESCRIPTION = [
  "Architecture locked 2026-05-04 (sidebar): event-driven Lambda + Aurora Serverless v2.",
  "Snowflake stays read-only (we are a customer, not a producer).",
  "",
  "Flow:",
  "  S3 transcripts/ ──[S3 EventBridge]──► Enrichment Lambda",
  "                                             │",
  "                                             │ reads: Snowflake RAW.GO_HIGH_LEVEL.CALLS (PII_ALLOWED)",
  "                                             │ writes: Aurora Serverless v2 (Telegento DB) via RDS Proxy",
  "                                             ▼",
  "                                       tenant_calls table",
  "",
  "Defensibility: single AWS account boundary, KMS CMK on every storage layer,",
  "private-subnet Aurora, IAM least-privilege per Lambda, CloudTrail data events,",
  "Object Lock on raw audio. Scales to zero idle. Cost is intentionally last priority.",
  "",
  "Old C1–C5 marked skipped — represented the Snowflake-as-target path we abandoned.",
].join("\n")

const NEW_STEPS: SeedStep[] = [
  {
    id: "step-C-pipeline-arch",
    parentStepId: "step-C-pipeline-C",
    status: "covered",
    title: "Target architecture locked — event-driven, serverless, defensible [DONE]",
    description:
      "COVERED 2026-05-04 via 30s sidebar. Picked event-driven Lambda + Aurora Serverless v2 + RDS Proxy as the target shape for Leg C. Criteria order: security, compliance, scalability, headache-aversion, cost (last). Rationale captured in parent card. ASCII shape: S3 transcripts → S3 EventBridge → enrichment Lambda → (reads Snowflake GHL, writes Aurora). MWAA transcription DAG (Leg B) stays as-is — works, audit-defensible, migrate to Lambda in a quiet week if/when worth doing.",
  },
  {
    id: "step-C-pipeline-aurora",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Provision Aurora Serverless v2 PostgreSQL + RDS Proxy",
    description:
      "CFN stack: Aurora Serverless v2 cluster (min 0.5 ACU, max scale-to-load), KMS CMK, private subnets in same VPC as MWAA (or new), security group restricting ingress to RDS Proxy + bastion if needed. RDS Proxy in front for Lambda connection pooling. Apply Telegento drizzle migrations to it (apps/v4/drizzle/0000–0010) so tenant_calls + tenant_agents exist there. Outputs: writer endpoint, reader endpoint, RDS Proxy endpoint, Secrets Manager ARN for the master credentials.",
  },
  {
    id: "step-C-pipeline-lambda",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Enrichment Lambda — reads S3 + Snowflake, writes Aurora",
    description:
      "Lambda function (Python). S3 EventBridge trigger on PutObject under enrollhere/transcripts/. For each event: read transcript JSON from S3, query Snowflake RAW.GO_HIGH_LEVEL.CALLS for the matching enrollhere_id (= manifest call_id), shape a tenant_calls row (agent_id, agent_name, outcome, call_data JSONB with full transcript + GHL metadata), INSERT via RDS Proxy with ON CONFLICT (id) DO UPDATE for idempotency. SQS DLQ for failed events with maxReceiveCount=3. CloudWatch alarms on error rate + DLQ depth.",
  },
  {
    id: "step-C-pipeline-secrets",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Secrets — Snowflake key-pair auth + Aurora master creds",
    description:
      "Snowflake side: reuse AIDA's existing service account (EHTOOLS w/ key-pair, PII_ALLOWED role) by mounting the same Secrets Manager secret to the Lambda — no new Snowflake user needed. Aurora side: Secrets Manager rotation policy on the master creds, Lambda fetches via SDK at cold start (cache for warm invocations). Both encrypted at rest with the same KMS CMK as the rest of the pipeline.",
  },
  {
    id: "step-C-pipeline-events",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "S3 EventBridge wiring — transcripts/ prefix → Lambda",
    description:
      "EventBridge rule on cmg-enrollhere-call-recordings-prod for PutObject events filtered to enrollhere/transcripts/* prefix. Target = enrichment Lambda. Single-shot per object (S3 event idempotent on object key). Document the contract: any object PUT to transcripts/ triggers downstream enrichment exactly once (modulo S3-EventBridge at-least-once semantics, handled by the Lambda's ON CONFLICT idempotency).",
  },
  {
    id: "step-C-pipeline-cutover",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Telegento cutover — point app at Aurora prod (away from local docker)",
    description:
      "Telegento (apps/v4 in nextgen-call-intelligence-shell) currently reads from local docker telegento-db-1. Update DATABASE_URL via Secrets Manager / SSM Parameter Store to point at the RDS Proxy endpoint. Deploy Telegento web/worker to App Runner or Lambda+CloudFront (separate decision; not blocking Leg C ingest). Demo data in current local DB stays useful for dev — prod is fresh.",
  },
  {
    id: "step-C-pipeline-observability",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Observability — DLQ + CloudWatch + audit trail",
    description:
      "CloudWatch alarms: enrichment Lambda error rate >5% (5min window), DLQ depth >0, Aurora ACU max sustained, Snowflake query failures. CloudTrail data events on the bucket (already enabled). Aurora audit logs to CloudWatch. X-Ray tracing on the Lambda for cold-start visibility. Quarterly DLQ replay drill so we know failure recovery works.",
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

  // 1. Skip old C1-C5 (Snowflake-target — superseded by event-driven Lambda + Aurora)
  const oldIds = [
    "step-C-pipeline-C1",
    "step-C-pipeline-C2",
    "step-C-pipeline-C3",
    "step-C-pipeline-C4",
    "step-C-pipeline-C5",
  ]
  await db
    .update(operatorPlanSteps)
    .set({
      status: "skipped",
      description: "SKIPPED 2026-05-04 — superseded by event-driven Lambda + Aurora Serverless v2 architecture (see step-C-pipeline-arch and siblings). The Snowflake schema we briefly created (ENHANCE_HEALTH.ENROLLHERE.TRANSCRIPTS + ENRICHED_TRANSCRIPTS view) was dropped live; we no longer write to Snowflake at all (read-only consumer).",
      updatedAt: new Date(),
    })
    .where(inArray(operatorPlanSteps.id, oldIds))
  console.log(`Skipped ${oldIds.length} old Snowflake-target sub-cards`)

  // 2. Update parent C description
  await db
    .update(operatorPlanSteps)
    .set({ description: NEW_C_PARENT_DESCRIPTION, updatedAt: new Date() })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-C"))
  console.log("Refreshed step-C-pipeline-C description")

  // 3. Refresh D + E descriptions to read from Aurora (not Snowflake)
  await db
    .update(operatorPlanSteps)
    .set({
      description:
        "Reads from Aurora tenant_calls (Leg C output) + GHL agent context that's already joined in. Gemini produces structured insights (summary, QA score, coaching feedback, compliance flags) and writes back into a sibling Aurora table (tenant_call_insights) or appends to call_data JSONB. Per the LLM-layering rule, this is an additive enhancement — Legs A–C stand on their own without it.",
      updatedAt: new Date(),
    })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-D"))
  await db
    .update(operatorPlanSteps)
    .set({
      description:
        "Auth: Cognito (already set up — pool us-east-1_NY5wyN8lo, client 6po39ciqktmi4nj355ec3vm3j9). Per-agent UI queries Aurora tenant_calls (filter by agent_id) + tenant_call_insights for the QA/coaching overlay. Audio playback: signed S3 URLs from the Lambda or via Telegento API endpoint that proxies S3 reads. Hosting: App Runner or Lambda+CloudFront for the Next.js app — decision deferred, not blocking ingest.",
      updatedAt: new Date(),
    })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-E"))
  console.log("Refreshed D + E descriptions")

  // 4. Insert new sub-cards (idempotent)
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(and(eq(operatorPlanSteps.planId, planId), like(operatorPlanSteps.id, "step-C-pipeline-%")))
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = NEW_STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log("All new sub-cards already present.")
  } else {
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
    console.log(`Seeded ${toInsert.length} new architecture sub-cards`)
    for (const s of toInsert) console.log(`  ${s.id}  [${s.status}]  ${s.title}`)
  }
}

main()
  .catch((e) => {
    console.error("Pivot seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
