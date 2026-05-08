/**
 * 2026-05-04 evening pivot follow-up: the MWAA transcription DAG was merged but
 * never run — MWAA workers stopped picking up queued runs, so we built a
 * dedicated Lambda (telegento-prod-transcribe) that reads manifests, calls
 * Deepgram nova-3, and writes transcripts back to S3. EventBridge then chains
 * to the enrichment Lambda.
 *
 * Smoke-tested + backfilled 188 manifests end-to-end this evening:
 *   - 188/188 transcripts written
 *   - 188/188 tenant_calls rows
 *   - 111 resolved agents, 77 placeholders (Snowflake GHL coverage gap, not a
 *     pipeline bug)
 *   - 0 DLQ messages on either Lambda
 *
 * Plan deltas:
 *   - step-C-pipeline-B-replay  [open] → covered (the backfill happened, just
 *                                              via Lambda, not MWAA)
 *   - step-C-pipeline-B5        [open] → skipped (MWAA smoke test obviated by
 *                                              the Lambda-path pivot)
 *   - step-C-pipeline-B         [in-motion] → covered (all children resolved)
 *   - NEW: step-C-pipeline-transcribe-lambda [covered] under step-C-pipeline-B
 *
 * Idempotent on insert and on the status flips.
 */

import { and, eq, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"

const NEW_CARD_ID = "step-C-pipeline-transcribe-lambda"
const NEW_CARD_TITLE = "Transcribe Lambda — Deepgram nova-3 path that replaced MWAA"
const NEW_CARD_DESCRIPTION = [
  "COVERED 2026-05-04 (evening). When MWAA workers stopped picking up the",
  "transcribe_enrollhere_recordings DAG, we built telegento-prod-transcribe",
  "(pure-stdlib Python Lambda, urllib + boto3, no vendored deps) and wired",
  "S3 EventBridge on PutObject of enrollhere/manifests/* to fire it. The",
  "Lambda reads manifest + audio from S3, POSTs audio bytes to Deepgram",
  "nova-3 (secret arn .../deepgram/api-key-pjDAA3), writes the transcript",
  "JSON back to enrollhere/transcripts/<event_id>.json. EventBridge on the",
  "transcripts/ prefix then triggers the enrichment Lambda.",
  "",
  "Smoke + backfill 2026-05-04:",
  "  - 188/188 manifests transcribed end-to-end",
  "  - 188/188 tenant_calls rows written via the cascade",
  "  - 111 rows with resolved agents (Colin Allen, Jamie Webb, Norm",
  "    Tomlinson, Darrel Bowens, Ian Fallon, Brudara Deoliviera, Dylan",
  "    Bronstrop, Jimlee Paul, Thomas Bedgood, Comysion Mcfadden, ...)",
  "  - 77 rows with Unknown Agent placeholder — these are the call_ids that",
  "    do not have a matching enrollhere_id in RAW.GO_HIGH_LEVEL.CALLS;",
  "    Lambda gracefully degrades. Reconciliation is a future task once",
  "    Mickey's GHL export catches up or once we identify why those calls",
  "    aren't appearing.",
  "  - 0 DLQ depth on either Lambda",
  "",
  "MWAA DAG (transcribe_enrollhere_recordings) is left in place but PAUSED —",
  "non-destructive per the 'never tear down shared infra' rule. Reversible",
  "via `dags unpause` if we ever decide to flip back.",
].join("\n")

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

  // 1. step-C-pipeline-B-replay → covered
  await db
    .update(operatorPlanSteps)
    .set({
      status: "covered",
      description:
        "COVERED 2026-05-04 — the 188 manifests already in S3 (we said 174 in the original card; actual count was 188) were transcribed end-to-end via the new telegento-prod-transcribe Lambda + EventBridge cascade. 188/188 tenant_calls rows written; 111 agent-resolved, 77 placeholder. 0 DLQ messages.",
      updatedAt: now,
    })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-B-replay"))
  console.log("Updated step-C-pipeline-B-replay → covered")

  // 2. step-C-pipeline-B5 → skipped
  await db
    .update(operatorPlanSteps)
    .set({
      status: "skipped",
      description:
        "SKIPPED 2026-05-04 — superseded by the Lambda-based transcribe path. The DAG MR (!1548) DID merge in airflow-scripts (commit afa930e5) and the DAG is left in MWAA as PAUSED, but the MWAA smoke test never happened: when workers stopped picking up queued runs we pivoted to telegento-prod-transcribe Lambda. See step-C-pipeline-transcribe-lambda for the path that actually delivered the backfill.",
      updatedAt: now,
    })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-B5"))
  console.log("Updated step-C-pipeline-B5 → skipped")

  // 3. step-C-pipeline-B parent → covered (all children resolved)
  await db
    .update(operatorPlanSteps)
    .set({ status: "covered", updatedAt: now })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-B"))
  console.log("Updated step-C-pipeline-B → covered")

  // 4. Insert step-C-pipeline-transcribe-lambda (idempotent)
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(eq(operatorPlanSteps.id, NEW_CARD_ID))
  if (existing.length > 0) {
    await db
      .update(operatorPlanSteps)
      .set({ description: NEW_CARD_DESCRIPTION, status: "covered", updatedAt: now })
      .where(eq(operatorPlanSteps.id, NEW_CARD_ID))
    console.log(`Refreshed existing ${NEW_CARD_ID}`)
  } else {
    const baseOrder =
      ((
        await db
          .select({ max: max(operatorPlanSteps.stepOrder) })
          .from(operatorPlanSteps)
          .where(eq(operatorPlanSteps.planId, planId))
      )[0]?.max ?? -1) + 1
    await db.insert(operatorPlanSteps).values({
      id: NEW_CARD_ID,
      planId,
      workspaceId: WORKSPACE_ID,
      title: NEW_CARD_TITLE,
      description: NEW_CARD_DESCRIPTION,
      stepOrder: baseOrder,
      status: "covered",
      parentStepId: "step-C-pipeline-B",
      createdAt: now,
      updatedAt: now,
    })
    await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, planId))
    console.log(`Inserted ${NEW_CARD_ID} [covered] under step-C-pipeline-B`)
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
