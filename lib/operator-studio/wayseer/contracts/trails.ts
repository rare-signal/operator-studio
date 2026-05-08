import { z } from "zod"

import type {
  OperatorSourceApp,
  OperatorThread,
} from "@/lib/operator-studio/types"

/**
 * Wayseer trails contract — v1 (POC).
 *
 * The "Sleuth" half of the agentic plan-population system. Where the
 * Scribe (`plan-suggestions.ts`) is bound to a single session and emits
 * narrow proposals against a known plan, the Sleuth ranges across many
 * recent sessions and synthesizes *trails* — preoccupations the
 * operator keeps returning to in their own words.
 *
 * The visual contract underneath this data contract: in the Trails
 * surface the operator's verbatim quotes are large and unstyled, and
 * the agent's framing (title, temperature, rationale) is dim italic.
 * If the surface ever speaks louder than the operator's own words, the
 * surface has failed. Keep that in mind when tuning the prompt.
 *
 * Trails earn their place by precision, not breadth. Conflating two
 * distinct concerns even once erodes trust faster than missing a real
 * one. The Sleuth should drop a trail before it pads it.
 */

export const TRAILS_CONTRACT_VERSION = "trails@v1-cross-session-sleuth"

const trailQuoteSchema = z.object({
  /** Source-app native key for the thread the quote came from. The
   *  importer resolves this to operator_threads.id. */
  source_thread_key: z.string().min(1),
  /** Zero-based turn index within the thread. */
  turn_index: z.number().int().nonnegative(),
  /** Trails surface only quotes the operator. The schema admits
   *  "user" only — assistant turns are context for the Sleuth, not
   *  evidence the operator will recognize as their own voice. */
  role: z.literal("user"),
  /** Literal words from the cited turn. Trim with … if longer than
   *  400 chars; preserve the load-bearing span. */
  quote: z.string().min(8).max(400),
  /** ISO timestamp of the quoted turn — used by the UI to render a
   *  temporal ordering and the trail's heat curve. */
  occurred_at: z.string().datetime(),
})

export type TrailQuote = z.infer<typeof trailQuoteSchema>

const trailTemperatureSchema = z.enum([
  /** Recurred recently and frequency is climbing. */
  "heating",
  /** Recurred recently but frequency is roughly steady. */
  "steady",
  /** Recurred less often than before; may be resolving or fading. */
  "cooling",
  /** No recurrence in the recent window; on the back burner. */
  "dormant",
])

export type TrailTemperature = z.infer<typeof trailTemperatureSchema>

const trailSchema = z.object({
  /** Stable agent-assigned id for this trail within the response.
   *  The importer uses it to dedupe against trails it has already
   *  seen across previous Sleuth runs. */
  trail_id: z.string().min(1).max(80),
  /** A short trail title. Inferred — rendered dim italic next to the
   *  operator's quotes. 2–6 words; sentence-case; not a sentence. */
  inferred_title: z.string().min(2).max(80),
  /** One-sentence rationale: why does the Sleuth believe these
   *  quotes are the same trail? Inferred — rendered dim italic. The
   *  operator skims this to verify the grouping before accepting. */
  inferred_rationale: z.string().min(8).max(300),
  temperature: trailTemperatureSchema,
  /** 3–5 quotes from the operator's own messages, ordered oldest →
   *  newest. Fewer than 3 is too thin to merit a trail; more than 5
   *  pads the surface and the operator stops scanning. */
  quotes: z.array(trailQuoteSchema).min(3).max(5),
  /** Optional plan-step ids this trail already maps onto. Lets the
   *  UI render "already in your plan" badges and avoids prompting
   *  the operator to re-pin work that's tracked. */
  linked_step_ids: z.array(z.string().min(1)).max(8).optional(),
  /** Optional source-app filter the Sleuth saw the trail across.
   *  If only one app, the Sleuth records it; cross-app trails leave
   *  this null and the UI shows mixed-source provenance. */
  observed_in_source_apps: z
    .array(z.string() as z.ZodType<OperatorSourceApp>)
    .max(8)
    .optional(),
  /** Optional cross-trail links — other trail_ids in this same
   *  response whose concerns brush against this one. The Sleuth uses
   *  this when two trails are clearly related but not the same (e.g.,
   *  a hot version and a dormant version of the same underlying
   *  concern, or two angles on a shared theme). The UI renders these
   *  as "↔ <other-trail-title>" annotations under the rationale so
   *  the operator can see the web of preoccupations as a graph, not
   *  just a list. Cap is 4 — more than that and the trail is
   *  probably the wrong unit and should be merged or split. */
  crosses_with_trail_ids: z.array(z.string().min(1)).max(4).optional(),
})

