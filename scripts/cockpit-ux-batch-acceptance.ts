/**
 * Acceptance gate for the 2026-05-10 cockpit UX batch:
 *   1. Snapshot route: ≤100 turns by default, no `earlierTurnsHidden`.
 *   2. Detach reason column: persisted via detachThreadCardBinding(...,
 *      reason); surfaced through getRecentlyDetachedBindingsSpawnedBy.
 *   3. extractLastAssistantSnippet: returns null with no assistant
 *      turn; ≤80-char string; truncates with "…".
 *   4. autoDetachStaleReadyWorkers: detaches a synthetic ready-for-
 *      review binding whose updatedAt is older than the threshold,
 *      with the auto-reason persisted on the row.
 *
 * Designed to be self-contained and idempotent — every fixture row /
 * fixture file we create is also cleaned up on exit.
 *
 * Exit 0 = green, 1 = a contract assertion failed, 2 = setup error.
 */

// Stub `server-only` BEFORE the lib imports — same trick as the
// anchor-acceptance script.
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

import { promises as fs } from "node:fs"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { config as loadEnv } from "dotenv"
import { randomUUID } from "node:crypto"

loadEnv({ path: ".env.local" })

const { getPgPool } = await import("../lib/server/db/client")
const { extractLastAssistantSnippet } = await import(
  "../lib/operator-studio/review-status"
)
const {
  autoDetachStaleReadyWorkers,
  detachThreadCardBinding,
  getRecentlyDetachedBindingsSpawnedBy,
  upsertThreadCardBinding,
} = await import("../lib/operator-studio/thread-card-bindings")
const { GLOBAL_WORKSPACE_ID } = await import(
  "../lib/operator-studio/workspaces"
)

let failed = 0
function ok(label: string) {
  console.log(`  ✓ ${label}`)
}
function fail(label: string, detail: string) {
  failed += 1
  console.error(`  ✗ ${label}\n      ${detail}`)
}

// ── 1. Snapshot route source: anchor slice removed, default 100 ─────
async function check1Snapshot() {
  console.log("[1] snapshot hard-cap")
  const src = readFileSync(
    path.join(process.cwd(), "app/api/operator-studio/agents/[id]/snapshot/route.ts"),
    "utf8"
  )
  if (src.includes("earlierTurnsHidden")) {
    fail("earlierTurnsHidden absent", "still references earlierTurnsHidden")
  } else {
    ok("earlierTurnsHidden absent from snapshot route")
  }
  if (!/tail\.turns\.slice\(-lines\)/.test(src)) {
    fail("hard-cap slice present", "expected `tail.turns.slice(-lines)`")
  } else {
    ok("hard-cap slice present (`tail.turns.slice(-lines)`)")
  }
  if (!/\?\?\s*100\b/.test(src)) {
    fail("default lines = 100", "expected `?? 100` default in lines parsing")
  } else {
    ok("default lines = 100")
  }

  const typesSrc = readFileSync(
    path.join(process.cwd(), "lib/server/agent-bridge/types.ts"),
    "utf8"
  )
  if (typesSrc.includes("earlierTurnsHidden")) {
    fail("AgentSnapshot.earlierTurnsHidden removed", "still in types")
  } else {
    ok("AgentSnapshot.earlierTurnsHidden removed")
  }
}

// ── 2. detach_reason column ────────────────────────────────────────
const FIXTURE_EXEC = "claude:fixture-exec-ux-batch-2026-05-10"
const FIXTURE_AGENT_PREFIX = "claude:fixture-worker-ux-batch-"
const fixtureBindingIds: string[] = []

