// ─── Operator Studio Domain Types ────────────────────────────────────────────

export const OPERATOR_SOURCE_APPS = [
  "codex",
  "cursor",
  "claude",
  "claude-code",
  "opencode",
  "chatgpt",
  "openai",
  "gemini",
  "anthropic",
  "antigravity",
  "void",
  "aider",
  "zed",
  "copilot",
  "webhook",
  "manual",
] as const

export type OperatorSourceApp = (typeof OPERATOR_SOURCE_APPS)[number]

/**
 * Source ids that have a server-side filesystem / database importer
 * (registered in `lib/operator-studio/importers/index.ts`). Client code
 * uses this for auto-ingest polling and Discover-mode source pickers.
 *
 * Hand-maintained here because the importer modules pull `node:fs` and
 * `better-sqlite3` — they can't reach the client bundle. The
 * registry-integrity check (`scripts/integrity-check.ts`) verifies
 * this list matches `listImporters()` server-side and flags drift,
 * so adding a new importer without updating this list fails loudly.
 *
 * Convention: list a single canonical id per importer. Claude Code is
 * aliased to "claude" in the registry but historically our DB rows
 * tag it as "claude" too — keeping that as the canonical-for-client
 * value preserves analytics continuity.
 */
export const IMPORTER_SOURCE_IDS = [
  "claude",
  "codex",
  "opencode",
] as const satisfies readonly OperatorSourceApp[]

export type ImporterSourceId = (typeof IMPORTER_SOURCE_IDS)[number]

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
  // Short AI-generated rationale produced at ingest time — "what's the
  // value in capturing this thread?" Distinct from whyItMatters (which
  // operators fill in when promoting).
  captureReason: string | null
  // Fork link within the same workspace.
  parentThreadId: string | null
  // Cross-workspace provenance (set by promote/pull).
  promotedFromId: string | null
  pulledFromId: string | null
  visibleInStudio: boolean
  messageCount: number
  archivedAt: string | null
  /** Persisted "thread is done" timestamp. Null = not done. Written
   *  either by phrase-detection (source='phrase') or by a manual
   *  click in Operator Studio (source='manual'). */
  markedDoneAt: string | null
  markedDoneBy: string | null
  markedDoneSource: "phrase" | "manual" | null
  createdAt: string
  updatedAt: string
}

export type ThreadDoneSource = "phrase" | "manual"

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

// ─── Continuation Session ────────────────────────────────────────────────────
//
// Interactive chat that happens inside Operator Studio. This is separate from
// an imported thread transcript and separate from a time-bucketed work session.

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

// ─── Work Sessions ───────────────────────────────────────────────────────────
//
// A segment of LLM activity bracketed by a 3h+ idle gap. See
// `lib/operator-studio/sessions.ts` for the pure segmentation logic and
// `drizzle/0005_session_spaces.sql` for the storage shape.

export type OperatorPlanStepStatus =
  | "open"
  | "in-motion"
  | "covered"
  | "skipped"

export interface OperatorPlanStep {
  /** Stable id — generated client-side when the step is added. */
  id: string
  title: string
  description?: string
  /** Integer sort key — lower first. */
  order: number
  /** Authoritative status from the database. View code may layer
   *  evidence-derived coverage status on top, but this is the baseline. */
  status: OperatorPlanStepStatus
  /** Tree relationship — null means top-level / independent. */
  parentStepId: string | null
  /** Atelier canvas coordinates. Null falls back to grid layout. */
  positionX: number | null
  positionY: number | null
  /** Optional per-card cover image URL — served by the studio uploads
   *  route. */
  coverImageUrl: string | null
}

export interface OperatorSession {
  id: string
  workspaceId: string
  /** User-editable display name. Null means "use default label derived
   *  from startedAt" — the UI is responsible for computing that. */
  label: string | null
  startedAt: string // ISO
  endedAt: string // ISO
  /** Legacy read-side shadow from operator_sessions.plan_steps.
   *  New code should resolve durable plan steps via planId and
   *  operator_plan_steps. */
  planSteps: OperatorPlanStep[]
  /** FK to operator_plans. Null only for pre-backfill sessions. */
  planId: string | null
  /** Cached derived counts for list views. Not authoritative — the
   *  time range is. Recomputed when the range grows. */
  threadCount: number
  messageCount: number
  createdAt: string
  updatedAt: string
}

