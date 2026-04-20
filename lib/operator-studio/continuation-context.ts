import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadSummary,
} from "./types"

const APPROX_CHARS_PER_TOKEN = 4
const DEFAULT_CONTEXT_BUDGET_TOKENS = 200_000
const MIN_ENTRY_HEADROOM_CHARS = 220
const RECENT_MESSAGE_PREFIX = "[Earlier content omitted to prioritize recency]\n\n"

export interface ContinuationContextMessage {
  role: "user" | "assistant"
  content: string
  createdAt?: string | null
  branchId?: string | null
}

export interface ContinuationContextSnapshotSection {
  id: string
  label: string
  includedItems: number
  omittedItems: number
  truncatedItems: number
  approxTokens: number
}

export interface ContinuationContextSnapshot {
  budgetTokens: number
  budgetChars: number
  usedTokens: number
  usedChars: number
  activeThreadId: string | null
  activeThreadTitle: string | null
  sourceThreadId: string | null
  sourceThreadTitle: string | null
  usedParentThread: boolean
  activeBranchId: string | null
  pathHistory: {
    totalMessages: number
    includedMessages: number
    omittedMessages: number
    approxTokens: number
  }
  grounding: {
    sectionCount: number
    approxTokens: number
  }
  sections: ContinuationContextSnapshotSection[]
}

interface SelectedHistory {
  messages: ContinuationContextMessage[]
  usedChars: number
  omittedCount: number
}

interface BuildGroundingContextOptions {
  activeThread: OperatorThread
  sourceThread: OperatorThread
  sourceMessages: OperatorThreadMessage[]
  sourceSummaries: OperatorThreadSummary[]
  budgetTokens: number
  historySelection: SelectedHistory
  activeBranchId?: string | null
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}

export function getContinuationContextBudgetTokens(): number {
  const parsed = Number(process.env.OPERATOR_STUDIO_CONTINUATION_CONTEXT_TOKENS)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return DEFAULT_CONTEXT_BUDGET_TOKENS
}

export function sanitizeContextMessages(
  value: unknown
): ContinuationContextMessage[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []

    const role =
      item.role === "user" || item.role === "assistant" ? item.role : null
    const content =
      typeof item.content === "string" ? normalizeText(item.content) : ""

    if (!role || !content) return []

    return [
      {
        role,
        content,
        createdAt:
          typeof item.createdAt === "string" ? item.createdAt : undefined,
        branchId: typeof item.branchId === "string" ? item.branchId : undefined,
      },
    ]
  })
}

export function selectRecentHistoryMessages(
  messages: ContinuationContextMessage[],
  budgetTokens: number
): SelectedHistory {
  const budgetChars = Math.max(0, budgetTokens) * APPROX_CHARS_PER_TOKEN
  if (budgetChars === 0 || messages.length === 0) {
    return {
      messages: [],
      usedChars: 0,
      omittedCount: messages.length,
    }
  }

  let usedChars = 0
  let omittedCount = 0
  const selected: ContinuationContextMessage[] = []

  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const msg = messages[idx]
    const content = normalizeText(msg.content)
    if (!content) continue

    const messageCost = content.length + 48
    if (usedChars + messageCost <= budgetChars) {
      selected.unshift({ ...msg, content })
      usedChars += messageCost
      continue
    }

    const remainingChars = budgetChars - usedChars
    if (remainingChars >= MIN_ENTRY_HEADROOM_CHARS) {
      const maxContentChars = Math.max(
        remainingChars - RECENT_MESSAGE_PREFIX.length - 48,
        0
      )
      if (maxContentChars > 0) {
        selected.unshift({
          ...msg,
          content: `${RECENT_MESSAGE_PREFIX}${takeTail(content, maxContentChars)}`,
        })
        usedChars = budgetChars
      }
    }

    omittedCount = idx + 1
    return { messages: selected, usedChars, omittedCount }
  }

  return { messages: selected, usedChars, omittedCount }
}

