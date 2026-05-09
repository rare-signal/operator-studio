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
}
