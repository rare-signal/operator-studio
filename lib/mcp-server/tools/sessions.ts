/**
 * MCP tools for sessions — recent sessions with thread membership.
 *
 * `sessions.recent` is the orientation tool: "what has been worked on
 * lately, and which threads belong to those work windows?" It reuses
 * the same `getRecentSessionsWithThreads` helper that powers the new
 * secondary sidebar in the web app, so the agent and the operator
 * see the same shape of data.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  ensureSessionsForWorkspace,
  getRecentSessionsWithThreads,
} from "@/lib/operator-studio/queries"
import type { McpContext } from "../context.js"
import { capTextWithBudget } from "../budget.js"
import { renderSessionsList } from "../views/session-view.js"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

export function registerSessionTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    "sessions_recent",
    {
      title: "Recent sessions",
      description:
        "Recent work sessions for the workspace, each with the threads that touched them. Sessions are 3-hour-gap-bracketed activity windows; threads can appear in multiple sessions if they spanned a break.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max sessions to return. Default 5."),
        workspaceId: z.string().optional(),
      },
    },
    async ({ limit, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const cap = limit ?? 5
      try {
        // Same idempotent ensure-then-query the web app uses; safe to
        // call repeatedly on every tool invocation.
        await ensureSessionsForWorkspace(ws)
        const groups = await getRecentSessionsWithThreads(ws, cap)
        const text = renderSessionsList(groups)
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
