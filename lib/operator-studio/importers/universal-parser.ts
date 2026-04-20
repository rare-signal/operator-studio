/**
 * Universal conversation parser.
 *
 * Accepts literally anything a human or script might send us — structured
 * JSON from Gemini / OpenAI / Claude / our own shape, plain-text transcripts
 * with labeled turns, markdown-heading-split conversations, or unlabeled
 * blobs — and produces a normalized `{role, content, timestamp?}[]`.
 *
 * The contract is "never reject." If we cannot identify turns, we ingest the
 * input as a single user message so the operator can still review, promote,
 * and continue from it. The detected format is reported back so the UI and
 * API responses can show what happened.
 */

export type NormalizedRole = "user" | "assistant" | "system"

export interface NormalizedMessage {
  role: NormalizedRole
  content: string
  timestamp?: string
}

export type DetectedFormat =
  | "openai-chat"
  | "anthropic-messages"
  | "gemini-generate"
  | "gemini-conversation"
  | "chatgpt-share"
  | "operator-studio-native"
  | "messages-array"
  | "role-content-array"
  | "jsonl-messages"
  | "labeled-transcript"
  | "markdown-heading-split"
  | "raw-blob"

export interface ParsedConversation {
  messages: NormalizedMessage[]
  detectedFormat: DetectedFormat
  title?: string
  // Free-form diagnostic notes (e.g. "5 turns detected via User:/Assistant: labels")
  notes: string[]
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function parseUniversal(input: unknown): ParsedConversation {
  // Pass-through for already-parsed objects.
  if (input !== null && typeof input === "object") {
    return detectStructured(input as Record<string, unknown> | unknown[])
  }

  const text = typeof input === "string" ? input : String(input ?? "")
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return {
      messages: [],
      detectedFormat: "raw-blob",
      notes: ["empty input"],
    }
  }

  // Try JSON first — if it parses and looks conversational, detect its shape.
  const asJson = tryParseJson(trimmed)
  if (asJson !== undefined) {
    const structured = detectStructured(asJson as Record<string, unknown> | unknown[])
    if (structured.messages.length > 0) return structured
    // JSON parsed but didn't produce turns; fall through to text parsers.
  }

  // JSONL — one JSON object per line.
  if (looksLikeJsonl(trimmed)) {
    const jsonl = parseJsonl(trimmed)
    if (jsonl.messages.length > 0) return jsonl
  }

  // Labeled transcript ("User: ...\n\nAssistant: ...").
  const labeled = parseLabeledTranscript(trimmed)
  if (labeled.messages.length >= 2) return labeled

  // Markdown conversations often use # / ## headings for turns.
  const md = parseMarkdownHeadings(trimmed)
  if (md.messages.length >= 2) return md

  // Last resort — ingest the whole blob as one user message.
  return {
    messages: [{ role: "user", content: trimmed }],
    detectedFormat: "raw-blob",
    notes: [
      "No structure detected; ingested as a single user message. Add explicit role labels (User:, Assistant:) or JSON to split turns.",
    ],
  }
}

// ─── Structured detection ────────────────────────────────────────────────────

function detectStructured(obj: unknown): ParsedConversation {
  // Top-level array.
  if (Array.isArray(obj)) {
    return fromMessagesArray(obj, "role-content-array")
  }

  const o = obj as Record<string, unknown>

  // OpenAI Chat Completions: a response has `choices`, possibly alongside
  // the original prompt `messages`. Check this first so we don't miss the
  // assistant turn when both arrays are present.
  if (Array.isArray(o.choices) && o.choices.length > 0) {
    return fromOpenAIChoices(o)
  }

  // Our native shape: { title?, messages: [{role, content, timestamp?}] }.
  if (Array.isArray(o.messages) && looksLikeMessages(o.messages)) {
    return {
      ...fromMessagesArray(o.messages, "operator-studio-native"),
      title: typeof o.title === "string" ? o.title : undefined,
    }
  }

  // Anthropic Messages API: { messages: [{role, content: string | content-block[]}] }.
  // (Already partially covered by operator-studio-native if simple strings.)
  if (
    Array.isArray(o.messages) &&
    (o.messages as unknown[]).some(
      (m) => m && typeof m === "object" && Array.isArray((m as { content?: unknown }).content)
    )
  ) {
    return fromAnthropicMessages(o.messages as unknown[])
  }

  // Gemini single generateContent response: { candidates: [{content: {parts, role}}] }.
  if (Array.isArray(o.candidates) && (o.candidates as unknown[]).length > 0) {
    return fromGeminiCandidates(o)
  }

  // Gemini conversational history: { contents: [{role, parts: [{text}]}] }.
  if (Array.isArray(o.contents) && (o.contents as unknown[]).length > 0) {
    return fromGeminiContents(o.contents as unknown[])
  }

  // ChatGPT share export: { title, mapping: { [id]: {message?: {author, content}} } }.
  if (o.mapping && typeof o.mapping === "object" && !Array.isArray(o.mapping)) {
    return fromChatGPTShareMapping(o)
  }

  // `conversation` wrapper common in ad-hoc pastes.
  if (o.conversation && typeof o.conversation === "object") {
    return detectStructured(o.conversation)
  }

  // Nothing matched — ingest the JSON as a single message so the operator
  // can still review.
  return {
    messages: [{ role: "user", content: JSON.stringify(obj, null, 2) }],
    detectedFormat: "raw-blob",
    notes: [
      "JSON parsed but no known conversational shape was found (no `messages`, `choices`, `candidates`, `contents`, or `mapping` keys). Ingested as a single user message.",
    ],
  }
}

