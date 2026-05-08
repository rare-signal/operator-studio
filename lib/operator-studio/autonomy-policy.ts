import "server-only"

/**
 * Autonomy policy bounds.
 *
 * Single source of truth for "what can run without David?". Codifies
 * the four-tier ladder so the executive cycle CLI, the Bento UI, and
 * future automations can ask the same question and get the same
 * answer.
 *
 * The tiers (most permissive → most restrictive):
 *
 *   safe-read-only        Pure reads. `pnpm os:state`, dry-run scans,
 *                         current-tail checks. Never writes.
 *   routine-after-approved  Side effects allowed only after a David
 *                         approval already exists. Sending an
 *                         approved continue_worker nudge, marking a
 *                         recommendation executed after a successful
 *                         send. Hot mode still required where the
 *                         downstream API enforces it.
 *   approval-required     David must approve before acting. Fresh
 *                         worker launches, plan-card closeouts,
 *                         review acceptance, high-risk continuations.
 *   always-human          David must do it himself. Production
 *                         deploys, external/team-facing messages,
 *                         irreversible data changes, scope/taste/
 *                         product direction.
 *
 * The cycle CLI consults this module before acting. It writes
 * recommendations freely (those are advisory), but it never executes
 * `approval-required` actions on its own, and `routine-after-approved`
 * paths are gated by `gateRoutine()` which checks for an existing
 * approval and (optionally) hot mode.
 */

import type {
  ExecutiveRecommendation,
  ExecutiveRecommendationKind,
} from "./executive-recommendations"

export type AutonomyTier =
  | "safe-read-only"
  | "routine-after-approved"
  | "approval-required"
  | "always-human"

export interface AutonomyAction {
  /** Stable id for the action class. */
  id: string
  tier: AutonomyTier
  /** Short label for UI / CLI output. */
  label: string
  /** One-line "why this tier". Surfaces in decision-gate explanations. */
  reason: string
}

/**
 * Catalog of named actions. New automations should register here and
 * read `AUTONOMY_ACTIONS[id]` rather than hard-coding a tier at the
 * call site — that way David can re-tier an action in one place.
 */
export const AUTONOMY_ACTIONS = {
  "os:state": {
    id: "os:state",
    tier: "safe-read-only",
    label: "Read operator state",
    reason: "Pure read. Returns a snapshot of plan/agents/reviews.",
  },
  "os:cycle:scan": {
    id: "os:cycle:scan",
    tier: "safe-read-only",
    label: "Sense + decide (no writes)",
    reason: "Scan-only pass. Identifies candidate actions but does not write.",
  },
  "os:cycle:write-recommendation": {
    id: "os:cycle:write-recommendation",
    tier: "safe-read-only",
    label: "Create or update an executive recommendation",
    reason:
      "Recommendations are advisory until David approves. Writing one is reversible and never executes.",
  },
  "agent:continue:approved": {
    id: "agent:continue:approved",
    tier: "routine-after-approved",
    label: "Send approved continue_worker nudge",
    reason:
      "Side effect on a live worker, but only allowed when an approved continue_worker recommendation already exists. Hot mode still enforced by the send API.",
  },
  "agent:launch": {
    id: "agent:launch",
    tier: "approval-required",
    label: "Launch fresh tmux Claude worker",
    reason:
      "Spawns a new agent and sends an initial prompt. David approves the prompt, cwd, and acceptance criteria first.",
  },
  "plan:card:closeout": {
    id: "plan:card:closeout",
    tier: "approval-required",
    label: "Mark plan card covered",
    reason:
      "Closeouts ratify that a piece of work is done. David accepts evidence; the cycle proposes, never decides.",
  },
  "review:accept": {
    id: "review:accept",
    tier: "approval-required",
    label: "Accept a review item",
    reason:
      "Promotes raw signal into committed plan/product state. Always David's call.",
  },
  "agent:continue:high-risk": {
    id: "agent:continue:high-risk",
    tier: "approval-required",
    label: "High-risk continuation prompt",
    reason:
      "Continuation that changes scope, touches deploys, or could destabilize an in-flight worker.",
  },
  "deploy:production": {
    id: "deploy:production",
    tier: "always-human",
    label: "Production deploy",
    reason: "Irreversible blast radius outside the studio. David only.",
  },
  "external:message": {
    id: "external:message",
    tier: "always-human",
    label: "External / team-facing message",
    reason:
      "Anything visible to non-David humans. Tone, timing, and political weight require David.",
  },
  "data:irreversible": {
    id: "data:irreversible",
    tier: "always-human",
    label: "Irreversible data change",
    reason:
      "Drops, hard deletes, schema-destructive migrations, secret rotations. Never automatable.",
  },
  "product:direction": {
    id: "product:direction",
    tier: "always-human",
    label: "Scope / taste / product direction",
    reason: "Judgment calls. The cycle can surface options; David picks.",
  },
} as const satisfies Record<string, AutonomyAction>

