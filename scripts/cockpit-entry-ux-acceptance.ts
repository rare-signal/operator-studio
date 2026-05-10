/**
 * Acceptance gate for the cockpit entry-UX changes
 * (step-cockpit-entry-ux-persistent-anointing).
 *
 * Asserts (DB-level — no dev server required):
 *   1. Synthetic workspace with 0 lanes
 *        → /api/operator-studio/work-lanes equivalent (listWorkLanes +
 *          enrichWorkLanes) returns an empty array. The cockpit's
 *          entry view renders the "+ Create new lane" CTA in this
 *          state; no auto-route happens.
 *   2. Synthetic workspace with 2 lanes (one with exec + one bare)
 *        → enriched list returns both lanes in createdAt order. The
 *          lane with an exec carries exec metadata; the bare lane has
 *          exec = null. liveWorkerCount + readyForReviewCount are
 *          computed (0 here — no bindings).
 *   3. Synthetic workspace with backfilled Default lane only
 *        → enriched list returns it as one ordinary row. No "default
 *          flag" / no special routing field. The cockpit must treat
 *          it like any other lane.
 *   4. Reload-resilience: after setLaneExec persists per-lane, a fresh
 *      listWorkLanes returns the lane with execAgentId still set —
 *      proving the cockpit can derive its exec from the backend on
 *      reload rather than localStorage.
 *
 * Synthetic ids are namespaced with `acceptance_entry_*`; synthetic
 * workspaces are created (and torn down via ON DELETE CASCADE) so no
 * production GLOBAL data is mutated.
 */

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
  enrichWorkLanes,
  listWorkLanes,
  setLaneExec,
} = await import("../lib/operator-studio/work-lanes")
const { setCockpitExec, clearCockpitExec } = await import(
  "../lib/operator-studio/cockpit-execs"
)
const { backfillDefaultLanes } = await import(
  "../lib/operator-studio/work-lanes"
)

const STAMP = Date.now().toString(36)
const WS_EMPTY = `acceptance_entry_empty_${STAMP}`
const WS_TWO = `acceptance_entry_two_${STAMP}`
const WS_DEFAULT = `acceptance_entry_default_${STAMP}`
const EXEC_AGENT = "claude:__acceptance_entry_exec__"

let assertions = 0
function assert(cond: unknown, label: string): asserts cond {
  assertions++
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`)
  console.log(`  ✓ ${label}`)
}

async function ensureWorkspace(id: string, label: string) {
  const db = getDb()
  const now = new Date()
  await db
    .insert(workspaces)
    .values({ id, label, isGlobal: 0, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
}

async function deleteWorkspace(id: string) {
  const db = getDb()
  await db.delete(workspaces).where(eq(workspaces.id, id))
}

async function main() {
  console.log(`[acceptance] synthetic workspaces stamp=${STAMP}\n`)

  await Promise.all([
    ensureWorkspace(WS_EMPTY, "Acceptance — entry UX (empty)"),
    ensureWorkspace(WS_TWO, "Acceptance — entry UX (two lanes)"),
    ensureWorkspace(WS_DEFAULT, "Acceptance — entry UX (default-only)"),
  ])

  // ── 1. zero lanes → enriched list is empty (CTA-only entry view) ──
  console.log("[1] workspace with 0 lanes returns empty enriched list")
  const emptyLanes = await listWorkLanes(WS_EMPTY)
  const emptyEnriched = await enrichWorkLanes(emptyLanes)
  assert(
    Array.isArray(emptyEnriched) && emptyEnriched.length === 0,
    `enrichWorkLanes returns [] for empty workspace (got ${emptyEnriched.length})`
  )

  // ── 2. two lanes (one with exec, one bare) → both returned, enriched ──
  console.log("\n[2] two lanes (one anointed, one bare) round-trip with metadata")
  const laneAnointed = await createWorkLane({
    workspaceId: WS_TWO,
    name: "Anointed lane",
    description: "exec already set",
  })
  await setLaneExec(laneAnointed.id, {
    agentId: EXEC_AGENT,
    agentKind: "claude",
  })
  const laneBare = await createWorkLane({
    workspaceId: WS_TWO,
    name: "Bare lane",
    description: "no exec yet",
  })
  const twoLanes = await listWorkLanes(WS_TWO)
  const twoEnriched = await enrichWorkLanes(twoLanes)
  assert(
    twoEnriched.length === 2,
    `two enriched lanes (got ${twoEnriched.length})`
  )
  const anointed = twoEnriched.find((l) => l.id === laneAnointed.id)
  const bare = twoEnriched.find((l) => l.id === laneBare.id)
  assert(anointed != null, "anointed lane present in enriched list")
  assert(bare != null, "bare lane present in enriched list")
  assert(
    anointed!.execAgentId === EXEC_AGENT,
    "anointed lane carries execAgentId (backend source of truth)"
  )
  assert(
    anointed!.exec != null && anointed!.exec.agentId === EXEC_AGENT,
    "anointed lane carries enriched exec block"
  )
  assert(
    bare!.exec === null,
    "bare lane reports exec = null (entry view should render 'no exec set')"
  )
  assert(
    typeof anointed!.liveWorkerCount === "number" &&
      typeof anointed!.readyForReviewCount === "number",
    "counts are numeric (no bindings yet → 0 each)"
  )
  assert(
    anointed!.liveWorkerCount === 0 && anointed!.readyForReviewCount === 0,
    "no bindings → both counts are 0"
  )

  // ── 3. backfilled Default lane only → ordinary row, no special flag ──
  console.log("\n[3] workspace with backfilled Default lane only renders as one row")
  await setCockpitExec({
    workspaceId: WS_DEFAULT,
    agentId: EXEC_AGENT,
    agentKind: "claude",
  })
  const beforeBackfill = await listWorkLanes(WS_DEFAULT)
  assert(
    beforeBackfill.length === 0,
    `default-only workspace has 0 lanes pre-backfill (got ${beforeBackfill.length})`
  )
  await backfillDefaultLanes()
  const defaultLanes = await listWorkLanes(WS_DEFAULT)
  const defaultEnriched = await enrichWorkLanes(defaultLanes)
  assert(
    defaultEnriched.length === 1,
    `backfill produced exactly 1 lane (got ${defaultEnriched.length})`
  )
  const def = defaultEnriched[0]
  assert(
    def.name === "Default lane",
    `lane labelled "Default lane" (got "${def.name}")`
  )
  assert(
    !("isDefault" in def) && !("auto" in def) && !("special" in def),
    "no special-route flag on the row — cockpit treats it as one of N"
  )
  assert(
    def.execAgentId === EXEC_AGENT,
    "default lane inherits exec from operator_cockpit_execs"
  )

  // ── 4. reload resilience: per-lane exec persists across listWorkLanes ──
  console.log("\n[4] persistent anointing: re-fetch after setLaneExec still has exec")
  const refetched = await listWorkLanes(WS_TWO)
  const anointedAgain = refetched.find((l) => l.id === laneAnointed.id)
  assert(
    anointedAgain?.execAgentId === EXEC_AGENT,
    "exec still set on lane after re-fetch (cockpit can derive on reload)"
  )

  console.log(`\n✅ ${assertions} assertions green\n`)
}

main()
  .catch((err) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await Promise.all([
        clearCockpitExec(WS_DEFAULT).catch(() => null),
        deleteWorkspace(WS_EMPTY).catch(() => null),
        deleteWorkspace(WS_TWO).catch(() => null),
        deleteWorkspace(WS_DEFAULT).catch(() => null),
      ])
    } finally {
      await getPgPool().end()
    }
  })
