/**
 * Decision extractor — pull the moments where a choice was actually
 * made out of a wall of conversation.
 *
 * Pattern:
 *   "let's go with X"
 *   "decision:" / "decided:"
 *   "going with X over Y"
 *   "the call is X"
 *   "we'll use X"
 *   "settled on X"
 *
 * These are the moments worth replaying when you (or a teammate) come
 * back later and want to know "wait, why did we do it this way?"
 *
 * Pure heuristic, no LLM. Returns ranked list — first the most
 * decisive-sounding phrasings, then chronological for ties.
 */

export interface DecisionMomentInput {
  id: string
  threadId: string
  threadTitle: string | null
  role: "user" | "assistant"
  content: string
  turnIndex: number
  createdAt: string
}

export interface DecisionMoment {
  messageId: string
  threadId: string
  threadTitle: string | null
  role: "user" | "assistant"
  excerpt: string
  trigger: string // The phrase that fired
  turnIndex: number
  createdAt: string
  weight: number
}

interface DecisionPattern {
  /** Compiled regex; capture group 1 should be the decisive phrase. */
  re: RegExp
  weight: number
  label: string
}

const PATTERNS: DecisionPattern[] = [
  // Explicit "decided:" / "decision:" markers — strongest signal.
  {
    re: /\b(decision|decided)\s*:\s*[^.\n]{8,}/i,
    weight: 5,
    label: "decision:",
  },
  // "let's go with X" / "going with X"
  {
    re: /\b(let'?s\s+go\s+with|going\s+with)\s+[^.\n]{4,}/i,
    weight: 4,
    label: "going with",
  },
  // "we'll use X" / "I'll use X"
  {
    re: /\b((?:we|i|you|they|i'?ll|we'?ll)\s+(?:will\s+)?use)\s+[^.\n]{4,}/i,
    weight: 3,
    label: "use",
  },
  // "settled on X"
  {
    re: /\b(settled\s+on|landed\s+on|chose|chosen)\s+[^.\n]{4,}/i,
    weight: 4,
    label: "settled on",
  },
  // "the call is" / "the right call is" / "the right move is"
  {
    re: /\b(the\s+(?:right\s+)?(?:call|move|approach|answer|choice)\s+is)\s+[^.\n]{4,}/i,
    weight: 4,
    label: "the call is",
  },
  // "X over Y" comparison phrasing
  {
    re: /\b((?:going|using|picking|preferring|choosing)\s+\S+\s+over\s+\S+)/i,
    weight: 3,
    label: "X over Y",
  },
  // "let's NOT" — explicit rejection is also a decision
  {
    re: /\b(let'?s\s+not\s+|skip(?:ping)?\s+|deferring)\s+[^.\n]{4,}/i,
    weight: 2,
    label: "rejected",
  },
  // "I'll pick" / "going to pick"
  {
    re: /\b((?:i'?ll|we'?ll|gonna|going\s+to)\s+pick)\s+[^.\n]{4,}/i,
    weight: 3,
    label: "pick",
  },
]

function buildExcerpt(content: string, offset: number, len: number): string {
  const trimmed = content.trim()
  const start = Math.max(0, offset - 30)
  const window = trimmed.slice(start, start + len)
  // Trim to last sentence boundary on the right.
  const cut = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf(". \n"),
    window.lastIndexOf(".\n")
  )
  const right = cut > len * 0.4 ? cut + 1 : window.lastIndexOf(" ")
  const lhs = start > 0 ? "…" : ""
  return `${lhs}${window.slice(0, right > 0 ? right : len).trim()}…`
}

export interface ExtractDecisionOptions {
  topN?: number
  excerptLen?: number
  maxPerThread?: number
}

export function extractDecisions(
  messages: DecisionMomentInput[],
  opts: ExtractDecisionOptions = {}
): DecisionMoment[] {
  const topN = opts.topN ?? 12
  const excerptLen = opts.excerptLen ?? 200
  const maxPerThread = opts.maxPerThread ?? 3

  const found: DecisionMoment[] = []
  for (const msg of messages) {
    let bestWeight = 0
    let bestMatch: { offset: number; trigger: string } | null = null
    for (const p of PATTERNS) {
      const m = p.re.exec(msg.content)
      if (!m) continue
      if (p.weight > bestWeight) {
        bestWeight = p.weight
        bestMatch = {
          offset: m.index,
          trigger: p.label,
        }
      }
    }
    if (!bestMatch || bestWeight < 2) continue

    found.push({
      messageId: msg.id,
      threadId: msg.threadId,
      threadTitle: msg.threadTitle,
      role: msg.role,
      excerpt: buildExcerpt(msg.content, bestMatch.offset, excerptLen),
      trigger: bestMatch.trigger,
      turnIndex: msg.turnIndex,
      createdAt: msg.createdAt,
      weight: bestWeight,
    })
  }

  // Sort: weight desc then recency desc.
  found.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight
    return b.createdAt.localeCompare(a.createdAt)
  })

  // Cap per thread + total.
  const perThread = new Map<string, number>()
  const out: DecisionMoment[] = []
  for (const d of found) {
    const seen = perThread.get(d.threadId) ?? 0
    if (seen >= maxPerThread) continue
    perThread.set(d.threadId, seen + 1)
    out.push(d)
    if (out.length >= topN) break
  }
  return out
}
