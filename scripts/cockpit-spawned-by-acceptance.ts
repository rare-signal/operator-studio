/**
 * Acceptance gate for the cockpit "spawned-by drawer survives recency
 * window" fix. Hits the spawned-by route and asserts:
 *   - workers[] exists and is an array
 *   - each active worker carries the AgentListItem-shaped fields
 *     (label, source, lastActivityAt, status, project, title, isLive)
 *     plus the binding-shape fields (agentId, sequence, active=true,
 *     spawnedAt, agentKind)
 *   - at least one active worker is older than 12h (the bug case:
 *     Workers 7 + 9 under Berthier on 2026-05-10).
 *
 * Usage:
 *   pnpm tsx scripts/cockpit-spawned-by-acceptance.ts [exec-id]
 *
 * Default exec-id is the Berthier executive thread.
 *
 * Exit codes: 0 green, 1 contract assertion failed, 2 transport / args.
 */

export {}

const DEFAULT_EXEC = "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const BASE = process.env.OPERATOR_STUDIO_BASE_URL ?? "http://localhost:4200"

interface WorkerShape {
  agentId?: unknown
  sequence?: unknown
  active?: unknown
  spawnedAt?: unknown
  agentKind?: unknown
  label?: unknown
  source?: unknown
  lastActivityAt?: unknown
  status?: unknown
  project?: unknown
  title?: unknown
  isLive?: unknown
}

interface ResponseShape {
  agentIds?: unknown
  workers?: WorkerShape[]
}

function fail(msg: string): never {
  console.error(`[spawned-by-acceptance] FAIL: ${msg}`)
  process.exit(1)
}

const REQUIRED_KEYS = [
  "agentId",
  "sequence",
  "active",
  "spawnedAt",
  "agentKind",
  "label",
  "source",
  "lastActivityAt",
  "status",
  "project",
  "title",
  "isLive",
] as const

async function main() {
  const exec = process.argv[2] ?? DEFAULT_EXEC
  const url = `${BASE}/api/operator-studio/cockpit/spawned-by?exec=${encodeURIComponent(exec)}`
  console.log(`[spawned-by-acceptance] GET ${url}`)

  let res: Response
  try {
    res = await fetch(url, { cache: "no-store" })
  } catch (e) {
    console.error(
      `[spawned-by-acceptance] transport error: ${e instanceof Error ? e.message : String(e)}`
    )
    process.exit(2)
  }
  if (!res.ok) {
    console.error(
      `[spawned-by-acceptance] HTTP ${res.status} ${res.statusText} from ${url}`
    )
    process.exit(2)
  }
  const body = (await res.json()) as ResponseShape

  if (!Array.isArray(body.workers)) {
    fail(
      `response.workers must be an array — got ${JSON.stringify(typeof body.workers)}`
    )
  }

  const active = body.workers.filter((w) => w?.active === true)
  if (active.length === 0) {
    fail(
      `expected at least one active worker under exec=${exec}; got 0. (If Berthier truly has no active workers right now, point this script at a different exec id.)`
    )
  }

  for (const w of active) {
    for (const k of REQUIRED_KEYS) {
      if (!(k in (w as object))) {
        fail(
          `active worker missing required key "${k}": ${JSON.stringify(w)}`
        )
      }
    }
    if (typeof w.agentId !== "string" || w.agentId.length === 0) {
      fail(`worker.agentId must be a non-empty string: ${JSON.stringify(w)}`)
    }
    if (typeof w.sequence !== "number" || w.sequence < 1) {
      fail(`worker.sequence must be >= 1: ${JSON.stringify(w)}`)
    }
    if (w.active !== true) {
      fail(`active worker.active must be true: ${JSON.stringify(w)}`)
    }
    if (typeof w.spawnedAt !== "string") {
      fail(`worker.spawnedAt must be string: ${JSON.stringify(w)}`)
    }
    if (typeof w.agentKind !== "string") {
      fail(`worker.agentKind must be string: ${JSON.stringify(w)}`)
    }
    if (
      w.source !== "claude" &&
      w.source !== "codex" &&
      w.source !== "tmux"
    ) {
      fail(`worker.source must be claude|codex|tmux: ${JSON.stringify(w)}`)
    }
    if (typeof w.isLive !== "boolean") {
      fail(`worker.isLive must be boolean: ${JSON.stringify(w)}`)
    }
    // label/lastActivityAt/status/project/title may be null — presence
    // (already checked above) is the contract.
  }

  // The point of this fix: aged-out workers must still appear.
  const now = Date.now()
  const TWELVE_HOURS_MS = 12 * 60 * 60_000
  const aged = active.filter((w) => {
    const t = typeof w.spawnedAt === "string" ? Date.parse(w.spawnedAt) : NaN
    if (!Number.isFinite(t)) return false
    return now - t > TWELVE_HOURS_MS
  })
  if (aged.length === 0) {
    fail(
      `acceptance requires at least one ACTIVE worker spawned >12h ago to prove the fix. None found under exec=${exec}. (If the test fixture has no aged workers right now, this gate is moot — point at an exec that does, or wait until one of the current workers ages.)`
    )
  }

  console.log(
    `[spawned-by-acceptance] OK exec=${exec} active=${active.length} aged>12h=${aged.length}`
  )
  for (const w of aged) {
    const ageH = (
      (now - Date.parse(w.spawnedAt as string)) /
      3_600_000
    ).toFixed(1)
    console.log(
      `  - Worker ${w.sequence as number} agentId=${w.agentId as string} age=${ageH}h title=${JSON.stringify(w.title)}`
    )
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(
    `[spawned-by-acceptance] unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
  )
  process.exit(2)
})
