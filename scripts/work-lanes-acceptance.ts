/**
 * Acceptance gate for the cockpit work-lanes MVP.
 *
 * Asserts (DB-level only — does not require dev server up):
 *   1. listWorkLanes returns the two lanes we create.
 *   2. setLaneExec succeeds on an "available" thread; same thread bound
 *      as worker afterwards reports roleStatus=worker.
 *   3. Role-conflict guard: attempting to set the bound worker as exec
 *      on a second lane throws LaneExecConflictError.
 *   4. addLaneMember + listLaneMembers round-trip for 3 plan-step
 *      members.
 *   5. archiveWorkLane: archived lane is excluded from
 *      listWorkLanes(includeArchived=false) but included when
 *      includeArchived=true.
 *   6. backfillDefaultLanes is idempotent and asserts every workspace
 *      with a cockpit_exec row has an active lane after the call.
 *
 * Synthetic ids are namespaced with `__acceptance_*` and a synthetic
 * workspace is created (and deleted on cleanup) so no production
 * GLOBAL data is mutated. See `step-acceptance-scripts-test-isolation`.
 *
 * Exits 0 on green; on red prints the failing assertion and exits 1.
 */

// Stub `server-only` BEFORE importing the libs that pull it in.
import { createRequire } from "node:module"
const requireFromHere = createRequire(import.meta.url)
const serverOnlyId = requireFromHere.resolve("server-only")
requireFromHere.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

const { getPgPool, getDb } = await import("../lib/server/db/client")
const { workspaces } = await import("../lib/server/db/schema")
const { eq } = await import("drizzle-orm")
const {
  createWorkLane,
  listWorkLanes,
  getWorkLane,
  archiveWorkLane,
  setLaneExec,
  addLaneMember,
  listLaneMembers,
  backfillDefaultLanes,
  LaneExecConflictError,
} = await import("../lib/operator-studio/work-lanes")
const {
  setCockpitExec,
  clearCockpitExec,
  getThreadRoleStatus,
} = await import("../lib/operator-studio/cockpit-execs")
const {
  upsertThreadCardBinding,
  detachThreadCardBinding,
} = await import("../lib/operator-studio/thread-card-bindings")

const TEST_WORKSPACE = `acceptance_lanes_${Date.now().toString(36)}`
const TEST_EXEC_AGENT = "claude:__acceptance_lanes_exec_test__"
const TEST_WORKER_AGENT = "claude:__acceptance_lanes_worker_test__"
const TEST_PLAN_STEPS = [
  "step-acceptance-lanes-1",
  "step-acceptance-lanes-2",
  "step-acceptance-lanes-3",
]

