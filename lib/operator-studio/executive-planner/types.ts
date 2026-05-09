import "server-only"

import type { SoftwareFactory } from "@/lib/operator-studio/factories"
import type { InboxEvent } from "@/lib/operator-studio/inbox"
import type { ContinuationDraft } from "@/lib/operator-studio/worker-continuation-analyzer"

/**
 * The executive planner brain — interface seam.
 *
 * Per pattern-executive-planner-headless. Wraps whatever planner
 * implementation is configured (deterministic heuristic today,
 * Claude CLI tomorrow, Hermes later). The factory binds to ONE
 * implementation via env (OPERATOR_STUDIO_PLANNER) so the rest of
 * the system never reaches around the seam.
 *
 * v1 only `proposeRecommendations` is wired against a real impl —
 * the other methods are aspirational seams that implementations may
 * leave unimplemented (return empty / throw NotImplemented).
 *
 * Stability guarantee: this interface is additive only. New methods
 * may be added with a default fallback in the base class so existing
 * implementations don't break.
 */

export interface PlannerFactoryContext {
  workspaceId: string
  reviewer: string
  /** May be null when the operator hasn't bound a factory to the
   *  active plan yet (still the pre-F7-cleanup state for some
   *  cards). Implementations should degrade gracefully. */
  factory: SoftwareFactory | null
}

export interface EventSalience {
  /** 0..1. 1 = "tap David on the shoulder right now." */
  score: number
  /** Short reason ("Micky comment + expedite keyword"). */
  reason: string
  /** Tags lifted onto downstream surfaces — e.g. `david_assigned`,
   *  `micky_touch`, `expedite`. */
  tags: string[]
}

export interface OutboxDraft {
  surface: "ado" | "teams" | "preview_deploy" | "email" | "stakeholder_reply"
  action: string
  targetId: string
  targetLabel?: string
  audience?: string[]
  payload: Record<string, unknown>
  renderedText: string
  rationale: string
  sourceInboxEventIds?: string[]
  relatedPlanStepId?: string
}

export class PlannerNotImplementedError extends Error {
  constructor(plannerId: string, method: string) {
    super(`Planner '${plannerId}' does not implement ${method}`)
    this.name = "PlannerNotImplementedError"
  }
}

export interface ExecutivePlanner {
  readonly id: string

  /**
   * Walk the live agent state + active plan and emit advisory
   * recommendations (continue worker, request review, update plan,
   * launch worker). Persisted to the David-only review queue.
   */
  proposeRecommendations(
    ctx: PlannerFactoryContext
  ): Promise<ContinuationDraft[]>

  /**
   * Score a single inbox event so downstream surfaces (factory page,
   * digest, MCP active-work-context tool) can rank by stakeholder
   * weight. Optional in v1.
   */
  scoreInboxEvent(
    ev: InboxEvent,
    ctx: PlannerFactoryContext
  ): Promise<EventSalience>

  /**
   * Draft the rendered text + payload for an outbox row that the
   * agent intends to stage. Optional in v1; today the staging path
   * accepts text directly from the calling agent.
   */
  draftOutbox(
    seedHint: string,
    ctx: PlannerFactoryContext
  ): Promise<OutboxDraft>
}
