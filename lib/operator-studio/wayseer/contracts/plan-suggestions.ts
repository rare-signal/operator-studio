import { z } from "zod"

import type {
  OperatorPlanStep,
  OperatorSessionPlan,
  OperatorThread,
} from "@/lib/operator-studio/types"

/**
 * Wayseer plan-suggestions contract — v1 (POC).
 *
 * Unlike the thread-analysis and thread-rollup contracts, this one is
 * not meant to be run server-side against an imported transcript. It
 * is meant to be embedded in the *external* coding agent's prompt
 * (Claude Code, Codex, Cursor, …) so that at the end of an agentic
 * session — or when the operator says "wrap up" — the agent emits
 * structured proposals for plan updates. Operator Studio then renders
 * those proposals as ghostly cutouts in the Plan tab: faint
 * pre-checked checkboxes on existing steps and outlined new cards,
 * with the load-bearing quote shown inline. Accept or trash with one
 * click; trash is corrective signal back into the extractor.
 *
 * The contract is the agreement between "what the agent emits" and
 * "what the importer accepts." The Zod schema is the runtime check on
 * agent output before anything reaches the database. Versioning lets
 * us re-prompt or re-shape later without breaking ingestion.
 *
 * Design choices worth remembering:
 *  - Quotes are load-bearing (literal words), not paraphrases. The
 *    operator should be able to skim a suggestion and recognize the
 *    moment it cites without clicking through.
 *  - mark_step_done is preferred over add_step; the most common case
 *    is "step you already planned, agent finished it, you forgot to
 *    mark it done."
 *  - turn_index is the agent-friendly handle. The importer resolves
 *    turn_index → operator_thread_messages.id when it ingests, using
 *    sourceThreadKey (or the current session if unspecified).
 *  - considered_no_suggestion is for *debugging* false negatives
 *    during the POC — never shown to the operator in v1.
 */

export const PLAN_SUGGESTIONS_CONTRACT_VERSION =
  "plan-suggestions@v1-agent-emitted"

const evidenceSchema = z.object({
  /** Source-app native key for the thread the quote came from
   *  (Claude Code session UUID, Codex rollout filename stem, etc.).
   *  Null/omitted = "the session being recapped right now" — the
   *  importer fills it in from context. */
  source_thread_key: z.string().min(1).nullable().optional(),
  /** Zero-based turn index within the thread. The agent's view of
   *  turns must match what the importer sees, so this matches
   *  OperatorThreadMessage.turnIndex. */
  turn_index: z.number().int().nonnegative(),
  role: z.enum(["user", "assistant", "system", "function"]),
  /** A literal quote from the cited turn — the words that prove the
   *  claim. Not a paraphrase. Trim with … if the load-bearing span is
   *  longer than 400 chars, but preserve the verbatim core. */
  quote: z.string().min(8).max(400),
})

export type PlanSuggestionEvidence = z.infer<typeof evidenceSchema>

const baseFields = {
  /** 1–2 sentences. Why does this evidence support this proposal? */
  rationale: z.string().min(8).max(400),
  /** Calibration:
   *   - "high"   = explicit verbalization (merged / shipped / tests passing /
   *                deployed) or a tool result that proves completion.
   *   - "medium" = strong implicit signal (code change applied, decision
   *                made and committed, no follow-up regression).
   *   - "low"    = tangential, partial, inferential. Emit sparingly. */
  confidence: z.enum(["high", "medium", "low"]),
  evidence: evidenceSchema,
}

const markStepDoneSchema = z.object({
  kind: z.literal("mark_step_done"),
  /** Must match an existing OperatorPlanStep.id from the plan handed
   *  to the agent. Unknown ids are rejected by the importer. */
  target_step_id: z.string().min(1),
  ...baseFields,
})

