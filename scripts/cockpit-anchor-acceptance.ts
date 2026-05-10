/**
 * Programmatic acceptance gate for the cockpit "open at last user
 * message" behavior. Verifies the snapshot endpoint slices `turns`
 * to start at the user's most recent message, and that nothing was
 * silently truncated before the slice.
 *
 * Usage:
 *   pnpm tsx scripts/cockpit-anchor-acceptance.ts [session-uuid]
 *
 * Default session-uuid is the Berthier executive thread used during
 * the v1 launch.
 *
 * Exit codes: 0 green, 1 a contract assertion failed, 2 transport / args.
 */
// Stub `server-only` BEFORE importing the lib that pulls it in. The
// package throws on require-time in non-RSC contexts; node scripts
// are fine to read JSONL directly, so we inject an empty module into
// the CJS require cache and dynamic-import the lib below.
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

const DEFAULT_SESSION = "2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const BASE = process.env.OPERATOR_STUDIO_BASE_URL ?? "http://localhost:4200"

interface SnapshotShape {
  id: string
  kind: string
  status: string
  turns?: Array<{ role: string; at: string | null }>
  earlierTurnsHidden?: number
}

function fail(msg: string): never {
  console.error(`[anchor-acceptance] FAIL: ${msg}`)
  process.exit(1)
}

async function main() {
  const sessionId = process.argv[2] ?? DEFAULT_SESSION
  const url = `${BASE}/api/operator-studio/agents/${encodeURIComponent(`claude:${sessionId}`)}/snapshot?lines=2000`
  console.log(`[anchor-acceptance] GET ${url}`)

  let res: Response
  try {
    res = await fetch(url, { cache: "no-store" })
  } catch (e) {
    console.error(
      `[anchor-acceptance] transport error: ${e instanceof Error ? e.message : String(e)}`
    )
    process.exit(2)
  }
  if (!res.ok) {
    console.error(
      `[anchor-acceptance] HTTP ${res.status} ${res.statusText} from ${url}`
    )
    process.exit(2)
  }
  const body = (await res.json()) as SnapshotShape

  if (!body.turns || body.turns.length === 0) {
    fail("response.turns must be non-empty (got empty or missing array)")
  }
  if (body.turns[0].role !== "user") {
    fail(
      `response.turns[0].role must be "user" — got "${body.turns[0].role}". The slice did not start at the user's last message.`
    )
  }
  if (
    typeof body.earlierTurnsHidden !== "number" ||
    body.earlierTurnsHidden < 0
  ) {
    fail(
      `response.earlierTurnsHidden must be a non-negative number — got ${JSON.stringify(body.earlierTurnsHidden)}.`
    )
  }

  // Cross-check against the same lib the route uses, with the same
  // limit. The slice contract says: turns.length + earlierTurnsHidden
  // === total turns parsed from disk for this lines= window. If the
  // API ever truncates beyond the slice (the failure mode this gate
  // exists to catch), this assertion fires.
  const disk = await getAppSessionTail("claude", sessionId, 2000)
  if ("error" in disk) {
    fail(`could not load disk tail to cross-check: ${disk.error}`)
  }
  const diskTotal = disk.turns.length
  const apiTotal = body.turns.length + body.earlierTurnsHidden
  if (apiTotal !== diskTotal) {
    fail(
      `slice math mismatch: API reports ${body.turns.length} turns + ${body.earlierTurnsHidden} hidden = ${apiTotal}; disk has ${diskTotal} parsed turns. Truncation regression.`
    )
  }

  // The slice's first turn must be the SAME turn as the disk's last
  // user turn (timestamps are the cheapest invariant we can compare).
  let diskLastUserIdx = -1
  for (let i = disk.turns.length - 1; i >= 0; i--) {
    if (disk.turns[i].role === "user") {
      diskLastUserIdx = i
      break
    }
  }
  if (diskLastUserIdx < 0) {
    fail(
      "disk tail has no user turn — session may be empty or fixture-only; cannot validate slice."
    )
  }
  const diskAnchor = disk.turns[diskLastUserIdx]
  const apiAnchor = body.turns[0]
  if (diskAnchor.at !== apiAnchor.at) {
    fail(
      `slice anchor timestamp mismatch: API turns[0].at=${apiAnchor.at}, disk turns[${diskLastUserIdx}].at=${diskAnchor.at}.`
    )
  }
  if (diskLastUserIdx !== body.earlierTurnsHidden) {
    fail(
      `earlierTurnsHidden mismatch: expected ${diskLastUserIdx} (disk index of last user turn), got ${body.earlierTurnsHidden}.`
    )
  }

  console.log(
    `[anchor-acceptance] OK session=${sessionId} turns=${body.turns.length} earlierTurnsHidden=${body.earlierTurnsHidden} anchor.at=${apiAnchor.at}`
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(
    `[anchor-acceptance] unexpected: ${e instanceof Error ? e.stack ?? e.message : String(e)}`
  )
  process.exit(2)
})