function looksLikeMessages(arr: unknown[]): boolean {
  if (arr.length === 0) return false
  const first = arr[0]
  if (!first || typeof first !== "object") return false
  const f = first as Record<string, unknown>
  return "role" in f || "author" in f || "from" in f
}

function fromMessagesArray(
  arr: unknown[],
  format: DetectedFormat
): ParsedConversation {
  const messages: NormalizedMessage[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const rawRole =
      (typeof e.role === "string" && e.role) ||
      (typeof e.author === "string" && e.author) ||
      (typeof e.from === "string" && e.from) ||
      "user"
    const content = extractContent(e.content ?? e.text ?? e.message ?? "")
    if (!content) continue
    messages.push({
      role: normalizeRole(rawRole),
      content,
      timestamp: extractTimestamp(e),
    })
  }
  return {
    messages,
    detectedFormat: format,
    notes: [`parsed ${messages.length} message(s) from array`],
  }
}

function fromOpenAIChoices(o: Record<string, unknown>): ParsedConversation {
  const prompt: NormalizedMessage[] = []
  if (Array.isArray(o.messages)) {
    prompt.push(...fromMessagesArray(o.messages as unknown[], "openai-chat").messages)
  }
  const choices = o.choices as unknown[]
  for (const c of choices) {
    if (!c || typeof c !== "object") continue
    const msg = (c as { message?: Record<string, unknown> }).message
    if (!msg) continue
    const content = extractContent(msg.content ?? "")
    if (!content) continue
    prompt.push({
      role: normalizeRole((msg.role as string) ?? "assistant"),
      content,
    })
  }
  return {
    messages: prompt,
    detectedFormat: "openai-chat",
    notes: [`parsed ${prompt.length} turn(s) from OpenAI-shaped response`],
  }
}

function fromAnthropicMessages(arr: unknown[]): ParsedConversation {
  const messages: NormalizedMessage[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    const role = normalizeRole((e.role as string) ?? "user")
    const content = extractContent(e.content)
    if (!content) continue
    messages.push({ role, content })
  }
  return {
    messages,
    detectedFormat: "anthropic-messages",
    notes: [`parsed ${messages.length} turn(s) from Anthropic messages format`],
  }
}

function fromGeminiCandidates(o: Record<string, unknown>): ParsedConversation {
  // A generateContent response typically includes the user's last turn
  // implicitly and one or more assistant candidates. We only ingest the top
  // candidate's text as an assistant message. If the caller also supplied a
  // `prompt` or `request.contents`, include those.
  const messages: NormalizedMessage[] = []

  // Optional prompt wrapper some integrations add.
  if (Array.isArray(o.prompt)) {
    messages.push(...fromMessagesArray(o.prompt as unknown[], "gemini-generate").messages)
  } else if (
    o.request &&
    typeof o.request === "object" &&
    Array.isArray((o.request as { contents?: unknown }).contents)
  ) {
    const sub = fromGeminiContents(
      (o.request as { contents: unknown[] }).contents
    )
    messages.push(...sub.messages)
  }

  const candidates = o.candidates as unknown[]
  const top = candidates[0]
  if (top && typeof top === "object") {
    const content = (top as { content?: { parts?: unknown[]; role?: string } }).content
    const parts = content?.parts ?? []
    const text = parts
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: string }).text) : ""))
      .join("")
      .trim()
    if (text) {
      messages.push({
        role: normalizeRole(content?.role ?? "model"),
        content: text,
      })
    }
  }
  return {
    messages,
    detectedFormat: "gemini-generate",
    notes: [`parsed ${messages.length} turn(s) from Gemini generateContent response`],
  }
}