export type AutonomyActionId = keyof typeof AUTONOMY_ACTIONS

export function getAutonomyAction(id: AutonomyActionId): AutonomyAction {
  return AUTONOMY_ACTIONS[id]
}

/**
 * Map an executive recommendation kind to its default autonomy action
 * id when the cycle wants to *execute* it. The executive cycle uses
 * this to decide whether it can even attempt an action.
 */
export function actionIdForRecommendationKind(
  kind: ExecutiveRecommendationKind
): AutonomyActionId {
  switch (kind) {
    case "launch_worker":
      return "agent:launch"
    case "continue_worker":
      return "agent:continue:approved"
    case "mark_covered":
      return "plan:card:closeout"
    case "request_review":
      return "review:accept"
    case "update_plan":
      return "plan:card:closeout"
    default:
      return "product:direction"
  }
}

export interface RoutineGateInput {
  recommendation: ExecutiveRecommendation
  /** Required for routine-after-approved actions whose downstream API
   *  also enforces hot mode (e.g. agent send). The CLI does not arm
   *  hot mode itself; it must be told whether the server is armed. */
  hotModeArmed?: boolean
}

export type GateOutcome =
  | { ok: true; tier: AutonomyTier; action: AutonomyAction }
  | {
      ok: false
      tier: AutonomyTier
      action: AutonomyAction
      reason: string
    }

/**
 * Decide whether a recommendation is allowed to execute right now.
 *
 * - `safe-read-only`           always ok.
 * - `routine-after-approved`   ok iff status is `approved` and (when
 *                              relevant) hot mode is armed.
 * - `approval-required`        never ok from the CLI; the user must
 *                              act in the UI.
 * - `always-human`             never ok from automation.
 */
export function gateRecommendation(input: RoutineGateInput): GateOutcome {
  const { recommendation, hotModeArmed } = input
  const actionId = actionIdForRecommendationKind(recommendation.payload.kind)
  const action = AUTONOMY_ACTIONS[actionId]

  if (action.tier === "safe-read-only") {
    return { ok: true, tier: action.tier, action }
  }

  if (action.tier === "routine-after-approved") {
    if (recommendation.payload.status !== "approved") {
      return {
        ok: false,
        tier: action.tier,
        action,
        reason: `recommendation status=${recommendation.payload.status}, expected approved`,
      }
    }
    if (
      (actionId === "agent:continue:approved" ||
        actionId === "agent:launch") &&
      hotModeArmed === false
    ) {
      return {
        ok: false,
        tier: action.tier,
        action,
        reason: "hot mode is not armed",
      }
    }
    return { ok: true, tier: action.tier, action }
  }

  if (action.tier === "approval-required") {
    return {
      ok: false,
      tier: action.tier,
      action,
      reason:
        "approval-required: David must approve in the Operator Studio UI before this can execute",
    }
  }

  return {
    ok: false,
    tier: action.tier,
    action,
    reason: "always-human: this class of action is not automatable",
  }
}

/**
 * Stable, machine-readable summary of the policy ladder. Used by the
 * CLI `--policy` flag and by docs generators.
 */
export function describeAutonomyPolicy(): Array<{
  tier: AutonomyTier
  actions: AutonomyAction[]
}> {
  const tiers: AutonomyTier[] = [
    "safe-read-only",
    "routine-after-approved",
    "approval-required",
    "always-human",
  ]
  return tiers.map((tier) => ({
    tier,
    actions: Object.values(AUTONOMY_ACTIONS).filter((a) => a.tier === tier),
  }))
}
