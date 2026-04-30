/**
 * Integrity check: scan every thread for messageCount drift between
 * `operator_threads.messageCount` and the actual COUNT(*) of rows in
 * `operator_thread_messages`.
 *
 * Usage:
 *   pnpm integrity:check            # report drift, exit 0 if clean, 1 if drift
 *   pnpm integrity:check --repair   # recompute and persist the correct count
 *
 * Why this exists:
 *
 * `messageCount` is denormalized for dashboard list performance (no N+1
 * COUNT per thread). Every mutation path is expected to keep it in sync,
 * but:
 * 1. Future contributors can add a new mutation and forget.
 * 2. Manual DB edits (migrations, psql sessions, test fixtures) bypass
 *    the query layer entirely.
 * 3. Transactions can partially commit if the DB crashes.
 *
 * Running this in CI (or periodically in production) catches drift before
 * it surfaces as "N turns in the header, M rendered in the body" — which
 * is exactly the bug class we just fixed in the UI.
 */

import { getPgPool } from "../lib/server/db/client"
import {
  findMessageCountDrift,
  recomputeMessageCount,
} from "../lib/operator-studio/queries"

async function main() {
  const args = process.argv.slice(2)
  const repair = args.includes("--repair")
  const quiet = args.includes("--quiet")

  const drift = await findMessageCountDrift()

  if (drift.length === 0) {
    if (!quiet) {
      console.log("✓ No messageCount drift detected across all workspaces.")
    }
    await getPgPool().end()
    process.exit(0)
  }

  console.log(
    `⚠ Found ${drift.length} thread${drift.length === 1 ? "" : "s"} with messageCount drift:`
  )
  console.log()
  for (const d of drift) {
    const delta = d.actualCount - d.storedCount
    const sign = delta > 0 ? "+" : ""
    console.log(
      `  [${d.workspaceId}] ${d.threadId}`
    )
    console.log(
      `    stored=${d.storedCount}  actual=${d.actualCount}  delta=${sign}${delta}`
    )
  }
  console.log()

  if (repair) {
    console.log("Repairing…")
    for (const d of drift) {
      const newCount = await recomputeMessageCount(d.workspaceId, d.threadId)
      console.log(`  fixed ${d.threadId}: ${d.storedCount} → ${newCount}`)
    }
    console.log()
    console.log(`✓ Repaired ${drift.length} thread${drift.length === 1 ? "" : "s"}.`)
    await getPgPool().end()
    process.exit(0)
  }

  console.log(
    "Run with --repair to persist the correct counts, or investigate first with:"
  )
  console.log(
    "  SELECT id, message_count FROM operator_threads WHERE id = '<thread-id>';"
  )
  await getPgPool().end()
  process.exit(1)
}

main().catch((err) => {
  console.error("integrity:check failed:", err)
  process.exit(2)
})
