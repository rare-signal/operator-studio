/**
 * MCP `progress_recap` tool — "what got done in this window?"
 *
 * Window presets cover the common asks:
 *   - "today"     → midnight today (local time, but expressed in UTC) → now
 *   - "this-week" → 7 days ago     → now
 *   - "custom"    → caller supplies since/until ISO timestamps
 *
 * When `compare: true` (default for the presets), we also fetch the
 * prior window of equal duration immediately before `since`, and the
 * view renders deltas. Compare doubles the query count but stays in
 * the low-millisecond range against an indexed schema.
 *
 * The active plan's coverage snapshot is appended as a footer — that
 * piece is point-in-time, NOT windowed, and the view labels it as
 * such so the agent doesn't conflate it with the deltas above.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  getActivePlanCoverage,
  getProgressRecap,
} from "@/lib/operator-studio/queries"
import { getActivePlan } from "@/lib/operator-studio/plans"
import type { McpContext } from "../context.js"
import { capTextWithBudget } from "../budget.js"
import { renderProgressRecap } from "../views/recap-view.js"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

function resolveWindow(
  windowName: "today" | "this-week" | "custom",
  customSince: string | undefined,
  customUntil: string | undefined,
  now: Date = new Date()
): { since: Date; until: Date; label: string } | { error: string } {
  if (windowName === "today") {
    const since = new Date(now)
    since.setUTCHours(0, 0, 0, 0)
    return { since, until: now, label: "today" }
  }
  if (windowName === "this-week") {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return { since, until: now, label: "this week (7d)" }
  }
  if (!customSince || !customUntil) {
    return {
      error:
        "window=custom requires both `since` and `until` ISO-8601 timestamps.",
    }
  }
  const since = new Date(customSince)
  const until = new Date(customUntil)
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return { error: "since/until must be parseable ISO-8601 timestamps." }
  }
  if (since >= until) {
    return { error: "since must be strictly before until." }
  }
  return { since, until, label: `${customSince} → ${customUntil}` }
}

export function registerRecapTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    "progress_recap",
    {
      title: "Progress recap",
      description:
        "What got done in a time window — sessions, threads, messages, promotions, plans shipped, and steps newly evidenced. With `compare: true` (default) also reports deltas vs the immediately prior window of equal duration. Footer adds a point-in-time snapshot of the active plan's coverage. Use this to answer 'how am I doing?' or 'did I make progress this week?' Note: there is no step-status audit log, so 'steps newly evidenced' is a proxy based on first-ever fulfillment landing in the window — close to but not identical to 'steps marked covered today.'",
      inputSchema: {
        window: z
          .enum(["today", "this-week", "custom"])
          .optional()
          .describe(
            "Window preset. Default 'this-week'. Use 'custom' to pass since/until."
          ),
        since: z
          .string()
          .optional()
          .describe("ISO-8601 start (required when window='custom')."),
        until: z
          .string()
          .optional()
          .describe("ISO-8601 end (required when window='custom')."),
        compare: z
          .boolean()
          .optional()
          .describe(
            "If true (default), also fetch the prior window of equal duration and render deltas."
          ),
        workspaceId: z.string().optional(),
      },
    },
    async ({ window, since, until, compare, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const windowName = window ?? "this-week"
      const compareMode = compare ?? true

      const resolved = resolveWindow(windowName, since, until, new Date())
      if ("error" in resolved) return errorResult(resolved.error)

      try {
        const current = await getProgressRecap(
          ws,
          resolved.since,
          resolved.until
        )

        let prior = null
        if (compareMode) {
          const duration =
            resolved.until.getTime() - resolved.since.getTime()
          const priorUntil = resolved.since
          const priorSince = new Date(priorUntil.getTime() - duration)
          prior = await getProgressRecap(ws, priorSince, priorUntil)
        }

        // Active plan coverage — separate read because it's NOT
        // windowed. Failing to find an active plan is fine; the view
        // just omits the footer.
        let coverage = null
        try {
          const plan = await getActivePlan(ws, null, ctx.reviewer)
          if (plan) {
            coverage = await getActivePlanCoverage(ws, plan.id)
          }
        } catch {
          /* tolerate — coverage is a nice-to-have */
        }

        const text = renderProgressRecap({
          current,
          prior,
          coverage,
          windowName: resolved.label,
        })
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
