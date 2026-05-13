/**
 * Clean up the failed V4 spawn artifacts from the previous run. The
 * spawn itself succeeded (Claude CLI subprocess + JSONL reconciled),
 * but setLaneExec rejected the promotion due to a role-conflict bug
 * (binding was role='worker' default). Both the lane row AND the
 * binding row are now orphaned.
 *
 * This script:
 *   - detaches the orphan binding (claude:498278d1-...)
 *   - archives the orphan lane (lane_mp3jdhcp_ehjhpf)
 * so the re-spawn can land cleanly. Idempotent.
 */

import { eq } from "drizzle-orm"
import { getPgPool, getDb } from "@/lib/server/db/client"
import { operatorThreadCardBindings } from "@/lib/server/db/schema"
import { archiveWorkLane } from "@/lib/operator-studio/work-lanes"

const ORPHAN_AGENT_ID = "claude:32318759-9d22-4f64-a6fd-eb49eeb76ee6"
const ORPHAN_LANE_ID = "lane_mp3jf8xx_gsnom5"

async function main(): Promise<void> {
  const db = getDb()
  const now = new Date()

  const detached = await db
    .update(operatorThreadCardBindings)
    .set({ detachedAt: now, detachReason: "v4-spawn-cleanup", updatedAt: now })
    .where(eq(operatorThreadCardBindings.agentId, ORPHAN_AGENT_ID))
    .returning({ id: operatorThreadCardBindings.id })
  console.log(`[cleanup] detached ${detached.length} binding rows for ${ORPHAN_AGENT_ID}`)

  const archived = await archiveWorkLane(ORPHAN_LANE_ID)
  console.log(`[cleanup] archived lane ${ORPHAN_LANE_ID}: ${archived ? "ok" : "(not found / already gone)"}`)

  await getPgPool().end()
}

main().catch((e) => {
  console.error("[cleanup] fatal:", e)
  process.exit(1)
})
