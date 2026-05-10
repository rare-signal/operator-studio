/**
 * Exec chip system — parser + stripper.
 *
 * Companion to `lib/operator-studio/power-strings.ts`. Where power-strings
 * detects single-token sentinels (`task_done`) and fires a backend
 * trigger, this module handles **chip sentinels** — the structured
 * "whisper to the UI" channel that lets exec/worker agents suggest 1–3
 * tappable next-action pills under the message that emitted them.
 *
 * Sentinel syntax (deliberately minimal):
 *
 *   <<chip:LABEL>>
 *
 * The LABEL is the literal text that the cockpit will send back as the
 * user's next message when the chip is tapped. There is intentionally
 * NO action id, NO params shape, NO typed registry, NO server-side
 * dispatcher — the agent on the receiving end (exec OR worker) reads
 * the natural-language label and acts on it with the tools it already
 * has. This was a 2026-05-09 simplification of an earlier registry-based
 * design that was overengineered for the actual job.
 *
 * Storage model: derived on read (no DB, no migration). Chips are
 * extracted from the assistant message body via `parseChipsFromMessage`
 * and the sentinel is stripped from the rendered body via
 * `stripChipSentinels`. Editing/redacting the message edits/redacts the
 * chip — no orphaned chips ever.
 *
 * Tap contract (default): the cockpit fills the chat input with the
 * chip's label and lets the user review/edit/submit. Auto-send on tap
 * is deliberately NOT the default — preserves user control, no surprise
 * mutations. Holding Cmd/Shift on tap is the natural place for a future
 * "send immediately" override.
 */

/** A single chip parsed from an assistant message. */
export interface ChipInstance {
  /** The literal text that will become the user's next message when
   *  this chip is tapped. */
  label: string
  /** Index of this chip within the message (0-based). Useful for
   *  per-chip tap-state persistence in localStorage. */
  index: number
}

/** Lazy match anchored to its own line — captures everything between
 *  `<<chip:` and the next `>>`, but only when the sentinel occupies a
 *  whole line (allowing surrounding whitespace). This prevents inline
 *  documentation like "Sentinel syntax: `<<chip:LABEL>>`" from being
 *  parsed as an actual chip. The `m` flag makes `^` / `$` match line
 *  boundaries; the `g` flag is required for `matchAll`.
 *
 *  LLMs are responsible for putting each chip on its own line and for
 *  not embedding `>>` inside labels. */
const CHIP_SENTINEL_RE = /^[ \t]*<<chip:(.*?)>>[ \t]*$/gm

/**
 * Extract every chip from a message body. Empty labels drop silently.
 * Pure function; safe to call on every render.
 */
export function parseChipsFromMessage(content: string): ChipInstance[] {
  if (!content || typeof content !== "string") return []
  const out: ChipInstance[] = []
  let index = 0
  for (const m of content.matchAll(CHIP_SENTINEL_RE)) {
    const label = m[1]?.trim()
    if (!label) continue
    out.push({ label, index })
    index++
  }
  return out
}

/**
 * Remove every chip sentinel from a message body so the rendered text
 * doesn't show the literal `<<chip:...>>`. Pair with
 * `parseChipsFromMessage` to render the chips separately as pills.
 */
export function stripChipSentinels(content: string): string {
  if (!content || typeof content !== "string") return content
  return content.replace(CHIP_SENTINEL_RE, "").replace(/\n{3,}/g, "\n\n").trim()
}
