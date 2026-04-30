/**
 * Gold extractor — deterministic heuristic scoring of messages to find
 * the ones most likely to be worth promoting.
 *
 * The thesis: most turns in an agent conversation are connective tissue
 * — "ok", "let me read", tool calls, debug output. A small fraction
 * contain the actual valuable IP: a framing, a decision, a hard-won
 * insight, a crisp explanation. Surface those so the reviewer reacts
 * instead of reads.
 *
 * Pure function, no LLM — runs in milliseconds on thousands of
 * messages. If someone wants to add an LLM reranker on top later, this
 * is a fine prefilter.
 *
 * Each candidate includes the SIGNALS the scorer fired on, rendered
 * as a short human label. That's important: the UI tells the user
 * "why this one?" which teaches them what "gold" looks like in their
 * own data, and lets them disagree with the tool when appropriate.
 */

export type GoldSignalKind =
  | "tldr"
  | "insight-callout"
  | "emphatic-claim"
  | "structured-analysis"
  | "substantive-analysis"
  | "code-and-explain"
  | "numbered-synthesis"
  | "opening-framing"
  | "substantive-question"
  | "conclusion"
  | "next-action"
  | "quoted-reference"

export interface GoldSignal {
  kind: GoldSignalKind
  /** Score contribution. */
  boost: number
  /** One-line human-readable reason for the UI. */
  label: string
  /** Character offset in the message content where this signal hit.
   *  Lets the UI excerpt around the signal instead of the first N
   *  chars — important when one long thread has multiple gold
   *  candidates that would otherwise all show the same opening. */
  offset?: number
}

export interface GoldCandidateInput {
  id: string
  threadId: string
  threadTitle: string | null
  role: "user" | "assistant"
  content: string
  turnIndex: number
  createdAt: string
  /** Total turns in the thread — needed to know if this is the last. */
  threadTurnCount: number
}

export interface GoldCandidate {
  messageId: string
  threadId: string
  threadTitle: string | null
  role: "user" | "assistant"
  content: string
  excerpt: string
  turnIndex: number
  createdAt: string
  score: number
  signals: GoldSignal[]
  /** Single best reason for the headline badge. */
  topReason: GoldSignal
}

export interface ExtractOptions {
  /** Cap the total candidates returned. Default 8. */
  topN?: number
  /** Minimum score threshold. Default 3. */
  minScore?: number
  /** Max candidates from a single thread — prevents one chatty thread
   *  from monopolizing the gold card. Default 3. */
  maxPerThread?: number
  /** Excerpt length in characters. Default 220. */
  excerptLength?: number
}

// ─── Keyword banks ────────────────────────────────────────────────────────

// Phrases that strongly signal a promotable claim. Tuned from observing
// what actually gets promoted in real review workflows. Keep concise —
// too many false positives dilute the signal.
const INSIGHT_KEYWORDS = [
  "the insight is",
  "key insight",
  "key decision",
  "bottom line",
  "the thesis is",
  "the point is",
  "critical",
  "the crux",
  "the million dollar",
  "the actual",
  "the real",
  "the truth is",
  "real insight",
  "non-obvious",
]

// Words that mean "I'm summarizing this for you" — high-signal because
// the author did the filtering for us.
const TLDR_MARKERS = [
  "tldr:",
  "tl;dr",
  "tldr;",
  "in short:",
  "summary:",
  "to summarize",
  "bottom line:",
]

// Markers for a next-step / action callout.
const NEXT_ACTION_MARKERS = ["next:", "next step:", "action:"]

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build an excerpt of a message centered on the signal's character
 * offset. Critical for diversifying cards from the same long thread:
 * a 30-turn assistant response with a TLDR at line 200 should excerpt
 * the TLDR area, not the boilerplate header at line 0.
 *
 * If `offset` is undefined or 0 we revert to "first maxLen chars" with
 * sentence-boundary smart cut.
 */
function buildExcerpt(
  content: string,
  maxLen: number,
  offset?: number
): string {
  const trimmed = content.trim()
  if (trimmed.length <= maxLen) return trimmed

  // Pick a window start: pull the cursor back from `offset` to give
  // the reader a tiny lead-in (~40 chars), but never before 0.
  const lead = 40
  let start = 0
  if (typeof offset === "number" && offset > lead) {
    start = Math.min(trimmed.length - maxLen, offset - lead)
    // Snap to the nearest preceding whitespace so we don't break a
    // word.
    const ws = trimmed.lastIndexOf(" ", start)
    if (ws > start - 60 && ws >= 0) start = ws + 1
  }

  const window = trimmed.slice(start, start + maxLen)
  // Sentence-boundary smart cut on the right edge.
  const lastSentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! ")
  )
  const rightCut =
    lastSentence > maxLen * 0.6
      ? lastSentence + 1
      : Math.max(window.lastIndexOf(" "), maxLen)

  const lhs = start > 0 ? "…" : ""
  return `${lhs}${trimmed.slice(start, start + rightCut).trim()}…`
}

