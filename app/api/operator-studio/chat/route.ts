import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  appendChatMessage,
  createChatSession,
  getChatMessages,
  getChatSessionById,
  getThreadById,
  getThreadMessages,
  getThreadSummaries,
  updateChatSessionContextSnapshot,
} from "@/lib/operator-studio/queries"
import { CONTINUATION_PERSONAS } from "@/lib/operator-studio/types"
import {
  buildGroundingContext,
  getContinuationContextBudgetTokens,
  sanitizeContextMessages,
  selectRecentHistoryMessages,
  type ContinuationContextMessage,
} from "@/lib/operator-studio/continuation-context"

/**
 * Grounded continuation chat endpoint — two request modes.
 *
 * 1. Non-streaming (default): POST /api/operator-studio/chat
 *    Buffers the full LLM completion and returns a single JSON body
 *    shaped { sessionId, message }. Preserved for back-compat.
 *
 * 2. Streaming: POST /api/operator-studio/chat?stream=1 (or
 *    `Accept: text/event-stream` header)
 *    Returns a text/event-stream response. Frames emitted:
 *      - event: start  data: { sessionId, contextSnapshot }
 *      - event: delta  data: { content }   (zero or more)
 *      - event: done   data: { message }   (final — DB-saved assistant row)
 *      - event: error  data: { error }     (on failure; still followed by done)
 *
 * Both paths run the same grounding logic: workspace resolution, history
 * selection, context snapshot, persona selection, user-message append, and
 * context snapshot update. If WORKBOOK_CLUSTER_ENDPOINTS is unset the
 * endpoint emits the echo-mode fallback response — in streaming mode that
 * comes through as a single start → done pair without delta frames.
 */

export const dynamic = "force-dynamic"

function getEndpoints(): string[] {
  const raw =
    process.env.WORKBOOK_CLUSTER_ENDPOINTS ||
    process.env.WORKBOOK_BALANCED_ENDPOINTS ||
    ""
  return raw
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean)
}

const ENGINE_MODEL =
  process.env.WORKBOOK_CLUSTER_MODEL ?? "gpt-3.5-turbo"

function getTimeoutMs(): number {
  const v = Number(process.env.WORKBOOK_CLUSTER_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 60_000
}

const postSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  threadId: z.string().trim().min(1).nullish(),
  message: z.string().min(1).max(1_000_000),
  operatorName: z.string().trim().min(1).max(128).optional(),
  personaId: z.string().trim().min(1).max(64).optional(),
  pathMessages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
        createdAt: z.string().optional(),
      })
    )
    .optional(),
  targetBranchId: z.string().trim().min(1).nullish(),
})

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const sessionId = new URL(req.url).searchParams.get("sessionId")
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 })
  }

  const session = await getChatSessionById(workspaceId, sessionId)
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const messages = await getChatMessages(workspaceId, sessionId)
  return NextResponse.json({ session, messages })
}

interface PreparedContext {
  activeSessionId: string
  systemPrompt: string
  chatHistory: Array<{ role: string; content: string }>
  contextSnapshot: Record<string, unknown>
  echoFallback: string
}

async function prepareGroundedContext(
  req: NextRequest
): Promise<
  | { ok: true; prepared: PreparedContext }
  | { ok: false; status: number; error: string; issues?: unknown }