function fromGeminiContents(arr: unknown[]): ParsedConversation {
  const messages: NormalizedMessage[] = []
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as { role?: string; parts?: unknown[] }
    const text = (e.parts ?? [])
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: string }).text)
          : ""
      )
      .join("")
      .trim()
    if (!text) continue
    messages.push({
      role: normalizeRole(e.role ?? "user"),
      content: text,
    })
  }
  return {
    messages,
    detectedFormat: "gemini-conversation",
    notes: [`parsed ${messages.length} turn(s) from Gemini contents[] array`],
  }
}

function fromChatGPTShareMapping(o: Record<string, unknown>): ParsedConversation {
  const mapping = o.mapping as Record<string, { message?: Record<string, unknown> }>
  const nodes = Object.values(mapping)
  const messages: NormalizedMessage[] = []
  for (const node of nodes) {
    const m = node.message
    if (!m || typeof m !== "object") continue
    const author =
      (m.author && typeof m.author === "object" && "role" in m.author
        ? String((m.author as { role: string }).role)
        : "user") || "user"
    const content = extractContent((m.content as { parts?: unknown[] })?.parts ?? m.content)
    if (!content) continue
    const createTime =
      typeof m.create_time === "number" ? new Date(m.create_time * 1000).toISOString() : undefined
    messages.push({
      role: normalizeRole(author),
      content,
      timestamp: createTime,
    })
  }
  return {
    messages,
    detectedFormat: "chatgpt-share",
    title: typeof o.title === "string" ? o.title : undefined,
    notes: [`parsed ${messages.length} turn(s) from ChatGPT share mapping`],
  }
}

// ─── Text parsers ────────────────────────────────────────────────────────────

// Label prefixes we recognize on transcript lines. Keep broad — this is where
// humans paste whatever they have.
const LABEL_PATTERNS = [
  { re: /^(user|you|human|me|operator)\b/i, role: "user" as const },
  {
    re: /^(assistant|ai|bot|model|gpt|chatgpt|claude|gemini|copilot|cursor|codex)\b/i,
    role: "assistant" as const,
  },
  { re: /^(system|developer)\b/i, role: "system" as const },
]

function detectLabel(line: string): NormalizedRole | null {
  // Match at start of line, optionally followed by : or - or whitespace then colon.
  const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{0,24})\s*[:>\-—]/)
  if (!match) return null
  const candidate = match[1].trim()
  for (const p of LABEL_PATTERNS) {
    if (p.re.test(candidate)) return p.role
  }
  return null
}

function stripLabel(line: string): string {
  return line.replace(/^\s*[A-Za-z][A-Za-z0-9 _-]{0,24}\s*[:>\-—]\s*/, "")
}

function parseLabeledTranscript(text: string): ParsedConversation {
  const lines = text.split(/\r?\n/)
  const messages: NormalizedMessage[] = []
  let current: { role: NormalizedRole; content: string[] } | null = null
  let hasAnyLabel = false

  for (const line of lines) {
    const role = detectLabel(line)
    if (role) {
      hasAnyLabel = true
      if (current) messages.push({ role: current.role, content: current.content.join("\n").trim() })
      current = { role, content: [stripLabel(line)] }
    } else if (current) {
      current.content.push(line)
    }
    // Lines before the first label get dropped only if we actually found labels —
    // otherwise we fall through to other parsers.
  }
  if (current)
    messages.push({ role: current.role, content: current.content.join("\n").trim() })

  const filtered = messages.filter((m) => m.content.trim().length > 0)

  if (!hasAnyLabel || filtered.length === 0) {
    return { messages: [], detectedFormat: "labeled-transcript", notes: [] }
  }
  return {
    messages: filtered,
    detectedFormat: "labeled-transcript",
    notes: [`detected ${filtered.length} labeled turn(s)`],
  }
}