function countMatches(hay: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while (idx !== -1) {
    idx = hay.indexOf(needle, idx)
    if (idx === -1) break
    count++
    idx += needle.length
  }
  return count
}

// ─── Per-signal detectors ────────────────────────────────────────────────

function detectSignals(msg: GoldCandidateInput): GoldSignal[] {
  const signals: GoldSignal[] = []
  const content = msg.content
  const lower = content.toLowerCase()
  const len = content.length

  // TLDR / Summary blocks — highest-signal because the author literally
  // did the compression for us. Track the offset so the excerpt
  // centers on the TLDR, not the boilerplate above it.
  let tldrOffset = -1
  for (const m of TLDR_MARKERS) {
    const idx = lower.indexOf(m)
    if (idx !== -1 && (tldrOffset === -1 || idx < tldrOffset)) {
      tldrOffset = idx
    }
  }
  if (tldrOffset !== -1) {
    signals.push({
      kind: "tldr",
      boost: 4,
      label: "Has TLDR / summary",
      offset: tldrOffset,
    })
  }

  // Insight / decision callouts. Any hit is a strong signal — the
  // author used claim-phrasing. Base 2, extra +1 per additional hit.
  let firstInsightHit = ""
  let firstInsightOffset = -1
  for (const k of INSIGHT_KEYWORDS) {
    const idx = lower.indexOf(k.toLowerCase())
    if (
      idx !== -1 &&
      (firstInsightOffset === -1 || idx < firstInsightOffset)
    ) {
      firstInsightHit = k
      firstInsightOffset = idx
    }
  }
  if (firstInsightOffset !== -1) {
    const insightHits = INSIGHT_KEYWORDS.filter((k) =>
      lower.includes(k.toLowerCase())
    )
    signals.push({
      kind: "insight-callout",
      boost: Math.min(3, 1 + insightHits.length),
      label: `Insight phrasing: "${firstInsightHit}"`,
      offset: firstInsightOffset,
    })
  }

  // Bold emphasis. 2+ emphasis markers = worth a look (base 2), 4+
  // = strong (3). Single emphasis is noise.
  const boldCount = Math.floor(countMatches(content, "**") / 2)
  if (boldCount >= 2) {
    signals.push({
      kind: "emphatic-claim",
      boost: boldCount >= 4 ? 3 : 2,
      label: `${boldCount} emphasized phrases`,
      offset: content.indexOf("**"),
    })
  }

  // Markdown headers — author structured their answer.
  const headerMatches = [...content.matchAll(/(?:^|\n)#{2,4}\s/g)]
  if (headerMatches.length >= 2) {
    signals.push({
      kind: "structured-analysis",
      boost: Math.min(3, headerMatches.length),
      label: `${headerMatches.length} section headers`,
      offset: headerMatches[0].index ?? 0,
    })
  }

  // Substantive length — longer responses often contain the real
  // thinking. Diminishing returns past ~3k chars.
  if (len > 3000) {
    signals.push({
      kind: "substantive-analysis",
      boost: 3,
      label: "Long substantive response",
    })
  } else if (len > 1500) {
    signals.push({
      kind: "substantive-analysis",
      boost: 2,
      label: "Substantive response",
    })
  } else if (len > 700 && msg.role === "assistant") {
    signals.push({
      kind: "substantive-analysis",
      boost: 1,
      label: "Moderate-length response",
    })
  }

  // Code + prose = "here's the solution" pattern. Even one block plus
  // modest surrounding text is meaningful.
  const codeFenceCount = Math.floor(countMatches(content, "```") / 2)
  if (codeFenceCount >= 1 && len > 300) {
    signals.push({
      kind: "code-and-explain",
      boost: codeFenceCount >= 2 ? 3 : 2,
      label: `Code + explanation (${codeFenceCount} block${codeFenceCount === 1 ? "" : "s"})`,
    })
  }

  // Numbered synthesis — author enumerated the points. High structure
  // signal especially combined with length.
  const numberedLines = (content.match(/^\d+\.\s/gm) ?? []).length
  if (numberedLines >= 3) {
    signals.push({
      kind: "numbered-synthesis",
      boost: 2,
      label: `${numberedLines}-point list`,
    })
  }

  // Quoted references — author is calling out another passage.
  const quoteLines = (content.match(/^>\s/gm) ?? []).length
  if (quoteLines >= 3) {
    signals.push({
      kind: "quoted-reference",
      boost: 1,
      label: "Quoted passage",
    })
  }

  // Next-action callouts.
  if (NEXT_ACTION_MARKERS.some((m) => lower.includes(m))) {
    signals.push({
      kind: "next-action",
      boost: 1,
      label: "Calls out a next action",
    })
  }

  // Position signals.
  const isFirstUserMessage = msg.role === "user" && msg.turnIndex <= 1
  const isLastAssistantMessage =
    msg.role === "assistant" && msg.turnIndex >= msg.threadTurnCount - 1

  if (isFirstUserMessage && len > 80) {
    // Opening user message sets the whole session's intent — strong
    // signal by virtue of position alone.
    signals.push({
      kind: "opening-framing",
      boost: 3,
      label: "Opening framing",
    })
  }

  if (isLastAssistantMessage && len > 400) {
    signals.push({
      kind: "conclusion",
      boost: 2,
      label: "Final wrap-up",
    })
  }

  // Substantive user questions — multi-sentence, not a short "ok"
  // reply. These often contain the real strategic ask.
  if (msg.role === "user") {
    const sentences = content
      .split(/[.!?]\s/)
      .filter((s) => s.trim().length > 10)
    if (sentences.length >= 3 && len > 300) {
      signals.push({
        kind: "substantive-question",
        boost: 2,
        label: "Substantive user framing",
      })
    }
  }

  return signals
}

// ─── Main ────────────────────────────────────────────────────────────────

export function extractGoldCandidates(
  messages: GoldCandidateInput[],
  opts: ExtractOptions = {}
): GoldCandidate[] {
  const topN = opts.topN ?? 8
  // minScore=2: any single strong signal (emphatic, insight-callout,
  // emphatic-claim, substantive-analysis tier 2+, code-and-explain)
  // fires. Lower threshold means more bait for the user's eye —
  // underselling gold is a worse failure than showing an occasional
  // weaker candidate.
  const minScore = opts.minScore ?? 2
  const maxPerThread = opts.maxPerThread ?? 3
  const excerptLength = opts.excerptLength ?? 220

  const scored: GoldCandidate[] = []
  for (const msg of messages) {
    const signals = detectSignals(msg)
    if (signals.length === 0) continue
    const score = signals.reduce((s, sig) => s + sig.boost, 0)
    if (score < minScore) continue

    // Top reason = highest-boost signal (ties broken by declaration order).
    const topReason = [...signals].sort((a, b) => b.boost - a.boost)[0]

    // Center the excerpt on the top reason's offset so different
    // gold cards from the same long message show different content.
    // Without this, two TLDRs in the same long thread would render
    // an identical excerpt of the message header.
    scored.push({
      messageId: msg.id,
      threadId: msg.threadId,
      threadTitle: msg.threadTitle,
      role: msg.role,
      content: msg.content,
      excerpt: buildExcerpt(msg.content, excerptLength, topReason.offset),
      turnIndex: msg.turnIndex,
      createdAt: msg.createdAt,
      score,
      signals,
      topReason,
    })
  }

  // Sort: highest score wins; ties broken by recency (newer first).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.createdAt.localeCompare(a.createdAt)
  })

  // Enforce maxPerThread + dedupe by excerpt prefix. The excerpt-prefix
  // dedup is the key fix for "same content showing 4 times" — even
  // after maxPerThread caps, two messages might happen to render the
  // same excerpt window (e.g. both started from a similar TLDR header).
  // We hash the first 80 chars of normalized excerpt and skip dupes.
  const perThread = new Map<string, number>()
  const seenPrefixes = new Set<string>()
  const capped: GoldCandidate[] = []
  for (const c of scored) {
    const seen = perThread.get(c.threadId) ?? 0
    if (seen >= maxPerThread) continue

    const prefix = c.excerpt
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
      .toLowerCase()
    if (seenPrefixes.has(prefix)) continue
    seenPrefixes.add(prefix)

    perThread.set(c.threadId, seen + 1)
    capped.push(c)
    if (capped.length >= topN) break
  }

  return capped
}
