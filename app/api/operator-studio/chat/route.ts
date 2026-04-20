import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"

import { isAuthenticated, getDisplayName } from "@/lib/operator-studio/auth"
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
 * Grounded continuation chat endpoint.
 *
 * Routes a grounded prompt (active thread context + optional source thread
 * context + recent history) through an OpenAI-compatible chat/completions
 * endpoint. If no endpoint is configured the endpoint echoes the user message
 * so the UI still functions during local dev.
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
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const raw = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
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
  let assistantContent: string

  try {
    assistantContent = await callEngine(systemPrompt, chatHistory)
  } catch {
    assistantContent = `[Engine unavailable — echo mode]\n\nI received your message: "${body.message}"\n\nThe continuation engine is not currently reachable. Set WORKBOOK_CLUSTER_ENDPOINTS to one or more OpenAI-compatible chat endpoints (llama.cpp, vLLM, Ollama, LM Studio, or a cloud provider) to enable real responses.`
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
