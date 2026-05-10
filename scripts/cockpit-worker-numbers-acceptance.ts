/**
 * pnpm tsx scripts/cockpit-worker-numbers-acceptance.ts [--exec=<agentId>]
 *
 * Programmatic gate for plan-card
 *   step-cockpit-show-worker-numbers-on-rows
 *
 * Hits the running dev server at http://localhost:4200 once and asserts
 * the spawned-by endpoint surfaces stable, gap-free worker sequence
 * numbers. Exits 0 on green; prints the failed assertion + exits 1 on
 * red. One fetch, one assert chain, exit — no dev-server side effects.
 */

export {}

const DEFAULT_EXEC = "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const BASE_URL = process.env.OS_BASE_URL || "http://localhost:4200"

interface Worker {
  agentId: string
  sequence: number
  active: boolean
  spawnedAt: string
  agentKind?: string
}

function parseExec(argv: string[]): string {
  for (const a of argv) {
    if (a.startsWith("--exec=")) return a.slice("--exec=".length).trim()
  }
  return DEFAULT_EXEC
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

async function main() {
  const exec = parseExec(process.argv.slice(2))
  const url = `${BASE_URL}/api/operator-studio/cockpit/spawned-by?exec=${encodeURIComponent(exec)}`
  const headers: Record<string, string> = {}
  const tok = process.env.OPERATOR_STUDIO_INGEST_TOKEN?.trim()
  if (tok) headers.authorization = `Bearer ${tok}`

  const res = await fetch(url, { headers, cache: "no-store" }).catch((e) => {
    fail(`fetch error: ${e instanceof Error ? e.message : String(e)}`)
  })
  if (!res.ok) fail(`HTTP ${res.status} ${res.statusText} — ${url}`)

  const body = (await res.json()) as {
    agentIds?: unknown
    workers?: unknown
  }

  if (!Array.isArray(body.workers)) fail("response.workers is not an array")
  const workers = body.workers as Worker[]
  if (workers.length === 0) fail("workers array is empty (need at least one)")

  for (const [i, w] of workers.entries()) {
    if (typeof w.agentId !== "string" || w.agentId.length === 0) {
      fail(`workers[${i}].agentId missing or not a string`)
    }
    if (typeof w.sequence !== "number" || !Number.isFinite(w.sequence)) {
      fail(`workers[${i}].sequence missing or not a number`)
    }
    if (typeof w.active !== "boolean") {
      fail(`workers[${i}].active missing or not a boolean`)
    }
    if (typeof w.spawnedAt !== "string" || Number.isNaN(Date.parse(w.spawnedAt))) {
      fail(`workers[${i}].spawnedAt missing or not an ISO string`)
    }
  }

  // Sequence: 1..N, no gaps, no duplicates, equals sort position.
  const seqs = workers.map((w) => w.sequence)
  const seen = new Set<number>()
  for (const [i, seq] of seqs.entries()) {
    if (seen.has(seq)) fail(`duplicate sequence ${seq} at workers[${i}]`)
    seen.add(seq)
    if (seq !== i + 1) {
      fail(`workers[${i}].sequence === ${seq}, expected ${i + 1} (must be 1..N in order)`)
    }
  }

  // Spawn-time monotonicity: spawnedAt[i] <= spawnedAt[i+1].
  for (let i = 0; i < workers.length - 1; i++) {
    const a = Date.parse(workers[i].spawnedAt)
    const b = Date.parse(workers[i + 1].spawnedAt)
    if (!(a <= b)) {
      fail(
        `workers[${i}].spawnedAt (${workers[i].spawnedAt}) > workers[${i + 1}].spawnedAt (${workers[i + 1].spawnedAt})`
      )
    }
  }

  const anyActive = workers.some((w) => w.active === true)
  const anyDetached = workers.some((w) => w.active === false)
  if (!anyActive) fail("expected at least one active worker (caller is one)")
  if (!anyDetached) fail("expected at least one detached worker (completed in this session)")

  // Back-compat: agentIds still present and equals the active agent ids.
  if (!Array.isArray(body.agentIds)) fail("response.agentIds missing (back-compat)")
  const activeIdsFromWorkers = new Set(workers.filter((w) => w.active).map((w) => w.agentId))
  const agentIdsSet = new Set(body.agentIds as string[])
  if (activeIdsFromWorkers.size !== agentIdsSet.size) {
    fail(
      `agentIds size ${agentIdsSet.size} !== active workers size ${activeIdsFromWorkers.size}`
    )
  }
  for (const id of activeIdsFromWorkers) {
    if (!agentIdsSet.has(id)) fail(`active worker ${id} missing from agentIds`)
  }

  console.log(`PASS — ${workers.length} workers, sequences 1..${workers.length}`)
  console.log(
    `       active=${workers.filter((w) => w.active).length} detached=${workers.filter((w) => !w.active).length}`
  )
  console.log(`       first: Worker 1 spawned ${workers[0].spawnedAt} (${workers[0].agentId})`)
  console.log(
    `       last:  Worker ${workers[workers.length - 1].sequence} spawned ${workers[workers.length - 1].spawnedAt} (${workers[workers.length - 1].agentId})`
  )
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
