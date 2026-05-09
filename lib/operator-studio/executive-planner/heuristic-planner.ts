import "server-only"

import { analyzeWorkers } from "@/lib/operator-studio/worker-continuation-analyzer"
import type { ContinuationDraft } from "@/lib/operator-studio/worker-continuation-analyzer"

import {
  PlannerNotImplementedError,
  type EventSalience,
  type ExecutivePlanner,
  type OutboxDraft,
  type PlannerFactoryContext,
} from "./types"
import type { InboxEvent } from "@/lib/operator-studio/inbox"

/**
 * Heuristic (no-LLM) planner. Wraps the existing worker-continuation
 * analyzer in the ExecutivePlanner contract. This is the baseline —
 * deterministic, fast, transparent, no token spend, no network calls
 * beyond reading local agent JSONL + tmux pane state.
 *
 * Behavior is identical to calling `analyzeWorkers()` directly —
 * F9's purpose is just the seam, not a behavior change.
 */
export class HeuristicPlanner implements ExecutivePlanner {
  readonly id = "heuristic"

  async proposeRecommendations(
    ctx: PlannerFactoryContext
  ): Promise<ContinuationDraft[]> {
    const result = await analyzeWorkers(ctx.workspaceId, ctx.reviewer)
    return result.drafts
  }

  // The salience scorer + outbox drafter are aspirational seams that
  // need either a richer event model or an LLM. Heuristic v1 doesn't
  // ship them; throw a typed error so call sites can fall through to
  // the unscored / unrendered path explicitly.
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
