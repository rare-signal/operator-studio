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
 * Stub: Claude CLI planner. The intended shape (per
 * pattern-executive-planner-headless) is a headless `claude -p ...`
 * invocation that takes the factory context bundle plus the active
 * plan + a tail of inbox events and emits structured recommendation
 * drafts.
 *
 * Not implemented in v1 — this file exists to prove the seam is
 * plug-in-shaped. Selecting `OPERATOR_STUDIO_PLANNER=claude-cli`
 * surfaces a clear NotImplemented error so a future implementation
 * has a fill-in-the-blank target.
 */
export class ClaudeCliPlanner implements ExecutivePlanner {
  readonly id = "claude-cli"

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
