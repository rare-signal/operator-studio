/**
 * Operator Studio MCP server — stdio entry point.
 *
 * Run via `pnpm mcp:server`. Speaks the MCP protocol over stdin/stdout,
 * which is how Claude Code, Codex, Cursor, and other CLI agents
 * connect.
 *
 * Configuration:
 *   - DATABASE_URL          — required, points at the same Postgres the
 *                             web app uses
 *   - OPERATOR_STUDIO_WORKSPACE
 *                           — default workspace id (defaults to "global")
 *   - OPERATOR_STUDIO_REVIEWER
 *                           — name attributed to auto-created plans
 *                             (defaults to "mcp-agent")
 *
 * CLI overrides:
 *   --workspace=<id>        — same as OPERATOR_STUDIO_WORKSPACE
 *   --reviewer=<name>       — same as OPERATOR_STUDIO_REVIEWER
 *
 * Logging policy: anything written to stdout corrupts the MCP protocol
 * stream. We log to stderr only, and never use `console.log`.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { buildOperatorStudioMcpServer } from "@/lib/mcp-server/server"
import { buildContextFromEnv } from "@/lib/mcp-server/context"
import { getPgPool } from "@/lib/server/db/client"

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write(
      "[operator-studio-mcp] DATABASE_URL is not set — refusing to start.\n"
    )
    process.exit(1)
  }

  const ctx = buildContextFromEnv(process.argv.slice(2))
  process.stderr.write(
    `[operator-studio-mcp] starting · workspace=${ctx.defaultWorkspaceId} reviewer=${ctx.reviewer}\n`
  )

  const server = buildOperatorStudioMcpServer(ctx)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Graceful shutdown — close the PG pool on SIGINT/SIGTERM so the
  // process exits cleanly when the host (Claude Code, etc.) tears
  // down the stdio pipe.
  const shutdown = async (signal: string) => {
    process.stderr.write(`[operator-studio-mcp] ${signal} received, closing\n`)
    try {
      await server.close()
    } catch {
      /* ignore */
    }
    try {
      await getPgPool().end()
    } catch {
      /* ignore */
    }
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch((err) => {
  process.stderr.write(
    `[operator-studio-mcp] fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}\n`
  )
  process.exit(1)
})
