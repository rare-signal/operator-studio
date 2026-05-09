/**
 * MCP tool — agent_startup_manifest.
 *
 * Returns the same plain-text manifest that
 * `pnpm tsx scripts/agent-prompt.ts` emits, intended as the first
 * tool a fresh agent calls before doing any work in the workspace.
 *
 * Per `step-agent-startup-tool-manifest` from the 2026-05-08 review.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { renderAgentManifest } from "@/lib/operator-studio/agent-manifest"
import { getTimeline, renderTimeline } from "@/lib/operator-studio/timeline"
import type { McpContext } from "../context.js"
import { capTextWithBudget } from "../budget.js"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

export function registerManifestTools(server: McpServer, ctx: McpContext) {
  server.registerTool(
    "agent_startup_manifest",
    {
      title: "Agent startup manifest",
      description:
        "Read this BEFORE doing any work in this workspace. Returns the factory context bundle (repo, product, audience), the tools-first rules of engagement (use MCP / Operator Studio routes — never the filesystem for product-native records, never direct ADO/Teams APIs), the recommended first-moves checklist, and the recency packet (what is hot right now). Idempotent and read-only.",
      inputSchema: {
        factoryId: z
          .string()
          .optional()
          .describe(
            "Factory you are bound to. Default: factory-clarifying-telegento. List factories via /operator-studio/factory."
          ),
        workspaceId: z.string().optional(),
      },
    },
    async ({ factoryId, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const text = await renderAgentManifest({
          workspaceId: ws,
          factoryId,
        })
        return textResult(text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── operations_timeline ─────────────────────────────────────────
  server.registerTool(
    "operations_timeline",
    {
      title: "Operations timeline — temporal narrative",
      description:
        "Read the chronological story of what's happened in the workspace. Spans inbox events (ADO/Teams), outbox state transitions (staged/approved/sent/rejected), plan-step touches, review queue items raised + decided, KB activity, and agent-card bindings. Use this when an agent needs to understand WHY a card is in motion or what's already been tried before re-doing work. Returns plain text, newest-first.",
      inputSchema: {
        factoryId: z
          .string()
          .optional()
          .describe(
            "Filter to a specific factory. Omit for cross-factory. Common values: factory-clarifying-telegento, factory-operator-studio."
          ),
        sinceIso: z
          .string()
          .optional()
          .describe(
            "ISO 8601 timestamp — earliest event to include. Default: 14 days ago."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max events to return. Default 50."),
        workspaceId: z.string().optional(),
      },
    },
    async ({ factoryId, sinceIso, limit, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const since = sinceIso ? new Date(sinceIso) : undefined
        if (since && Number.isNaN(since.getTime())) {
          return errorResult(`sinceIso is not a valid ISO date: ${sinceIso}`)
        }
        const events = await getTimeline(ws, {
          factoryId: factoryId ?? null,
          since,
          limit: limit ?? 50,
        })
        const header = `# Operations timeline · ${factoryId ?? "all factories"} · ${events.length} events`
        const text = `${header}\n\n${renderTimeline(events)}`
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
