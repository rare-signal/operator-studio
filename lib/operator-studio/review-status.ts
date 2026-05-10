/**
 * Multi-tier worker reviewStatus computation. Per the
 * `step-multi-tier-review-state-machine` plan card:
 *
 *   - "live": recent activity, no task_done in last assistant turn.
 *   - "candidate-self-believed" / "awaiting-berthier-check": task_done
 *     posted (no later user turn) AND no Berthier acknowledgement on
 *     the binding. Synonyms — compute emits "candidate-self-believed"
 *     by default; the UI may relabel as "awaiting Berthier's eyes".
 *   - "berthier-reviewed": Berthier acknowledged but David hasn't
 *     signed off. Surfaces interstitial review risk.
 *   - "human-approved": David explicitly signed off. Terminal.
 *   - "idle": no task_done, no recent activity past N min.
 *
 * The two timestamps come from the binding row (set by
 * `cockpit-berthier-ack` and `cockpit-mark-done` respectively).
 */

import "server-only"

import {
  getPowerStrings,
  matchesPowerString,
} from "@/lib/operator-studio/power-strings"
import type { Turn } from "@/lib/server/agent-bridge/app-sessions"

export type ReviewStatus =
  | "live"
  | "candidate-self-believed"
  | "awaiting-berthier-check"
  | "berthier-reviewed"
  | "human-approved"
  | "idle"

export const REVIEW_IDLE_THRESHOLD_MS = 5 * 60 * 1000

/** Sort rank used by the cockpit drawer + spawned-by route. Lower is
 *  higher in the list. David always sees what's NOT yet
 *  human-approved at the top. */
export const REVIEW_STATUS_RANK: Record<ReviewStatus, number> = {
  "awaiting-berthier-check": 0,
  "candidate-self-believed": 0,
  "berthier-reviewed": 1,
  live: 2,
  idle: 3,
  "human-approved": 4,
}

export interface ReviewStatusBindingState {
  /** ISO timestamp; non-null = Berthier explicitly acknowledged. */
  berthierReviewedAt?: string | null
  /** ISO timestamp; non-null = David explicitly signed off. */
  humanApprovedAt?: string | null
}

export function computeReviewStatus(
  turns: Turn[],
  lastActivityAt: string | null,
  binding: ReviewStatusBindingState = {}
): ReviewStatus {
  // Terminal — David signed off. Wins regardless of subsequent activity.
  if (binding.humanApprovedAt) return "human-approved"

  let lastAssistantIdx = -1
  let lastUserIdx = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    const r = turns[i].role
    if (lastAssistantIdx < 0 && r === "assistant") lastAssistantIdx = i
    if (lastUserIdx < 0 && r === "user") lastUserIdx = i
    if (lastAssistantIdx >= 0 && lastUserIdx >= 0) break
  }
  const taskDoneSpec = getPowerStrings().find((s) => s.id === "task-done-token")
  const hasTaskDone =
    !!taskDoneSpec &&
    lastAssistantIdx >= 0 &&
    lastAssistantIdx > lastUserIdx &&
    matchesPowerString(
      taskDoneSpec,
      "assistant",
      turns[lastAssistantIdx].parts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text)
        .join("\n")
    )

  if (hasTaskDone) {
    if (binding.berthierReviewedAt) return "berthier-reviewed"
    return "candidate-self-believed"
  }

  // Berthier acknowledged but the worker has since posted a non-done
  // assistant turn (re-engagement). Treat as live — Berthier's prior
  // ack no longer reflects current state.
  const ageMs = lastActivityAt
    ? Date.now() - Date.parse(lastActivityAt)
    : Number.POSITIVE_INFINITY
  if (Number.isFinite(ageMs) && ageMs > REVIEW_IDLE_THRESHOLD_MS) return "idle"
  return "live"
}

/** Last assistant turn's first text part, trimmed to ≤80 chars (with
 *  ellipsis if truncated). Null when no assistant turn exists yet, or
 *  when the assistant has only non-text parts. */
export function extractLastAssistantSnippet(turns: Turn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== "assistant") continue
    const firstText = turns[i].parts.find(
      (p): p is { kind: "text"; text: string } => p.kind === "text"
    )
    if (!firstText) return null
    const text = firstText.text.trim().replace(/\s+/g, " ")
    if (text.length === 0) return null
    return text.length > 80 ? text.slice(0, 80) + "…" : text
  }
  return null
}
