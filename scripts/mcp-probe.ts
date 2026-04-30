/**
 * MCP smoke test — links a Client and the operator-studio Server over
 * an in-memory transport, exercises every tool, and prints the
 * rendered output to stdout. Lets you see what the agent sees without
 * needing to wire the server into Claude Code first.
 *
 * Run: `pnpm mcp:probe`
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

import { buildOperatorStudioMcpServer } from "@/lib/mcp-server/server"
import { buildContextFromEnv } from "@/lib/mcp-server/context"
import { getPgPool } from "@/lib/server/db/client"

type ToolText = { type: "text"; text: string }
type CallResult = {
  content?: unknown[]
  isError?: boolean
}

function extractText(result: CallResult): string {
  const lines = ((result.content ?? []) as ToolText[])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
  const prefix = result.isError ? "[ERROR] " : ""
  return prefix + lines.join("\n")
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<CallResult> {
  return (await client.callTool(
    { name, arguments: args },
    CallToolResultSchema
  )) as CallResult
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stderr.write("DATABASE_URL is not set.\n")
    process.exit(1)
  }
  const ctx = buildContextFromEnv(process.argv.slice(2))
  const server = buildOperatorStudioMcpServer(ctx)

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "mcp-probe", version: "0.1.0" })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])

  const banner = (label: string) =>
    `\n\n========== ${label} ==========\n`

  // 1. List tools — confirm the registration shape.
  const tools = await client.listTools()
  process.stdout.write(banner("listTools"))
  for (const t of tools.tools) {
    process.stdout.write(`- ${t.name}: ${t.description?.slice(0, 80) ?? ""}\n`)
  }

  // 2. plan_outline (active plan)
  process.stdout.write(banner("plan_outline (active plan)"))
  const outline = await call(client, "plan_outline", {})
  process.stdout.write(extractText(outline))

  // 3. plans_list (orient)
  process.stdout.write(banner("plans_list"))
  const plansList = await call(client, "plans_list", {})
  process.stdout.write(extractText(plansList))

  // 4. plan_search (try a probably-present token)
  process.stdout.write(banner('plan_search query="plan"'))
  const search = await call(client, "plan_search", {
    query: "plan",
    limit: 5,
  })
  process.stdout.write(extractText(search))

  // 5. sessions_recent
  process.stdout.write(banner("sessions_recent (limit 3)"))
  const sessions = await call(client, "sessions_recent", { limit: 3 })
  process.stdout.write(extractText(sessions))

  // 5b. progress_recap (this-week with delta vs prior week)
  process.stdout.write(banner("progress_recap (this-week)"))
  const recap = await call(client, "progress_recap", {
    window: "this-week",
    compare: true,
  })
  process.stdout.write(extractText(recap))

  // 6. plan_step on the first step from the outline (parse the id from
  // the markdown).
  const outlineText = extractText(outline)
  const stepIdMatch = outlineText.match(/`(step-[A-Za-z0-9_-]+)`/)
  if (stepIdMatch) {
    process.stdout.write(banner(`plan_step ${stepIdMatch[1]}`))
    const step = await call(client, "plan_step", {
      stepId: stepIdMatch[1],
      includeChildren: true,
    })
    process.stdout.write(extractText(step))
  } else {
    process.stdout.write(
      banner("plan_step") + "_no step id found in outline output_"
    )
  }

  // 7. thread_summary on the first thread referenced in sessions_recent
  const sessionsText = extractText(sessions)
  const threadIdMatch = sessionsText.match(/`(thread-[A-Za-z0-9_-]+)`/)
  if (threadIdMatch) {
    process.stdout.write(banner(`thread_summary ${threadIdMatch[1]}`))
    const summary = await call(client, "thread_summary", {
      threadId: threadIdMatch[1],
    })
    process.stdout.write(extractText(summary))

    process.stdout.write(banner(`thread_passages ${threadIdMatch[1]} "the"`))
    const passages = await call(client, "thread_passages", {
      threadId: threadIdMatch[1],
      query: "the",
      limit: 3,
    })
    process.stdout.write(extractText(passages))
  }

  await client.close()
  await server.close()
  await getPgPool().end()
  process.stdout.write("\n\n[probe complete]\n")
}

main().catch((err) => {
  process.stderr.write(
    `[probe] fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}\n`
  )
  process.exit(1)
})