async function check2DetachReason() {
  console.log("[2] detach_reason column + spawned-by surfacing")
  const pool = getPgPool()

  // Schema sanity: column exists.
  const colRes = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'operator_thread_card_bindings'
      AND column_name = 'detach_reason'
  `)
  if (colRes.rowCount === 0) {
    fail("detach_reason column exists", "column missing — run apply-binding-detach-reason-migration")
    return
  }
  ok("detach_reason column exists")

  const agentId = `${FIXTURE_AGENT_PREFIX}${randomUUID()}`
  const binding = await upsertThreadCardBinding({
    workspaceId: GLOBAL_WORKSPACE_ID,
    agentId,
    agentKind: "claude",
    planStepId: "step-cockpit-ux-batch-2026-05-10",
    source: "manual",
    spawnedByAgentId: FIXTURE_EXEC,
    spawnOrigin: "cockpit",
    rationale: "fixture for ux-batch acceptance",
  })
  fixtureBindingIds.push(binding.id)

  const reason = `acceptance-fixture ${randomUUID().slice(0, 8)}`
  const detached = await detachThreadCardBinding(
    GLOBAL_WORKSPACE_ID,
    agentId,
    reason
  )
  if (!detached) {
    fail("detach with reason persists", "detachThreadCardBinding returned false")
    return
  }

  const rowRes = await pool.query(
    `SELECT detach_reason FROM operator_thread_card_bindings WHERE id = $1`,
    [binding.id]
  )
  const dbReason = rowRes.rows[0]?.detach_reason
  if (dbReason !== reason) {
    fail("detach_reason persisted", `expected ${JSON.stringify(reason)}, got ${JSON.stringify(dbReason)}`)
  } else {
    ok("detach_reason persisted on row")
  }

  const recent = await getRecentlyDetachedBindingsSpawnedBy(
    GLOBAL_WORKSPACE_ID,
    FIXTURE_EXEC,
    50
  )
  const me = recent.find((b) => b.agentId === agentId)
  if (!me) {
    fail("recently-detached surfaces fixture", "binding not in getRecentlyDetachedBindingsSpawnedBy result")
  } else if (me.detachReason !== reason) {
    fail("ThreadCardBinding.detachReason hydrated", `expected ${JSON.stringify(reason)}, got ${JSON.stringify(me.detachReason)}`)
  } else {
    ok("ThreadCardBinding.detachReason hydrated from rowToBinding")
  }
}

// ── 3. extractLastAssistantSnippet ─────────────────────────────────
async function check3Snippet() {
  console.log("[3] extractLastAssistantSnippet")
  const empty = extractLastAssistantSnippet([])
  if (empty !== null) fail("empty turns → null", `got ${JSON.stringify(empty)}`)
  else ok("empty turns → null")

  const userOnly = extractLastAssistantSnippet([
    { role: "user", at: null, parts: [{ kind: "text", text: "hello" }] },
  ])
  if (userOnly !== null) fail("user-only → null", `got ${JSON.stringify(userOnly)}`)
  else ok("user-only → null")

  const short = extractLastAssistantSnippet([
    { role: "user", at: null, parts: [{ kind: "text", text: "ping" }] },
    { role: "assistant", at: null, parts: [{ kind: "text", text: "pong" }] },
  ])
  if (short !== "pong") fail("short snippet returned verbatim", `got ${JSON.stringify(short)}`)
  else ok("short snippet returned verbatim")

  const longText = "x".repeat(120)
  const long = extractLastAssistantSnippet([
    { role: "assistant", at: null, parts: [{ kind: "text", text: longText }] },
  ])
  if (!long || long.length !== 81 || !long.endsWith("…")) {
    fail("long snippet truncated to 80+ellipsis", `got length ${long?.length} value=${JSON.stringify(long)}`)
  } else {
    ok("long snippet truncated to 80 chars + ellipsis")
  }

  // Last assistant wins (not earlier ones).
  const lastWins = extractLastAssistantSnippet([
    { role: "assistant", at: null, parts: [{ kind: "text", text: "first" }] },
    { role: "user", at: null, parts: [{ kind: "text", text: "ping" }] },
    { role: "assistant", at: null, parts: [{ kind: "text", text: "second" }] },
  ])
  if (lastWins !== "second") fail("last assistant wins", `got ${JSON.stringify(lastWins)}`)
  else ok("last assistant wins")
}

// ── 4. autoDetachStaleReadyWorkers ─────────────────────────────────
async function check4AutoDetach() {
  console.log("[4] autoDetachStaleReadyWorkers")
  // Build a real claude JSONL fixture under ~/.claude/projects so
  // getAppSessionEntry / getAppSessionTail can find it.
  const projectsDir = path.join(
    os.homedir(),
    ".claude",
    "projects",
    "-tmp-os-ux-batch-acceptance"
  )
  await fs.mkdir(projectsDir, { recursive: true })
  const sessionId = `acceptance-${randomUUID()}`
  const file = path.join(projectsDir, `${sessionId}.jsonl`)
  const userTs = new Date(Date.now() - 60_000).toISOString()
  const asstTs = new Date(Date.now() - 30_000).toISOString()
  // The Claude JSONL parser expects events with type="user"/"assistant".
  // Last assistant message contains the literal `task_done` token so
  // computeReviewStatus → "ready-for-review".
  const lines = [
    {
      type: "user",
      message: { role: "user", content: "kick off the work" },
      uuid: randomUUID(),
      timestamp: userTs,
      sessionId,
      cwd: "/tmp",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "All four UX items shipped. task_done\n\n<<chip:DONE>>",
          },
        ],
      },
      uuid: randomUUID(),
      timestamp: asstTs,
      sessionId,
    },
  ]
  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")

  const agentId = `claude:${sessionId}`
  const pool = getPgPool()
  let bindingId: string | null = null
  try {
    const binding = await upsertThreadCardBinding({
      workspaceId: GLOBAL_WORKSPACE_ID,
      agentId,
      agentKind: "claude",
      planStepId: "step-cockpit-ux-batch-2026-05-10",
      source: "manual",
      spawnedByAgentId: FIXTURE_EXEC,
      spawnOrigin: "cockpit",
      rationale: "auto-detach acceptance fixture",
    })
    bindingId = binding.id
    fixtureBindingIds.push(binding.id)

    // Backdate updatedAt so the binding is ALREADY older than the
    // threshold we're about to pass.
    await pool.query(
      `UPDATE operator_thread_card_bindings SET updated_at = $2 WHERE id = $1`,
      [binding.id, new Date(Date.now() - 5_000)]
    )

    // Threshold: 1 second. Binding is ~5s old, so it qualifies.
    const detached = await autoDetachStaleReadyWorkers(
      GLOBAL_WORKSPACE_ID,
      1_000
    )

    const rowRes = await pool.query(
      `SELECT detached_at, detach_reason FROM operator_thread_card_bindings WHERE id = $1`,
      [binding.id]
    )
    const row = rowRes.rows[0]
    if (!row?.detached_at) {
      fail(
        "stale ready-for-review binding gets detached",
        `auto-detached ${detached} bindings; this fixture's row still has detached_at = null. reviewStatus may not have computed as ready-for-review.`
      )
    } else {
      ok(`stale ready-for-review binding detached (count=${detached})`)
    }
    if (
      typeof row?.detach_reason !== "string" ||
      !row.detach_reason.includes("auto-detached")
    ) {
      fail(
        "auto-detach reason persisted",
        `expected an "auto-detached…" string, got ${JSON.stringify(row?.detach_reason)}`
      )
    } else {
      ok(`auto-detach reason persisted: "${row.detach_reason}"`)
    }

    // Now flip back to fresh — confirm a binding that's NOT stale is left alone.
    const agentId2 = `claude:fresh-${randomUUID()}`
    const fresh = await upsertThreadCardBinding({
      workspaceId: GLOBAL_WORKSPACE_ID,
      agentId: agentId2,
      agentKind: "claude",
      planStepId: "step-cockpit-ux-batch-2026-05-10",
      source: "manual",
      spawnedByAgentId: FIXTURE_EXEC,
      spawnOrigin: "cockpit",
      rationale: "fresh fixture (must not auto-detach)",
    })
    fixtureBindingIds.push(fresh.id)
    const detached2 = await autoDetachStaleReadyWorkers(
      GLOBAL_WORKSPACE_ID,
      60 * 60_000 // 1h threshold — nothing should match
    )
    const freshRow = await pool.query(
      `SELECT detached_at FROM operator_thread_card_bindings WHERE id = $1`,
      [fresh.id]
    )
    if (freshRow.rows[0]?.detached_at) {
      fail("fresh binding NOT detached", `auto-detach pass detached ${detached2}; fresh fixture got detached`)
    } else {
      ok("fresh binding under threshold NOT detached")
    }
  } finally {
    // File-level cleanup.
    await fs.rm(file, { force: true })
    await fs.rm(projectsDir, { recursive: true, force: true })
    void bindingId
  }
}

async function cleanup() {
  if (fixtureBindingIds.length === 0) return
  const pool = getPgPool()
  await pool.query(
    `DELETE FROM operator_thread_card_bindings WHERE id = ANY($1::text[])`,
    [fixtureBindingIds]
  )
}

async function main() {
  try {
    await check1Snapshot()
    await check2DetachReason()
    await check3Snippet()
    await check4AutoDetach()
  } finally {
    await cleanup()
    await getPgPool().end()
  }
  if (failed > 0) {
    console.error(`\n[ux-batch-acceptance] FAIL — ${failed} assertion(s)`)
    process.exit(1)
  }
  console.log("\n[ux-batch-acceptance] OK")
}

main().catch((e) => {
  console.error(`[ux-batch-acceptance] unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exit(2)
})
