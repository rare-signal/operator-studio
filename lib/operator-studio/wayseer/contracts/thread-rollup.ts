import { z } from "zod"

import type {
  OperatorThread,
  OperatorThreadMessage,
} from "@/lib/operator-studio/types"

/**
 * Wayseer thread-rollup contract — v1.
 *
 * Ported from AIDA Observatory's `observatory_thread_rollup_v2`. The
 * rollup is a richer, opinionated summary than the v1 single-pass
 * thread-analysis: it produces a magazine-style headline, a paragraph
 * of "what happened", a bullet list of "need-to-know", a "vibe"
 * paragraph, and a numbered timeline of *story beats* — each beat has
 * a title, a summary, and citations back to specific turns.
 *
 * Phase 1 of the port ships the schema, fixtures, and UI surface so
 * the visual language is reviewable without an LLM. Phase 2 wires the
 * actual two-stage planner→writer pipeline that AIDA uses, keyed off
 * pulse ticks with a debounce.
 *
 * The contract version below pins prompt + schema together so an
 * older row's payload can be detected and re-rolled when either
 * changes. We share the `operator_thread_enrichments` table with the
 * v1 thread-analysis contract — the `contract_version` column
 * discriminates the two payload shapes.
 */

export const ROLLUP_CONTRACT_VERSION = "thread-rollup@v2-planner-writer-live"

/** Hard cap on transcript characters fed to the planner. ≈ 15k tokens
 *  at 4 chars/token. Tail-truncation matches the v1 thread-analysis
 *  contract: the conclusion of a working session is where the rollup
 *  most needs grounding, so we bias toward the back of the thread. */
const MAX_TRANSCRIPT_CHARS = 60_000

/** True when the contract version belongs to a rollup-shaped row.
 *  Used by the rollup GET endpoint to filter out v1 thread-analysis
 *  rows that share the same enrichments table. */
export function isRollupContractVersion(version: string): boolean {
  return version.startsWith("thread-rollup@")
}

/** A citation back to a specific turn in the thread. The UI uses this
 *  to render "Codex #10 · 5d ago" chips and the underlying excerpt
 *  when a beat row is expanded. */
export const rollupCitationSchema = z.object({
  /** turn_index in operator_thread_messages — 0-based, monotonically
   *  increasing within the thread. */
  turnIndex: z.number().int().min(0),
  role: z.enum(["user", "assistant", "system", "function"]),
  /** Short slice of the turn content, capped server-side at ~220 chars
   *  to keep payloads bounded. */
  excerpt: z.string().min(1).max(400),
})
export type RollupCitation = z.infer<typeof rollupCitationSchema>

export const rollupBeatSchema = z.object({
  /** Stable id for keying / linking. Generated server-side. */
  id: z.string().min(1),
  /** 1-based ordinal — the maroon "01 / 02 / 03" numbers in the UI. */
  index: z.number().int().min(1),
  /** 2–8 word headline for the beat. */
  title: z.string().min(1).max(160),
  /** 1–3 sentences describing what shifted at this moment. */
  summary: z.string().min(1).max(800),
  /** Inclusive bounds in turn_index space — used to lazily fetch the
   *  underlying turns when the beat is expanded. */
  startTurnIndex: z.number().int().min(0),
  endTurnIndex: z.number().int().min(0),
  /** Concrete turn indexes covered by this beat. AIDA's planner
   *  guarantees non-overlapping coverage across beats; the writer
   *  uses these to generate citations. */
  turnIndexes: z.array(z.number().int().min(0)).min(1).max(64),
  /** Up to 8 citations the writer chose as load-bearing for this
   *  beat. Empty array is allowed for fixture/early states. */
  refs: z.array(rollupCitationSchema).max(8).default([]),
})
export type RollupBeat = z.infer<typeof rollupBeatSchema>

export const rollupSignalsSchema = z.object({
  generationMode: z.enum([
    "fixture",
    "single-pass",
    "planner-writer",
  ]),
  pipelineVersion: z.string().min(1),
  turnsConsidered: z.number().int().min(0),
  modelEndpoint: z.string().nullable().default(null),
  modelName: z.string().nullable().default(null),
  /** True when the planner or writer fell back to a heuristic path
   *  (Phase 2 only). Surfaced in admin telemetry, not the user UI. */
  plannerUsedFallback: z.boolean().default(false),
  writerUsedFallback: z.boolean().default(false),
  /** True when the planner's coverage matched the budgeted units
   *  exactly (no gaps, no overlap). Phase 2. */
  coverageIsExact: z.boolean().default(true),
})
export type RollupSignals = z.infer<typeof rollupSignalsSchema>

