import "server-only"

import { createHash, randomUUID } from "crypto"

import {
  getThreadById,
  getThreadMessages,
} from "@/lib/operator-studio/queries"
import type {
  OperatorThread,
  OperatorThreadMessage,
} from "@/lib/operator-studio/types"

import {
  ROLLUP_CONTRACT_VERSION,
  buildPlannerPrompt,
  buildWriterPrompt,
  parseRollupPlanResponse,
  parseWriterResponse,
  stitchRollup,
} from "./contracts/thread-rollup"
import {
  EmptyThreadError,
  ThreadNotFoundError,
  WayseerNotConfiguredError,
} from "./runner"
import { WayseerLlmError, callContract, isLlmConfigured } from "./llm"
import {
  completeEnrichment,
  createEnrichmentRunning,
  failEnrichment,
  getLatestEnrichmentForThreadByContractPrefix,
} from "./queries"
import type { ThreadEnrichmentRow } from "./queries"
import type { ThreadRollup } from "./contracts/thread-rollup"

/**
 * Rollup runner — Phase 2 two-stage planner→writer pipeline.
 *
 * Mirrors the v1 single-pass thread-analysis runner: kick off a
 * `running` row, fire-and-forget the LLM work, let the GET endpoint
 * surface terminal state. The differences from v1 are:
 *
 *   1. **Two LLM calls** — planner produces a structural plan, writer
 *      consumes it to produce the final rollup. Two cheap calls
 *      against a small local model still beat one expensive call to
 *      a flagship for this kind of structured-output task.
 *
 *   2. **Content-hash short-circuit** — if the latest completed
 *      rollup row's `content_hash` matches the current thread's hash
 *      AND the row is not stale by contract version, we return that
 *      row instead of starting a new run. This is the core cost
 *      gate: pulse-driven re-enqueues won't burn tokens on threads
 *      that haven't materially changed.
 *
 *   3. **Pulse compatibility** — `startThreadRollup` accepts a
 *      `force` flag. The Phase 3 pulse-tick maybe-enqueue route
 *      passes `force=false` so it can be no-op'd; the manual
 *      "Refresh" button passes `force=true` to bypass the gate.
 */

interface StartArgs {
  workspaceId: string
  threadId: string
  /** When true, skip the content-hash short-circuit and always start
   *  a new run. Used by the manual Refresh button. */
  force?: boolean
}

interface StartResult {
  enrichment: ThreadEnrichmentRow<ThreadRollup>
  /** True when we returned an existing completed row instead of
   *  starting a new run (the content-hash short-circuit fired). */
  reused: boolean
}

export async function startThreadRollup(args: StartArgs): Promise<StartResult> {
  if (!isLlmConfigured()) {
    throw new WayseerNotConfiguredError()
  }

  const thread = await getThreadById(args.workspaceId, args.threadId)
  if (!thread) {
    throw new ThreadNotFoundError(args.threadId)
  }

  const messages = await getThreadMessages(args.workspaceId, args.threadId)
  if (messages.length === 0) {
    throw new EmptyThreadError()
  }

  // Cost gate: short-circuit when the existing row was generated
  // from this exact transcript shape and the same contract version.
  if (!args.force) {
    const latest =
      await getLatestEnrichmentForThreadByContractPrefix<ThreadRollup>(
        args.workspaceId,
        args.threadId,
        "thread-rollup@"
      )
    const currentHash = computeThreadContentHash(messages)
    const latestHash =
      latest?.resultPayload?.signalsUsed &&
      "contentHash" in latest.resultPayload.signalsUsed
        ? (latest.resultPayload.signalsUsed as { contentHash?: string })
            .contentHash
        : undefined
    if (
      latest?.status === "completed" &&
      latest.contractVersion === ROLLUP_CONTRACT_VERSION &&
      latestHash === currentHash
    ) {
      return { enrichment: latest, reused: true }
    }
  }

  const enrichmentId = `enr-${randomUUID()}`
  const row = await createEnrichmentRunning({
    id: enrichmentId,
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    contractVersion: ROLLUP_CONTRACT_VERSION,
  })

  // Fire-and-forget: the row is the source of truth for
  // running/completed/failed; the GET endpoint polls it.
  void runRollup({
    enrichmentId,
    thread,
    messages,
  }).catch((error) => {
    // Should be unreachable — runRollup catches its own errors and
    // writes them to the row.
    console.error("[wayseer/rollup] runRollup escaped error", error)
  })

  // The Phase 1 callers expect a completed row in the response. Now
  // that we're async, we return the running row; the UI polls.
  return { enrichment: row as ThreadEnrichmentRow<ThreadRollup>, reused: false }
}