const addStepSchema = z.object({
  kind: z.literal("add_step"),
  proposed_title: z.string().min(2).max(120),
  proposed_description: z.string().max(600).optional(),
  /** Existing step id this new step nests under, or null/omitted for
   *  top-level. Useful when the agent realized a planned step was
   *  actually two sub-steps. */
  proposed_parent_step_id: z.string().min(1).nullable().optional(),
  /** Most new-step proposals are "open" (work was identified, not
   *  finished). "covered" is allowed when the agent both discovered
   *  AND completed an unplanned step in the same session. */
  proposed_status: z.enum(["open", "covered"]).default("open"),
  ...baseFields,
})

const attachEvidenceSchema = z.object({
  kind: z.literal("attach_evidence"),
  target_step_id: z.string().min(1),
  ...baseFields,
})

export const planSuggestionSchema = z.discriminatedUnion("kind", [
  markStepDoneSchema,
  addStepSchema,
  attachEvidenceSchema,
])

export type PlanSuggestion = z.infer<typeof planSuggestionSchema>

export const planSuggestionsResponseSchema = z.object({
  contract_version: z.string().min(1),
  /** Plan id the suggestions are scoped to. Echoed back from the
   *  prompt; the importer rejects mismatches. */
  plan_id: z.string().min(1),
  /** Ordered by the agent's confidence. Capped to keep review
   *  attention finite — if there are more than 20, the agent dropped
   *  the weakest. */
  suggestions: z.array(planSuggestionSchema).max(20),
  /** Optional debug channel: topics the agent considered but did not
   *  propose, with reasons. Helps tune the prompt; never shown to the
   *  operator in v1. */
  considered_no_suggestion: z
    .array(
      z.object({
        topic: z.string().min(1).max(200),
        reason: z.string().min(1).max(300),
      })
    )
    .max(10)
    .optional(),
})

export type PlanSuggestionsResponse = z.infer<
  typeof planSuggestionsResponseSchema
>

const SYSTEM_PROMPT = `You are emitting plan-suggestion proposals for Operator Studio at the end of an agentic session. The operator will review your proposals as ghostly cutouts in their Plan tab — a faint pre-checked checkbox on an existing step, or an outlined new card — and accept or trash each one with a click.

Trash is corrective signal back into the system, but every wrong proposal taxes the operator's attention. Be conservative. If you cannot find a load-bearing quote that proves the claim, do not emit the suggestion.

There are three kinds of suggestion. Choose the lightest one that fits:

  1. mark_step_done — an existing plan step was completed in this session. Strongest preference. Cite the turn that proves completion (a tool result, a "merged", a green test run).
  2. attach_evidence — an existing plan step had partial progress this session, but is not yet done. Use this when work is in motion but the step is not finished.
  3. add_step — work happened that no existing step covers. Use sparingly. Prefer attach_evidence to an adjacent step over creating a new one.

Strong preferences:
  - PREFER mark_step_done over add_step. If an existing step covers the work, attach to it; do not duplicate.
  - PREFER attach_evidence over add_step for partial progress.
  - ONE suggestion per evidence point. Do not emit multiple suggestions that cite the same exchange.
  - If unsure whether the work counts, drop the suggestion. False positives erode trust faster than false negatives.

Confidence calibration:
  - high   = explicit verbalization the work is done ("merged", "shipped", "tests passing", "deployed"), or a tool result that proves it.
  - medium = strong implicit signal — code change applied without follow-up regression, decision made and committed.
  - low    = tangential, partial, or inferential. Think twice before emitting low-confidence suggestions.

Evidence quotes must be the LITERAL words from the conversation — not paraphrases, not summaries. Trim with … if longer than 400 chars, but preserve the load-bearing span. The operator should be able to recognize the moment from the quote alone.

For topics you considered but did not propose (signal too weak, already covered, unrelated to the plan), use the optional considered_no_suggestion array. This is a debug channel for tuning the extractor — keep it short and never editorialize.

Return ONLY valid JSON matching the schema below (no markdown fences, no prose outside the object). Echo back contract_version and plan_id verbatim from the prompt.

{
  "contract_version": "<echoed verbatim from prompt>",
  "plan_id": "<echoed verbatim from prompt>",
  "suggestions": [
    {
      "kind": "mark_step_done" | "attach_evidence",
      "target_step_id": "<existing step id>",
      "rationale": "<1-2 sentences>",
      "confidence": "high" | "medium" | "low",
      "evidence": {
        "source_thread_key": "<source-app native key, or null>",
        "turn_index": <integer>,
        "role": "user" | "assistant" | "system" | "function",
        "quote": "<literal words from that turn>"
      }
    },
    {
      "kind": "add_step",
      "proposed_title": "<short title>",
      "proposed_description": "<optional, ≤ 600 chars>",
      "proposed_parent_step_id": "<existing step id, or null>",
      "proposed_status": "open" | "covered",
      "rationale": "<1-2 sentences>",
      "confidence": "high" | "medium" | "low",
      "evidence": { ... }
    }
  ],
  "considered_no_suggestion": [
    { "topic": "<short topic>", "reason": "<short reason>" }
  ]
}`

