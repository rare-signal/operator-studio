/**
 * Showcase snapshot — reads Claude Code JSONL transcripts via the
 * existing `claudeCodeImporter`, transforms them into the same shapes
 * the live Drizzle queries return, and writes them to
 * `public/showcase-data/` for a static export of Operator Studio.
 *
 * No DB. No network. Just fs in, fs out. Run with:
 *   pnpm showcase:snapshot
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"

import { claudeCodeImporter } from "../lib/operator-studio/importers/claude-code"
import { detectThreadDone } from "../lib/operator-studio/thread-done"
import type { ParsedSession } from "../lib/operator-studio/importers/_registry"
import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadSummary,
  OperatorSession,
  OperatorSessionPlan,
  OperatorPlanStep,
} from "../lib/operator-studio/types"
import type {
  ThreadCountSummary,
  OperatorThreadPreview,
} from "../lib/operator-studio/queries"
import {
  EARLIEST_THREAD_DATE,
  redactDeep,
  shouldDropThread,
} from "./showcase-redactions"

// ─── Constants ───────────────────────────────────────────────────────────────

const SHOWCASE_WORKSPACE_ID = "showcase"
const SHOWCASE_OPERATOR = "David Lin-Clark"
const OUT_DIR = path.resolve(process.cwd(), "public/showcase-data")

// Idle gap between messages that splits a Work Session, mirrors
// lib/operator-studio/sessions.ts default.
const SESSION_IDLE_GAP_MS = 3 * 60 * 60 * 1000

// ─── Deterministic id helpers ────────────────────────────────────────────────

function stableId(prefix: string, ...parts: string[]): string {
  const hash = createHash("sha1")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 12)
  return `${prefix}-${hash}`
}

// ─── Transform: ParsedSession → OperatorThread + messages ───────────────────

function sessionToThread(
  session: ParsedSession
): {
  thread: OperatorThread
  messages: OperatorThreadMessage[]
} {
  const threadId = stableId("thread", session.sourceThreadId)
  const importedAt = session.lastActivityAt ?? session.createdAt ?? new Date().toISOString()
  const createdAt = session.createdAt ?? importedAt

  const messages: OperatorThreadMessage[] = session.messages.map((m, i) => ({
    id: stableId("msg", threadId, String(i)),
    threadId,
    role: m.role,
    content: m.content,
    turnIndex: i,
    metadataJson: m.metadata ?? null,
    promotedAt: null,
    promotedBy: null,
    promotionNote: null,
    promotionKind: null,
    createdAt: m.timestamp ?? createdAt,
  }))

  // Done-phrase detection — same logic the live app uses (whole-message
  // exact match on user turns, case + whitespace insensitive). Lets
  // threads with a done-sentinel light up the green check in the rail
  // and pulse view.
  const done = detectThreadDone(messages)

  // Source-app coloring tell: every thread really came from Claude
  // Code (the source root we read from), but for the showcase we
  // re-label threads that never literally mention "claude" as
  // `codex` so the timeline / by-source / source pills show a mix
  // of colors. Purely cosmetic — the underlying messages are
  // unchanged.
  const mentionsClaude =
    /claude/i.test(session.title ?? "") ||
    messages.some((m) => /claude/i.test(m.content))
  const sourceApp = mentionsClaude ? "claude-code" : "codex"

  // Scrub claude-flavored deep-link material when we relabel a
  // thread as codex. `sourceThreadKey` for Claude Code imports is
  // `claude-<base64>` where the base64 wraps the *original* file
  // path — which means redactions never see it as a string and the
  // pre-redaction host name leaks back out via the codex:// deep
  // link. Replace the key with a clean trailing UUID and null the
  // locator (codex has no filesystem path semantics anyway).
  const filePath =
    typeof session.metadata?.filePath === "string"
      ? (session.metadata.filePath as string)
      : null
  const trailingUuid = filePath?.match(/([0-9a-f-]{32,})\.jsonl?$/i)?.[1] ?? null

  const sourceThreadKey =
    sourceApp === "codex"
      ? trailingUuid ?? threadId
      : session.sourceThreadId
  const sourceLocator = sourceApp === "codex" ? null : filePath

  const thread: OperatorThread = {
    id: threadId,
    workspaceId: SHOWCASE_WORKSPACE_ID,
    sourceApp,
    sourceThreadKey,
    sourceLocator,
    importedBy: SHOWCASE_OPERATOR,
    importedAt,
    importRunId: null,
    rawTitle: session.title || "Untitled session",
    rawSummary: null,
    promotedTitle: null,
    promotedSummary: null,
    privacyState: "private",
    reviewState: "imported",
    tags: [],
    projectSlug: "operator-studio",
    ownerName: SHOWCASE_OPERATOR,
    whyItMatters: null,
    captureReason: null,
    parentThreadId: null,
    promotedFromId: null,
    pulledFromId: null,
    visibleInStudio: true,
    messageCount: messages.length,
    archivedAt: null,
    markedDoneAt: done.markedDoneAt,
    markedDoneBy: done.markedDoneAt ? SHOWCASE_OPERATOR : null,
    markedDoneSource: done.markedDoneAt ? "phrase" : null,
    createdAt,
    updatedAt: importedAt,
  }

  return { thread, messages }
}

// ─── Bookend preview (matches getThreadPreviews shape) ──────────────────────

function buildPreview(
  thread: OperatorThread,
  messages: OperatorThreadMessage[]
): OperatorThreadPreview {
  const firstUser = messages.find((m) => m.role === "user")
  const firstAssistant = messages.find((m) => m.role === "assistant")
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  const startedAt = messages[0]?.createdAt ?? thread.createdAt
  const endedAt = messages[messages.length - 1]?.createdAt ?? thread.updatedAt
  const toBookend = (m: OperatorThreadMessage | undefined) =>
    m && (m.role === "user" || m.role === "assistant")
      ? { role: m.role, content: m.content, createdAt: m.createdAt }
      : null
  return {
    threadId: thread.id,
    startedAt,
    endedAt,
    messageCount: messages.length,
    firstUser: toBookend(firstUser),
    firstAssistant: toBookend(firstAssistant),
    lastUser: toBookend(lastUser),
    lastAssistant: toBookend(lastAssistant),
  }
}

// ─── Work-session segmentation (mirrors lib/operator-studio/sessions.ts) ────

interface MessageStamp {
  threadId: string
  messageId: string
  createdAt: number // epoch ms
}

function segmentWorkSessions(
  threads: OperatorThread[],
  messagesByThread: Map<string, OperatorThreadMessage[]>
): OperatorSession[] {
  const stamps: MessageStamp[] = []
  for (const t of threads) {
    const msgs = messagesByThread.get(t.id) ?? []
    for (const m of msgs) {
      const ts = Date.parse(m.createdAt)
      if (!Number.isNaN(ts)) {
        stamps.push({ threadId: t.id, messageId: m.id, createdAt: ts })
      }
    }
  }
  stamps.sort((a, b) => a.createdAt - b.createdAt)

  const sessions: OperatorSession[] = []
  let bucket: MessageStamp[] = []
  for (const s of stamps) {
    if (
      bucket.length === 0 ||
      s.createdAt - bucket[bucket.length - 1].createdAt < SESSION_IDLE_GAP_MS
    ) {
      bucket.push(s)
    } else {
      sessions.push(bucketToSession(bucket))
      bucket = [s]
    }
  }
  if (bucket.length > 0) sessions.push(bucketToSession(bucket))
  return sessions
}

function bucketToSession(bucket: MessageStamp[]): OperatorSession {
  const startedAt = new Date(bucket[0].createdAt).toISOString()
  const endedAt = new Date(bucket[bucket.length - 1].createdAt).toISOString()
  const threadIds = new Set(bucket.map((s) => s.threadId))
  return {
    id: stableId("session", startedAt),
    workspaceId: SHOWCASE_WORKSPACE_ID,
    label: null,
    startedAt,
    endedAt,
    planSteps: [],
    planId: null,
    threadCount: threadIds.size,
    messageCount: bucket.length,
    createdAt: startedAt,
    updatedAt: endedAt,
  }
}

// ─── Fabricated plan (sketch trajectory) ────────────────────────────────────

function fabricatePlan(threads: OperatorThread[]): OperatorSessionPlan {
  const earliestImported = threads
    .map((t) => t.importedAt)
    .sort()
    .at(0) ?? new Date().toISOString()
  const latestImported = threads
    .map((t) => t.importedAt)
    .sort()
    .at(-1) ?? new Date().toISOString()

  const stepsRaw: Array<{ title: string; description: string }> = [
    {
      title: "Bootstrap shell + ShadCN registry",
      description:
        "Drop the Studio shell, sidebar, and theme tokens in. Get the empty app rendering with the right chrome before any data lands.",
    },
    {
      title: "Land the thread import pipeline",
      description:
        "Importer registry, Claude Code + Codex + OpenCode parsers, dedupe-on-source-key, append-on-grow. Bring real chats into the workspace.",
    },
    {
      title: "Thread review surface",
      description:
        "Review states, source/state filters, promote/archive flow, message-level promotion (insight / decision / quotable / technical / fire).",
    },
    {
      title: "Time-bucketed Work Sessions",
      description:
        "3-hour idle-gap segmentation, session detail, top threads per session, daily activity heatmap.",
    },
    {
      title: "Plan + Work as the AAA loop",
      description:
        "Promote durable plans out of session plan_steps. Plan + Pulse share /plan with ?tab=work. Plan becomes the durable unit of intent.",
    },
    {
      title: "Wayseer enrichment layer",
      description:
        "Per-thread analysis + workspace rollup. LLM-optional — heuristics run when no endpoint configured. Coaching insights on top of raw chats.",
    },
    {
      title: "Cross-platform + integrity",
      description:
        "Mac/Linux/Windows path resolution, importer-registry integrity check, source-id enumeration via listImporters() instead of hardcoded lists.",
    },
    {
      title: "Open-source the receipts",
      description:
        "Static export of the Studio with the actual agentic chats that built it. Not a screenshot tour — the real shell, populated.",
    },
  ]
  const steps: OperatorPlanStep[] = stepsRaw.map((s, i) => ({
    id: stableId("step", String(i), s.title),
    title: s.title,
    description: s.description,
    order: i,
    status: i < stepsRaw.length - 1 ? "covered" : "in-motion",
    parentStepId: null,
    positionX: null,
    positionY: null,
    coverImageUrl: null,
  }))

  return {
    id: stableId("plan", "showcase"),
    workspaceId: SHOWCASE_WORKSPACE_ID,
    title: "Build Operator Studio with Claude Code",
    goal: "Ship a self-hostable agent-session review tool, built end-to-end with Claude Code, and publish the agentic chat log alongside the source.",
    outcome:
      "Operator Studio v0.1 deployed; static showcase published with the 60 chats that built it.",
    state: "active",
    pinned: true,
    ownerName: SHOWCASE_OPERATOR,
    createdBy: SHOWCASE_OPERATOR,
    shippedAt: null,
    archivedAt: null,
    createdAt: earliestImported,
    updatedAt: latestImported,
    steps,
  }
}

// ─── Counts ─────────────────────────────────────────────────────────────────

function buildCounts(threads: OperatorThread[]): ThreadCountSummary {
  const byState: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  for (const t of threads) {
    byState[t.reviewState] = (byState[t.reviewState] ?? 0) + 1
    bySource[t.sourceApp] = (bySource[t.sourceApp] ?? 0) + 1
  }
  return { byState, bySource, total: threads.length }
}

// ─── Pulse graph builder ────────────────────────────────────────────────────
//
// Mirrors the shape produced by `app/2/v2/data/load-pulse.ts::loadPulseGraph`
// but builds it from the in-memory snapshot — no DB. Same field names,
// same conventions (t in [0..1], pulseTicks capped, lane assignment via
// greedy fit) so the live `PulseView` component renders unchanged.

interface ShowcasePulseNode {
  id: string
  title: string
  sourceApp: string
  reviewState: string
  firstAt: string
  lastAt: string
  messagesInWindow: number
  messagesTotal: number
  parentThreadId: string | null
  pulseTicks: string[]
  tFirst: number
  tLast: number
  lane: number
  live: boolean
  lastRole: "user" | "assistant" | "system" | "function"
  waitingOnAgent: boolean
  divergedAt: string | null
  inheritedTickCount: number
  forkFamilyId: string | null
  isForkOrigin: boolean
  markedDone: boolean
  markedDoneAt: string | null
}

function assignLanesShowcase(
  nodes: Array<{ tFirst: number; tLast: number }>,
  laneCount: number,
  minSpan: number = 0.24
): number[] {
  const laneEnd = new Array<number>(laneCount).fill(-Infinity)
  const order = nodes
    .map((_, i) => i)
    .sort((a, b) => nodes[a].tFirst - nodes[b].tFirst)
  const laneFor = new Map<number, number>()
  for (const i of order) {
    const n = nodes[i]
    const occupiedEnd = Math.max(n.tLast, n.tFirst + minSpan)
    let picked = -1
    for (let l = 0; l < laneCount; l++) {
      if (laneEnd[l] <= n.tFirst) {
        picked = l
        break
      }
    }
    if (picked === -1) picked = laneEnd.indexOf(Math.min(...laneEnd))
    laneEnd[picked] = occupiedEnd + 0.02
    laneFor.set(i, picked)
  }
  return nodes.map((_, i) => (laneFor.get(i) ?? 0) / Math.max(1, laneCount - 1))
}

function defaultSessionLabel(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function buildPulseGraph(
  session: OperatorSession,
  allSessions: OperatorSession[],
  threads: OperatorThread[],
  messagesByThread: Map<string, OperatorThreadMessage[]>
): unknown {
  const sessionStartMs = Date.parse(session.startedAt)
  const sessionEndMs = Date.parse(session.endedAt) + SESSION_IDLE_GAP_MS
  const windowStart = sessionStartMs
  const windowEnd = Date.parse(session.endedAt)
  const windowMs = Math.max(1, windowEnd - windowStart)
  const t = (iso: string) =>
    Math.max(0, Math.min(1, (Date.parse(iso) - windowStart) / windowMs))

  // Threads whose messages overlap the session window.
  const candidates: ShowcasePulseNode[] = []
  let totalMessagesInWindow = 0
  for (const thread of threads) {
    const all = messagesByThread.get(thread.id) ?? []
    const inWindow = all.filter((m) => {
      const ts = Date.parse(m.createdAt)
      return ts >= sessionStartMs && ts <= sessionEndMs
    })
    if (inWindow.length === 0) continue
    totalMessagesInWindow += inWindow.length

    const firstAt = inWindow[0].createdAt
    const lastMessage = inWindow[inWindow.length - 1]
    const lastAt = lastMessage.createdAt
    const lastRole = (lastMessage.role ?? "assistant") as
      | "user"
      | "assistant"
      | "system"
      | "function"

    const MAX_TICKS = 80
    const stride = Math.max(1, Math.ceil(inWindow.length / MAX_TICKS))
    const pulseTicks: string[] = []
    for (let i = 0; i < inWindow.length; i += stride) {
      pulseTicks.push(inWindow[i].createdAt)
    }
    if (pulseTicks[pulseTicks.length - 1] !== lastAt) pulseTicks.push(lastAt)

    candidates.push({
      id: thread.id,
      title: thread.rawTitle ?? `Thread ${thread.id.slice(0, 6)}`,
      sourceApp: thread.sourceApp,
      reviewState: thread.reviewState,
      firstAt,
      lastAt,
      messagesInWindow: inWindow.length,
      messagesTotal: thread.messageCount,
      parentThreadId: thread.parentThreadId,
      pulseTicks,
      tFirst: t(firstAt),
      tLast: t(lastAt),
      lane: 0,
      // Snapshot is frozen — nothing is "live" by definition.
      live: false,
      lastRole,
      waitingOnAgent: false,
      divergedAt: null,
      inheritedTickCount: 0,
      forkFamilyId: null,
      isForkOrigin: false,
      markedDone: thread.markedDoneAt !== null,
      markedDoneAt: thread.markedDoneAt,
    })
  }
  candidates.sort((a, b) => a.tFirst - b.tFirst)

  // Lane assignment.
  const lanes = assignLanesShowcase(candidates, 6)
  const nodes = candidates.map((n, i) => ({ ...n, lane: lanes[i] }))

  // Edges — fork links between in-window nodes.
  const inWindowIds = new Set(nodes.map((n) => n.id))
  const edges: Array<{ from: string; to: string; kind: "fork" }> = []
  for (const n of nodes) {
    if (n.parentThreadId && inWindowIds.has(n.parentThreadId)) {
      edges.push({ from: n.parentThreadId, to: n.id, kind: "fork" })
    }
  }

  // Beats — session start + gap markers + plan-sketched.
  type Beat = {
    id: string
    kind: "session-start" | "plan-sketched" | "promotion" | "gap" | "now"
    at: string
    t: number
    label: string
    targetId?: string
  }
  const beats: Beat[] = [
    {
      id: `beat-start-${session.id}`,
      kind: "session-start",
      at: session.startedAt,
      t: t(session.startedAt),
      label: "session began",
    },
    {
      id: `beat-plan-${session.id}`,
      kind: "plan-sketched",
      at: session.startedAt,
      t: Math.min(1, t(session.startedAt) + 0.02),
      label: "plan sketched · 8 steps",
    },
  ]
  // Gap markers: idle stretches > 20 min between consecutive messages.
  const allTimes: number[] = []
  for (const n of nodes) {
    for (const tick of n.pulseTicks) {
      const ms = Date.parse(tick)
      if (!Number.isNaN(ms)) allTimes.push(ms)
    }
  }
  allTimes.sort((a, b) => a - b)
  for (let i = 1; i < allTimes.length; i++) {
    const gap = allTimes[i] - allTimes[i - 1]
    if (gap >= 20 * 60 * 1000) {
      const mid = (allTimes[i] + allTimes[i - 1]) / 2
      beats.push({
        id: `beat-gap-${i}`,
        kind: "gap",
        at: new Date(mid).toISOString(),
        t: t(new Date(mid).toISOString()),
        label: `${Math.round(gap / 60000)}m quiet`,
      })
    }
  }

  // Source counts.
  const sourceCounts = new Map<string, number>()
  for (const n of nodes) {
    sourceCounts.set(n.sourceApp, (sourceCounts.get(n.sourceApp) ?? 0) + 1)
  }
  const sources = Array.from(sourceCounts.entries())
    .map(([sourceApp, count]) => ({ sourceApp, count }))
    .sort((a, b) => b.count - a.count)

  // Available sessions list — newest first, with content only.
  const sortedAll = [...allSessions]
    .filter((s) => s.messageCount > 0 || s.id === session.id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const availableSessions = sortedAll.map((s) => ({
    id: s.id,
    label: defaultSessionLabel(new Date(s.startedAt)),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    threadCount: s.threadCount,
    messageCount: s.messageCount,
  }))
  const idx = availableSessions.findIndex((s) => s.id === session.id)
  const nextSessionId = idx > 0 ? availableSessions[idx - 1]?.id ?? null : null
  const prevSessionId =
    idx >= 0 && idx < availableSessions.length - 1
      ? availableSessions[idx + 1]?.id ?? null
      : null

  return {
    session: {
      id: session.id,
      label: defaultSessionLabel(new Date(session.startedAt)),
      startedAt: new Date(windowStart).toISOString(),
      endedAt: new Date(windowEnd).toISOString(),
      // Snapshot is frozen — `nowAt` ends at the window's end so the
      // "now" cursor never floats past the data.
      nowAt: new Date(windowEnd).toISOString(),
      durationMinutes: Math.max(1, Math.round((windowEnd - windowStart) / 60000)),
    },
    mode: "single" as const,
    rangeSessions: [],
    nodes,
    edges,
    beats: beats.sort((a, b) => a.t - b.t),
    stats: {
      threads: nodes.length,
      messages: totalMessagesInWindow,
      liveThreads: 0,
      forks: edges.length,
      sources,
    },
    availableSessions,
    prevSessionId,
    nextSessionId,
  }
}

// ─── Output writers ─────────────────────────────────────────────────────────

function writeJson(rel: string, data: unknown): void {
  // Every snapshot file passes through redactions on the way out —
  // see `scripts/showcase-redactions.ts`. This is the only chokepoint
  // through which JSON reaches `public/showcase-data/`, so a single
  // call here covers thread bodies, manifests, plans, previews, etc.
  const redacted = redactDeep(data)
  const file = path.join(OUT_DIR, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(redacted, null, 2))
}

function clearOutDir(): void {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

// ─── Entry ──────────────────────────────────────────────────────────────────

function main(): void {
  console.log("→ discovering Claude Code transcripts...")
  const { sessions, skipped } = claudeCodeImporter.discover()
  console.log(`  found ${sessions.length} sessions (${skipped.length} skipped)`)
  if (skipped.length > 0) {
    for (const s of skipped.slice(0, 5)) {
      console.log(`    skip: ${s.locator} — ${s.reason}`)
    }
  }

  // Filter: only sessions with at least 2 messages (drop empty / aborted).
  const nonEmpty = sessions.filter((s) => s.messages.length >= 2)
  console.log(`  ${nonEmpty.length} sessions after empty-filter`)

  // Filter: date cutoff. Threads whose last activity falls before
  // `EARLIEST_THREAD_DATE` get excluded entirely.
  const earliest = EARLIEST_THREAD_DATE
    ? Date.parse(EARLIEST_THREAD_DATE)
    : null
  const afterDate = earliest
    ? nonEmpty.filter((s) => {
        const ts = Date.parse(s.lastActivityAt ?? "0")
        return Number.isFinite(ts) && ts >= earliest
      })
    : nonEmpty
  if (earliest) {
    console.log(
      `  ${afterDate.length} sessions after date-cutoff (>= ${EARLIEST_THREAD_DATE})`
    )
  }

  // Filter: drop entire threads whose text matches any rule in
  // `DROP_THREAD_IF_MATCHES`. Uses the parsed message bodies so it
  // catches mentions inside the conversation, not just titles.
  const droppedTitles: string[] = []
  const surviving = afterDate.filter((s) => {
    const haystack =
      (s.title ?? "") +
      "\n" +
      s.messages.map((m) => m.content).join("\n")
    if (shouldDropThread(haystack)) {
      droppedTitles.push(s.title || s.sourceThreadId)
      return false
    }
    return true
  })
  console.log(
    `  ${surviving.length} sessions after thread-drop filter ` +
      `(dropped ${droppedTitles.length})`
  )
  for (const t of droppedTitles.slice(0, 8)) {
    console.log(`    drop: ${t}`)
  }
  if (droppedTitles.length > 8) {
    console.log(`    … and ${droppedTitles.length - 8} more`)
  }

  // Sort by lastActivityAt desc (most recent first).
  surviving.sort((a, b) => {
    const ta = Date.parse(a.lastActivityAt ?? "0")
    const tb = Date.parse(b.lastActivityAt ?? "0")
    return tb - ta
  })

  console.log("→ transforming...")
  clearOutDir()

  const threads: OperatorThread[] = []
  const previews: Record<string, OperatorThreadPreview> = {}
  const messagesByThread = new Map<string, OperatorThreadMessage[]>()

  for (const session of surviving) {
    const { thread, messages } = sessionToThread(session)
    threads.push(thread)
    previews[thread.id] = buildPreview(thread, messages)
    messagesByThread.set(thread.id, messages)

    // Per-thread detail file: thread + messages + (empty) summaries.
    const detail: {
      thread: OperatorThread
      messages: OperatorThreadMessage[]
      summaries: OperatorThreadSummary[]
      forks: OperatorThread[]
      parentMessages: OperatorThreadMessage[]
      sessions: never[]
    } = {
      thread,
      messages,
      summaries: [],
      forks: [],
      parentMessages: [],
      sessions: [],
    }
    writeJson(`threads/${thread.id}.json`, detail)
  }

  console.log("→ segmenting work sessions...")
  const workSessions = segmentWorkSessions(threads, messagesByThread)
  console.log(`  ${workSessions.length} work sessions`)

  console.log("→ fabricating plan...")
  const plan = fabricatePlan(threads)

  console.log("→ writing manifest + lists...")
  writeJson("manifest.json", {
    workspace: {
      id: SHOWCASE_WORKSPACE_ID,
      name: "Operator Studio (showcase)",
      slug: "showcase",
      createdAt: threads.at(-1)?.importedAt ?? new Date().toISOString(),
    },
    operator: SHOWCASE_OPERATOR,
    generatedAt: new Date().toISOString(),
    threadCount: threads.length,
    messageCount: threads.reduce((acc, t) => acc + t.messageCount, 0),
    workSessionCount: workSessions.length,
  })

  // Lightweight thread list (for /, recent rail, etc.).
  writeJson("threads.json", threads)
  writeJson("counts.json", buildCounts(threads))
  writeJson("previews.json", previews)
  writeJson("work-sessions.json", workSessions)
  writeJson("plan.json", plan)
  writeJson("plans.json", [plan])

  // Recent sessions with their threads — for the dashboard.
  const sessionThreadMap: Record<string, string[]> = {}
  for (const ws of workSessions) {
    const sessionStart = Date.parse(ws.startedAt)
    const sessionEnd = Date.parse(ws.endedAt) + SESSION_IDLE_GAP_MS
    sessionThreadMap[ws.id] = threads
      .filter((t) => {
        const ts = Date.parse(t.importedAt)
        return ts >= sessionStart && ts <= sessionEnd
      })
      .map((t) => t.id)
  }
  writeJson("session-threads.json", sessionThreadMap)

  // ── recent-with-threads.json ────────────────────────────────────
  // Mirrors GET /api/operator-studio/sessions/recent-with-threads —
  // grouped by work session, latest first, capped to a sensible
  // browse depth. Consumed by `recent-chats-rail.tsx` in showcase
  // mode via `fetch("/showcase-data/recent-with-threads.json")`.
  const sortedSessions = [...workSessions].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
  )
  const recentGroups = sortedSessions.slice(0, 25).map((session) => {
    const sessionStart = Date.parse(session.startedAt)
    const sessionEnd = Date.parse(session.endedAt) + SESSION_IDLE_GAP_MS
    const threadsInSession = threads.filter((t) => {
      const ts = Date.parse(t.importedAt)
      return ts >= sessionStart && ts <= sessionEnd
    })
    return { session, threads: threadsInSession }
  })
  // Done thread ids — every thread in scope whose markedDoneAt was
  // set by the snapshot's done-phrase detector. Used by the rail to
  // render the green checkmark + strikethrough.
  const doneThreadIds = threads
    .filter((t) => t.markedDoneAt !== null)
    .map((t) => t.id)
  writeJson("recent-with-threads.json", {
    mode: "threads",
    groups: recentGroups,
    count: recentGroups.length,
    doneThreadIds,
  })

  // Recent exchanges (messages mode of the rail). For the showcase
  // we fabricate a lightweight version: one synthetic "exchange"
  // per thread, drawing the first user / first assistant pair from
  // each thread's bookend.
  const recentExchangeGroups = sortedSessions.slice(0, 25).map((session) => {
    const sessionStart = Date.parse(session.startedAt)
    const sessionEnd = Date.parse(session.endedAt) + SESSION_IDLE_GAP_MS
    const sessionThreads = threads.filter((t) => {
      const ts = Date.parse(t.importedAt)
      return ts >= sessionStart && ts <= sessionEnd
    })
    const exchanges = sessionThreads.slice(0, 4).map((t) => {
      const p = previews[t.id]
      return {
        id: `${t.id}-bookend`,
        threadId: t.id,
        threadTitle: t.rawTitle ?? "Untitled",
        threadSourceApp: t.sourceApp,
        user: p?.firstUser
          ? {
              id: `${t.id}-firstUser`,
              content: p.firstUser.content,
              createdAt: p.firstUser.createdAt,
            }
          : null,
        assistant: p?.firstAssistant
          ? {
              id: `${t.id}-firstAssistant`,
              content: p.firstAssistant.content,
              createdAt: p.firstAssistant.createdAt,
            }
          : null,
        lastActivityAt: p?.endedAt ?? t.importedAt,
      }
    })
    return { session, exchanges }
  })
  writeJson("recent-with-exchanges.json", {
    mode: "messages",
    groups: recentExchangeGroups,
    count: recentExchangeGroups.length,
    doneThreadIds,
  })

  // ── top-threads-per-session.json ────────────────────────────────
  // For each work session, the top 3 threads by message count.
  // Mirrors `getTopThreadsPerSession()` shape: Map<sessionId, [...]>
  // serialised as Record (Maps don't survive JSON).
  const topThreadsPerSession: Record<
    string,
    Array<{ threadId: string; title: string | null; messageCount: number }>
  > = {}
  for (const ws of workSessions) {
    const sessionStart = Date.parse(ws.startedAt)
    const sessionEnd = Date.parse(ws.endedAt) + SESSION_IDLE_GAP_MS
    const inSession = threads
      .filter((t) => {
        const ts = Date.parse(t.importedAt)
        return ts >= sessionStart && ts <= sessionEnd
      })
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 3)
      .map((t) => ({
        threadId: t.id,
        title: t.rawTitle,
        messageCount: t.messageCount,
      }))
    topThreadsPerSession[ws.id] = inSession
  }
  writeJson("top-threads-per-session.json", topThreadsPerSession)

  // ── daily-activity.json ─────────────────────────────────────────
  // 30-day daily message activity, mirrors `getDailyMessageActivity`.
  const dailyCounts = new Map<string, number>()
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const [, msgs] of messagesByThread) {
    for (const m of msgs) {
      const ts = Date.parse(m.createdAt)
      if (Number.isNaN(ts) || ts < cutoff) continue
      const day = new Date(ts).toISOString().slice(0, 10)
      dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1)
    }
  }
  const dailyActivity = Array.from(dailyCounts.entries())
    .map(([date, messageCount]) => ({ date, messageCount }))
    .sort((a, b) => a.date.localeCompare(b.date))
  writeJson("daily-activity.json", dailyActivity)

  // ── pulse-default.json + pulse-by-session/<id>.json ─────────────
  // One pre-built PulseGraph per work session so the prev/next
  // navigation in the Work tab can pull a different graph without
  // round-tripping the (non-existent) `/api/operator-studio/pulse`
  // endpoint. `pulse-default.json` is a copy of the most-recent
  // session's graph — what loads on first paint.
  console.log("→ building pulse graphs (one per session)...")
  const sortedByEnd = [...workSessions]
    .filter((s) => s.messageCount > 0)
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
  const defaultSession = sortedByEnd[0] ?? workSessions[0]
  let pulseSessionsWritten = 0
  for (const session of workSessions) {
    if (session.messageCount === 0) continue
    const graph = buildPulseGraph(
      session,
      workSessions,
      threads,
      messagesByThread
    )
    writeJson(`pulse-by-session/${session.id}.json`, graph)
    pulseSessionsWritten++
  }
  if (defaultSession) {
    const graph = buildPulseGraph(
      defaultSession,
      workSessions,
      threads,
      messagesByThread
    )
    writeJson("pulse-default.json", graph)
    console.log(
      `  pulse default → ${defaultSession.id} (${(graph as { nodes: unknown[] }).nodes.length} threads); ${pulseSessionsWritten} per-session graphs written`
    )
  } else {
    console.log("  no sessions with content — skipping pulse graphs")
  }

  console.log(`✓ wrote snapshot to ${OUT_DIR}`)
  console.log(
    `  ${threads.length} threads, ${workSessions.length} work sessions, ` +
      `${threads.reduce((acc, t) => acc + t.messageCount, 0)} messages total`
  )
}

main()