// ─── Plan (durable intent) ───────────────────────────────────────────────────
//
// Promoted from operator_sessions.plan_steps (jsonb) into its own table in
// 0007_session_plans.sql. The plan is the durable unit of intent — a single
// plan can span many sessions. See docs in that migration for the why.

export type OperatorPlanState =
  | "drafting"
  | "active"
  | "paused"
  | "shipped"
  | "archived"

export interface OperatorSessionPlan {
  id: string
  workspaceId: string
  title: string
  /** "What are you trying to get done?" — measurable sentence. */
  goal: string | null
  /** "What does done look like?" — outcome description. */
  outcome: string | null
  state: OperatorPlanState
  /** True if this plan survives the current session (shows in the
   *  sidebar plan switcher). */
  pinned: boolean
  ownerName: string | null
  createdBy: string
  shippedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** Ordered plan steps. Loaded together with the plan — always small
   *  enough to ship in one query. */
  steps: OperatorPlanStep[]
}

export type OperatorFulfillmentTargetType = "thread" | "message"

/**
 * Accepted evidence for a plan step.
 *
 * The storage/API name is still "fulfillment" for compatibility with the
 * existing table and routes. Product copy should prefer "evidence".
 * `sessionId` records the work session where the evidence was accepted; it is
 * provenance, not the owner of the plan step.
 */
export interface OperatorStepFulfillment {
  id: string
  workspaceId: string
  sessionId: string
  stepId: string
  targetType: OperatorFulfillmentTargetType
  targetId: string
  note: string | null
  promotedBy: string
  promotedAt: string // ISO
}

/**
 * A passage — an operator-promoted span of text within a single
 * thread message. Standalone artifact; can later be linked to a plan
 * step as a third evidence kind alongside thread + message.
 *
 * `startOffset`/`endOffset` are character offsets into the message
 * content at promotion time. `textSnapshot` is the durable record;
 * if the underlying message later edits, the snapshot still wins.
 * `textHash` lets the UI detect drift cheaply (offsets no longer line
 * up with the live message text).
 */
export interface OperatorThreadPassage {
  id: string
  workspaceId: string
  threadId: string
  messageId: string
  startOffset: number
  endOffset: number
  textSnapshot: string
  textHash: string
  note: string | null
  /** Optional FK to operator_promotion_labels.id. Null = highlighted
   *  without a label (still a sacrosanct human elevation; the label
   *  adds AI-readable context via the label's ai_context blurb). */
  labelId: string | null
  promotedBy: string
  promotedAt: string // ISO
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
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  chatgpt: "ChatGPT",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
  antigravity: "Antigravity",
  void: "Void",
  aider: "aider",
  zed: "Zed",
  copilot: "Copilot",
  webhook: "Webhook",
  manual: "Manual",
}

export const SOURCE_APP_COLORS: Record<OperatorSourceApp, string> = {
  codex: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  cursor: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  claude: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "claude-code": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  opencode: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  chatgpt: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  openai: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  gemini: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  anthropic: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  antigravity: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  void: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  aider: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  zed: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  copilot: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
  webhook: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
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
  fire: "Standout",
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

// One-line descriptions surfaced in the first-class promote dialog so
// operators don't have to memorize what each kind means. Kept terse —
// the dialog is meant to be quick.
export const PROMOTION_KIND_DESCRIPTIONS: Record<PromotionKind, string> = {
  insight: "An aha moment worth remembering",
  decision: "A choice that shapes what comes next",
  quotable: "Phrasing too good to lose",
  technical: "Implementation detail worth filing",
  fire: "Must-keep — not sure of the kind yet",
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
    name: "Clarifier",
    description: "Grounded continuation — picks up where the original thread left off",
    systemPromptSuffix: "Focus on resolving ambiguity, addressing open questions, and proposing concrete next steps.",
    color: "bg-primary/20 text-primary",
    initials: "CL",
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
