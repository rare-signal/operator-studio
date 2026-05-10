/**
 * Acceptance gate for the 2026-05-09 plan-cleanup field report.
 *
 * Hits the operator_plans / operator_plan_steps tables directly and
 * asserts the post-cleanup invariants:
 *
 *   - Exactly 3 plans remain non-archived: OS-meta (pinned), CMG, Valikharlia.
 *   - The 3 trash plans are archived.
 *     (Note: operator_plans has no `deleted_at` column; archived state is
 *      the soft-delete shape per the field report's plan.)
 *   - The Valikharlia plan has ≤ 30 active cards.
 *   - Every Valikharlia card uses the canonical {open|in-motion|covered|skipped} statuses.
 *   - The 6 OS-meta bucket cards exist as top-level lanes in the OS plan.
 *   - The 5 CMG top-level lanes exist in the CMG plan.
 *
 * Exit 0 = green, exit 1 = a contract assertion failed.
 */
import { Pool } from "pg"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env.local" })

const PLAN_OS = "plan-1777793035871-dkq1b8"
const PLAN_VAL = "plan-valikharlia-agentic-studio-buildout"
const PLAN_CMG = "plan-clarifying-media-group-telegento"
const TRASH_PLANS = [
  "plan-draft-global-1776926241051",
  "plan-session-t-2026-04-22T18-15",
  "plan-draft-t-1776930795204",
]

const OS_BUCKET_IDS = [
  "step-os-software-factory-spine",
  "step-os-agent-orchestration",
  "step-os-operations-desk",
  "step-os-idea-gravity",
  "step-os-product-launch-media",
  "step-os-context-and-recency",
]

const CMG_LANE_IDS = [
  "step-cmg-jsa-product",
  "step-cmg-telegento-pipeline",
  "step-cmg-telegento-product",
  "step-cmg-telegento-demo-readiness",
  "step-cmg-cd-safety",
]

const failures: string[] = []
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✔ ${msg}`)
  } else {
    console.error(`  ✘ ${msg}`)
    failures.push(msg)
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  console.log("[plan-cleanup-acceptance]")

  // ── Plans ───────────────────────────────────────────────────────
  const plans = (
    await pool.query(
      `SELECT id, title, state, pinned, archived_at FROM operator_plans`
    )
  ).rows
  type PlanRow = {
    id: string
    title: string
    state: string
    pinned: number
    archived_at: Date | null
  }
  const byId = new Map<string, PlanRow>(
    (plans as PlanRow[]).map((r) => [r.id, r])
  )

  const active = plans.filter(
    (r: { state: string }) => r.state !== "archived"
  )
  const activeIds = new Set(active.map((r: { id: string }) => r.id))

  console.log(`active plans (${active.length}):`, [...activeIds].sort())

  assert(active.length === 3, "exactly 3 plans are non-archived")
  assert(activeIds.has(PLAN_OS), `${PLAN_OS} is non-archived`)
  assert(activeIds.has(PLAN_CMG), `${PLAN_CMG} is non-archived`)
  assert(activeIds.has(PLAN_VAL), `${PLAN_VAL} is non-archived`)

  const osPlan = byId.get(PLAN_OS)
  const valPlan = byId.get(PLAN_VAL)
  assert(!!osPlan && osPlan.pinned === 1, `${PLAN_OS} is pinned`)
  assert(!!valPlan && valPlan.pinned !== 1, `${PLAN_VAL} is unpinned`)

  for (const t of TRASH_PLANS) {
    const p = byId.get(t)
    assert(!!p && p.state === "archived", `trash plan ${t} is archived`)
  }

  // ── Valikharlia step counts + status normalization ──────────────
  const valSteps = (
    await pool.query(
      `SELECT id, status FROM operator_plan_steps
        WHERE plan_id = $1 AND deleted_at IS NULL`,
      [PLAN_VAL]
    )
  ).rows
  console.log(`valikharlia active cards: ${valSteps.length}`)
  assert(valSteps.length <= 30, "Valikharlia has ≤ 30 active cards")

  const canonical = new Set(["open", "in-motion", "covered", "skipped"])
  const nonCanonical = valSteps.filter(
    (r: { status: string }) => !canonical.has(r.status)
  )
  if (nonCanonical.length > 0) {
    for (const r of nonCanonical) {
      console.error(`    non-canonical: ${r.id} status=${r.status}`)
    }
  }
  assert(
    nonCanonical.length === 0,
    "all Valikharlia cards have canonical status (open/in-motion/covered/skipped)"
  )

  // ── OS bucket cards ─────────────────────────────────────────────
  const osBuckets = (
    await pool.query(
      `SELECT id, parent_step_id FROM operator_plan_steps
        WHERE plan_id = $1 AND deleted_at IS NULL AND id = ANY($2::text[])`,
      [PLAN_OS, OS_BUCKET_IDS]
    )
  ).rows
  assert(
    osBuckets.length === OS_BUCKET_IDS.length,
    `all ${OS_BUCKET_IDS.length} OS bucket cards exist in ${PLAN_OS}`
  )
  const osTopLevel = osBuckets.filter(
    (r: { parent_step_id: string | null }) => r.parent_step_id == null
  )
  assert(
    osTopLevel.length === OS_BUCKET_IDS.length,
    "all OS bucket cards are top-level (parent IS NULL)"
  )

  // ── CMG lane cards ─────────────────────────────────────────────
  const cmgLanes = (
    await pool.query(
      `SELECT id, parent_step_id FROM operator_plan_steps
        WHERE plan_id = $1 AND deleted_at IS NULL AND id = ANY($2::text[])`,
      [PLAN_CMG, CMG_LANE_IDS]
    )
  ).rows
  assert(
    cmgLanes.length === CMG_LANE_IDS.length,
    `all ${CMG_LANE_IDS.length} CMG top-level lanes exist in ${PLAN_CMG}`
  )
  const cmgTopLevel = cmgLanes.filter(
    (r: { parent_step_id: string | null }) => r.parent_step_id == null
  )
  assert(
    cmgTopLevel.length === CMG_LANE_IDS.length,
    "all CMG lane cards are top-level (parent IS NULL)"
  )

  await pool.end()

  if (failures.length > 0) {
    console.error(`\nFAILED ${failures.length} assertion(s):`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log("\nALL GREEN")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
