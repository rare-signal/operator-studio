/**
 * Exec chip system — parser + action registry.
 *
 * Companion to `lib/operator-studio/power-strings.ts`. Where power-strings
 * detects single-token sentinels (`task_done`) on assistant messages and
 * fires a backend trigger, this module handles **chip sentinels** — the
 * structured "whisper to the UI" channel that lets exec/worker agents
 * suggest 1–3 tappable next-action pills under the message that emitted
 * them.
 *
 * Sentinel syntax:
 *   <<chip:{"action":"<id>","label":"<display>","params":{...optional...}}>>
 *
 * Storage model: derived on read (no DB, no migration). Chips are
 * extracted from the assistant message body via `parseChipsFromMessage`
 * and the sentinel is stripped from the rendered body via
 * `stripChipSentinels`. Editing/redacting the message edits/redacts the
 * chip — no orphaned chips ever.
 *
 * Action universe is a registry, not free-form:
 *   - LLMs pick from `ChipActionId`; unknown ids drop silently.
 *   - Each action has a typed params shape + a handler stub. Phase 2
 *     fills in the handlers (this file ships with `unimplemented` throws
 *     so the type surface is concrete but no dispatcher accidentally
 *     fires before review).
 *
 * STATUS: Phase 1 stub. Worker 4 implements the handlers + the dispatch
 * route + the cockpit render layer. Design lives at
 * `scripts/data/exec-chip-system-design-2026-05-09.md`.
 */

/** Stable, type-safe action id union. Add new ids here + an entry in
 *  `getChipActionRegistry()` + a handler stub. */
export type ChipActionId =
  | "approve-phase-2"
  | "view-deliverable"
  | "mark-step-covered"
  | "mark-step-skipped"
  | "spawn-worker"
  | "send-to-agent"
  | "navigate-to-card"
  | "mark-worker-done"

/** A single chip parsed from an assistant message. */
export interface ChipInstance {
  action: ChipActionId
  label: string
  params: Record<string, unknown>
  /** Index of this chip within the message (0-based). Used by tap-state
   *  persistence in Phase 2. */
  index: number
}

/** A registry entry describing one allowed action. Handlers run in the
 *  USER's auth context (taps are user actions, not agent actions). */
export interface ChipActionSpec {
  id: ChipActionId
  /** Default label if the LLM doesn't override via the chip's `label`
   *  field. Mostly for dev tools / error toasts. */
  defaultLabel: string
  /** One-sentence developer-facing description. */
  description: string
  /** Whether this handler mutates server state. UI may show a confirm
   *  for destructive=true actions in Phase 2 if config asks for it. */
  destructive: boolean
}

/**
 * Result envelope every handler returns. Lets the cockpit decide what
 * to do after a tap (toast + refetch, or navigate, or both).
 */
export interface ChipActionResult {
  ok: boolean
  /** Toast text for the cockpit. */
  message?: string
  /** If set, cockpit navigates here. */
  navigate?: string
  /** If set, the cockpit refetches the named pane (e.g. "spawned-by",
   *  "active-work-context", "operations"). */
  refetch?: string[]
  /** On error: machine-readable code. */
  error?: string
}

const CHIP_SENTINEL_RE = /<<chip:(\{[^]*?\})>>/g

/**
 * Extract every chip from a message body. Malformed JSON drops silently
 * (logged once via console.warn for dev visibility). Unknown action ids
 * also drop — the registry is the allowlist.
 *
 * Pure function; safe to call on every render.
 */
export function parseChipsFromMessage(content: string): ChipInstance[] {
  if (!content || typeof content !== "string") return []
  const out: ChipInstance[] = []
  let index = 0
  // RegExp.matchAll requires global flag; CHIP_SENTINEL_RE has it.
  for (const m of content.matchAll(CHIP_SENTINEL_RE)) {
    const raw = m[1]
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Silent drop; sentinel was malformed.
      continue
    }
    if (!parsed || typeof parsed !== "object") continue
    const obj = parsed as Record<string, unknown>
    const action = typeof obj.action === "string" ? obj.action : null
    if (!action || !isKnownChipActionId(action)) continue
    const label =
      typeof obj.label === "string" && obj.label.trim().length > 0
        ? obj.label.trim()
        : getChipActionRegistry()[action].defaultLabel
    const params =
      obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : {}
    out.push({ action, label, params, index })
    index++
  }
  return out
}

/**
 * Remove every chip sentinel from a message body so the rendered text
 * doesn't show the JSON literal. Pair with `parseChipsFromMessage` to
 * render the chips separately.
 */
export function stripChipSentinels(content: string): string {
  if (!content || typeof content !== "string") return content
  return content.replace(CHIP_SENTINEL_RE, "").replace(/\n{3,}/g, "\n\n").trim()
}

/** Type guard for the action id union. */
export function isKnownChipActionId(id: string): id is ChipActionId {
  return id in getChipActionRegistry()
}

/**
 * The canonical action registry. Phase 2 adds handler functions next to
 * each spec. For now the registry is metadata-only; the dispatch route
 * doesn't exist yet, so calling any handler throws.
 */
export function getChipActionRegistry(): Record<ChipActionId, ChipActionSpec> {
  return {
    "approve-phase-2": {
      id: "approve-phase-2",
      defaultLabel: "Approve Phase 2",
      description:
        "Re-spawns a worker against the same plan step with a Phase-2 mandate.",
      destructive: false,
    },
    "view-deliverable": {
      id: "view-deliverable",
      defaultLabel: "View deliverable",
      description: "Opens a markdown report or KB entry in the cockpit viewer.",
      destructive: false,
    },
    "mark-step-covered": {
      id: "mark-step-covered",
      defaultLabel: "Mark covered",
      description: "Flips a plan step to status=covered.",
      destructive: true,
    },
    "mark-step-skipped": {
      id: "mark-step-skipped",
      defaultLabel: "Mark skipped",
      description: "Flips a plan step to status=skipped.",
      destructive: true,
    },
    "spawn-worker": {
      id: "spawn-worker",
      defaultLabel: "Spawn worker",
      description:
        "Kicks off a new worker against a plan step with a kickoff prompt.",
      destructive: false,
    },
    "send-to-agent": {
      id: "send-to-agent",
      defaultLabel: "Send to agent",
      description: "Delivers a message to a specific agent's chat.",
      destructive: false,
    },
    "navigate-to-card": {
      id: "navigate-to-card",
      defaultLabel: "Open plan card",
      description: "Opens a plan card detail view in the cockpit.",
      destructive: false,
    },
    "mark-worker-done": {
      id: "mark-worker-done",
      defaultLabel: "Mark worker done",
      description:
        "Detaches a worker binding (the `pnpm os:worker-done` path).",
      destructive: false,
    },
  }
}

/**
 * Phase 2 dispatcher — stub. Worker 4 fills this in by adding a handler
 * map of `ChipActionId -> (params) => Promise<ChipActionResult>` and
 * routing through it. For now any call throws so nothing accidentally
 * fires before review.
 */
export async function dispatchChipAction(
  _action: ChipActionId,
  _params: Record<string, unknown>
): Promise<ChipActionResult> {
  throw new Error(
    "chip-actions: dispatchChipAction is a Phase 1 stub. Worker 4 wires the handlers."
  )
}