export const threadRollupSchema = z.object({
  /** Magazine-style title — short, declarative, present-tense. */
  headline: z.string().min(1).max(160),
  /** Paragraph that opens the page: "Here's what happened in this
   *  Codex chat that went 2 days from 3/28 - 3/29..." */
  whatHappened: z.string().min(1).max(2000),
  /** 4–7 short imperative bullets — the green "need-to-know" panel. */
  needToKnow: z.array(z.string().min(1).max(240)).min(1).max(10),
  /** 1–3 sentences on how the operator was working — the blue
   *  "what the vibe was" panel. */
  vibe: z.string().min(1).max(800),
  /** 3–6 numbered story beats. The opinionated centerpiece. */
  beats: z.array(rollupBeatSchema).min(1).max(8),
  /** Confidence the writer assigned to its own output, 0–1. Used by
   *  the UI to show a subtle "draft / confident" affordance. */
  confidence: z.number().min(0).max(1).default(0.7),
  signalsUsed: rollupSignalsSchema,
})
export type ThreadRollup = z.infer<typeof threadRollupSchema>

/** Strip accidental markdown fences and isolate the outermost JSON
 *  object. Same logic as the v1 analysis contract — most local models
 *  obey the JSON-only directive but cloud providers occasionally wrap. */
export function parseThreadRollupResponse(raw: string): ThreadRollup {
  return threadRollupSchema.parse(extractJsonObject(raw))
}

/** Strip fences and isolate the outermost JSON object. Returns the
 *  parsed object; throws on malformed JSON. Shared by both planner
 *  and writer parsers. */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed
  const firstBrace = candidate.indexOf("{")
  const lastBrace = candidate.lastIndexOf("}")
  const jsonSlice =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate
  return JSON.parse(jsonSlice)
}

// ─── Planner stage ──────────────────────────────────────────────────────────

/** A planned moment — the unit the planner produces and the writer
 *  consumes. Maps 1:1 to a final beat, but the planner is responsible
 *  only for *structure* (chronology, coverage, turn assignment); the
 *  writer is responsible for *prose* (titles, summaries, citations).
 *  This split is the AIDA Observatory innovation that gives the
 *  rollup its consistent voice across very different threads. */
export const rollupMomentSchema = z.object({
  /** 2–6 word working label. The writer will rewrite this; it's just
   *  a planning aid for the model. */
  workingTitle: z.string().min(1).max(160),
  /** One sentence describing the shift at this moment, in the
   *  planner's words. The writer is free to discard this. */
  workingSummary: z.string().min(1).max(600),
  /** open | in_progress | blocked | resolved — the working status of
   *  the artifact at this moment. Surfaced in writer prompt as
   *  context, not currently rendered in the UI. */
  status: z
    .enum(["open", "in_progress", "blocked", "resolved"])
    .default("in_progress"),
  /** Inclusive turn-index bounds. */
  startTurnIndex: z.number().int().min(0),
  endTurnIndex: z.number().int().min(0),
  /** All turn indexes assigned to this moment. The planner is
   *  instructed to make this a non-overlapping partition of the
   *  budgeted units. */
  turnIndexes: z.array(z.number().int().min(0)).min(1).max(64),
})
export type RollupMoment = z.infer<typeof rollupMomentSchema>

export const rollupPlanSchema = z.object({
  moments: z.array(rollupMomentSchema).min(1).max(8),
})
export type RollupPlan = z.infer<typeof rollupPlanSchema>

const PLANNER_SYSTEM_PROMPT = `You are a timeline planning model for assistant chats. You read a single chat thread between an operator and an AI agent, and you build a strict chronological moment plan with complete unit coverage.

Your job is structure, not prose. You decide where the thread's natural shifts are — scope changes, new artifacts, blockers, resolutions — and you partition the turns into 3–6 chronological moments. Each moment has a working title, a one-sentence working summary, a status, and the exact turn indexes it covers.

Output ONLY valid JSON matching this exact schema (no markdown fences, no prose outside the object):

{
  "moments": [
    {
      "workingTitle": "<2-6 word planning label>",
      "workingSummary": "<one sentence describing the shift>",
      "status": "open" | "in_progress" | "blocked" | "resolved",
      "startTurnIndex": <int>,
      "endTurnIndex": <int>,
      "turnIndexes": [<int>, <int>, ...]
    },
    ...
  ]
}

Hard constraints:
- Strict chronology: start_turn_index of moment N+1 >= end_turn_index of moment N.
- Non-overlapping coverage: each turn appears in at most one moment's turnIndexes.
- 3–6 moments for a typical thread. Use 7–8 only when the thread really earns it.
- Each moment must cover at least 2 turns and at most 24.
- Status reflects the artifact's state at the *end* of the moment, not the start.`