let assertions = 0
function assert(cond: unknown, label: string): asserts cond {
  assertions++
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`)
  console.log(`  ✓ ${label}`)
}

async function ensureWorkspace() {
  const db = getDb()
  const now = new Date()
  // Direct insert — bypass createWorkspace's "global" reservation/slug
  // sanitization; we want a stable synthetic id.
  await db
    .insert(workspaces)
    .values({
      id: TEST_WORKSPACE,
      label: "Acceptance — Work Lanes",
      isGlobal: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
}

async function deleteWorkspaceRow() {
  const db = getDb()
  await db.delete(workspaces).where(eq(workspaces.id, TEST_WORKSPACE))
}

async function main() {
  console.log(`[acceptance] synthetic workspace = ${TEST_WORKSPACE}\n`)

  await ensureWorkspace()

  // ── 1. createWorkLane + listWorkLanes ────────────────────────────
  console.log("[1] create two lanes, list both")
  const laneA = await createWorkLane({
    workspaceId: TEST_WORKSPACE,
    name: "Lane A",
  })
  const laneB = await createWorkLane({
    workspaceId: TEST_WORKSPACE,
    name: "Lane B",
    description: "second lane",
  })
  const lanes = await listWorkLanes(TEST_WORKSPACE)
  assert(lanes.length === 2, `listWorkLanes returns 2 lanes (got ${lanes.length})`)
  assert(
    lanes.some((l) => l.id === laneA.id) &&
      lanes.some((l) => l.id === laneB.id),
    "both lane ids present"
  )

  // ── 2. setLaneExec on lane A ─────────────────────────────────────
  console.log("\n[2] set exec on lane A (available thread)")
  const laneAExec = await setLaneExec(laneA.id, {
    agentId: TEST_EXEC_AGENT,
    agentKind: "claude",
  })
  assert(laneAExec?.execAgentId === TEST_EXEC_AGENT, "lane A exec set")

  // Bind a different thread as a worker so it's roleStatus=worker.
  await upsertThreadCardBinding({
    workspaceId: TEST_WORKSPACE,
    agentId: TEST_WORKER_AGENT,
    agentKind: "claude",
    planStepId: TEST_PLAN_STEPS[0],
    source: "manual",
  })
  const workerRole = await getThreadRoleStatus(
    TEST_WORKSPACE,
    TEST_WORKER_AGENT
  )
  assert(workerRole === "worker", `bound worker reports roleStatus=worker (got ${workerRole})`)

  // ── 3. Role-conflict guard rejects promoting bound worker on lane B ──
  console.log("\n[3] role-conflict guard rejects worker → lane-exec promote")
  let threw = false
  try {
    await setLaneExec(laneB.id, {
      agentId: TEST_WORKER_AGENT,
      agentKind: "claude",
    })
  } catch (err) {
    threw = err instanceof LaneExecConflictError
  }
  assert(threw, "setLaneExec throws LaneExecConflictError for active worker")

  // ── 4. addLaneMember + listLaneMembers ───────────────────────────
  console.log("\n[4] add 3 plan-step members to lane A and list them")
  for (const stepId of TEST_PLAN_STEPS) {
    await addLaneMember(laneA.id, "plan_step", stepId)
  }
  const members = await listLaneMembers(laneA.id)
  assert(
    members.length === TEST_PLAN_STEPS.length,
    `listLaneMembers returns ${TEST_PLAN_STEPS.length} (got ${members.length})`
  )
  for (const stepId of TEST_PLAN_STEPS) {
    assert(
      members.some(
        (m) => m.memberKind === "plan_step" && m.memberId === stepId
      ),
      `member ${stepId} present`
    )
  }

  // ── 5. archiveWorkLane filters out from active list ───────────────
  console.log("\n[5] archive lane A; excluded from active, included with includeArchived")
  await archiveWorkLane(laneA.id)
  const active = await listWorkLanes(TEST_WORKSPACE)
  const all = await listWorkLanes(TEST_WORKSPACE, { includeArchived: true })
  assert(
    !active.some((l) => l.id === laneA.id),
    "archived lane absent from active list"
  )
  assert(
    all.some((l) => l.id === laneA.id),
    "archived lane present when includeArchived=true"
  )
  const refetched = await getWorkLane(laneA.id)
  assert(
    refetched?.archivedAt != null,
    "getWorkLane reports archivedAt set"
  )

  // ── 6. backfill: every workspace with a cockpit_exec has an active lane ──
  console.log("\n[6] backfillDefaultLanes covers workspaces with cockpit_exec rows")
  // Seed a cockpit_exec on a fresh synthetic workspace and remove any
  // lane row we may have inserted there.
  const BACKFILL_WS = `${TEST_WORKSPACE}_bf`
  const db = getDb()
  const now = new Date()
  await db
    .insert(workspaces)
    .values({
      id: BACKFILL_WS,
      label: "Acceptance — Backfill",
      isGlobal: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
  await setCockpitExec({
    workspaceId: BACKFILL_WS,
    agentId: "claude:__acceptance_backfill_exec__",
    agentKind: "claude",
  })
  const before = await listWorkLanes(BACKFILL_WS)
  assert(before.length === 0, `backfill workspace starts with 0 lanes (got ${before.length})`)
  const result = await backfillDefaultLanes()
  assert(
    result.workspaces.includes(BACKFILL_WS),
    `backfill touched workspace ${BACKFILL_WS}`
  )
  const after = await listWorkLanes(BACKFILL_WS)
  assert(
    after.length === 1,
    `backfill produced exactly 1 default lane (got ${after.length})`
  )
  assert(
    after[0].execAgentId === "claude:__acceptance_backfill_exec__",
    "default lane inherits the workspace's cockpit_exec agent"
  )

  // Idempotency: re-running backfill leaves the count unchanged.
  await backfillDefaultLanes()
  const after2 = await listWorkLanes(BACKFILL_WS)
  assert(
    after2.length === 1,
    `backfill is idempotent (still 1, got ${after2.length})`
  )

  // Cleanup the backfill workspace's exec + workspace row.
  await clearCockpitExec(BACKFILL_WS)
  await db.delete(workspaces).where(eq(workspaces.id, BACKFILL_WS))

  console.log(`\n✅ ${assertions} assertions green\n`)
}

main()
  .catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await detachThreadCardBinding(TEST_WORKSPACE, TEST_WORKER_AGENT).catch(
        () => null
      )
      // Cascade through ON DELETE CASCADE on operator_work_lanes.workspace_id.
      await deleteWorkspaceRow().catch(() => null)
    } finally {
      await getPgPool().end()
    }
  })
