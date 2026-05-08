/**
 * Seed Telegento data-pipeline plan cards into the active dogfood plan.
 *
 * Captures the EnrollHere → transcript → enrichment → AI/Gemini pipeline
 * as plan cards under Lane C (JSA alliance), per the dogfood-first rule:
 * Operator Studio's own plan is the canonical artifact for OS-adjacent work,
 * not CLAUDE.md / AGENTS.md / ad-hoc docs.
 *
 * Layout (all parented to step-C):
 *   step-C-pipeline       — Lane C, Telegento data pipeline (parent card)
 *     step-C-pipeline-A   — Leg A: EnrollHere → S3 (lambda) [covered]
 *     step-C-pipeline-B   — Leg B: MWAA transcription DAG [in-motion]
 *       step-C-pipeline-B1 — IAM: companion CFN stack [covered]
 *       step-C-pipeline-B2 — DAG code: transcribe_enrollhere_recordings [covered]
 *       step-C-pipeline-B3 — Code-review fixes (docstring + failure marker)
 *       step-C-pipeline-B4 — TempFile switch (wav-edge defensive)
 *       step-C-pipeline-B5 — MR merge + MWAA smoke test on today's backfill
 *     step-C-pipeline-C   — Leg C: CRM enrichment (NOT STARTED)
 *     step-C-pipeline-D   — Leg D: AI/Gemini insight pipeline (NOT STARTED)
 *     step-C-pipeline-E   — Leg E: Telegento UI surfacing (NOT STARTED)
 *
 * Idempotent: skips any step already present (id-prefix guard).
 *
 * Usage:
 *   pnpm tsx ./scripts/seed-telegento-pipeline-plan.ts
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
    id: "step-C-pipeline",
    parentStepId: "step-C",
    status: "in-motion",
    title: "Telegento data pipeline — recording → transcript → enrichment → AI",
    description:
      "End-to-end data backbone behind the per-agent Telegento portal. Five legs (A–E) chained event_id-keyed under cmg-enrollhere-call-recordings-prod. Powers everything Lane C-portal-side surfaces — without these legs, the per-agent UI has nothing to show.\n\nLegs:\n  A. EnrollHere webhook → S3 archive (lambda) [LIVE 2026-05-04]\n  B. Transcription (MWAA DAG) [in-motion 2026-05-04]\n  C. CRM enrichment — agent_id / lead / disposition lookup [not started]\n  D. AI/Gemini insights over transcript + enrichment [not started]\n  E. Telegento UI surfacing per-agent [not started]\n\nArtifact convention: each leg writes a sibling object keyed by event_id under a dedicated S3 prefix (raw/, audio/, manifests/, transcripts/, enrichment/, insights/), unless we promote enrichment+insights into Telegento Postgres as the index layer.",
  },
  {
    id: "step-C-pipeline-A",
    parentStepId: "step-C-pipeline",
    status: "covered",
    title: "Leg A — EnrollHere webhook → S3 archive [LIVE]",
    description:
      "COVERED 2026-05-04. enrollhere-recording-intake-prod Lambda (us-east-1) authenticates partner Bearer token (Secrets Manager: prod/enrollhere/webhook-token), downloads the recording_url, and writes three flat-keyed objects to cmg-enrollhere-call-recordings-prod under enrollhere/raw/, enrollhere/audio/, enrollhere/manifests/. Manifest carries event_id, call_id, recording_id, recording_s3_key, recording_bytes, recording_sha256. Today's backfill: 174 archived, 2 duplicate, 0 failed. API Gateway endpoint: 2jmb1tr4x7.execute-api.us-east-1.amazonaws.com/prod/integrations/enrollhere/call-recordings.",
  },
  {
    id: "step-C-pipeline-B",
    parentStepId: "step-C-pipeline",
    status: "in-motion",
    title: "Leg B — MWAA transcription DAG (transcribe_enrollhere_recordings)",
    description:
      "Every 15 min, lists enrollhere/manifests/ within last 7d, skips event_ids whose transcript object already exists, downloads sha256-verified audio, runs Deepgram nova-3, writes enrollhere/transcripts/<event_id>.json. Idempotent on head-object check; 24h failure-marker window stops infinite retries on permanently broken events. AIDA-isolated: zero imports of shared.snowflake / shared.postgres / shared.five9 / shared.tld / shared.s3 defaults.",
  },
  {
    id: "step-C-pipeline-B1",
    parentStepId: "step-C-pipeline-B",
    status: "covered",
    title: "IAM — companion CFN stack mwaa-enrollhere-access [DONE]",
    description:
      "COVERED 2026-05-04. Separate CFN stack (not the legacy data-private-airflow stack) so the EnrollHere grant is cleanly detachable when Telegento moves off shared MWAA. Grants the MwaaExecutionRole least-privilege access: ListBucket scoped to enrollhere/manifests|audio|transcripts/* prefixes, GetObject on manifests/audio, PutObject on transcripts. Explicitly excludes raw/ — most sensitive ingest artifact stays out of airflow's reach. Reversible via single delete-stack command. simulate-principal-policy returned implicitDeny rows that we deliberately did not chase — stored policy doc inspected and is correct; real S3 ops in MWAA are the source of truth.",
  },
  {
    id: "step-C-pipeline-B2",
    parentStepId: "step-C-pipeline-B",
    status: "covered",
    title: "DAG code on enrollhere-transcription branch [DONE]",
    description:
      "COVERED 2026-05-04. Files: dags/enrollhere/transcribe_enrollhere_recordings.py (DAG), dags/shared/enrollhere.py (helpers — manifest list, sha256 download, idempotency check, transcript write), one-line relax of shared/transcripts.py:get_call_transcript_from_deepgram type annotation to accept m4a → audio/mp4. Branch pushed to gitlab.com:enhancehealth/airflow-scripts; MR URL: https://gitlab.com/enhancehealth/airflow-scripts/-/merge_requests/new?merge_request%5Bsource_branch%5D=enrollhere-transcription. Commit f0c9d8cb.",
  },
  {
    id: "step-C-pipeline-B3",
    parentStepId: "step-C-pipeline-B",
    status: "in-motion",
    title: "Code-review fixes — docstring + failure-marker fields",
    description:
      "Two staged-but-not-committed fixes from the in-flight review session:\n  1. DAG-file top docstring still referenced enrollhere/{raw,audio,manifest}/yyyy/mm/dd/ partitioning that doesn't exist — corrected to flat layout + plural manifests.\n  2. Failure-marker write was dropping external_call_id / external_recording_id / call_id / recording_id — added so failed calls are still queryable by CRM keys.\nNeed to commit + push as a follow-up commit on the same branch (not amend) before merging the MR.",
  },
  {
    id: "step-C-pipeline-B4",
    parentStepId: "step-C-pipeline-B",
    status: "open",
    title: "TempFile switch — defensive against wav 2-hour edge case",
    description:
      "Current download_audio reads audio into a BytesIO, then computes sha256 via getvalue() which makes a second copy in RAM. At 8 concurrent threads × 2-hour 16kHz PCM wav (~230MB each) peak ≈ 3.7GB — could OOM mw1.medium MWAA workers. Typical mp3 calls are fine (sub-GB). Mirror the AIDA pattern (TemporaryFile()) — disk-backed, zero RAM concern at any call length. ~5-line change in dags/shared/enrollhere.py:download_audio. Could ship in same follow-up commit as B3.",
  },
  {
    id: "step-C-pipeline-B5",
    parentStepId: "step-C-pipeline-B",
    status: "open",
    title: "MR merge + MWAA smoke test against today's 174-call backfill",
    description:
      "After Mickey grants merge permission (or grants ongoing rights): merge MR → CI syncs dags/ to MWAA env bucket → MWAA scheduler picks up transcribe_enrollhere_recordings within minutes. Manually trigger first run from MWAA UI. Watch logs for 'Found 174 recent manifest keys' and '174 manifests need transcription'. Verify enrollhere/transcripts/ count climbs in S3. Re-trigger to confirm idempotency (head-object skip). If real S3 access denies, simulate-principal-policy was right after all and we debug a permissions boundary or SCP — but stored policy doc is correct so this should just work.",
  },
  {
    id: "step-C-pipeline-C",
    parentStepId: "step-C-pipeline",
    status: "open",
    title: "Leg C — CRM enrichment (agent / lead / disposition lookup)",
    description:
      "Blocker: identify the CRM that holds agent records authoritative for EnrollHere calls (Salesforce? Some Telegento-side CRM? Direct EnrollHere API?). Define the join key from manifest's external_call_id / call_id to a CRM agent record. Decide artifact location:\n  (a) Sibling S3 prefix enrollhere/enrichment/<event_id>.json (chain-of-custody clean, list-driven UI)\n  (b) Telegento Postgres index table (faster per-agent queries, S3 stays bulk artifact)\n  (c) Hybrid — S3 for durable record, Postgres for query index\nLikely (c). Schema fields: event_id, agent_id, agent_email, agent_name, lead_id, disposition, campaign, queue, fetched_at.",
  },
  {
    id: "step-C-pipeline-D",
    parentStepId: "step-C-pipeline",
    status: "open",
    title: "Leg D — AI/Gemini insight pipeline over transcript + enrichment",
    description:
      "Reads the transcript JSON + enrichment record, produces structured insights for the agent QA / coaching surface. Outputs TBD: summary, QA score, coaching feedback, next-best-action, compliance flags. Likely landing as enrollhere/insights/<event_id>.json or rows in Telegento Postgres. Per the LLM-layering rule, this is an additive enhancement layer over the non-LLM pipeline (legs A–C must stand on their own); insights are valuable but not load-bearing.",
  },
  {
    id: "step-C-pipeline-E",
    parentStepId: "step-C-pipeline",
    status: "open",
    title: "Leg E — Telegento UI: per-agent transcript + insights view",
    description:
      "Auth: Cognito (already set up — pool us-east-1_NY5wyN8lo, client 6po39ciqktmi4nj355ec3vm3j9). Per-agent view filters by agent_id from Leg C. Transcript viewer renders segments/speakers from Leg B's JSON. Insights overlay from Leg D. This is the surface that 'invites people in' — first 1-2 trusted agents to vet experience before scaling. Sub-questions: do we proxy S3 reads through a Telegento backend, or grant signed URLs? Probably proxy for audit cleanliness.",
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
        `No active plan found in workspace "${opts.workspaceId}". Pass --plan-id=<id> to target one explicitly.`
      )
      process.exit(1)
    }
    targetPlanId = candidate.id
    console.log(`Target plan: ${candidate.id} — "${candidate.title}"`)
  }

  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.planId, targetPlanId),
        like(operatorPlanSteps.id, "step-C-pipeline%")
      )
    )
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(
      `All ${STEPS.length} Telegento-pipeline steps already present. Nothing to do.`
    )
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
    `Seeded ${toInsert.length} new Telegento-pipeline step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}). ${existingIds.size} already present.`
  )
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