interface BuildPlannerArgs {
  thread: Pick<
    OperatorThread,
    "rawTitle" | "promotedTitle" | "sourceApp" | "projectSlug"
  >
  messages: Array<Pick<OperatorThreadMessage, "role" | "content" | "turnIndex">>
}

interface ContractPrompt {
  systemPrompt: string
  userPrompt: string
  truncated: boolean
}

export function buildPlannerPrompt({
  thread,
  messages,
}: BuildPlannerArgs): ContractPrompt {
  const title = thread.promotedTitle ?? thread.rawTitle ?? "(untitled thread)"
  const ordered = [...messages].sort(
    (a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0)
  )

  // Tail-truncate: walk backwards, accept until we'd cross budget.
  const tail: typeof ordered = []
  let used = 0
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const msg = ordered[i]
    const rendered = `[turn ${msg.turnIndex}] ${msg.role}: ${msg.content}\n\n`
    if (used + rendered.length > MAX_TRANSCRIPT_CHARS && tail.length > 0) {
      break
    }
    tail.unshift(msg)
    used += rendered.length
  }

  const truncated = tail.length < ordered.length
  const truncationNote = truncated
    ? `[Note: this thread had ${ordered.length} turns; the earliest ${ordered.length - tail.length} were dropped to fit the planning budget. The transcript below is the most recent ${tail.length} turns in order. Use only the visible turn indexes when planning moments.]\n\n`
    : ""

  const transcript = tail
    .map((msg) => `[turn ${msg.turnIndex}] ${msg.role}: ${msg.content}`)
    .join("\n\n")

  const visibleIndexes = tail.map((m) => m.turnIndex)
  const minIdx = visibleIndexes[0] ?? 0
  const maxIdx = visibleIndexes[visibleIndexes.length - 1] ?? 0

  const userPrompt = `Title: ${title}
Source: ${thread.sourceApp}
Project: ${thread.projectSlug ?? "—"}
Total turns in thread: ${ordered.length}
Visible turn indexes: ${minIdx}..${maxIdx} (${tail.length} turns)

${truncationNote}--- Thread ---
${transcript}
--- End thread ---

Produce the JSON moment plan now. Use only turn indexes in the visible range.`

  return {
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    userPrompt,
    truncated,
  }
}

export function parseRollupPlanResponse(raw: string): RollupPlan {
  return rollupPlanSchema.parse(extractJsonObject(raw))
}

// ─── Writer stage ───────────────────────────────────────────────────────────

const WRITER_SYSTEM_PROMPT = `You are a session rollup writer for long coding-assistant chats. Given a fixed chronological moment plan, you write a product-facing structured rollup.

The plan is fixed — do not invent new moments, drop moments, or re-order them. For each planned moment you produce one beat with a tight title and a 1–3 sentence summary. You also produce three magazine-style summary fields covering the whole thread: a headline, a "what happened" paragraph, a "need-to-know" bullet list, and a "vibe" paragraph.

Tone:
- User-direction-first: lead with what the *operator* did, not what the agent said. The operator is the protagonist.
- Specific over generic: name files, commands, decisions. Avoid "various changes were made."
- Present-tense, declarative. No hedging.
- Don't regurgitate the prompt or the plan's working summaries verbatim — rewrite in the rollup's voice.
- The headline is the natural session title, not a marketing line. 4–10 words.
- "Vibe" is about the operator's mood/energy/focus, not the technical content. 1–3 sentences.

For each beat, also pick up to 3 *citations* from the moment's turnIndexes — specific turns that are load-bearing for that beat's claim. Use the role and a short excerpt (under 220 chars).

Output ONLY valid JSON matching this exact schema (no markdown fences, no prose outside the object):

{
  "headline": "<4-10 word session title>",
  "whatHappened": "<one paragraph, 3-5 sentences>",
  "needToKnow": ["<bullet>", "<bullet>", ...],   // 4-6 bullets
  "vibe": "<1-3 sentences on operator mood/energy>",
  "beats": [
    {
      "title": "<tight 2-8 word headline>",
      "summary": "<1-3 sentence beat summary>",
      "refs": [
        { "turnIndex": <int>, "role": "user|assistant|system|function", "excerpt": "<≤220 chars>" },
        ...
      ]
    },
    ...
  ],
  "confidence": <float 0..1>
}

Number and order of beats must exactly match the plan. Each beat's refs must come from that moment's turnIndexes — do not cite turns from other moments.`

/** Subset of the final ThreadRollup that the writer is responsible
 *  for emitting. The runner combines this with planner output to
 *  produce a fully-typed ThreadRollup. */
