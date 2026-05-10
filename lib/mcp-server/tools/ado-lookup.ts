/**
 * MCP tool — `ado_lookup`. The keyed-intake bundle (L5) for a single
 * ADO work-item id. Read-only; no `az boards` calls; no outbound.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  buildAdoIntakeBundle,
  renderAdoIntakeBundle,
} from "@/lib/operator-studio/ado-keyed-intake"

import { capTextWithBudget } from "../budget.js"
import type { McpContext } from "../context.js"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

export function registerAdoLookupTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    "ado_lookup",
    {
      title: "ADO keyed intake bundle",
      description:
        "Fast context for one ADO work-item id, assembled from the local Operator Studio read model (inbox events, plan steps, thread bindings, factory product repos). NEVER calls `az boards` directly. If data is missing, returns deliberate empty markers and poll hints (e.g. `pnpm tsx scripts/ado-poll.ts`). Bundle includes liveAdoRead, comments with thin salience tags, plan-step references, shipped commit references (`git log -G \"#<id>\"` against productRepoPath), bound agents, and heuristic stakeholder posture.",
      inputSchema: {
        workItemId: z
          .string()
          .regex(/^\d+$/)
          .describe("ADO work-item numeric id, e.g. \"39\"."),
        workspaceId: z.string().optional(),
        commentLimit: z.number().int().min(1).max(50).optional(),
        gitLogLimit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ workItemId, workspaceId, commentLimit, gitLogLimit }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const bundle = await buildAdoIntakeBundle(ws, workItemId, {
          commentLimit,
          gitLogLimit,
        })
        const text = renderAdoIntakeBundle(bundle)
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
