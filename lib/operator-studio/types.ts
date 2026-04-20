// ─── Operator Studio Domain Types ────────────────────────────────────────────

export type OperatorSourceApp =
  | "codex"
  | "cursor"
  | "claude"
  | "antigravity"
  | "void"
  | "manual"

export type OperatorPrivacyState = "private" | "team"

export type OperatorReviewState =
  | "imported"
  | "in-review"
  | "promoted"
  | "archived"

// ─── Thread ──────────────────────────────────────────────────────────────────

export interface OperatorThread {
  id: string
  workspaceId: string
  sourceApp: OperatorSourceApp
  sourceThreadKey: string | null
  sourceLocator: string | null
  importedBy: string
  importedAt: string // ISO
  importRunId: string | null
  rawTitle: string | null
  rawSummary: string | null
  promotedTitle: string | null
  promotedSummary: string | null
  privacyState: OperatorPrivacyState
  reviewState: OperatorReviewState
  tags: string[]
  projectSlug: string | null
  ownerName: string | null
  whyItMatters: string | null
  // Fork link within the same workspace.
  parentThreadId: string | null
  // Cross-workspace provenance (set by promote/pull).
  promotedFromId: string | null
  pulledFromId: string | null
  visibleInStudio: boolean
  messageCount: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Thread Message ──────────────────────────────────────────────────────────

export type OperatorMessageRole = "user" | "assistant" | "system" | "function"

export type PromotionKind = "insight" | "decision" | "quotable" | "technical" | "fire"

export interface OperatorThreadMessage {
  id: string
  threadId: string
  role: OperatorMessageRole
  content: string
  turnIndex: number
  metadataJson: Record<string, unknown> | null
  promotedAt: string | null
  promotedBy: string | null
  promotionNote: string | null
  promotionKind: PromotionKind | null
  createdAt: string
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export type OperatorSummaryKind = "auto" | "manual" | "promoted"

export interface OperatorThreadSummary {
  id: string
  threadId: string
  summaryKind: OperatorSummaryKind
  content: string
  createdBy: string
  createdAt: string
}

// ─── Chat Session (Continuation) ─────────────────────────────────────────────

export interface OperatorChatSession {
  id: string
  threadId: string | null
  sessionTitle: string | null
  operatorName: string
  createdAt: string
  updatedAt: string
}

export interface OperatorChatMessage {
  id: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  modelLabel: string | null
  promotedAt: string | null
  promotedBy: string | null
  promotionNote: string | null
  promotionKind: PromotionKind | null
  createdAt: string
}

// ─── Import Run ──────────────────────────────────────────────────────────────

export type OperatorImportStatus = "running" | "completed" | "failed"

export interface OperatorImportRun {
  id: string
  sourceApp: OperatorSourceApp
  sourcePath: string | null
  importedBy: string
  threadCount: number
  status: OperatorImportStatus
  error: string | null
  createdAt: string
  completedAt: string | null
}

// ─── Dashboard Helpers ───────────────────────────────────────────────────────

export interface OperatorDashboardStats {
  totalThreads: number
  promoted: number
  inReview: number
  imported: number
  recentImportRuns: number
}

// ─── Source App Metadata ─────────────────────────────────────────────────────

export const SOURCE_APP_LABELS: Record<OperatorSourceApp, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude: "Claude",
  antigravity: "Antigravity",
  void: "Void",
  manual: "Manual",
}

export const SOURCE_APP_COLORS: Record<OperatorSourceApp, string> = {
  codex: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  cursor: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  claude: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  antigravity: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  void: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  manual: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
}

export const REVIEW_STATE_LABELS: Record<OperatorReviewState, string> = {
  imported: "Imported",
  "in-review": "In Review",
  promoted: "Promoted",
  archived: "Archived",
}

export const REVIEW_STATE_COLORS: Record<OperatorReviewState, string> = {
  imported: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  "in-review": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  promoted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  archived: "bg-zinc-500/10 text-zinc-500",
}

// ─── Message Promotion ──────────────────────────────────────────────────────

export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = {
  insight: "Insight",
  decision: "Decision",
  quotable: "Quotable",
  technical: "Technical",
  fire: "Fire",
}

export const PROMOTION_KIND_COLORS: Record<PromotionKind, string> = {
  insight: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  decision: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  quotable: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  technical: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  fire: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
}

export const PROMOTION_KIND_EMOJI: Record<PromotionKind, string> = {
  insight: "💡",
  decision: "⚖️",
  quotable: "✍️",
  technical: "⚙️",
  fire: "🔥",
}

// ─── Personas (Continuation Engines) ────────────────────────────────────────

export interface ContinuationPersona {
  id: string
  name: string
  description: string
  systemPromptSuffix: string
  color: string
  initials: string
}

export const CONTINUATION_PERSONAS: ContinuationPersona[] = [
  {
    id: "clarifier",
    name: "Clarifying Intelligence",
    description: "Grounded continuation — picks up where the original thread left off",
    systemPromptSuffix: "Focus on clarifying ambiguity, resolving open questions, and proposing concrete next steps.",
    color: "bg-primary/20 text-primary",
    initials: "CI",
  },
  {
    id: "strategist",
    name: "Strategic Advisor",
    description: "Zooms out — connects thread insights to broader product and business strategy",
    systemPromptSuffix: "Think like a strategic advisor. Connect thread insights to broader product strategy, market positioning, and organizational priorities. Be opinionated but grounded.",
    color: "bg-violet-500/20 text-violet-600 dark:text-violet-400",
    initials: "SA",
  },
  {
    id: "critic",
    name: "Devil's Advocate",
    description: "Challenges assumptions — stress-tests ideas from the thread",
    systemPromptSuffix: "Play devil's advocate. Challenge assumptions, identify blind spots, and stress-test the ideas presented. Be constructively critical.",
    color: "bg-rose-500/20 text-rose-600 dark:text-rose-400",
    initials: "DA",
  },
  {
    id: "synthesizer",
    name: "Synthesis Engine",
    description: "Distills and connects — finds patterns across thread content",
    systemPromptSuffix: "Focus on synthesis. Distill key themes, find non-obvious connections between ideas, and produce structured takeaways the team can act on.",
    color: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
    initials: "SE",
  },
  {
    id: "scribe",
    name: "Documentation Scribe",
    description: "Captures and formalizes — turns thread content into clean documentation",
    systemPromptSuffix: "Act as a technical writer. Turn the messy, exploratory thread content into clean, well-structured documentation. Produce specs, ADRs, or runbooks as appropriate.",
    color: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
    initials: "DS",
  },
]