interface RunArgs {
  enrichmentId: string
  thread: OperatorThread
  messages: OperatorThreadMessage[]
}

async function runRollup({
  enrichmentId,
  thread,
  messages,
}: RunArgs): Promise<void> {
  const startedAt = Date.now()
  let promptTokens = 0
  let completionTokens = 0

  try {
    // Stage 1 — planner.
    const planner = buildPlannerPrompt({ thread, messages })
    const plannerResult = await callContract({
      systemPrompt: planner.systemPrompt,
      userPrompt: planner.userPrompt,
      // Planner output is short structural JSON — give it room but
      // don't overspend.
      maxTokens: 1600,
    })
    promptTokens += plannerResult.promptTokens ?? 0
    completionTokens += plannerResult.completionTokens ?? 0
    const plan = parseRollupPlanResponse(plannerResult.content)

    // Stage 2 — writer.
    const writer = buildWriterPrompt({ thread, messages, plan })
    const writerResult = await callContract({
      systemPrompt: writer.systemPrompt,
      userPrompt: writer.userPrompt,
      maxTokens: 2400,
    })
    promptTokens += writerResult.promptTokens ?? 0
    completionTokens += writerResult.completionTokens ?? 0
    const written = parseWriterResponse(writerResult.content)

    // Stitch + persist. Stash the content hash on signalsUsed so
    // the next call can short-circuit cheaply.
    const rollup = stitchRollup({
      plan,
      writer: written,
      signals: {
        modelEndpoint: writerResult.endpoint,
        modelName: getEnvModelName(),
        turnsConsidered: messages.length,
      },
    })
    const contentHash = computeThreadContentHash(messages)
    const enriched: ThreadRollup = {
      ...rollup,
      signalsUsed: {
        ...rollup.signalsUsed,
        // Extra runtime field; widening here is fine because we
        // narrowly persist via JSONB.
        ...(({ contentHash } as unknown) as Record<string, unknown>),
      },
    }

    await completeEnrichment({
      id: enrichmentId,
      resultPayload: enriched,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
      latencyMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message =
      error instanceof WayseerLlmError
        ? `LLM error: ${error.message}`
        : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error)
    await failEnrichment(enrichmentId, message)
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Stable content fingerprint for the thread. The cost gate uses
 *  this to detect "same thread shape, no new turns" and skip the
 *  pipeline entirely. We hash turn count + the role+content of the
 *  last 3 turns + the total content length — cheap, and sensitive to
 *  any new conversation.
 *
 *  Not a cryptographic guarantee — collisions are fine; we'd just
 *  re-use a slightly stale rollup. The "Refresh" button bypasses
 *  this entirely. */
function computeThreadContentHash(messages: OperatorThreadMessage[]): string {
  const ordered = [...messages].sort(
    (a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0)
  )
  const totalLen = ordered.reduce((s, m) => s + m.content.length, 0)
  const tail = ordered
    .slice(-3)
    .map((m) => `${m.turnIndex}:${m.role}:${m.content.slice(0, 200)}`)
    .join("||")
  return createHash("sha256")
    .update(`${ordered.length}|${totalLen}|${tail}`)
    .digest("hex")
    .slice(0, 32)
}

function getEnvModelName(): string | null {
  return process.env.WORKBOOK_CLUSTER_MODEL ?? null
}
