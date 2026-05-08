/**
 * 2026-05-04 evening — Gemini insight Lambda landed end-to-end.
 *
 * What works:
 *   - tenant_call_insights table created (migration 0011)
 *   - telegento-prod-insight Lambda deployed (CFN stack telegento-prod-insight)
 *   - Single-call mode: { mode: "single", call_id: "..." } scores one call,
 *     writes tenant_call_insights row, updates tenant_calls.aggregate_score
 *     / theme / opportunity_bucket
 *   - Backfill mode: { mode: "backfill", limit: N, skip_unknown: true }
 *     processes N un-scored calls in one invocation
 *   - First real call (Ian Fallon, 117s): score 50, "Client becomes agitated
 *     and ends call after learning final expense insurance is not free,
 *     accusing agent of scam" → bucket: lost
 *   - 1454 input + 586 output tokens per call, ~$0.0003 each, ~9-12s per call
 *
 * Plan deltas:
 *   - step-C-pipeline-D-trigger    [open] → covered (insight Lambda live)
 *   - step-C-pipeline-D-gemini-source [open] → covered (key in
 *                                                Telegento Secrets Manager)
 *   - NEW step-C-pipeline-D-insight-lambda [covered] under step-C-pipeline-D
 *   - step-C-pipeline-D parent [open] → in-motion (auto-trigger + cost
 *                                          guardrails still pending)
 *
 * Idempotent.
 */

import { and, eq, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"

const NEW_CARD_ID = "step-C-pipeline-D-insight-lambda"
const NEW_CARD_TITLE = "Insight Lambda — Gemini scoring of tenant_calls rows"
const NEW_CARD_DESCRIPTION = [
  "COVERED 2026-05-04 (evening). On-demand Gemini scoring of tenant_calls",
  "rows. Two modes:",
  "  - { mode: 'single', call_id: '...' }",
  "  - { mode: 'backfill', limit: N, skip_unknown: true }",
  "",
  "Pipeline shape:",
  "  tenant_calls (Aurora) ─► insight Lambda ─► Vertex AI Gemini (BAA path)",
  "                                  │",
  "                                  ▼",
  "                          tenant_call_insights row +",
  "                          tenant_calls.{aggregate_score,",
  "                                         theme, opportunity_bucket}",
  "",
  "Files:",
  "  - infra/insight-lambda/handler.py (pure stdlib + psycopg2 + boto3)",
  "  - infra/insight-lambda.cfn.yml",
  "  - infra/enrichment-lambda/migrations/0011_tenant_call_insights.sql",
  "",
  "Stack: telegento-prod-insight (CREATE_COMPLETE).",
  "Secret: telegento-prod/gemini/api-key-pXrFQc (BAA-Gemini).",
  "Model: gemini-2.5-flash. ~$0.0003 / call. ~9-12s elapsed per call.",
  "",
  "First real call validation (Ian Fallon, 117s, 7ee014456b42eb2cd16b8194):",
  "  score=50, theme='Client becomes agitated and ends call after learning",
  "  final expense insurance is not free, accusing agent of scam',",
  "  bucket=lost.",
  "",
  "5-call backfill (random sample) showed varied, useful insights:",
  "  - rapport vs control issues (Norm Tomlinson, 63, needs_followup)",
  "  - missed bank confirmation (Aimee Baldevieso, 75, compliance_risk)",
  "  - competitor objection (Aimee Baldevieso, 75, objection_unresolved)",
  "  - payment-method compliance gap (Brudara Deoliviera, 63,",
  "    compliance_risk)",
  "  - existing-coverage rapport (Brudara Deoliviera, 63, needs_followup)",
  "",
  "Next (in step-C-pipeline-D-trigger / D-cost-guardrails):",
  "  - Auto-chain from enrichment Lambda (or scheduled batch)",
  "  - Per-tenant daily token cap",
  "  - Surface insights in Telegento UI (agent-report-v3, coaching-hub)",
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

  // Cover the existing cards we just satisfied
  for (const id of ["step-C-pipeline-D-trigger", "step-C-pipeline-D-gemini-source"]) {
    await db
      .update(operatorPlanSteps)
      .set({ status: "covered", updatedAt: now })
      .where(eq(operatorPlanSteps.id, id))
    console.log(`Covered ${id}`)
  }

  // Move D parent to in-motion
  await db
    .update(operatorPlanSteps)
    .set({ status: "in-motion", updatedAt: now })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-D"))
  console.log("step-C-pipeline-D → in-motion")

  // Insert / refresh the new card
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(eq(operatorPlanSteps.id, NEW_CARD_ID))
  if (existing.length > 0) {
    await db
      .update(operatorPlanSteps)
      .set({ title: NEW_CARD_TITLE, description: NEW_CARD_DESCRIPTION, status: "covered", updatedAt: now })
      .where(eq(operatorPlanSteps.id, NEW_CARD_ID))
    console.log(`Refreshed ${NEW_CARD_ID}`)
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
      parentStepId: "step-C-pipeline-D",
      createdAt: now,
      updatedAt: now,
    })
    console.log(`Inserted ${NEW_CARD_ID} [covered] under step-C-pipeline-D`)
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
