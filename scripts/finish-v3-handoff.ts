import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { setLaneExec, getWorkLane } from "@/lib/operator-studio/work-lanes"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"
import type { AgentCompositeId } from "@/lib/server/agent-bridge/types"

const LANE_ID = "lane_v2_claudecli_1778638967713"
const V3_AGENT_ID = "claude:e7e1175e-3492-4aa9-81e5-8f53a53466ae" as AgentCompositeId
const PLAN_STEP_ID = "step-v3-opus-exec-handoff"

async function main() {
  const lane = await getWorkLane(LANE_ID)
  if (!lane) throw new Error(`Lane ${LANE_ID} not found`)
  const previousExecId = lane.execAgentId
  console.log(`V2 lane: ${lane.id}`)
  console.log(`Previous exec (V2): ${previousExecId ?? "(none)"}`)
  console.log(`Promoting V3 → exec: ${V3_AGENT_ID}`)
  const updated = await setLaneExec(LANE_ID, {
    agentId: V3_AGENT_ID,
    agentKind: "claude",
  })
  console.log(`Lane exec is now: ${updated?.execAgentId ?? "(unknown)"}`)
  const b = await upsertThreadCardBinding({
    workspaceId: lane.workspaceId ?? GLOBAL_WORKSPACE_ID,
    agentId: V3_AGENT_ID,
    agentKind: "claude",
    planStepId: PLAN_STEP_ID,
    source: "launch",
    spawnedByAgentId: previousExecId ?? undefined,
    spawnOrigin: "cockpit",
    rationale: `V2 → V3 handoff (manual reconcile after AX timeout); Opus 4.7 exec via settings.json project default`,
  })
  console.log(`Binding: ${b.id}`)
  console.log(`\nDone. V3 chat is now exec. Sidebar id: ${V3_AGENT_ID}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await getPgPool().end() })
