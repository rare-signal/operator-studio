import { z } from "zod"

import type { OperatorThread, OperatorThreadMessage } from "@/lib/operator-studio/types"

/**
 * Wayseer thread-analysis contract — v1.
 *
 * The contract is the unit of LLM enhancement: a fixed prompt template
 * and a fixed response schema. Versioning the contract (via
 * `CONTRACT_VERSION`) lets us detect rows that were produced by an
 * older shape and re-run them when the prompt or schema change. The
 * rest of the system treats the contract as a black box — it takes a
 * thread, returns a `ThreadAnalysis`, and writes both into
 * `operator_thread_enrichments`.
 *
 * v1 strategy is deliberately simple: single-pass with tail
 * truncation. Long threads get the most recent messages up to a
 * character budget, plus a header note that some early turns were
 * dropped. Multi-pass progressive chunking ("resolutionizing") is a
 * v2 evolution — we'd bump CONTRACT_VERSION and gate the new code on
 * the new tag.
 */

export const CONTRACT_VERSION = "thread-analysis@v1-single-pass-truncate-tail"

/** Hard cap on characters of thread transcript shipped to the LLM.
 *  ≈ 15k tokens at 4 chars/token. Keeps us well clear of any model's
 *  practical context limit while still admitting most threads whole. */
const MAX_TRANSCRIPT_CHARS = 60_000

export const threadAnalysisSchema = z.object({
  /** 3–8 ordered events. Each label is 2–6 words; summary is 1–2
   *  sentences describing what shifted at that moment. */
  timeline: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        summary: z.string().min(1).max(600),
      })
    )
    .min(1)
    .max(12),
  /** 1–2 sentences on the operator's mood/energy/focus across the thread. */
  attitude: z.string().min(1).max(800),
  /** 1–6 bullets of concrete accomplishments. Empty array allowed when
   *  the thread is exploratory and produced no shippable artifact. */
  what_got_done: z.array(z.string().min(1).max(400)).max(10),
  /** 0–4 bullets of unfinished work or unresolved questions. */
  open_threads: z.array(z.string().min(1).max(400)).max(8),
})

export type ThreadAnalysis = z.infer<typeof threadAnalysisSchema>

const SYSTEM_PROMPT = `You are Wayseer, the analysis layer that helps an operator make sense of long agentic chat threads. You turn raw conversations into a tight summary the operator can scan in 30 seconds.

Your job is to read a single chat thread (between an operator and an AI agent) and produce a structured analysis. Be concrete, specific, and grounded in what actually happened in the conversation. Do not invent details; if the thread is short or exploratory, say so honestly in the attitude field.

Return ONLY valid JSON matching this exact schema (no markdown fences, no prose outside the object):

{
  "timeline": [{ "label": "<2-6 word label>", "summary": "<1-2 sentence description>" }, ...],
  "attitude": "<1-2 sentences on the operator's mood/energy/focus>",
  "what_got_done": ["<bullet>", ...],
  "open_threads": ["<bullet>", ...]
}

Constraints:
- timeline: 3–8 ordered events for a typical thread; up to 12 for very long ones.
- what_got_done: 1–6 bullets of concrete accomplishments (empty array if exploratory).
- open_threads: 0–4 bullets of unfinished work or unresolved questions.
- Bullets are full sentences, not headlines. Be specific about what was decided, built, or stuck.`

interface BuildPromptInput {
  thread: Pick<OperatorThread, "rawTitle" | "promotedTitle" | "sourceApp" | "projectSlug">
  messages: Array<Pick<OperatorThreadMessage, "role" | "content" | "turnIndex">>
}

interface ContractPrompt {
  systemPrompt: string
  userPrompt: string
  /** True when the transcript was truncated to fit the budget. The
   *  user prompt already includes a header note in that case; this
   *  flag is just so the runner can record it in telemetry. */
  truncated: boolean
}

export function buildThreadAnalysisPrompt({
  thread,
  messages,
}: BuildPromptInput): ContractPrompt {
  const title = thread.promotedTitle ?? thread.rawTitle ?? "(untitled thread)"
  const sourceApp = thread.sourceApp
  const projectSlug = thread.projectSlug ?? "—"

  const ordered = [...messages].sort(
    (a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0)
  )

  // Tail-truncate: walk from the end backwards, accepting messages
  // until we'd cross the budget. Then reverse so the prompt reads in
  // chronological order. Most threads' conclusions live in the back
  // half, so this preserves the part the analysis most needs.
  const tail: typeof ordered = []
  let used = 0
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const msg = ordered[i]
    const rendered = `${msg.role}: ${msg.content}\n\n`
    if (used + rendered.length > MAX_TRANSCRIPT_CHARS && tail.length > 0) {
      break
    }
    tail.unshift(msg)
    used += rendered.length
  }

  const truncated = tail.length < ordered.length
  const truncationNote = truncated
    ? `[Note: this thread had ${ordered.length} turns; the earliest ${ordered.length - tail.length} were dropped to fit the analysis budget. The transcript below is the most recent ${tail.length} turns in order.]\n\n`
    : ""

  const transcript = tail
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n\n")

  const userPrompt = `Title: ${title}
Source: ${sourceApp}
Project: ${projectSlug}
Total turns: ${ordered.length}

${truncationNote}--- Thread ---
${transcript}
--- End thread ---

Produce the JSON analysis now.`

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    truncated,
  }
}

/**
 * Parse and validate an LLM response against the contract. Strips
 * accidental markdown fences and surrounding prose if the model
 * produced them despite being told not to — most local models obey,
 * but cloud providers occasionally wrap.
 */
export function parseThreadAnalysisResponse(raw: string): ThreadAnalysis {
  const trimmed = raw.trim()

  // Strip ```json … ``` or ``` … ``` fences if present.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed

  // If there's leading/trailing prose, isolate the outermost JSON object.
  const firstBrace = candidate.indexOf("{")
  const lastBrace = candidate.lastIndexOf("}")
  const jsonSlice =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate

  const parsed = JSON.parse(jsonSlice)
  return threadAnalysisSchema.parse(parsed)
}
