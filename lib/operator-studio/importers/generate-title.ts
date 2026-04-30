/**
 * LLM-powered title generation for imported threads.
 *
 * Routes the opening messages of a conversation through an OpenAI-compatible
 * /v1/chat/completions endpoint to produce a short, descriptive title.
 * Falls back to first-user-message truncation when no endpoint is configured
 * or the request fails.
 */

function getEndpoints(): string[] {
  const raw =
    process.env.WORKBOOK_CLUSTER_ENDPOINTS ||
    process.env.WORKBOOK_FAST_ENDPOINTS ||
    ""
  return raw
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean)
}

const MODEL = process.env.WORKBOOK_CLUSTER_MODEL ?? "gpt-3.5-turbo"
const TIMEOUT_MS = 15_000 // aggressive — title gen should be fast

interface Message {
  role: string
  content: string
}

/**
 * Generate a short conversational title from the opening messages.
 *
 * Returns `null` if the LLM cluster is unreachable so the caller can fall
 * back to the legacy first-message heuristic.
 */
export async function generateTitle(
  messages: Message[]
): Promise<string | null> {
  // Take the first 4 messages (or fewer) to give the model enough context
  const sample = messages.slice(0, 4)
  if (sample.length === 0) return null

  const transcript = sample
    .map((m) => `[${m.role}]: ${m.content.slice(0, 300)}`)
    .join("\n\n")

  const systemPrompt = [
    "You are a conversation title generator.",
    "Given the opening messages of a coding/work conversation, generate a short, lowercase title (3-8 words) that captures the topic.",
    "Rules:",
    "- Output ONLY the title text, nothing else",
    "- No quotes, no punctuation at the end, no explanation",
    "- Lowercase, like a chat title (e.g. 'fix sidebar layout bug' or 'add economics asset pipeline')",
    "- Focus on what the conversation is about, not what the user literally said",
  ].join("\n")

  const endpoints = getEndpoints()

  // Try each endpoint until one responds
  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint.replace(/\/$/, "")}/v1/chat/completions`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcript },
          ],
          max_tokens: 40,
          temperature: 0.3,
        }),
      })

      clearTimeout(timer)

      if (!res.ok) continue

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const raw = data.choices?.[0]?.message?.content?.trim()

      if (raw && raw.length > 0 && raw.length < 150) {
        // Clean up: strip quotes, trailing period
        return raw
          .replace(/^["']|["']$/g, "")
          .replace(/\.+$/, "")
          .trim()
      }
    } catch {
      // try next endpoint
    }
  }

  return null
}

/**
 * Derive a title for an imported session.
 *
 * Tries the LLM cluster first. Falls back to the first user message
 * truncated to 120 characters (the legacy behavior).
 */
export async function deriveTitle(messages: Message[]): Promise<string> {
  // Try LLM-generated title
  const generated = await generateTitle(messages)
  if (generated) return generated

  // Fallback: first user message, truncated
  const firstUser = messages.find(
    (m) => m.role === "user" || m.role === "human"
  )
  return firstUser
    ? firstUser.content.slice(0, 120).replace(/\n/g, " ")
    : "Untitled conversation"
}
