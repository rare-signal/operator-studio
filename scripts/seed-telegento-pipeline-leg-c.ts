/**
 * Drill-down for Leg C (Telegento data pipeline → Snowflake) under Lane C.
 *
 * Adds five concrete sub-cards parented to step-C-pipeline-C, capturing the
 * actual table/stage/integration/DAG decisions we landed on after talking to
 * Mickey + querying RAW.GO_HIGH_LEVEL.CALLS directly.
 *
 * Idempotent: skips any step already present (id-prefix guard step-C-pipeline-C%).
 *
 * Usage:
 *   pnpm tsx ./scripts/seed-telegento-pipeline-leg-c.ts
 */

import { and, eq, inArray, like, max } from "drizzle-orm"

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

type SeedStatus = "open" | "in-motion" | "covered" | "skipped"

interface SeedStep {
  id: string
  parentStepId: string | null
  title: string
  description: string
  status: SeedStatus
}

const STEPS: SeedStep[] = [
  {
    id: "step-C-pipeline-C1",
    parentStepId: "step-C-pipeline-C",
    status: "covered",
    title: "Schema + target table — ENHANCE_HEALTH.ENROLLHERE.TRANSCRIPTS [DONE]",
    description:
      "COVERED 2026-05-04. CREATE SCHEMA + CREATE TABLE applied live as PII_ALLOWED via aida-celery-1 docker exec → AIDA shared.snowflake helper. DDL at airflow-scripts:scripts/snowflake/enrollhere/01_schema_and_table.sql. Columns: event_id (PK), call_id, recording_id, external_call_id, external_recording_id, audio_s3_key, manifest_s3_key, manifest_sha256, audio_duration_seconds, audio_channels, transcript_source, success, transcript, segments (VARIANT), words (VARIANT), speakers (VARIANT), failure_stage, error, created_at, loaded_at.",
  },
  {
    id: "step-C-pipeline-C2",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Storage integration ENROLLHERE_S3 [needs ACCOUNTADMIN]",
    description:
      "DDL ready at airflow-scripts:scripts/snowflake/enrollhere/02_storage_integration.sql. Defensible-by-detach: separate from the existing ENHANCE_S3 integration so detaching EnrollHere later is a single DROP INTEGRATION. Allowed locations scoped to s3://cmg-enrollhere-call-recordings-prod/enrollhere/transcripts/ only — cannot read raw, audio, or manifests. After CREATE, immediately DESC INTEGRATION ENROLLHERE_S3 and capture STORAGE_AWS_IAM_USER_ARN + STORAGE_AWS_EXTERNAL_ID for the AWS-side CFN.",
  },
  {
    id: "step-C-pipeline-C3",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "AWS IAM role for Snowflake [needs AWS admin]",
    description:
      "CFN at airflow-scripts:scripts/snowflake/enrollhere/03_iam_role.yml. Creates role snowflake-enrollhere-s3-access with trust policy bound to the Snowflake user ARN + external ID from C2. Read-only, prefix-scoped to enrollhere/transcripts/. Pattern matches the mwaa-enrollhere-access companion stack — separable, named, single-stack-deletes-everything. Apply via aws cloudformation create-stack with the two parameters from DESC INTEGRATION output.",
  },
  {
    id: "step-C-pipeline-C4",
    parentStepId: "step-C-pipeline-C",
    status: "open",
    title: "Stage ENHANCE_HEALTH.ENROLLHERE.TRANSCRIPTS_S3 [needs C2+C3]",
    description:
      "DDL at airflow-scripts:scripts/snowflake/enrollhere/04_stage.sql. Binds the storage integration to the actual bucket prefix and uses STAGING.UTILS.JSON file format. GRANTs USAGE+READ to PII_ALLOWED so the airflow service account can run COPY INTO. After this, COPY INTO ENHANCE_HEALTH.ENROLLHERE.TRANSCRIPTS FROM @TRANSCRIPTS_S3 should work end-to-end.",
  },
  {
    id: "step-C-pipeline-C5",
    parentStepId: "step-C-pipeline-C",
    status: "covered",
    title: "Enriched view + DAG transcripts_to_snowflake [DONE]",
    description:
      "COVERED 2026-05-04. View ENHANCE_HEALTH.ENROLLHERE.ENRICHED_TRANSCRIPTS applied live (compiles, 0 rows expected). LEFT JOIN on call_id ↔ data:properties:enrollhere_id::string. Surfaces agent_id, agent_email, agent_first/last_name, disposition, queue_id, queue_name, from/to_number, caller_state/zip_code, was_connected, call_duration, recording_url alongside transcript_text, segments, words, speakers. DAG dags/enrollhere/transcripts_to_snowflake.py mirrors voicecalls_db_to_snowflake pattern: 15-min schedule, COPY INTO temp + MERGE on event_id (idempotent at row + file level), TriggerDagRunOperator self-rerun. Branch: enrollhere-transcripts-to-snowflake, commit 636d2e1b. MR URL: https://gitlab.com/enhancehealth/airflow-scripts/-/merge_requests/new?merge_request%5Bsource_branch%5D=enrollhere-transcripts-to-snowflake.",
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
      console.error(`No active plan in "${opts.workspaceId}".`)
      process.exit(1)
    }
    targetPlanId = candidate.id
    console.log(`Target plan: ${candidate.id} — "${candidate.title}"`)
  }

  // Refresh the parent C-pipeline-C description to reflect the verified picture.
  const newParentDescription = [
    "Snowflake-as-narrow-waist architecture (verified 2026-05-04 against live data).",
    "",
    "Join key: manifest.call_id ↔ RAW.GO_HIGH_LEVEL.CALLS.data:properties:enrollhere_id::string.",
    "Today's coverage: 131 GHL CALLS rows, 128 with agent (98%), 112 with recording_url.",
    "",
    "Five sub-cards (C1–C5) cover schema/table (PII_ALLOWED, applied), storage integration",
    "(ACCOUNTADMIN, pending), AWS IAM role for Snowflake (AWS admin, pending), stage",
    "(needs C2+C3, pending), and the view + transcripts_to_snowflake DAG (PII_ALLOWED, applied).",
    "",
    "Once C2+C3+C4 land, COPY INTO works and the DAG starts loading rows. The ENRICHED_TRANSCRIPTS",
    "view is the read surface for Telegento UI (Leg E) and Gemini (Leg D).",
  ].join("\n")
  await db
    .update(operatorPlanSteps)
    .set({ description: newParentDescription, updatedAt: new Date() })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-C"))
  console.log("Refreshed step-C-pipeline-C description")

  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.planId, targetPlanId),
        like(operatorPlanSteps.id, "step-C-pipeline-C%")
      )
    )
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(`All ${STEPS.length} Leg C sub-steps already present. Done.`)
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
  await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, targetPlanId))

  console.log(`Seeded ${toInsert.length} Leg C step(s) (orders ${baseOrder}–${baseOrder + toInsert.length - 1}).`)
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