export type Trail = z.infer<typeof trailSchema>

export const trailsResponseSchema = z.object({
  contract_version: z.string().min(1),
  /** Workspace the Sleuth ran against. Echoed back from the prompt. */
  workspace_id: z.string().min(1),
  /** ISO range the Sleuth read across. The UI shows this as the
   *  trail surface's "as of" window. */
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  /** Ordered by the Sleuth's confidence — strongest trails first.
   *  Capped to keep review attention finite. */
  trails: z.array(trailSchema).max(12),
  /** Optional debug channel: candidate trails the Sleuth considered
   *  but dropped, with reasons. Helps tune the grouping rules during
   *  the POC; never shown to the operator in v1. */
  considered_dropped: z
    .array(
      z.object({
        candidate_title: z.string().min(1).max(120),
        reason: z.string().min(1).max(300),
      })
    )
    .max(10)
    .optional(),
})

export type TrailsResponse = z.infer<typeof trailsResponseSchema>

const SYSTEM_PROMPT = `You are the Sleuth — the cross-session synthesis layer for Operator Studio. You read many recent agentic chat threads (between an operator and AI agents) and surface "trails": preoccupations the operator keeps returning to in their own words.

The operator's verbatim words are sacrosanct. They are the load-bearing layer. Your contribution — the inferred trail title, the one-line rationale, the temperature — sits above their quotes and is rendered dim italic in the UI. If your framing ever speaks louder than the operator's voice, the surface has failed. Keep that in mind when choosing what to emit.

What a trail is:
  - A through-line in the operator's own messages across multiple sessions.
  - At least three distinct quotes (different turns, ideally different threads) where the operator returns to the same concern, idea, or open question — even if phrased differently.
  - Worth surfacing because the operator might want to pin it to their plan, promote a quote to a step, or notice that something they keep mentioning has no plan home yet.

Strong rules:
  - QUOTES ARE THE OPERATOR'S, ALWAYS. Never quote the assistant. Assistant turns are context for your synthesis but they are not evidence.
  - LITERAL WORDS ONLY. Never paraphrase or summarize a quote. Trim with … if longer than 400 chars but preserve the load-bearing span.
  - PRECISION OVER BREADTH. Drop a trail before padding it. Conflating two distinct concerns even once erodes the operator's trust in this surface.
  - 3–5 QUOTES PER TRAIL. Fewer is too thin; more dilutes attention.
  - DEDUPE BY MEANING. If two candidate trails are the same concern phrased differently, merge them under one trail; do not emit both.

Temperature calibration:
  - heating  = recurred recently AND frequency climbing.
  - steady   = recurred recently AND frequency roughly stable.
  - cooling  = recurred less often than before; may be resolving or fading.
  - dormant  = no recurrence in the recent window; on the back burner. Emit dormant trails sparingly — only if the operator might benefit from a "you used to care about this" reminder.

The inferred_title is short (2–6 words, sentence-case, not a sentence). The inferred_rationale is one sentence on why these quotes belong together — it is the operator's "yes, that's me" or "no, those are two different things" check.

For candidate groupings you considered but did not emit (signal too thin, conflated, already covered by the plan), use the optional considered_dropped array. This is a debug channel for tuning the Sleuth — keep entries short, never editorialize.

Return ONLY valid JSON matching the schema (no markdown fences, no prose outside the object). Echo contract_version, workspace_id, window_start, and window_end verbatim from the prompt.`

