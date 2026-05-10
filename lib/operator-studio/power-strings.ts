/**
 * Power-strings registry — sentinel phrases that, when they appear
 * in a thread message, fire a configured backend trigger.
 *
 * Generalizes the original single "done phrase" into a list of specs
 * so we can layer in new triggers (e.g. `task_done` parroted by the
 * agent, future review/approve sentinels, etc.) without rewriting
 * detector code each time.
 *
 * Adding a new power string:
 *   1. Append a `PowerStringSpec` to the array in `getPowerStrings()`.
 *   2. If your trigger isn't already in `PowerStringTrigger`, add it
 *      to the union and wire its dispatch in
 *      `lib/operator-studio/thread-done.ts` (or a sibling module
 *      dedicated to the new trigger family).
 *
 * Match semantics:
 *   - role: which message author counts ("user", "assistant", "any").
 *   - match: "exact" = whole-message equality (case + whitespace
 *            insensitive), the conservative default that prevents
 *            casual quoting from false-positiving.
 *            "contains" = case-insensitive WORD-bounded substring
 *            (token must be flanked by non-word chars or string
 *            ends), for sentinel tokens that the agent emits embedded
 *            in longer output. Word-bounded so `task_done` does not
 *            fire on incidental occurrences inside identifiers like
 *            `task_done_handler` or `marked_task_done_at`.
 *
 * This module is the single agent-edit surface. It deliberately has
 * no DB code; persistence lives next to its trigger (e.g. thread-done.ts
 * for "mark-thread-done").
 */

import type { ThreadDoneSource } from "./types"

export type PowerStringRole = "user" | "assistant" | "any"
export type PowerStringMatch = "exact" | "contains"

/** Backend triggers a power-string match can fire. Extend this union
 *  when adding a new trigger family; the dispatcher lives wherever
 *  the trigger's side-effect code is owned. */
export type PowerStringTrigger = "mark-thread-done"

export interface PowerStringSpec {
  /** Stable id — used in audit trails (`marked_done_by =
   *  "power-string:<id>"`) and to dedupe overlapping configs. */
  id: string
  /** Human-readable label for admin UI. */
  label: string
  /** The literal phrase to match. Resolved at call time so env
   *  overrides and future dynamic config can flow through. */
  phrase: string
  role: PowerStringRole
  match: PowerStringMatch
  trigger: PowerStringTrigger
  /** For trigger="mark-thread-done": which `marked_done_source` to
   *  stamp. Defaults to "phrase" if omitted. */
  doneSource?: ThreadDoneSource
  /** For trigger="mark-thread-done": value to write into
   *  `marked_done_by`. Defaults to `power-string:<id>`. */
  doneBy?: string
}

const LEGACY_DONE_DEFAULT = "All done in this chat, TY!"

/** Resolve the legacy operator-typed done phrase. Kept here so the
 *  registry stays the single source of truth, but the env override
 *  (`OPERATOR_STUDIO_DONE_PHRASE`) continues to work. */
function legacyDonePhrase(): string {
  const env = process.env.OPERATOR_STUDIO_DONE_PHRASE
  if (typeof env === "string" && env.trim().length > 0) return env.trim()
  return LEGACY_DONE_DEFAULT
}

/**
 * The active power-string registry. Add new entries by appending to
 * the returned array. Order matters only for the diagnostics that
 * report "which spec matched first" — detection itself is per-spec.
 */
export function getPowerStrings(): PowerStringSpec[] {
  return [
    {
      id: "done-phrase",
      label: "Operator-typed done phrase",
      phrase: legacyDonePhrase(),
      role: "user",
      match: "exact",
      trigger: "mark-thread-done",
      doneSource: "phrase",
      doneBy: "phrase-detector",
    },
    {
      id: "task-done-token",
      label: "Agent task_done sentinel",
      phrase: "task_done",
      role: "assistant",
      match: "contains",
      trigger: "mark-thread-done",
      doneSource: "phrase",
      doneBy: "task_done-detector",
    },
  ]
}

function normalizeExact(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Pure matcher — returns true iff `content` (authored by `role`)
 *  satisfies `spec`'s role + match-mode rules. */
export function matchesPowerString(
  spec: PowerStringSpec,
  role: string,
  content: string
): boolean {
  if (spec.role !== "any" && spec.role !== role) return false
  if (spec.match === "exact") {
    return normalizeExact(content) === normalizeExact(spec.phrase)
  }
  // Word-bounded contains: token must be flanked by a non-word char
  // or string boundary. Prevents `task_done` from matching inside
  // identifiers like `task_done_handler`.
  const phrase = spec.phrase.trim()
  if (!phrase) return false
  const re = new RegExp(`(?:^|\\W)${escapeRegex(phrase)}(?:\\W|$)`, "i")
  return re.test(content)
}

/** First spec in registry order that matches the given message, or
 *  null. Useful for ad-hoc detection at write time (e.g. a streaming
 *  endpoint that wants to short-circuit a thread when the agent
 *  parrots a sentinel). */
export function matchPowerString(
  role: string,
  content: string
): PowerStringSpec | null {
  for (const spec of getPowerStrings()) {
    if (matchesPowerString(spec, role, content)) return spec
  }
  return null
}

/** All specs whose trigger matches `trigger`. Resolved at call time
 *  so env overrides flow through. */
export function getPowerStringsByTrigger(
  trigger: PowerStringTrigger
): PowerStringSpec[] {
  return getPowerStrings().filter((s) => s.trigger === trigger)
}
