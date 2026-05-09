import "server-only"

import {
  PlannerNotImplementedError,
  type EventSalience,
  type ExecutivePlanner,
  type OutboxDraft,
  type PlannerFactoryContext,
} from "./types"
import type { InboxEvent } from "@/lib/operator-studio/inbox"
import type { ContinuationDraft } from "@/lib/operator-studio/worker-continuation-analyzer"

/**
 * Stub: Hermes planner. Per pattern-executive-planner-headless, the
 * eventual replacement candidate for the Codex/Claude CLI planner.
 * Strictly experimental until A/B'd against the heuristic baseline
 * for a sprint on the same factory.
 *
 * Not implemented in v1 — placeholder exists to keep the
 * implementation-set symmetric in the selector's switch.
 */
export class HermesPlanner implements ExecutivePlanner {
  readonly id = "hermes"

  async proposeRecommendations(
    _ctx: PlannerFactoryContext
  ): Promise<ContinuationDraft[]> {
    throw new PlannerNotImplementedError(this.id, "proposeRecommendations")
  }

  async scoreInboxEvent(
    _ev: InboxEvent,
    _ctx: PlannerFactoryContext
  ): Promise<EventSalience> {
    throw new PlannerNotImplementedError(this.id, "scoreInboxEvent")
  }

  async draftOutbox(
    _seedHint: string,
    _ctx: PlannerFactoryContext
  ): Promise<OutboxDraft> {
    throw new PlannerNotImplementedError(this.id, "draftOutbox")
  }
}
