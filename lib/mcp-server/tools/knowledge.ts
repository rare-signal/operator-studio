/**
 * MCP tools for the Knowledge Base.
 *
 * Lets an agentic-coding session (Claude / Codex / etc.) read the KB,
 * write entries deliberately, and post atomic claims sourced from
 * thread passages. Designed so the agent browses BEFORE writing,
 * which keeps the article surface from collapsing into a duplicate
 * dumping ground.
 *
 * Naming uses underscores (knowledge_*) per the same rule plan_*
 * tools follow — MCP requires `^[a-zA-Z0-9_-]+$`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  KB_ENTRY_TYPES,
  KB_STABILITIES,
  getEntryById,
  isKbEnabled,
  listEntries,
  upsertClaim,
  upsertEntry,
  type KbEntryType,
  type KbStability,
} from "@/lib/operator-studio/knowledge"
import type { KbCitation } from "@/lib/server/db/schema"
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

function formatEntryListing(
  entries: Awaited<ReturnType<typeof listEntries>>
): string {
  if (entries.length === 0) {
    return "No entries yet. Use `knowledge_upsert_entry` to add one."
  }
  const byType = new Map<string, typeof entries>()
  for (const e of entries) {
    const arr = byType.get(e.entryType) ?? []
    arr.push(e)
    byType.set(e.entryType, arr)
  }
  const lines: string[] = ["# Knowledge Base"]
  for (const type of KB_ENTRY_TYPES) {
    const group = byType.get(type)
    if (!group || group.length === 0) continue
    lines.push("")
    lines.push(`## ${type} (${group.length})`)
    for (const e of group) {
      const stab = e.stability === "draft" ? " [draft]" : ""
      lines.push(`- \`${e.id}\`${stab} — **${e.title}**`)
      if (e.summary) lines.push(`  ${e.summary}`)
    }
  }
  return lines.join("\n")
}

function formatEntryDetail(
  entry: NonNullable<Awaited<ReturnType<typeof getEntryById>>>
): string {
  const lines: string[] = []
  lines.push(`# ${entry.title}`)
  lines.push("")
  lines.push(`Type: \`${entry.entryType}\` — Stability: \`${entry.stability}\``)
  if (entry.tags.length > 0) {
    lines.push(`Tags: ${entry.tags.map((t) => `#${t}`).join(" ")}`)
  }
  lines.push("")
  if (entry.summary) {
    lines.push(`> ${entry.summary}`)
    lines.push("")
  }
  lines.push(entry.bodyMarkdown || "_No body yet._")
  if (entry.citations.length > 0) {
    lines.push("")
    lines.push("## Citations")
    for (const [i, c] of entry.citations.entries()) {
      lines.push(`${i + 1}. (${c.kind}) ${c.label ?? c.excerpt ?? c.threadId ?? c.claimId ?? "—"}`)
    }
  }
  lines.push("")
  lines.push(
    `Updated ${entry.updatedAt} — ${entry.versionCount} version${entry.versionCount === 1 ? "" : "s"}.`
  )
  return lines.join("\n")
}

async function ensureEnabled(ws: string): Promise<string | null> {
  const enabled = await isKbEnabled(ws)
  if (!enabled) {
    return `Knowledge Base module is not enabled for workspace \`${ws}\`. Enable it in Operator Studio (sidebar → Knowledge Base → Enable for workspace) before using KB tools.`
  }
  return null
}

export function registerKnowledgeTools(server: McpServer, ctx: McpContext) {
  // ─── knowledge_list_entries ─────────────────────────────────────────────
  server.registerTool(
    "knowledge_list_entries",
    {
      title: "List knowledge base entries",
      description:
        "Browse the knowledge base. Returns a markdown listing grouped by entry type. Use this BEFORE upserting an entry to avoid duplicates and to find ids of related entries to link.",
      inputSchema: {
        workspaceId: z
          .string()
          .optional()
          .describe("Override the default workspace."),
      },
    },
    async ({ workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const blocked = await ensureEnabled(ws)
      if (blocked) return errorResult(blocked)
      const entries = await listEntries(ws)
      const listing = formatEntryListing(entries)
      return textResult(capTextWithBudget(listing).text)
    }
  )

  // ─── knowledge_get_entry ────────────────────────────────────────────────
  server.registerTool(
    "knowledge_get_entry",
    {
      title: "Get a knowledge base entry",
      description:
        "Read the full markdown body, citations, and metadata for a single entry by id.",
      inputSchema: {
        id: z.string().describe("Entry id (slug-like)."),
        workspaceId: z.string().optional(),
      },
    },
    async ({ id, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const blocked = await ensureEnabled(ws)
      if (blocked) return errorResult(blocked)
      const entry = await getEntryById(ws, id)
      if (!entry) {
        return errorResult(`Entry \`${id}\` not found in workspace \`${ws}\`.`)
      }
      return textResult(capTextWithBudget(formatEntryDetail(entry)).text)
    }
  )

  // ─── knowledge_upsert_entry ─────────────────────────────────────────────
  server.registerTool(
    "knowledge_upsert_entry",
    {
      title: "Create or update a knowledge base entry",
      description:
        "Write an article-shaped entry. Always call `knowledge_list_entries` first to check for an existing entry on the same topic — pass its id to update instead of creating a duplicate. Body is markdown.",
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe(
            "Pass an existing id to update; omit to create a new entry (id auto-generated from type + title)."
          ),
        title: z.string().min(1),
        entryType: z
          .enum(KB_ENTRY_TYPES as [KbEntryType, ...KbEntryType[]])
          .describe(
            "concept | pattern | metric | procedure | agent | comparison | anomaly | todo | report"
          ),
        stability: z
          .enum(KB_STABILITIES as [KbStability, ...KbStability[]])
          .optional()
          .describe(
            "evergreen | stable | fluctuant | draft (default: draft)"
          ),
        summary: z.string().optional(),
        bodyMarkdown: z
          .string()
          .optional()
          .describe("Full markdown body. Use headings, lists, code blocks."),
        tags: z.array(z.string()).optional(),
        relatedEntryIds: z
          .array(z.string())
          .optional()
          .describe("Ids of related entries to link in the sidebar."),
        sourceThreadId: z.string().optional().nullable(),
        sourcePassageIds: z.array(z.string()).optional(),
        citations: z
          .array(
            z.object({
              kind: z.enum(["passage", "message", "thread", "claim"]),
              threadId: z.string().optional(),
              messageId: z.string().optional(),
              passageId: z.string().optional(),
              claimId: z.string().optional(),
              excerpt: z.string().optional(),
              label: z.string().optional(),
            })
          )
          .optional(),
        workspaceId: z.string().optional(),
      },
    },
    async (args) => {
      const ws = args.workspaceId ?? ctx.defaultWorkspaceId
      const blocked = await ensureEnabled(ws)
      if (blocked) return errorResult(blocked)
      try {
        const entry = await upsertEntry(ws, {
          id: args.id,
          entryType: args.entryType,
          stability: args.stability,
          title: args.title,
          summary: args.summary,
          bodyMarkdown: args.bodyMarkdown,
          tags: args.tags,
          relatedEntryIds: args.relatedEntryIds,
          sourceThreadId: args.sourceThreadId ?? null,
          sourcePassageIds: args.sourcePassageIds,
          citations: args.citations as KbCitation[] | undefined,
          modelProvider: "mcp",
          modelName: ctx.reviewer,
        })
        return textResult(
          `Saved entry \`${entry.id}\` (${entry.entryType}, ${entry.stability}) — version ${entry.versionCount}.\n\n${formatEntryDetail(entry)}`
        )
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── knowledge_upsert_claim ─────────────────────────────────────────────
  server.registerTool(
    "knowledge_upsert_claim",
    {
      title: "Post an atomic claim",
      description:
        "Record a single proposition extracted from a thread passage or message. Claims are the atomic facts that articles cite. Keep statements small and verifiable.",
      inputSchema: {
        id: z.string().optional(),
        statement: z
          .string()
          .min(1)
          .describe("One short proposition that is true or false."),
        subject: z
          .string()
          .optional()
          .describe(
            "Optional entity the claim is about (helps cluster claims for entry curation)."
          ),
        confidence: z.number().min(0).max(1).optional(),
        sourceThreadId: z.string().optional(),
        sourceMessageId: z.string().optional(),
        sourcePassageId: z.string().optional(),
        sourceExcerpt: z.string().optional(),
        validAt: z
          .string()
          .optional()
          .describe("ISO timestamp the claim was true. Defaults to now."),
        supersededById: z
          .string()
          .optional()
          .describe("Pass the id of a newer claim that contradicts this one."),
        workspaceId: z.string().optional(),
      },
    },
    async (args) => {
      const ws = args.workspaceId ?? ctx.defaultWorkspaceId
      const blocked = await ensureEnabled(ws)
      if (blocked) return errorResult(blocked)
      try {
        const claim = await upsertClaim(ws, {
          id: args.id,
          statement: args.statement,
          subject: args.subject ?? null,
          confidence: args.confidence,
          sourceThreadId: args.sourceThreadId ?? null,
          sourceMessageId: args.sourceMessageId ?? null,
          sourcePassageId: args.sourcePassageId ?? null,
          sourceExcerpt: args.sourceExcerpt ?? null,
          validAt: args.validAt,
          supersededById: args.supersededById ?? null,
          modelProvider: "mcp",
          modelName: ctx.reviewer,
        })
        return textResult(
          `Saved claim \`${claim.id}\` (confidence ${claim.confidence}, valid_at ${claim.validAt}).\n\n> ${claim.statement}`
        )
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── knowledge_request_article ──────────────────────────────────────────
  server.registerTool(
    "knowledge_request_article",
    {
      title: "Request a missing article (loose-thread wish)",
      description:
        "Drop a 'I wish we had an article on X' pointer. Creates a TODO-typed entry that can be promoted into a real article later. Use when you spot a gap but aren't ready to write the full piece yourself.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe("What article do you wish existed?"),
        why: z
          .string()
          .optional()
          .describe("Why would this article be valuable?"),
        tags: z.array(z.string()).optional(),
        workspaceId: z.string().optional(),
      },
    },
    async ({ title, why, tags, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const blocked = await ensureEnabled(ws)
      if (blocked) return errorResult(blocked)
      try {
        const entry = await upsertEntry(ws, {
          entryType: "todo",
          stability: "draft",
          title: title.startsWith("Article wanted")
            ? title
            : `Article wanted: ${title}`,
          summary: why ?? "",
          bodyMarkdown: why
            ? `**Why this article would be valuable:**\n\n${why}`
            : "",
          tags: tags ?? ["wishlist", "loose-thread"],
          modelProvider: "mcp",
          modelName: ctx.reviewer,
        })
        return textResult(
          `Recorded wish \`${entry.id}\`. View it in the KB under TODOs.`
        )
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
