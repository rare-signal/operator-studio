import "server-only"

import { ClaudeCliPlanner } from "./claude-cli-planner"
import { HermesPlanner } from "./hermes-planner"
import { HeuristicPlanner } from "./heuristic-planner"
import type { ExecutivePlanner } from "./types"

export {
  PlannerNotImplementedError,
  type EventSalience,
  type ExecutivePlanner,
  type OutboxDraft,
  type PlannerFactoryContext,
} from "./types"

export type PlannerId = "heuristic" | "claude-cli" | "hermes"

/**
 * Pick the configured planner. Default `heuristic` — deterministic,
 * no LLM. Override with `OPERATOR_STUDIO_PLANNER=claude-cli|hermes`.
 *
 * The factory is a function (not a singleton) because future planners
 * may carry per-instance state (HTTP clients, API keys, throttle
 * tokens). Callers that already hold a planner instance should reuse
 * it rather than calling this every tick.
 */
export function selectPlanner(): ExecutivePlanner {
  const id = (process.env.OPERATOR_STUDIO_PLANNER?.trim() ??
    "heuristic") as PlannerId
  switch (id) {
    case "claude-cli":
      return new ClaudeCliPlanner()
    case "hermes":
      return new HermesPlanner()
    case "heuristic":
    default:
      return new HeuristicPlanner()
  }
}

export const KNOWN_PLANNER_IDS: readonly PlannerId[] = [
  "heuristic",
  "claude-cli",
  "hermes",
]
