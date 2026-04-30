import "server-only"

import { randomUUID } from "crypto"

import {
  getThreadById,
  getThreadMessages,
} from "@/lib/operator-studio/queries"

import {
  CONTRACT_VERSION,
  buildThreadAnalysisPrompt,
  parseThreadAnalysisResponse,
} from "./contracts/thread-analysis"
import { WayseerLlmError, callContract, isLlmConfigured } from "./llm"
import {
  completeEnrichment,
  createEnrichmentRunning,
  failEnrichment,
  getLatestEnrichmentForThread,
} from "./queries"
import type { ThreadEnrichmentRow } from "./queries"

/**
 * Start a thread-analysis run for the given thread.
 *
 * Creates a `running` row immediately, returns it to the caller, and
 * kicks off the actual LLM work asynchronously via `void`-discarded
 * promise. The caller (the analyze API route) returns the running row
 * straight away; the frontend polls the GET endpoint to see status
 * transition to `completed` or `failed`.
 *
 * If Wayseer is not configured (no LLM endpoints), we refuse up front
 * with a structured error rather than committing a row we'd
 * immediately fail. The route translates that to a 412.
 */

export class WayseerNotConfiguredError extends Error {
  constructor() {
    super("Wayseer requires an LLM endpoint. Set WORKBOOK_CLUSTER_ENDPOINTS.")
    this.name = "WayseerNotConfiguredError"
  }
}

export class ThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} not found in workspace`)
    this.name = "ThreadNotFoundError"
  }
}

export class EmptyThreadError extends Error {
  constructor() {
    super("Cannot analyze an empty thread (no messages)")
    this.name = "EmptyThreadError"
  }
}

interface StartArgs {
  workspaceId: string
  threadId: string
}

export async function startThreadAnalysis(
  args: StartArgs
): Promise<ThreadEnrichmentRow> {
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

  const enrichmentId = `enr-${randomUUID()}`
  const row = await createEnrichmentRunning({
    id: enrichmentId,
    workspaceId: args.workspaceId,
    threadId: args.threadId,
    contractVersion: CONTRACT_VERSION,
  })

  // Fire-and-forget the actual LLM work. We capture errors inside so
  // the unhandled-rejection floor doesn't catch them; the row itself
  // records terminal state for the GET poller. This works in
  // long-running Next.js processes (next dev / next start). In a
  // serverless deployment we'd switch this to a real queue.
  void runAnalysis({
    enrichmentId,
    workspaceId: args.workspaceId,
    thread,
    messages,
  }).catch((error) => {
    // Last-ditch logger: should be unreachable since runAnalysis
    // catches its own errors and writes them to the row.
    console.error("[wayseer] runAnalysis escaped error", error)
  })

  return row
}

interface RunArgs {
  enrichmentId: string
  workspaceId: string
  thread: Awaited<ReturnType<typeof getThreadById>>
  messages: Awaited<ReturnType<typeof getThreadMessages>>
}

async function runAnalysis(args: RunArgs): Promise<void> {
  if (!args.thread) {
    await failEnrichment(args.enrichmentId, "Thread vanished before run started")
    return
  }
  try {
    const { systemPrompt, userPrompt } = buildThreadAnalysisPrompt({
      thread: args.thread,
      messages: args.messages,
    })

    const result = await callContract({ systemPrompt, userPrompt })
    const analysis = parseThreadAnalysisResponse(result.content)

    await completeEnrichment({
      id: args.enrichmentId,
      resultPayload: analysis,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: result.latencyMs,
    })
  } catch (error) {
    const message =
      error instanceof WayseerLlmError
        ? `LLM error: ${error.message}`
        : error instanceof Error
        ? error.message
        : String(error)
    await failEnrichment(args.enrichmentId, message)
  }
}

/**
 * Convenience read for the GET endpoint and Phase 4 sidebar enrichment
 * — re-exported so route handlers don't pull in queries.ts directly.
 */
export { getLatestEnrichmentForThread } from "./queries"
