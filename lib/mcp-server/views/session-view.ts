/**
 * Markdown projections for sessions and threads.
 */

import type {
  OperatorSession,
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadSummary,
} from "@/lib/operator-studio/types"
import { defaultSessionLabel } from "@/lib/operator-studio/sessions"

function formatRelative(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const deltaMs = now.getTime() - t
  const mins = Math.round(deltaMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

export function renderSessionsList(
  groups: Array<{ session: OperatorSession; threads: OperatorThread[] }>,
  now: Date = new Date()
): string {
  if (groups.length === 0) return "_No recent sessions._"
  const lines: string[] = []
  lines.push(`# Recent sessions (${groups.length})`)
  lines.push("")
  for (const { session, threads } of groups) {
    const label =
      session.label ?? defaultSessionLabel(new Date(session.startedAt))
    const ago = formatRelative(session.startedAt, now)
    lines.push(`## \`${session.id}\` ${label}`)
    lines.push(
      `_started ${ago} · ${threads.length} thread${threads.length === 1 ? "" : "s"} · plan ${session.planId ?? "(none)"}_`
    )
    if (threads.length > 0) {
      for (const t of threads.slice(0, 8)) {
        const title = t.promotedTitle ?? t.rawTitle ?? "Untitled thread"
        lines.push(
          `- \`${t.id}\` ${title} · ${t.sourceApp} · ${t.messageCount} turns · ${t.reviewState}`
        )
      }
      if (threads.length > 8) {
        lines.push(
          `- _…and ${threads.length - 8} more. Call \`thread.summary\` with a specific id._`
        )
      }
    } else {
      lines.push("- _no threads in window_")
    }
    lines.push("")
  }
  return lines.join("\n")
}

export function renderThreadSummary(
  thread: OperatorThread,
  summaries: OperatorThreadSummary[]
): string {
  const title = thread.promotedTitle ?? thread.rawTitle ?? "Untitled thread"
  const lines: string[] = []
  lines.push(`# Thread: ${title}`)
  const meta = [
    thread.reviewState,
    thread.sourceApp,
    `${thread.messageCount} turns`,
    `imported ${formatRelative(thread.importedAt)}`,
    `id: ${thread.id}`,
  ]
  lines.push(`_${meta.join(" · ")}_`)
  if (thread.tags.length > 0)
    lines.push(`_tags: ${thread.tags.map((t) => `#${t}`).join(", ")}_`)
  lines.push("")

  if (thread.captureReason) {
    lines.push("## Capture reason")
    lines.push(thread.captureReason.trim())
    lines.push("")
  }

  if (thread.whyItMatters) {
    lines.push("## Why it matters")
    lines.push(thread.whyItMatters.trim())
    lines.push("")
  }

  // Prefer the most recent promoted/manual summary; fall back to auto.
  const ranked = [...summaries].sort((a, b) => {
    const rank = (s: OperatorThreadSummary) =>
      s.summaryKind === "promoted" ? 0 : s.summaryKind === "manual" ? 1 : 2
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  if (ranked.length > 0) {
    const top = ranked[0]
    lines.push(`## Summary (${top.summaryKind})`)
    lines.push(`_by ${top.createdBy} · ${formatRelative(top.createdAt)}_`)
    lines.push("")
    lines.push(top.content.trim())
    if (ranked.length > 1) {
      lines.push("")
      lines.push(
        `_${ranked.length - 1} additional summar${ranked.length - 1 === 1 ? "y" : "ies"} on file._`
      )
    }
  } else {
    lines.push("## Summary")
    lines.push(
      "_(no summary on file — use `thread.passages` to search the raw transcript instead)_"
    )
  }
  return lines.join("\n")
}

export function renderThreadPassages(
  thread: OperatorThread,
  matches: Array<{ message: OperatorThreadMessage; snippet: string }>,
  query: string
): string {
  const title = thread.promotedTitle ?? thread.rawTitle ?? "Untitled thread"
  const lines: string[] = []
  lines.push(
    `# Passage matches for "${query}" in thread "${title}" (${matches.length})`
  )
  lines.push(`_thread id: ${thread.id} · ${thread.sourceApp}_`)
  lines.push("")
  if (matches.length === 0) {
    lines.push("_No matches in this thread._")
    return lines.join("\n")
  }
  for (const { message, snippet } of matches) {
    lines.push(`## Turn ${message.turnIndex} · ${message.role}`)
    lines.push("")
    lines.push(snippet)
    lines.push("")
  }
  return lines.join("\n")
}
