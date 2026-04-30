import "server-only"

/**
 * Minimal OpenAI-compatible chat-completions client for Wayseer
 * contracts. Mirrors the endpoint discovery and timeout logic in
 * app/api/operator-studio/chat/route.ts so both code paths read the
 * same env vars and behave the same way against local engines
 * (llama.cpp, vLLM, Ollama, LM Studio) and cloud providers.
 *
 * We deliberately keep this small and synchronous-shaped — no
 * streaming, no SDKs — because Wayseer contract calls are short and
 * structured. Streaming would only obscure the JSON validation step.
 */

export interface LlmCallResult {
  content: string
  promptTokens: number | null
  completionTokens: number | null
  endpoint: string
  latencyMs: number
}

export interface LlmCallOptions {
  systemPrompt: string
  userPrompt: string
  /** Defaults to 0 for contract calls — we want deterministic
   *  structured output, not creative continuation. */
  temperature?: number
  /** Defaults to 2048. Bump for contracts that produce long timelines. */
  maxTokens?: number
}

export class WayseerLlmError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "WayseerLlmError"
  }
}

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

function getModel(): string {
  return process.env.WORKBOOK_CLUSTER_MODEL ?? "gpt-3.5-turbo"
}

function getTimeoutMs(): number {
  const v = Number(process.env.WORKBOOK_CLUSTER_TIMEOUT_MS)
  // Contract calls do more work than a chat turn; be slightly more generous.
  return Number.isFinite(v) && v > 0 ? v : 90_000
}

export function isLlmConfigured(): boolean {
  return getEndpoints().length > 0
}

export async function callContract(
  options: LlmCallOptions
): Promise<LlmCallResult> {
  const endpoints = getEndpoints()
  if (endpoints.length === 0) {
    throw new WayseerLlmError(
      "No LLM endpoints configured. Set WORKBOOK_CLUSTER_ENDPOINTS in .env.local."
    )
  }

  const model = getModel()
  const messages = [
    { role: "system", content: options.systemPrompt },
    { role: "user", content: options.userPrompt },
  ]

  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    const startedAt = Date.now()
    try {
      const res = await fetch(
        `${endpoint.replace(/\/$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: options.maxTokens ?? 2048,
            temperature: options.temperature ?? 0,
          }),
          signal: AbortSignal.timeout(getTimeoutMs()),
        }
      )

      if (!res.ok) {
        const errBody = await res.text()
        throw new WayseerLlmError(
          `Engine ${endpoint} returned ${res.status}: ${errBody.slice(0, 320)}`
        )
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
        }
      }

      const content = extractText(data.choices?.[0]?.message?.content)
      if (!content) {
        throw new WayseerLlmError(`Engine ${endpoint} returned empty content`)
      }

      return {
        content,
        promptTokens: data.usage?.prompt_tokens ?? null,
        completionTokens: data.usage?.completion_tokens ?? null,
        endpoint,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error))
      // Try the next endpoint.
    }
  }

  throw new WayseerLlmError(
    `All ${endpoints.length} endpoint(s) failed`,
    lastError
  )
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item
        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof (item as { text: unknown }).text === "string"
        ) {
          return (item as { text: string }).text
        }
        return ""
      })
      .join("")
      .trim()
  }
  return ""
}
