/**
 * MCP tools for threads — summary view and passage search.
 *
 * `thread.summary` is the read-cheap projection: relies on the
 * pre-computed `OperatorThreadSummary` rows. Never dumps the raw
 * transcript. If no summary exists, we say so explicitly so the agent
 * knows to either request a summary be generated (out of scope here)
 * or use `thread.passages` to search the transcript directly.
 *
 * `thread.passages` does an in-process substring scan over a single
 * thread's messages. We chose substring over Postgres tsvector here
 * because (a) we already have the thread id, so we don't need
 * cross-thread ranking, and (b) substring lets the agent search for
 * literal terms (e.g. function names, error strings) that tsvector
 * stemming can mangle. Returns surrounding-turn context for each hit.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  getThreadById,
  getThreadMessages,
  getThreadSummaries,
} from "@/lib/operator-studio/queries"
import type { OperatorThreadMessage } from "@/lib/operator-studio/types"
import type { McpContext } from "../context.js"
import { capTextWithBudget, renderListWithBudget } from "../budget.js"
import {
  renderThreadPassages,
  renderThreadSummary,
} from "../views/session-view.js"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

/** Build a snippet around a substring match within a longer message. */
function buildSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return content.slice(0, 200)
  const radius = 240
  const start = Math.max(0, idx - radius)
  const end = Math.min(content.length, idx + query.length + radius)
  const head = start > 0 ? "…" : ""
  const tail = end < content.length ? "…" : ""
  return `${head}${content.slice(start, end)}${tail}`
}

export function registerThreadTools(server: McpServer, ctx: McpContext) {
  // ─── thread.summary ─────────────────────────────────────────────────────
  server.registerTool(
    "thread_summary",
    {
      title: "Thread summary",
      description:
        "Pre-computed summary of a thread (auto/manual/promoted). Cheap read — never dumps the raw transcript. If no summary exists, returns the capture reason and tells you to use `thread_passages` to search the transcript instead.",
      inputSchema: {
        threadId: z.string().describe("Thread id."),
        workspaceId: z.string().optional(),
      },
    },
    async ({ threadId, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const thread = await getThreadById(ws, threadId)
        if (!thread) {
          return errorResult(`Thread ${threadId} not found in workspace ${ws}.`)
        }
        const summaries = await getThreadSummaries(ws, threadId)
        const text = renderThreadSummary(thread, summaries)
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── thread.passages ────────────────────────────────────────────────────
  server.registerTool(
    "thread_passages",
    {
      title: "Search a thread's transcript",
      description:
        "Substring-match the messages in a single thread and return the matching turns with surrounding context. Use this when `thread_summary` doesn't have what you need and you have to look at the actual transcript. Case-insensitive.",
      inputSchema: {
        threadId: z.string().describe("Thread id."),
        query: z
          .string()
          .min(1)
          .describe("Substring to find within message contents."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max matching turns to return. Default 8."),
        workspaceId: z.string().optional(),
      },
    },
    async ({ threadId, query, limit, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const cap = limit ?? 8
      try {
        const thread = await getThreadById(ws, threadId)
        if (!thread) {
          return errorResult(`Thread ${threadId} not found in workspace ${ws}.`)
        }
        const messages = await getThreadMessages(ws, threadId)
        const lower = query.toLowerCase()
        const hits: Array<{
          message: OperatorThreadMessage
          snippet: string
        }> = []
        for (const m of messages) {
          if (m.content.toLowerCase().includes(lower)) {
            hits.push({ message: m, snippet: buildSnippet(m.content, query) })
            if (hits.length >= cap) break
          }
        }
        // Build the header from the actual hit count, then stream the
        // matches through the budget helper so a thread full of long
        // matches still respects the cap.
        const headerOnly = renderThreadPassages(thread, hits, query)
          .split("\n")
          .slice(0, 3)
          .join("\n")
        if (hits.length === 0) {
          return textResult(`${headerOnly}\n\n_No matches in this thread._`)
        }
        const rendered = renderListWithBudget({
          items: hits,
          header: `${headerOnly}\n\n`,
          render: ({ message, snippet }) =>
            `## Turn ${message.turnIndex} · ${message.role}\n\n${snippet}\n\n`,
        })
        return textResult(rendered.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
