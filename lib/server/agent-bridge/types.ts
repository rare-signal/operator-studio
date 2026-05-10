/**
 * Shared types for the in-app agent bridge surfaced via
 * /api/operator-studio/agents/*. Kept in a dedicated module so the
 * Bento command center component can import them without dragging
 * server-only dependencies.
 */

import type { AppStatus, Turn } from "./app-sessions"

export type AgentKind = "tmux" | "claude" | "codex"

/** Composite agent id as it appears in URLs. The route handlers parse
 *  this to a {kind, ref} pair. Kind comes first so a malformed ref
 *  can't be mistaken for a different kind. */
export type AgentCompositeId = `tmux:${string}` | `claude:${string}` | `codex:${string}`

export interface AgentListItem {
  id: AgentCompositeId
  kind: AgentKind
  /** Human-friendly label shown in the pane header. */
  label: string
  /** Source app id from IMPORTER_SOURCE_IDS, or "tmux" for tmux panes.
   *  Used by the UI to pick a tint + icon. */
  source: "tmux" | "claude" | "codex"
  /** ISO timestamp of last activity. */
  lastActivityAt: string
  /** Best-effort status. tmux panes: "live" if attached or recent,
   *  "idle" otherwise. JSONL sessions: derived from the parsed tail. */
  status: AppStatus
  /** Project / context hint, when known. tmux: pane current command.
   *  JSONL: project slug. */
  project: string | null
  /** Title pulled from the first user turn (JSONL only). */
  title: string | null
  /** True for "actively writing right now" — short window heuristic. */
  isLive: boolean
}

export interface AgentSnapshot {
  id: AgentCompositeId
  kind: AgentKind
  capturedAt: string
  status: AppStatus
  /** Plain-text scrollback for tmux panes; the `lines` field counts
   *  the number of trailing lines. */
  text?: string
  /** Parsed turn list for JSONL-backed sessions. */
  turns?: Turn[]
  fileMtime?: string
  pendingBytes?: number
  liveness?: {
    partialMode:
      | "tmux-pane-text"
      | "jsonl-line-buffered-codex"
      | "jsonl-per-message"
    partialUnavailable?: string
    pendingBytes: number
  }
}

export interface SendOutcome {
  ok: true
  at: string
  sentTextLength: number
  sentKeys: string[]
  submitted: boolean
}

export type ParsedAgentId =
  | { kind: "tmux"; ref: string }
  | { kind: "claude"; ref: string }
  | { kind: "codex"; ref: string }
  | { kind: null; error: string }

export function parseAgentId(raw: string): ParsedAgentId {
  const idx = raw.indexOf(":")
  if (idx <= 0) return { kind: null, error: "Invalid agent id (missing prefix)" }
  const prefix = raw.slice(0, idx)
  const ref = raw.slice(idx + 1)
  if (prefix === "tmux" || prefix === "claude" || prefix === "codex") {
    return { kind: prefix, ref }
  }
  return { kind: null, error: `Unknown agent kind: ${prefix}` }
}
