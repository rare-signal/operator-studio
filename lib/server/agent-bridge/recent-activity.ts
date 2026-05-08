/**
 * "What just happened lately?" — current-tail-derived activity for the
 * Bento command center.
 *
 * Solves the split-brain where Bento shows a live agent on screen but
 * a terminal-side check reads the JSONL's first user prompt and
 * misidentifies the session as something old. The list endpoint
 * (/api/operator-studio/agents) carries `title` from the first user
 * turn — that field is structurally stale once the agent has been
 * redirected mid-session. This module reads the *tail* of the same
 * sessions and surfaces:
 *   - latest user instruction (what was asked most recently),
 *   - latest assistant status (what it said back),
 *   - latest tool/file activity (what it's actually touching),
 *   - a best-effort plan-card id sniffed from recent content,
 *   - the existing stale title, clearly labeled as such.
 *
 * Read-only. No side effects on disk or on tmux.
 */

import "server-only"

import {
  getAppSessionTail,
  listAppSessions,
  type AppSlug,
  type AppStatus,
  type Turn,
} from "./app-sessions"
import { captureTmuxPane, listTmuxSessions } from "./tmux"
import { isValidSessionName } from "./exec"
import type { AgentCompositeId, AgentKind } from "./types"

export interface RecentActivityTurnHint {
  text: string
  at: string | null
}

export interface RecentToolActivity {
  name: string
  summary: string
  at: string | null
}

export interface RecentFileActivity {
  path: string
  tool: string
  at: string | null
}

export interface RecentAgentActivity {
  agentId: AgentCompositeId
  kind: AgentKind
  source: "tmux" | "claude" | "codex"
  /** First-user-prompt-derived label. Structurally stale: it does not
   *  reflect mid-session redirects. UI/agents must not treat this as
   *  "what the agent is currently doing". */
  staleTitle: string | null
  project: string | null

  /** ISO timestamp of the most recent file activity for this agent
   *  (JSONL mtime for Claude/Codex, tmux session activity otherwise). */
  lastActivityAt: string
  lastActivityAgeMs: number
  /** True for "writing right now" — short window around mtime. */
  isLive: boolean
  status: AppStatus
  /** Bytes after the last newline in the JSONL — non-zero means a turn
   *  is mid-stream. Always 0 for tmux. */
  pendingBytes: number

  /** Latest user-authored instruction in the tail. Null for tmux. */
  latestUserInstruction: RecentActivityTurnHint | null
  /** Latest assistant text turn in the tail (status / answer). */
  latestAssistantStatus: RecentActivityTurnHint | null
  /** Latest tool_use in the tail. */
  latestToolActivity: RecentToolActivity | null
  /** Latest file-touching tool (Edit/Write/Read/MultiEdit/NotebookEdit/
   *  apply_patch) with its target path. */
  latestFileActivity: RecentFileActivity | null

  /** Trailing turns. For Claude/Codex: parsed Turn[]. For tmux: a
   *  plain text capture in `tmuxText`. */
  recentTurns: Turn[]
  tmuxText: string | null

  /** Best-effort plan-card id sniffed from the recent tail (user
   *  instructions, tool args, assistant text). Lets Codex/Claude line
   *  up "agent X is on card Y" without trusting the stale title. */
  detectedPlanCardId: string | null
  detectedPlanCardSource: "user" | "assistant" | "tool" | null
}

const FILE_TOOL_NAMES = new Set([
  "Edit",
  "Write",
  "Read",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "apply_patch",
])

/** Card ids in this codebase are slugs that always start with `step-`
 *  (see plans.ts). Match a reasonable lower-bound length to avoid
 *  matching `step-1` style fragments in unrelated text. */
const CARD_ID_RE = /\bstep-[a-z0-9][a-z0-9-]{6,}\b/

function partsToText(turn: Turn): string {
  const out: string[] = []
  for (const p of turn.parts) {
    if (p.kind === "text") out.push(p.text)
    else if (p.kind === "thinking") out.push(p.text)
  }
  return out.join("\n").trim()
}

