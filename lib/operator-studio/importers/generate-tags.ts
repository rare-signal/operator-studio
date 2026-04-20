/**
 * LLM-powered tag generation for imported threads.
 *
 * Routes the opening messages of a conversation through an OpenAI-compatible
 * /v1/chat/completions endpoint to produce 2–5 short lowercase tags capturing
 * the dominant technical topics. Returns `[]` when no endpoint is configured
 * or the request fails so the caller can fall back gracefully.
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

const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/**
 * Clean a raw LLM response line into a sanitized, deduped tag list.
 *
 * Rules:
 *   - split on comma
 *   - trim + lowercase
 *   - drop empty, >40 chars, whitespace inside, or not matching [a-z0-9][a-z0-9-]*
 *   - dedupe
 *   - cap at 5
 *
 * Exported for unit testing.
 */
export function parseTagResponse(raw: string): string[] {
  if (!raw) return []
  // The model sometimes wraps the line in code fences, quotes, or leading
  // "tags:" labels — strip that before splitting.
  const cleaned = raw
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*tags?\s*[:\-]\s*/i, "")
    .trim()

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of cleaned.split(",")) {
    const tag = part.trim().toLowerCase()
    if (!tag) continue
    if (tag.length > 40) continue
    if (/\s/.test(tag)) continue
    if (!TAG_PATTERN.test(tag)) continue
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 5) break
  }
  return out
}

/**
 * Derive 2–5 lowercase tags for an imported session.
 *
 * Returns `[]` when the LLM cluster is unreachable or the response is empty
 * so the ingest path can continue normally.
 */
export async function deriveTags(messages: Message[]): Promise<string[]> {
  const sample = messages.slice(0, 6)
  if (sample.length === 0) return []

  const endpoints = getEndpoints()
  if (endpoints.length === 0) return []

  const transcript = sample
    .map((m) => `[${m.role}]: ${m.content.slice(0, 400)}`)
    .join("\n\n")

  const systemPrompt = [
    "You are a conversation tagger.",
    "Given these opening messages of a coding conversation, output 2–5 short lowercase tags (single words or hyphenated, no spaces inside a tag) that capture the dominant technical topics.",
    "Output only the tags on one line, comma-separated. No explanation.",
    "Example: nextjs,app-router,caching",
  ].join("\n")

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
          max_tokens: 60,
          temperature: 0.2,
        }),
      })

      clearTimeout(timer)

      if (!res.ok) continue

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const raw = data.choices?.[0]?.message?.content?.trim() ?? ""
      const tags = parseTagResponse(raw)
      if (tags.length > 0) return tags
    } catch {
      // try next endpoint
    }
  }

  return []
}