const writerOutputSchema = z.object({
  headline: z.string().min(1).max(160),
  whatHappened: z.string().min(1).max(2000),
  needToKnow: z.array(z.string().min(1).max(240)).min(1).max(10),
  vibe: z.string().min(1).max(800),
  beats: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        summary: z.string().min(1).max(800),
        refs: z
          .array(
            z.object({
              turnIndex: z.number().int().min(0),
              role: z.enum(["user", "assistant", "system", "function"]),
              excerpt: z.string().min(1).max(400),
            })
          )
          .max(8)
          .default([]),
      })
    )
    .min(1)
    .max(8),
  confidence: z.number().min(0).max(1).default(0.7),
})
export type WriterOutput = z.infer<typeof writerOutputSchema>

interface BuildWriterArgs extends BuildPlannerArgs {
  plan: RollupPlan
}

export function buildWriterPrompt({
  thread,
  messages,
  plan,
}: BuildWriterArgs): ContractPrompt {
  const title = thread.promotedTitle ?? thread.rawTitle ?? "(untitled thread)"
  const ordered = [...messages].sort(
    (a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0)
  )

  // Re-tail-truncate to the same budget so planner and writer share
  // a transcript window. The planner already filtered to visible
  // indexes; the writer just needs the same context for citations.
  const tail: typeof ordered = []
  let used = 0
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const msg = ordered[i]
    const rendered = `[turn ${msg.turnIndex}] ${msg.role}: ${msg.content}\n\n`
    if (used + rendered.length > MAX_TRANSCRIPT_CHARS && tail.length > 0) {
      break
    }
    tail.unshift(msg)
    used += rendered.length
  }
  const truncated = tail.length < ordered.length

  const transcript = tail
    .map((msg) => `[turn ${msg.turnIndex}] ${msg.role}: ${msg.content}`)
    .join("\n\n")

  const planJson = JSON.stringify(
    plan.moments.map((m, i) => ({
      momentIndex: i + 1,
      workingTitle: m.workingTitle,
      workingSummary: m.workingSummary,
      status: m.status,
      turnIndexes: m.turnIndexes,
    })),
    null,
    2
  )

  const userPrompt = `Title: ${title}
Source: ${thread.sourceApp}
Project: ${thread.projectSlug ?? "—"}
Total turns in thread: ${ordered.length}

--- Plan ---
${planJson}
--- End plan ---

--- Thread ---
${transcript}
--- End thread ---

Produce the final rollup JSON now. Beat count and order must match the plan exactly. Citations must come from each moment's own turnIndexes.`

  return {
    systemPrompt: WRITER_SYSTEM_PROMPT,
    userPrompt,
    truncated,
  }
}

export function parseWriterResponse(raw: string): WriterOutput {
  return writerOutputSchema.parse(extractJsonObject(raw))
}

// ─── Stitching ──────────────────────────────────────────────────────────────

interface StitchArgs {
  plan: RollupPlan
  writer: WriterOutput
  signals: Pick<
    RollupSignals,
    "modelEndpoint" | "modelName" | "turnsConsidered"
  >
}

/** Combine planner output + writer output into the final
 *  `ThreadRollup`. The planner owns turn-range bookkeeping; the
 *  writer owns prose. The runner calls this after both stages parse
 *  successfully. */
export function stitchRollup({
  plan,
  writer,
  signals,
}: StitchArgs): ThreadRollup {
  // Defensive: clamp writer.beats.length to plan.moments.length.
  // Both prompts demand exact match but cheap models occasionally
  // drop or duplicate. We pair by index and let the planner's turn
  // assignments be authoritative.
  const pairs = plan.moments.slice(0, writer.beats.length).map((m, i) => ({
    moment: m,
    written: writer.beats[i],
  }))

  // Build beats by stitching planner ranges with writer prose. Filter
  // refs to ones that fall inside the moment's turnIndexes — the
  // writer is told to do this but we enforce it.
  const beats: RollupBeat[] = pairs.map((p, i) => {
    const allowed = new Set(p.moment.turnIndexes)
    return {
      id: `beat-${i + 1}`,
      index: i + 1,
      title: p.written.title,
      summary: p.written.summary,
      startTurnIndex: p.moment.startTurnIndex,
      endTurnIndex: p.moment.endTurnIndex,
      turnIndexes: p.moment.turnIndexes,
      refs: p.written.refs.filter((r) => allowed.has(r.turnIndex)).slice(0, 8),
    }
  })

  return {
    headline: writer.headline,
    whatHappened: writer.whatHappened,
    needToKnow: writer.needToKnow,
    vibe: writer.vibe,
    beats,
    confidence: writer.confidence,
    signalsUsed: {
      generationMode: "planner-writer",
      pipelineVersion: ROLLUP_CONTRACT_VERSION,
      turnsConsidered: signals.turnsConsidered,
      modelEndpoint: signals.modelEndpoint,
      modelName: signals.modelName,
      plannerUsedFallback: false,
      writerUsedFallback: false,
      coverageIsExact: true,
    },
  }
}
