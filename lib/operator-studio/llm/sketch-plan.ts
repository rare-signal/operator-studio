/**
 * LLM-assisted plan sketch.
 *
 * Given the user's freeform composer text (and optional title), asks an
 * OpenAI-compatible /v1/chat/completions endpoint to extract a structured
 * plan: refined title, goal, outcome, and 3–7 suggested steps. Returns
 * `null` when no LLM endpoint is configured or the call fails — caller
 * is expected to surface that to the UI as "echo mode" so the user can
 * still type the plan manually.
 *
 * Mirrors the pattern in importers/generate-tags.ts.
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
const TIMEOUT_MS = 20_000

export interface SketchSuggestion {
  title: string
  goal: string
  outcome: string
  steps: Array<{ title: string; description?: string }>
}

const SYSTEM_PROMPT = `You are a planning assistant for a tool that helps engineers steer their AI assistants toward concrete deliverables.

The user has typed a freeform description of what they're trying to get done. Extract:
- title: short imperative phrase, ≤ 8 words, no trailing period.
- goal: one measurable sentence with a yes/no answer (e.g., "Ship the public repo with README by Friday").
- outcome: 1–2 sentences describing the world when done. Concrete, observable.
- steps: 3 to 7 short imperative phrases for the milestones along the way. Each step optionally has a one-sentence description.

Respond with ONLY strict JSON, no prose, no code fence, in this exact shape:
{"title":"...","goal":"...","outcome":"...","steps":[{"title":"...","description":"..."},...]}

If the user's text is too short to plan from, return:
{"title":"","goal":"","outcome":"","steps":[]}`

function tryParse(raw: string): SketchSuggestion | null {
  // Strip code fences if the model added them anyway.
  const cleaned = raw
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .trim()
  if (!cleaned) return null
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const title = typeof parsed.title === "string" ? parsed.title.trim() : ""
    const goal = typeof parsed.goal === "string" ? parsed.goal.trim() : ""
    const outcome = typeof parsed.outcome === "string" ? parsed.outcome.trim() : ""
    const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : []
    const steps: Array<{ title: string; description?: string }> = []
    for (const s of stepsRaw) {
      if (!s || typeof s !== "object") continue
      const obj = s as Record<string, unknown>
      const t = typeof obj.title === "string" ? obj.title.trim() : ""
      if (!t) continue
      const d =
        typeof obj.description === "string" && obj.description.trim()
          ? obj.description.trim()
          : undefined
      steps.push(d ? { title: t, description: d } : { title: t })
      if (steps.length >= 8) break
    }
    return { title, goal, outcome, steps }
  } catch {
    return null
  }
}

export async function sketchPlanFromComposer(
  composer: string,
  hint?: { title?: string }
): Promise<SketchSuggestion | null> {
  const text = composer.trim()
  if (text.length < 10) return null

  const endpoints = getEndpoints()
  if (endpoints.length === 0) return null

  const userMessage = hint?.title?.trim()
    ? `Working title: ${hint.title.trim()}\n\nDescription:\n${text}`
    : text

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
            { role: "user", content: userMessage },
          ],
          max_tokens: 800,
          temperature: 0.3,
          response_format: { type: "json_object" },
        }),
      })

      clearTimeout(timer)

      if (!res.ok) continue

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const raw = data.choices?.[0]?.message?.content?.trim() ?? ""
      const parsed = tryParse(raw)
      if (parsed) return parsed
    } catch {
      // try next endpoint
    }
  }

  return null
}