> {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return { ok: false, status: 401, error: auth.reason }
  }
  const workspaceId = await getActiveWorkspaceId()
  const raw = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid body",
      issues: parsed.error.issues,
    }
  }
  const body = parsed.data
  const operatorName =
    body.operatorName?.trim() || (await getDisplayName()) || "operator"

  let activeSessionId = body.sessionId
  if (!activeSessionId) {
    const newSession = await createChatSession({
      id: `session-${randomUUID()}`,
      workspaceId,
      threadId: body.threadId ?? null,
      sessionTitle: body.message.slice(0, 80),
      operatorName,
      contextSnapshotJson: null,
    })
    activeSessionId = newSession.id
  }

  const normalizedPathMessages = sanitizeContextMessages(body.pathMessages)
  const fallbackSessionMessages =
    normalizedPathMessages.length === 0
      ? await getChatMessages(workspaceId, activeSessionId)
      : []
  const historySource: ContinuationContextMessage[] =
    normalizedPathMessages.length > 0
      ? normalizedPathMessages
      : fallbackSessionMessages.map((chatMessage) => ({
          role: chatMessage.role,
          content: chatMessage.content,
          createdAt: chatMessage.createdAt,
        }))

  const contextBudgetTokens = getContinuationContextBudgetTokens()
  const historyBudgetTokens = Math.max(contextBudgetTokens - 20_000, 0)
  const historySelection = selectRecentHistoryMessages(
    historySource,
    historyBudgetTokens
  )

  let contextParts: string[] = []
  let contextSnapshot: Record<string, unknown> | null = null

  if (body.threadId) {
    const activeThread = await getThreadById(workspaceId, body.threadId)
    if (activeThread) {
      const sourceThread = activeThread.parentThreadId
        ? (await getThreadById(workspaceId, activeThread.parentThreadId)) ??
          activeThread
        : activeThread
      const [sourceMessages, sourceSummaries] = await Promise.all([
        getThreadMessages(workspaceId, sourceThread.id),
        getThreadSummaries(workspaceId, sourceThread.id),
      ])
      const grounding = buildGroundingContext({
        activeThread,
        sourceThread,
        sourceMessages,
        sourceSummaries,
        budgetTokens: Math.max(
          contextBudgetTokens - Math.ceil(historySelection.usedChars / 4),
          0
        ),
        historySelection,
        activeBranchId:
          typeof body.targetBranchId === "string" ? body.targetBranchId : null,
      })
      contextParts = grounding.contextParts
      contextSnapshot = {
        ...grounding.snapshot,
        budgetTokens: contextBudgetTokens,
        budgetChars: contextBudgetTokens * 4,
      } as Record<string, unknown>
    }
  }

  if (!contextSnapshot) {
    contextSnapshot = {
      budgetTokens: contextBudgetTokens,
      budgetChars: contextBudgetTokens * 4,
      usedTokens: Math.ceil(historySelection.usedChars / 4),
      usedChars: historySelection.usedChars,
      activeThreadId: body.threadId ?? null,
      activeThreadTitle: null,
      sourceThreadId: body.threadId ?? null,
      sourceThreadTitle: null,
      usedParentThread: false,
      activeBranchId:
        typeof body.targetBranchId === "string" ? body.targetBranchId : null,
      pathHistory: {
        totalMessages:
          historySelection.messages.length + historySelection.omittedCount,
        includedMessages: historySelection.messages.length,
        omittedMessages: historySelection.omittedCount,
        approxTokens: Math.ceil(historySelection.usedChars / 4),
      },
      grounding: {
        sectionCount: 0,
        approxTokens: 0,
      },
      sections: [],
    }
  }

  await updateChatSessionContextSnapshot(
    workspaceId,
    activeSessionId,
    contextSnapshot
  )

  await appendChatMessage({
    id: `cmsg-${randomUUID()}`,
    workspaceId,
    sessionId: activeSessionId,
    role: "user",
    content: body.message,
    contextSnapshotJson: contextSnapshot,
  })

  const chatHistory = [
    ...historySelection.messages.map((historyMessage) => ({
      role: historyMessage.role,
      content: historyMessage.content,
    })),
    {
      role: "user" as const,
      content: body.message,
    },
  ]

  const persona = body.personaId
    ? CONTINUATION_PERSONAS.find((p) => p.id === body.personaId)
    : CONTINUATION_PERSONAS[0]

  const systemPrompt = buildSystemPrompt(contextParts, persona?.systemPromptSuffix)

  const echoFallback = `[Engine unavailable — echo mode]\n\nI received your message: "${body.message}"\n\nThe continuation engine is not currently reachable. Set WORKBOOK_CLUSTER_ENDPOINTS to one or more OpenAI-compatible chat endpoints (llama.cpp, vLLM, Ollama, LM Studio, or a cloud provider) to enable real responses.`

  return {
    ok: true,
    prepared: {
      activeSessionId,
      systemPrompt,
      chatHistory,
      contextSnapshot,
      echoFallback,
    },
  }
}