function parseMarkdownHeadings(text: string): ParsedConversation {
  const lines = text.split(/\r?\n/)
  const messages: NormalizedMessage[] = []
  let current: { role: NormalizedRole; content: string[] } | null = null
  let headingCount = 0

  for (const line of lines) {
    const m = line.match(/^(#{1,4})\s+(.+?)\s*$/)
    if (m) {
      headingCount++
      const heading = m[2].toLowerCase()
      const role = detectLabel(heading) ?? inferRoleFromHeading(heading)
      if (current)
        messages.push({
          role: current.role,
          content: current.content.join("\n").trim(),
        })
      current = { role, content: [] }
    } else if (current) {
      current.content.push(line)
    }
  }
  if (current)
    messages.push({
      role: current.role,
      content: current.content.join("\n").trim(),
    })

  const filtered = messages.filter((m) => m.content.trim().length > 0)
  if (headingCount < 2 || filtered.length < 2) {
    return { messages: [], detectedFormat: "markdown-heading-split", notes: [] }
  }
  return {
    messages: filtered,
    detectedFormat: "markdown-heading-split",
    notes: [`split ${filtered.length} turn(s) on ${headingCount} markdown heading(s)`],
  }
}

function inferRoleFromHeading(heading: string): NormalizedRole {
  // Try the bare-label patterns first (markdown headings like `# User` or
  // `# Assistant` won't hit detectLabel's regex because they have no trailing
  // colon/dash/etc — so we need to recognize them here too).
  const normalized = heading.trim().toLowerCase()
  if (/\b(user|you|human|me|operator|prompt|question|ask)\b/.test(normalized)) {
    return "user"
  }
  if (
    /\b(assistant|ai|bot|model|gpt|chatgpt|claude|gemini|copilot|cursor|codex|response|answer|reply|completion)\b/.test(
      normalized
    )
  ) {
    return "assistant"
  }
  if (/\b(system|developer)\b/.test(normalized)) return "system"
  return "user"
}

// ─── JSONL ───────────────────────────────────────────────────────────────────

function looksLikeJsonl(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return false
  return lines.every((l) => {
    const s = l.trim()
    return s.startsWith("{") && s.endsWith("}")
  })
}

function parseJsonl(text: string): ParsedConversation {
  const messages: NormalizedMessage[] = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const obj = JSON.parse(s) as Record<string, unknown>
      const content = extractContent(obj.content ?? obj.text ?? obj.message ?? "")
      if (!content) continue
      messages.push({
        role: normalizeRole((obj.role as string) ?? (obj.author as string) ?? "user"),
        content,
        timestamp: extractTimestamp(obj),
      })
    } catch {
      // skip malformed line
    }
  }
  return {
    messages,
    detectedFormat: "jsonl-messages",
    notes: [`parsed ${messages.length} JSONL message line(s)`],
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tryParseJson(s: string): unknown | undefined {
  if (!s.startsWith("{") && !s.startsWith("[")) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function extractContent(raw: unknown): string {
  if (raw == null) return ""
  if (typeof raw === "string") return raw.trim()

  // Anthropic / OpenAI content blocks: [{type: "text", text: "..."}]
  if (Array.isArray(raw)) {
    return raw
      .map((block) => {
        if (typeof block === "string") return block
        if (!block || typeof block !== "object") return ""
        const b = block as Record<string, unknown>
        if (typeof b.text === "string") return b.text
        if (typeof b.content === "string") return b.content
        if (Array.isArray(b.parts)) {
          return b.parts
            .map((p) =>
              p && typeof p === "object" && "text" in p
                ? String((p as { text: string }).text)
                : ""
            )
            .join("")
        }
        return ""
      })
      .join("\n")
      .trim()
  }

  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>
    if (typeof r.text === "string") return r.text.trim()
    if (typeof r.content === "string") return r.content.trim()
    if (Array.isArray(r.parts)) {
      return r.parts
        .map((p) =>
          p && typeof p === "object" && "text" in p
            ? String((p as { text: string }).text)
            : ""
        )
        .join("")
        .trim()
    }
  }

  return String(raw).trim()
}

function normalizeRole(role: string): NormalizedRole {
  const r = role.trim().toLowerCase()
  if (
    r === "user" ||
    r === "human" ||
    r === "you" ||
    r === "operator" ||
    r === "prompt"
  )
    return "user"
  if (r === "system" || r === "developer") return "system"
  // Everything else maps to assistant — covers model, ai, bot, claude, gemini,
  // gpt, chatgpt, tool, function, and unknown provider-specific labels.
  return "assistant"
}

function extractTimestamp(obj: Record<string, unknown>): string | undefined {
  const v = obj.timestamp ?? obj.created_at ?? obj.createdAt ?? obj.time
  if (typeof v === "string") return v
  if (typeof v === "number") {
    // Heuristic: seconds vs ms.
    const ms = v > 1e12 ? v : v * 1000
    return new Date(ms).toISOString()
  }
  return undefined
}
