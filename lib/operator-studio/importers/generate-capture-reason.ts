/**
 * LLM-generated capture rationale for imported threads.
 *
 * Produces a short 1–2 sentence answer to "why is this thread worth
 * capturing?" — distinct from the promotion-time `whyItMatters` strategic
 * note. The capture reason is attached at ingest so every thread in the
 * dashboard shows a glanceable "what's the value here" line, even before
 * a human has reviewed it.
 *
 * Uses the same OpenAI-compatible endpoint as title / tag generation.
 * Returns `null` when no endpoint is configured or the call fails — ingest
 * continues normally without a reason.
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
const TIMEOUT_MS = 15_000

interface Message {
  role: string
  content: string
}

const SYSTEM_PROMPT = [
  "You are writing a 1-2 sentence rationale for why a conversation is worth capturing in a knowledge workspace.",
  "Given the opening messages of a coding / technical conversation, write a concise, specific note explaining what makes it valuable to keep.",
  "Rules:",
  "- Output ONE paragraph of 1-2 plain sentences. No markdown, no lists, no preamble.",
  "- Focus on the SUBSTANCE: what topic, what debugging insight, what decision, what reusable pattern.",
  "- Avoid generic filler like 'helpful for future reference' or 'discusses various topics'.",
  "- Under 200 characters total.",
  "- Write as a reviewer justifying the capture to a teammate, not as a summary of content.",
  "Examples:",
  "- 'Trace-through of why router.refresh() skips cached fetches in parent layouts — ends with the revalidatePath fix.'",
  "- 'Decision log: picked Drizzle over Prisma for the migration story; covers the three main tradeoffs.'",
  "- 'Postgres soft-delete trigger pattern — the final SQL reference implementation is embedded.'",
].join("\n")

/**
 * Derive a short capture rationale from the opening messages of a thread.
 *
 * Returns `null` if the LLM cluster is unreachable or returns an unusable
 * response. Callers treat `null` as "don't display" rather than surfacing
 * an error — capture reason is a nice-to-have, not a blocker.
 */
export async function deriveCaptureReason(
  messages: Message[]
): Promise<string | null> {
  const sample = messages.slice(0, 6)
  if (sample.length === 0) return null

  const transcript = sample
    .map((m) => `[${m.role}]: ${m.content.slice(0, 400)}`)
    .join("\n\n")

  const endpoints = getEndpoints()
  if (endpoints.length === 0) return null

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
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: transcript },
          ],
          max_tokens: 120,
          temperature: 0.4,
        }),
      })

      clearTimeout(timer)
      if (!res.ok) continue

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const raw = data.choices?.[0]?.message?.content?.trim()
      const cleaned = sanitizeReason(raw)
      if (cleaned) return cleaned
    } catch {
      // try the next endpoint
    }
  }

  return null
}

function sanitizeReason(raw: string | undefined): string | null {
  if (!raw) return null

  let s = raw.trim()
  // Strip leading quotes and markdown fences some models emit.
  s = s.replace(/^["'`]+|["'`]+$/g, "")
  s = s.replace(/^\s*(reason|rationale|why)[:\s-]+/i, "")
  // Collapse newlines to single spaces.
  s = s.replace(/\s*\n+\s*/g, " ").trim()
  // Enforce length cap — aggressive truncation to keep UI tidy.
  if (s.length > 260) s = s.slice(0, 257).trimEnd() + "…"
  if (s.length < 8) return null
  return s
}