function isStreamingRequested(req: NextRequest): boolean {
  const url = new URL(req.url)
  if (url.searchParams.get("stream") === "1") return true
  const accept = req.headers.get("accept") || ""
  return accept.includes("text/event-stream")
}

export async function POST(req: NextRequest) {
  if (isStreamingRequested(req)) {
    return handleStreamingPOST(req)
  }
  return handleJsonPOST(req)
}

async function handleJsonPOST(req: NextRequest) {
  const prep = await prepareGroundedContext(req)
  if (!prep.ok) {
    return NextResponse.json(
      prep.issues !== undefined
        ? { error: prep.error, issues: prep.issues }
        : { error: prep.error },
      { status: prep.status }
    )
  }
  const { activeSessionId, systemPrompt, chatHistory, contextSnapshot, echoFallback } =
    prep.prepared
  const workspaceId = await getActiveWorkspaceId()

  let assistantContent: string
  try {
    assistantContent = await callEngine(systemPrompt, chatHistory)
  } catch {
    assistantContent = echoFallback
  }

  const assistantMsg = await appendChatMessage({
    id: `cmsg-${randomUUID()}`,
    workspaceId,
    sessionId: activeSessionId,
    role: "assistant",
    content: assistantContent,
    modelLabel: ENGINE_MODEL,
    contextSnapshotJson: contextSnapshot,
  })

  return NextResponse.json({
    sessionId: activeSessionId,
    message: assistantMsg,
  })
}

