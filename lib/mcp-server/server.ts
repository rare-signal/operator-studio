/**
 * MCP server factory. Builds the McpServer with all tools registered
 * and returns it ready to be `connect`ed to a transport (stdio in
 * production; an in-memory transport in tests).
 *
 * Tool naming uses underscores (plan_outline, thread_summary) rather
 * than the dotted form because the MCP spec requires names to match
 * `^[a-zA-Z0-9_-]+$`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { registerKnowledgeTools } from "./tools/knowledge.js"
import { registerOutboxTools } from "./tools/outbox.js"
import { registerPlanTools } from "./tools/plan.js"
import { registerRecapTools } from "./tools/recap.js"
import { registerSessionTools } from "./tools/sessions.js"
import { registerThreadTools } from "./tools/threads.js"
import { registerWorkContextTools } from "./tools/work-context.js"
import type { McpContext } from "./context.js"

export function buildOperatorStudioMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    {
      name: "operator-studio",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  registerPlanTools(server, ctx)
  registerSessionTools(server, ctx)
  registerThreadTools(server, ctx)
  registerRecapTools(server, ctx)
  registerKnowledgeTools(server, ctx)
  registerWorkContextTools(server, ctx)
  registerOutboxTools(server, ctx)

  return server
}
