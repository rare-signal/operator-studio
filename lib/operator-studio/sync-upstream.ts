import type { OperatorThreadMessage } from "./types"

/**
 * Content-aware diagnosis of how upstream relates to what we have stored.
 *
 * Pure, sync, no I/O — caller hands in both message lists and gets back
 * one of four verdicts. The endpoint then executes the appropriate
 * action (append, fork, nothing).
 *
 * Rules:
 *   - upstream shorter than stored → "shrunk" (file was rewritten or
 *     rolled back; we don't try to be clever, just do nothing).
 *   - shared prefix matches AND upstream is longer → "fast-forward"
 *     (safe to append the tail).
 *   - shared prefix matches AND lengths equal → "noop".
 *   - shared prefix differs at any index → "conflict" (someone edited
 *     either side; auto-fork to preserve both views).
 *
 * We compare role + content exactly. Claude Code / Codex JSONL is
 * effectively append-only, so any shared-prefix mismatch overwhelmingly
 * indicates a local edit on the stored side — but the diagnosis is
 * symmetric: we don't claim to know which side moved.
 */
export type UpstreamSyncDiagnosis =
  | { kind: "noop" }
  | {
      kind: "fast-forward"
      appendFrom: number
      newMessages: ReadonlyArray<UpstreamLikeMessage>
    }
  | { kind: "conflict"; divergeAt: number }
  | { kind: "shrunk"; storedCount: number; upstreamCount: number }

export type UpstreamLikeMessage = {
  role: string
  content: string
  timestamp?: string
}

export type StoredLikeMessage = Pick<
  OperatorThreadMessage,
  "role" | "content" | "turnIndex"
>

export function diagnoseUpstreamSync(
  stored: ReadonlyArray<StoredLikeMessage>,
  upstream: ReadonlyArray<UpstreamLikeMessage>
): UpstreamSyncDiagnosis {
  if (upstream.length < stored.length) {
    return {
      kind: "shrunk",
      storedCount: stored.length,
      upstreamCount: upstream.length,
    }
  }

  for (let i = 0; i < stored.length; i++) {
    if (
      stored[i].role !== upstream[i].role ||
      stored[i].content !== upstream[i].content
    ) {
      return { kind: "conflict", divergeAt: i }
    }
  }

  if (upstream.length === stored.length) return { kind: "noop" }

  return {
    kind: "fast-forward",
    appendFrom: stored.length,
    newMessages: upstream.slice(stored.length),
  }
}
