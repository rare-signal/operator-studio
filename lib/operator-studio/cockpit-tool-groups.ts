/**
 * Group consecutive tool-call parts (tool_use, tool_result, image) into
 * collapsible blocks so the cockpit chat view can render N tool actions
 * as a single inline-expandable summary line per assistant turn.
 *
 * Text and thinking parts always render at top level — each becomes its
 * own "single" group so the surrounding narrative stays legible.
 */

import type { Turn } from "@/lib/server/agent-bridge/app-sessions"

export type TurnPart = Turn["parts"][number]

/** A single non-tool part (text, thinking) rendered at top level. */
export interface SingleGroup {
  kind: "single"
  index: number
  part: TurnPart
}

/** A run of consecutive tool-call parts collapsed under one summary row. */
export interface ToolCallGroup {
  kind: "tool-group"
  startIndex: number
  parts: Array<{ index: number; part: TurnPart }>
}

export type PartGroup = SingleGroup | ToolCallGroup

/** Parts that should be hidden behind the collapsed summary line. */
export function isToolPart(part: TurnPart): boolean {
  return (
    part.kind === "tool_use" ||
    part.kind === "tool_result" ||
    part.kind === "image"
  )
}

/**
 * Walk the turn's parts in order and bundle consecutive tool parts
 * into one ToolCallGroup. Text/thinking parts pass through as their
 * own SingleGroup, preserving original ordering.
 */
export function groupTurnParts(parts: ReadonlyArray<TurnPart>): PartGroup[] {
  const groups: PartGroup[] = []
  let current: ToolCallGroup | null = null
  parts.forEach((part, index) => {
    if (isToolPart(part)) {
      if (!current) {
        current = { kind: "tool-group", startIndex: index, parts: [] }
        groups.push(current)
      }
      current.parts.push({ index, part })
    } else {
      current = null
      groups.push({ kind: "single", index, part })
    }
  })
  return groups
}