export function buildGroundingContext({
  activeThread,
  sourceThread,
  sourceMessages,
  sourceSummaries,
  budgetTokens,
  historySelection,
  activeBranchId = null,
}: BuildGroundingContextOptions): {
  contextParts: string[]
  snapshot: ContinuationContextSnapshot
} {
  const budgetChars = Math.max(0, budgetTokens) * APPROX_CHARS_PER_TOKEN
  let remainingChars = budgetChars
  let usedChars = 0
  const contextParts: string[] = []
  const sections: ContinuationContextSnapshotSection[] = []

  const addSection = (
    id: string,
    label: string,
    content: string,
    includedItems: number,
    totalItems: number,
    truncatedItems = 0
  ) => {
    const normalizedContent = normalizeText(content)
    if (!normalizedContent) return

    const sectionText = `## ${label}\n${normalizedContent}`
    const sectionChars = sectionText.length
    if (sectionChars > remainingChars) return

    contextParts.push(sectionText)
    sections.push({
      id,
      label,
      includedItems,
      omittedItems: Math.max(totalItems - includedItems, 0),
      truncatedItems,
      approxTokens: estimateTokens(sectionText),
    })
    usedChars += sectionChars
    remainingChars -= sectionChars
  }

  addSection(
    "thread-context",
    "Thread Context",
    buildThreadContextBlock(activeThread, sourceThread),
    1,
    1
  )

  if (remainingChars > MIN_ENTRY_HEADROOM_CHARS) {
    const recentTurns = renderRecentSourceTurns(sourceMessages, remainingChars)
    if (recentTurns.content) {
      addSection(
        "recent-source-turns",
        "Recent Source Thread Turns",
        recentTurns.content,
        recentTurns.includedItems,
        sourceMessages.length,
        recentTurns.truncatedItems
      )
    }
  }

  const summaryBodies = buildSummarySections(activeThread, sourceThread, sourceSummaries)
  for (const summarySection of summaryBodies) {
    addSection(
      summarySection.id,
      summarySection.label,
      summarySection.content,
      summarySection.includedItems,
      summarySection.totalItems
    )
  }

  const snapshot: ContinuationContextSnapshot = {
    budgetTokens:
      historySelection.usedChars > 0
        ? Math.ceil((historySelection.usedChars + usedChars) / APPROX_CHARS_PER_TOKEN)
        : Math.ceil(usedChars / APPROX_CHARS_PER_TOKEN),
    budgetChars: historySelection.usedChars + usedChars,
    usedTokens: Math.ceil((historySelection.usedChars + usedChars) / APPROX_CHARS_PER_TOKEN),
    usedChars: historySelection.usedChars + usedChars,
    activeThreadId: activeThread.id,
    activeThreadTitle: activeThread.promotedTitle ?? activeThread.rawTitle,
    sourceThreadId: sourceThread.id,
    sourceThreadTitle: sourceThread.promotedTitle ?? sourceThread.rawTitle,
    usedParentThread: activeThread.id !== sourceThread.id,
    activeBranchId,
    pathHistory: {
      totalMessages:
        historySelection.messages.length +
        historySelection.omittedCount,
      includedMessages: historySelection.messages.length,
      omittedMessages: historySelection.omittedCount,
      approxTokens: estimateTokens(
        historySelection.messages.map((msg) => msg.content).join("\n\n")
      ),
    },
    grounding: {
      sectionCount: sections.length,
      approxTokens: estimateTokens(contextParts.join("\n\n---\n\n")),
    },
    sections,
  }

  return { contextParts, snapshot }
}

function buildThreadContextBlock(
  activeThread: OperatorThread,
  sourceThread: OperatorThread
): string {
  const lines = [
    `Current thread: ${activeThread.promotedTitle ?? activeThread.rawTitle ?? "Untitled thread"}`,
  ]

  if (activeThread.id !== sourceThread.id) {
    lines.push("This thread is a fork. The recent continuation path outweighs the original thread title.")
    lines.push(
      `Source thread: ${sourceThread.promotedTitle ?? sourceThread.rawTitle ?? "Untitled thread"}`
    )
  }

  return lines.join("\n")
}

function renderRecentSourceTurns(
  messages: OperatorThreadMessage[],
  remainingChars: number
): {
  content: string
  includedItems: number
  truncatedItems: number
} {
  if (messages.length === 0 || remainingChars <= MIN_ENTRY_HEADROOM_CHARS) {
    return { content: "", includedItems: 0, truncatedItems: 0 }
  }

  let usedChars = 0
  let truncatedItems = 0
  const rendered: string[] = []

  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const message = messages[idx]
    const content = normalizeText(message.content)
    if (!content) continue

    const entryPrefix = `[${message.role} · turn ${message.turnIndex}]\n`
    const entry = `${entryPrefix}${content}`
    const entryCost = entry.length + 2

    if (usedChars + entryCost <= remainingChars) {
      rendered.unshift(entry)
      usedChars += entryCost
      continue
    }

    const available = remainingChars - usedChars - entryPrefix.length - 2
    if (available >= MIN_ENTRY_HEADROOM_CHARS) {
      rendered.unshift(
        `${entryPrefix}${RECENT_MESSAGE_PREFIX}${takeTail(content, available)}`
      )
      truncatedItems += 1
    }
    break
  }

  return {
    content: rendered.join("\n\n"),
    includedItems: rendered.length,
    truncatedItems,
  }
}

function buildSummarySections(
  activeThread: OperatorThread,
  sourceThread: OperatorThread,
  summaries: OperatorThreadSummary[]
): Array<{
  id: string
  label: string
  content: string
  includedItems: number
  totalItems: number
}> {
  const sections: Array<{
    id: string
    label: string
    content: string
    includedItems: number
    totalItems: number
  }> = []

  const promotedSummary =
    activeThread.promotedSummary ?? sourceThread.promotedSummary ?? null
  const whyItMatters =
    activeThread.whyItMatters ?? sourceThread.whyItMatters ?? null

  if (promotedSummary) {
    sections.push({
      id: "promoted-summary",
      label: "Promoted Summary",
      content: promotedSummary,
      includedItems: 1,
      totalItems: 1,
    })
  }

  if (whyItMatters) {
    sections.push({
      id: "why-it-matters",
      label: "Why It Matters",
      content: whyItMatters,
      includedItems: 1,
      totalItems: 1,
    })
  }

  if (summaries.length > 0) {
    sections.push({
      id: "thread-summaries",
      label: "Thread Summaries",
      content: summaries
        .map((summary) => `[${summary.summaryKind}] ${normalizeText(summary.content)}`)
        .filter(Boolean)
        .join("\n\n"),
      includedItems: summaries.length,
      totalItems: summaries.length,
    })
  }

  return sections
}

function normalizeText(value: string): string {
  return value.replace(/\u0000/g, "").trim()
}

function takeTail(value: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (value.length <= maxChars) return value
  return `…${value.slice(-(maxChars - 1))}`
}