async function handleStreamingPOST(req: NextRequest) {
  const prep = await prepareGroundedContext(req)
  if (!prep.ok) {
    return NextResponse.json(
      prep.issues !== undefined
        ? { error: prep.error, issues: prep.issues }
        : { error: prep.error },
      { status: prep.status }
    )
  }
  const { activeSessionId, systemPrompt, chatHistory, contextSnapshot, echoFallback } =
    prep.prepared
  const workspaceId = await getActiveWorkspaceId()

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          )
        } catch {
          // controller may be closed if the client aborted
        }
      }

      // Frame 1: start
      send("start", {
        sessionId: activeSessionId,
        contextSnapshot,
      })

      let assistantContent = ""
      let errored = false

      const endpoints = getEndpoints()
      if (endpoints.length === 0) {
        // Echo-mode fallback: single start → done pair, no deltas.
        assistantContent = echoFallback
      } else {
        try {
          for await (const delta of callEngineStreaming(systemPrompt, chatHistory)) {
            if (!delta) continue
            assistantContent += delta
            send("delta", { content: delta })
          }
          if (!assistantContent.trim()) {
            throw new Error("Response was empty.")
          }
        } catch (error) {
          errored = true
          const message =
            error instanceof Error ? error.message : String(error)
          send("error", { error: message })
          // Fall back to echo-mode body so the thread still moves forward.
          assistantContent = echoFallback
        }
      }

      // Persist final assistant message BEFORE emitting done so id is real.
      let assistantMsg
      try {
        assistantMsg = await appendChatMessage({
          id: `cmsg-${randomUUID()}`,
          workspaceId,
          sessionId: activeSessionId,
          role: "assistant",
          content: assistantContent,
          modelLabel: ENGINE_MODEL,
          contextSnapshotJson: contextSnapshot,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        send("error", { error: `Failed to persist assistant message: ${message}` })
        errored = true
      }

      send("done", {
        message: assistantMsg,
        errored,
      })

      try {
        controller.close()
      } catch {
        // already closed
      }
    },
    cancel() {
      // Client aborted — nothing else to clean up for now (the upstream
      // fetch is bounded by AbortSignal.timeout inside callEngineStreaming).
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

function buildSystemPrompt(
  contextParts: string[],
  personaSuffix?: string
): string {
  const grounding =
    contextParts.length > 0
      ? `\n\n---\n\n# Grounding Context\n\nYou have access to grounded operator memory from the active thread and, when applicable, its source thread. Use it to ground your responses. Do not invent facts beyond what is provided.\n\n${contextParts.join("\n\n---\n\n")}`
      : ""

  const personaBlock = personaSuffix
    ? `\n\n## Persona Directive\n${personaSuffix}`
    : ""

  return `You are a continuation assistant inside Operator Studio, an open-source workspace for reviewing and continuing agent coding sessions.

Your role:
- Help operators continue work from previously imported and promoted conversation threads
- Prioritize fidelity to the provided context
- Treat the most recent continuation-path messages as the strongest signal of what the current branch is about
- If a fork has drifted from the original title or first turns, prefer the recent branch path over the old title
- Do not invent facts that aren't grounded in the memory
- Preserve operator intent and context
- Be concise and actionable
- If you don't know something from the context, say so

You are NOT the original model that produced the source conversation. You are a grounded continuation assistant helping the team pick up where prior work left off.${personaBlock}${grounding}`
}

async function callEngine(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>
): Promise<string> {
  const endpoints = getEndpoints()
  if (endpoints.length === 0) throw new Error("No engine endpoints configured")

  const messages = [{ role: "system", content: systemPrompt }, ...history]

  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(
        `${endpoint.replace(/\/$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ENGINE_MODEL,
            messages,
            max_tokens: 2048,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(getTimeoutMs()),
        }
      )

      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(`${res.status}: ${errBody.slice(0, 320)}`)
      }

      const data = await res.json()
      const content = extractTextContent(data.choices?.[0]?.message?.content)
      if (!content) throw new Error("Response was empty.")
      return content
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError ?? new Error("All engine endpoints failed")
}

/**
 * Streaming variant of callEngine. POSTs to the same OpenAI-compatible
 * /v1/chat/completions endpoint with `stream: true` and yields text deltas
 * from `choices[0].delta.content` as they arrive. Tries endpoints in order
 * and falls back to the next one on connection errors *before* the first
 * delta is received. If no endpoints are configured this throws — callers
 * should check for empty endpoint lists themselves and take the echo path.
 */
async function* callEngineStreaming(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>
): AsyncGenerator<string, void, void> {
  const endpoints = getEndpoints()
  if (endpoints.length === 0) throw new Error("No engine endpoints configured")

  const messages = [{ role: "system", content: systemPrompt }, ...history]

  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(
        `${endpoint.replace(/\/$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model: ENGINE_MODEL,
            messages,
            max_tokens: 2048,
            temperature: 0.7,
            stream: true,
          }),
          signal: AbortSignal.timeout(getTimeoutMs()),
        }
      )

      if (!res.ok || !res.body) {
        const errBody = res.body ? await res.text() : ""
        throw new Error(`${res.status}: ${errBody.slice(0, 320)}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // SSE frames are separated by blank lines. Split by \n\n.
          let idx: number
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const rawFrame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)

            // A frame may have multiple `data:` lines; concat them.
            const dataLines = rawFrame
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())

            if (dataLines.length === 0) continue
            const payload = dataLines.join("\n")
            if (payload === "[DONE]") {
              return
            }
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: unknown } }>
              }
              const delta = parsed.choices?.[0]?.delta?.content
              const text = extractTextContent(delta)
              if (text) {
                yield text
              }
            } catch {
              // Ignore malformed frames; some servers emit keep-alives.
            }
          }
        }
      } finally {
        try {
          reader.releaseLock()
        } catch {
          // already released
        }
      }

      // If we got here without a [DONE] marker, assume the stream ended
      // cleanly — nothing else to yield.
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      // Try the next endpoint.
    }
  }

  throw lastError ?? new Error("All engine endpoints failed")
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof item.text === "string"
        )
          return item.text
        return ""
      })
      .join("")
      .trim()
  }
  return ""
}