interface BuildPromptInput {
  workspaceId: string
  windowStart: string
  windowEnd: string
  /** A flattened list of operator messages across the window, with
   *  their thread + source-app context. The Sleuth sees the operator
   *  side of the conversation (its job is to surface the operator's
   *  preoccupations) plus enough thread metadata to cite. */
  operatorMessages: Array<{
    sourceThreadKey: string
    sourceApp: OperatorSourceApp
    threadTitle: string | null
    turnIndex: number
    occurredAt: string
    content: string
  }>
  /** Optional plan summary so the Sleuth can mark trails that
   *  already map onto existing steps via linked_step_ids. */
  planSummary?: {
    planId: string
    title: string
    steps: Array<{ id: string; title: string }>
  }
}

interface ContractPrompt {
  systemPrompt: string
  userPrompt: string
}

export function buildTrailsPrompt({
  workspaceId,
  windowStart,
  windowEnd,
  operatorMessages,
  planSummary,
}: BuildPromptInput): ContractPrompt {
  const ordered = [...operatorMessages].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt)
  )

  const planBlock = planSummary
    ? [
        "",
        "Active plan (use ids verbatim if a trail maps onto a step):",
        `  plan_id: ${planSummary.planId}`,
        `  title: ${JSON.stringify(planSummary.title)}`,
        ...planSummary.steps.map(
          (s) => `  - id=${s.id} title=${JSON.stringify(s.title)}`
        ),
      ].join("\n")
    : ""

  const messageBlock = ordered
    .map(
      (m) =>
        `[${m.occurredAt}] ${m.sourceApp} :: ${m.sourceThreadKey} :: turn=${m.turnIndex}\n${m.content}`
    )
    .join("\n\n---\n\n")

  const userPrompt = `Contract version: ${TRAILS_CONTRACT_VERSION}
Workspace id: ${workspaceId}
Window: ${windowStart} → ${windowEnd}
Operator messages in window: ${ordered.length}${planBlock}

--- Operator messages (chronological) ---
${messageBlock}
--- End operator messages ---

Surface the trails now. Echo contract_version, workspace_id, window_start, window_end verbatim. Emit only the JSON object.`

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  }
}

/**
 * Parse and validate a Sleuth response. Strips markdown fences and
 * surrounding prose if the agent wrapped despite being told not to.
 * Throws ZodError on schema mismatch — callers should treat that as
 * "Sleuth output unusable, surface raw to operator for debugging."
 */
export function parseTrailsResponse(raw: string): TrailsResponse {
  const trimmed = raw.trim()

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed

  const firstBrace = candidate.indexOf("{")
  const lastBrace = candidate.lastIndexOf("}")
  const jsonSlice =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate

  const parsed = JSON.parse(jsonSlice)
  return trailsResponseSchema.parse(parsed)
}

/**
 * Convenience: filter a list of Trails to those whose temperature is
 * "heating" or "steady" — the default surface filter for the Trails
 * tab. Cooling/dormant trails are still loaded but tucked under a
 * collapsed "back burner" rail.
 */
export function isOnFront(trail: Pick<Trail, "temperature">): boolean {
  return trail.temperature === "heating" || trail.temperature === "steady"
}

/**
 * Helper for the UI: a trail is considered "in flight" if at least
 * one quote occurred within `withinHours` of `now`. Used to drive
 * the small pulse-dot indicator on a card. Pure function over the
 * already-parsed response so the UI can call it without re-running
 * any of the Sleuth.
 */
export function trailIsInFlight(
  trail: Pick<Trail, "quotes">,
  now: Date,
  withinHours = 48
): boolean {
  const cutoffMs = now.getTime() - withinHours * 60 * 60 * 1000
  return trail.quotes.some(
    (q) => Date.parse(q.occurred_at) >= cutoffMs
  )
}
