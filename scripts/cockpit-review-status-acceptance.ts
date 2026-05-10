/**
 * Acceptance gate for "cockpit drawer ready-for-review state on worker
 * rows". Hits the spawned-by route for the Berthier exec and asserts:
 *   - workers[] exists
 *   - every worker entry carries a `reviewStatus` field
 *   - reviewStatus is one of "live" | "ready-for-review" | "idle"
 *   - for at least one worker that has NOT posted task_done in their
 *     last assistant turn, asserts reviewStatus !== "ready-for-review"
 *   - cross-checks: any worker reported as "ready-for-review" actually
 *     has task_done in the last assistant turn (positive direction);
 *     any worker NOT "ready-for-review" doesn't (negative direction —
 *     the route may legitimately surface "live" because a later user
 *     turn flipped it; ground-truth honors that).
 *
 * Usage:
 *   pnpm tsx scripts/cockpit-review-status-acceptance.ts [exec-id]
 *
 * Default exec-id is the Berthier executive thread.
 *
 * Exit codes: 0 green, 1 contract assertion failed, 2 transport / args.
 */

// Stub `server-only` before importing the lib that pulls it in. Same
// pattern as scripts/cockpit-anchor-acceptance.ts — node scripts read
// JSONL directly so the RSC guard is irrelevant here.
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

const { getAppSessionTail } = await import(
  "../lib/server/agent-bridge/app-sessions"
)
const { parseAgentId } = await import("../lib/server/agent-bridge/types")
const { getPowerStrings, matchesPowerString } = await import(
  "../lib/operator-studio/power-strings"
)

const DEFAULT_EXEC = "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const BASE = process.env.OPERATOR_STUDIO_BASE_URL ?? "http://localhost:4200"

const VALID = new Set(["live", "ready-for-review", "idle"])

interface WorkerShape {
  agentId: string
  active: boolean
  reviewStatus: "live" | "ready-for-review" | "idle"
  title?: string | null
  sequence?: number
}

interface ResponseShape {
  workers?: WorkerShape[]
}

function fail(msg: string): never {
  console.error(`[review-status-acceptance] FAIL: ${msg}`)
  process.exit(1)
}

async function lastAssistantTurnInfo(
  agentId: string
): Promise<{ text: string; userAfter: boolean } | null> {
  const parsed = parseAgentId(agentId)
  if (parsed.kind !== "claude" && parsed.kind !== "codex") return null
  const tail = await getAppSessionTail(parsed.kind, parsed.ref, 80).catch(
    () => null
  )
  if (!tail || "error" in tail) return null
  let lastAssistantIdx = -1
  let lastUserIdx = -1
  for (let i = tail.turns.length - 1; i >= 0; i--) {
    const r = tail.turns[i].role
    if (lastAssistantIdx < 0 && r === "assistant") lastAssistantIdx = i
    if (lastUserIdx < 0 && r === "user") lastUserIdx = i
    if (lastAssistantIdx >= 0 && lastUserIdx >= 0) break
  }
  if (lastAssistantIdx < 0) return null
  const text = tail.turns[lastAssistantIdx].parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("\n")
  return { text, userAfter: lastUserIdx > lastAssistantIdx }
}

async function main() {
  const exec = process.argv[2] ?? DEFAULT_EXEC
  const url = `${BASE}/api/operator-studio/cockpit/spawned-by?exec=${encodeURIComponent(exec)}`
  console.log(`[review-status-acceptance] GET ${url}`)

  let res: Response
  try {
    res = await fetch(url, { cache: "no-store" })
  } catch (e) {
    console.error(
      `[review-status-acceptance] transport: ${e instanceof Error ? e.message : String(e)}`
    )
    process.exit(2)
  }
  if (!res.ok) {
    console.error(
      `[review-status-acceptance] HTTP ${res.status} ${res.statusText} from ${url}`
    )
    process.exit(2)
  }
  const body = (await res.json()) as ResponseShape
  if (!Array.isArray(body.workers)) {
    fail(`response.workers must be an array — got ${typeof body.workers}`)
  }
  if (body.workers.length === 0) {
    fail(`no workers under exec=${exec}; cannot validate reviewStatus contract`)
  }

  for (const w of body.workers) {
    if (!("reviewStatus" in (w as object))) {
      fail(`worker missing reviewStatus field: ${JSON.stringify(w)}`)
    }
    if (!VALID.has(w.reviewStatus)) {
      fail(`invalid reviewStatus=${w.reviewStatus} on ${JSON.stringify(w)}`)
    }
  }

  const taskDoneSpec = getPowerStrings().find((s) => s.id === "task-done-token")
  if (!taskDoneSpec) {
    fail(`task-done-token power string missing from registry`)
  }

  const active = body.workers.filter((w) => w.active)

  // Ground-truth each active worker via its JSONL.
  let groundTruthed = 0
  let nonReadyConfirmed = 0
  let readyConfirmed = 0
  const mismatches: string[] = []
  for (const w of active) {
    const info = await lastAssistantTurnInfo(w.agentId)
    if (!info) continue
    groundTruthed++
    const matches = matchesPowerString(taskDoneSpec, "assistant", info.text)
    const expected =
      matches && !info.userAfter ? "ready-for-review" : "not-ready-for-review"
    const actualReady = w.reviewStatus === "ready-for-review"
    if (expected === "ready-for-review" && !actualReady) {
      mismatches.push(
        `worker ${w.sequence ?? "?"} (${w.agentId}): last assistant has task_done & no later user turn, but reviewStatus=${w.reviewStatus}`
      )
    } else if (expected !== "ready-for-review" && actualReady) {
      mismatches.push(
        `worker ${w.sequence ?? "?"} (${w.agentId}): reviewStatus=ready-for-review but ground-truth says NOT (matches=${matches} userAfter=${info.userAfter})`
      )
    } else if (actualReady) {
      readyConfirmed++
    } else {
      nonReadyConfirmed++
    }
  }

  if (mismatches.length > 0) {
    fail(
      `reviewStatus mismatched ground-truth on ${mismatches.length} worker(s):\n  - ${mismatches.join("\n  - ")}`
    )
  }
  if (groundTruthed === 0) {
    fail(
      `could not ground-truth any active worker (no JSONL tail readable). Cannot validate.`
    )
  }
  if (nonReadyConfirmed === 0) {
    fail(
      `expected at least one ACTIVE worker whose reviewStatus !== "ready-for-review" (and confirmed by ground-truth). Got 0.`
    )
  }

  console.log(
    `[review-status-acceptance] OK exec=${exec} workers=${body.workers.length} active=${active.length} groundTruthed=${groundTruthed} ready=${readyConfirmed} nonReady=${nonReadyConfirmed}`
  )
  for (const w of active) {
    console.log(
      `  - Worker ${w.sequence ?? "?"} reviewStatus=${w.reviewStatus} title=${JSON.stringify(w.title)}`
    )
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(
    `[review-status-acceptance] unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
  )
  process.exit(2)
})