function extractFilePath(toolName: string, summary: string): string | null {
  if (!FILE_TOOL_NAMES.has(toolName)) return null
  // tool_use summary is JSON.stringify(input) truncated to 200 chars.
  // Try to recover file_path / path / notebook_path; fall back to a
  // regex if the JSON was truncated mid-value.
  try {
    const parsed = JSON.parse(summary) as Record<string, unknown>
    const v =
      (typeof parsed.file_path === "string" && parsed.file_path) ||
      (typeof parsed.path === "string" && parsed.path) ||
      (typeof parsed.notebook_path === "string" && parsed.notebook_path) ||
      null
    if (v) return v
  } catch {
    /* fall through to regex */
  }
  const m = summary.match(/"(?:file_path|path|notebook_path)"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

interface TailDerivation {
  latestUserInstruction: RecentActivityTurnHint | null
  latestAssistantStatus: RecentActivityTurnHint | null
  latestToolActivity: RecentToolActivity | null
  latestFileActivity: RecentFileActivity | null
  detectedPlanCardId: string | null
  detectedPlanCardSource: "user" | "assistant" | "tool" | null
}

function deriveFromTurns(turns: Turn[]): TailDerivation {
  let latestUserInstruction: RecentActivityTurnHint | null = null
  let latestAssistantStatus: RecentActivityTurnHint | null = null
  let latestToolActivity: RecentToolActivity | null = null
  let latestFileActivity: RecentFileActivity | null = null
  let detectedPlanCardId: string | null = null
  let detectedPlanCardSource: TailDerivation["detectedPlanCardSource"] = null

  function maybeRecordCard(text: string, source: NonNullable<TailDerivation["detectedPlanCardSource"]>) {
    if (detectedPlanCardId) return
    const m = text.match(CARD_ID_RE)
    if (m) {
      detectedPlanCardId = m[0]
      detectedPlanCardSource = source
    }
  }

  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role === "user" && !latestUserInstruction) {
      const text = partsToText(t)
      if (text) {
        latestUserInstruction = { text: text.slice(0, 800), at: t.at }
        maybeRecordCard(text, "user")
      }
    }
    if (t.role === "assistant" && !latestAssistantStatus) {
      const text = partsToText(t)
      if (text) {
        latestAssistantStatus = { text: text.slice(0, 800), at: t.at }
        maybeRecordCard(text, "assistant")
      }
    }
    if (
      (t.role === "assistant" || t.role === "tool") &&
      (!latestToolActivity || !latestFileActivity)
    ) {
      for (let j = t.parts.length - 1; j >= 0; j--) {
        const p = t.parts[j]
        if (p.kind !== "tool_use") continue
        if (!latestToolActivity) {
          latestToolActivity = {
            name: p.name,
            summary: p.summary.slice(0, 400),
            at: t.at,
          }
          maybeRecordCard(p.summary, "tool")
        }
        if (!latestFileActivity) {
          const fp = extractFilePath(p.name, p.summary)
          if (fp) {
            latestFileActivity = { path: fp, tool: p.name, at: t.at }
          }
        }
        if (latestToolActivity && latestFileActivity) break
      }
    }
    if (
      latestUserInstruction &&
      latestAssistantStatus &&
      latestToolActivity &&
      latestFileActivity &&
      detectedPlanCardId
    ) {
      break
    }
  }

  return {
    latestUserInstruction,
    latestAssistantStatus,
    latestToolActivity,
    latestFileActivity,
    detectedPlanCardId,
    detectedPlanCardSource,
  }
}

function deriveFromTmuxText(text: string): TailDerivation {
  const card = text.match(CARD_ID_RE)
  return {
    latestUserInstruction: null,
    latestAssistantStatus: null,
    latestToolActivity: null,
    latestFileActivity: null,
    detectedPlanCardId: card ? card[0] : null,
    detectedPlanCardSource: card ? "tool" : null,
  }
}

export interface RecentActivityOptions {
  /** Max sessions per app to consider before tail-parsing. Defaults to 8. */
  appLimit?: number
  /** Number of trailing turns to keep in the response. Defaults to 12. */
  recentTurns?: number
  /** Number of trailing tmux lines to keep. Defaults to 60. */
  tmuxLines?: number
  /** When true, only include agents whose `lastActivityAt` is within
   *  this many ms. Set to 0 / undefined to include all. */
  freshWithinMs?: number
  /** Cap on returned items after sort. Defaults to 12. */
  limit?: number
  /** When true, include tmux sessions. Defaults to true. */
  includeTmux?: boolean
}