interface BuildPromptInput {
  plan: Pick<
    OperatorSessionPlan,
    "id" | "title" | "goal" | "outcome" | "state"
  > & {
    steps: Array<
      Pick<
        OperatorPlanStep,
        "id" | "title" | "description" | "status" | "parentStepId" | "order"
      >
    >
  }
  /** Optional thread context. When the agent is recapping a single
   *  thread (the most common case), pass the source-app key so the
   *  importer can resolve evidence references without ambiguity. */
  thread?: Pick<OperatorThread, "sourceApp" | "sourceThreadKey" | "rawTitle" | "promotedTitle">
}

interface ContractPrompt {
  systemPrompt: string
  userPrompt: string
}

export function buildPlanSuggestionsPrompt({
  plan,
  thread,
}: BuildPromptInput): ContractPrompt {
  const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order)
  const stepLines = orderedSteps.map((s) => {
    const parent = s.parentStepId ? ` (parent: ${s.parentStepId})` : ""
    const desc = s.description ? `\n     ${s.description}` : ""
    return `  - id=${s.id} status=${s.status}${parent} title=${JSON.stringify(s.title)}${desc}`
  })

  const planBlock = [
    `Plan id: ${plan.id}`,
    `Title: ${plan.title}`,
    `State: ${plan.state}`,
    plan.goal ? `Goal: ${plan.goal}` : null,
    plan.outcome ? `Outcome: ${plan.outcome}` : null,
    "",
    "Existing steps (use these ids verbatim when proposing mark_step_done or attach_evidence):",
    ...(stepLines.length > 0 ? stepLines : ["  (no steps yet — every actionable signal is a candidate add_step)"]),
  ]
    .filter((l) => l !== null)
    .join("\n")

  const threadBlock = thread
    ? [
        "",
        "Thread context:",
        `  source_app: ${thread.sourceApp}`,
        `  source_thread_key: ${thread.sourceThreadKey ?? "(unset — use null in evidence)"}`,
        `  title: ${thread.promotedTitle ?? thread.rawTitle ?? "(untitled)"}`,
      ].join("\n")
    : ""

  const userPrompt = `Contract version: ${PLAN_SUGGESTIONS_CONTRACT_VERSION}

${planBlock}${threadBlock}

You have the session transcript in your own context (the conversation you just lived through). Read it now and emit the JSON object per the system prompt.

Echo contract_version and plan_id verbatim. Emit only the JSON object.`

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
  }
}

/**
 * Parse and validate an agent's plan-suggestions output. Strips
 * markdown fences and surrounding prose if the agent wrapped despite
 * being told not to. Throws ZodError on schema mismatch — callers
 * should treat that as "agent output unusable, surface raw to operator
 * for debugging."
 */
export function parsePlanSuggestionsResponse(
  raw: string
): PlanSuggestionsResponse {
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
  return planSuggestionsResponseSchema.parse(parsed)
}
