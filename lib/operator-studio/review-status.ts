/**
 * Worker reviewStatus computation — shared between the cockpit
 * spawned-by route (renders the badge) and the auto-detach safety net
 * (detaches stale ready-for-review workers).
 *
 *   - "ready-for-review": last assistant turn matches the task_done
 *     power-string AND no user turn followed it (re-engagement flips
 *     back to live).
 *   - "idle": no recent activity within REVIEW_IDLE_THRESHOLD_MS.
 *   - "live": everything else.
 */

import "server-only"

import {
  getPowerStrings,
  matchesPowerString,
} from "@/lib/operator-studio/power-strings"
import type { Turn } from "@/lib/server/agent-bridge/app-sessions"

export type ReviewStatus = "live" | "ready-for-review" | "idle"

export const REVIEW_IDLE_THRESHOLD_MS = 5 * 60 * 1000

export function computeReviewStatus(
  turns: Turn[],
  lastActivityAt: string | null
): ReviewStatus {
  let lastAssistantIdx = -1
  let lastUserIdx = -1
  for (let i = turns.length - 1; i >= 0; i--) {
    const r = turns[i].role
    if (lastAssistantIdx < 0 && r === "assistant") lastAssistantIdx = i
    if (lastUserIdx < 0 && r === "user") lastUserIdx = i
    if (lastAssistantIdx >= 0 && lastUserIdx >= 0) break
  }
  const taskDoneSpec = getPowerStrings().find((s) => s.id === "task-done-token")
  if (
    taskDoneSpec &&
    lastAssistantIdx >= 0 &&
    lastAssistantIdx > lastUserIdx
  ) {
    const content = turns[lastAssistantIdx].parts
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text)
      .join("\n")
    if (matchesPowerString(taskDoneSpec, "assistant", content)) {
      return "ready-for-review"
    }
  }
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