async function buildAppActivity(
  app: AppSlug,
  appLimit: number,
  recentTurnsCap: number,
  freshWithinMs: number | undefined
): Promise<RecentAgentActivity[]> {
  const sessions = await listAppSessions(app, appLimit).catch(() => [])
  const now = Date.now()
  const out: RecentAgentActivity[] = []
  for (const s of sessions) {
    if (freshWithinMs && now - s.mtimeMs > freshWithinMs) continue
    const tail = await getAppSessionTail(app, s.id, recentTurnsCap)
    if ("error" in tail) continue
    const derived = deriveFromTurns(tail.turns)
    out.push({
      agentId: `${app}:${s.id}` as AgentCompositeId,
      kind: app,
      source: app,
      staleTitle: s.title,
      project: s.project,
      lastActivityAt: tail.fileMtime,
      lastActivityAgeMs: tail.mtimeAgeMs,
      isLive: tail.mtimeAgeMs < 5_000,
      status: tail.status,
      pendingBytes: tail.pendingBytes,
      latestUserInstruction: derived.latestUserInstruction,
      latestAssistantStatus: derived.latestAssistantStatus,
      latestToolActivity: derived.latestToolActivity,
      latestFileActivity: derived.latestFileActivity,
      recentTurns: tail.turns,
      tmuxText: null,
      detectedPlanCardId: derived.detectedPlanCardId,
      detectedPlanCardSource: derived.detectedPlanCardSource,
    })
  }
  return out
}

async function buildTmuxActivity(
  tmuxLines: number,
  freshWithinMs: number | undefined
): Promise<RecentAgentActivity[]> {
  const sessions = await listTmuxSessions().catch(() => [])
  const now = Date.now()
  const out: RecentAgentActivity[] = []
  for (const s of sessions) {
    const ageMs = Math.max(0, now - new Date(s.lastActivityAt).getTime())
    if (freshWithinMs && ageMs > freshWithinMs && !s.attached) continue
    if (!isValidSessionName(s.name)) continue
    const cap = await captureTmuxPane(s.name, tmuxLines)
    const text = "content" in cap ? cap.content : ""
    const trimmed = text.split("\n").slice(-tmuxLines).join("\n")
    const derived = deriveFromTmuxText(trimmed)
    const isLive = s.attached || ageMs < 5_000
    out.push({
      agentId: `tmux:${s.name}` as AgentCompositeId,
      kind: "tmux",
      source: "tmux",
      staleTitle: null,
      project: s.command || null,
      lastActivityAt: s.lastActivityAt,
      lastActivityAgeMs: ageMs,
      isLive,
      status: isLive ? "streaming" : "idle",
      pendingBytes: 0,
      latestUserInstruction: null,
      latestAssistantStatus: null,
      latestToolActivity: null,
      latestFileActivity: null,
      recentTurns: [],
      tmuxText: trimmed,
      detectedPlanCardId: derived.detectedPlanCardId,
      detectedPlanCardSource: derived.detectedPlanCardSource,
    })
  }
  return out
}

export async function getRecentAgentActivity(
  opts: RecentActivityOptions = {}
): Promise<RecentAgentActivity[]> {
  const appLimit = Math.max(1, Math.min(40, opts.appLimit ?? 8))
  const recentTurnsCap = Math.max(4, Math.min(200, opts.recentTurns ?? 12))
  const tmuxLines = Math.max(10, Math.min(2000, opts.tmuxLines ?? 60))
  const freshWithinMs =
    typeof opts.freshWithinMs === "number" && opts.freshWithinMs > 0
      ? opts.freshWithinMs
      : undefined
  const includeTmux = opts.includeTmux !== false
  const limit = Math.max(1, Math.min(50, opts.limit ?? 12))

  const [claude, codex, tmux] = await Promise.all([
    buildAppActivity("claude", appLimit, recentTurnsCap, freshWithinMs),
    buildAppActivity("codex", appLimit, recentTurnsCap, freshWithinMs),
    includeTmux
      ? buildTmuxActivity(tmuxLines, freshWithinMs)
      : Promise.resolve([] as RecentAgentActivity[]),
  ])

  const merged = [...claude, ...codex, ...tmux]
  merged.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1
    return b.lastActivityAt.localeCompare(a.lastActivityAt)
  })
  return merged.slice(0, limit)
}
