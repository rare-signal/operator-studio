/**
 * MCP tools for the staged-outbound (outbox) loop.
 *
 * Agents use these to STAGE outbound communications into Operator
 * Studio's outbox table. They cannot SEND — sending requires the
 * operator to enter a PIN and click Approve on the per-row preview
 * page (see `pattern-outbound-pin-gate` and the outbound writer
 * `lib/operator-studio/clients/ado-writer.ts`).
 *
 * Naming uses underscores per MCP spec (`^[a-zA-Z0-9_-]+$`).
 *
 * Tools:
 *   - outbox_stage_ado_comment
 *       Stage a draft comment to land on a specific ADO work item.
 *   - outbox_list
 *       List the operator's pending outbox rows so an agent can see
 *       what's already queued before staging another.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { createOutbox, listOutbox } from "@/lib/operator-studio/outbox"
import type { McpContext } from "../context.js"
import { capTextWithBudget } from "../budget.js"

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

export function registerOutboxTools(server: McpServer, ctx: McpContext) {
  // ─── outbox_stage_ado_comment ────────────────────────────────────────────
  server.registerTool(
    "outbox_stage_ado_comment",
    {
      title: "Stage ADO comment for operator approval",
      description:
        "Draft a comment to be posted on an Azure DevOps work item. Stages a row in Operator Studio's outbox; the operator proofreads and PIN-approves before the comment actually posts. Use when you've finished engineering work that resolves or progresses an ADO ticket and want to report status back to the team. NEVER call any direct ADO API — only stage via this tool.",
      inputSchema: {
        workItemId: z
          .number()
          .int()
          .positive()
          .describe(
            "ADO work-item id (e.g. 39 for the EnrollHere correlation ticket)."
          ),
        text: z
          .string()
          .min(1)
          .max(8000)
          .describe(
            "Comment body. Plain text. Will be sent verbatim to ADO. The operator may edit before approving."
          ),
        rationale: z
          .string()
          .min(1)
          .max(800)
          .describe(
            "Why this comment needs to go out — one or two sentences for the operator's review page. Not posted to ADO."
          ),
        audience: z
          .array(z.string())
          .optional()
          .describe(
            "Display-only list of stakeholders for the operator's situational awareness (e.g. ['Micky','Rob']). Not auto-mentioned in the comment."
          ),
        relatedPlanStepId: z
          .string()
          .optional()
          .describe(
            "Operator Studio plan step id this comment relates to, for cross-referencing on the preview page."
          ),
        sourceInboxEventIds: z
          .array(z.string())
          .optional()
          .describe(
            "Operator Studio inbox event ids (operator_inbox_events.id) that triggered this draft, if any."
          ),
        factoryId: z
          .string()
          .optional()
          .describe(
            "Software factory id this outbound belongs to. Defaults to factory-clarifying-telegento for ADO comments."
          ),
        workspaceId: z.string().optional(),
      },
    },
    async ({
      workItemId,
      text,
      rationale,
      audience,
      relatedPlanStepId,
      sourceInboxEventIds,
      factoryId,
      workspaceId,
    }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const row = await createOutbox({
          workspaceId: ws,
          factoryId: factoryId ?? "factory-clarifying-telegento",
          surface: "ado",
          action: "ado.addComment",
          targetId: String(workItemId),
          targetLabel: `ADO #${workItemId}`,
          audience,
          payload: { workItemId, text },
          renderedText: text,
          rationale,
          relatedPlanStepId,
          sourceInboxEventIds,
          llmRunId: ctx.reviewer,
        })
        const lines = [
          `Staged ADO #${workItemId} comment for operator review.`,
          ``,
          `Outbox row id: ${row.id}`,
          `State: ${row.state}`,
          `Preview page: /operator-studio/outbox/${row.id}`,
          ``,
          `The operator must enter their PIN and click Approve on that`,
          `page before this comment actually posts to ADO. Do not call`,
          `any direct ADO API.`,
        ]
        return textResult(lines.join("\n"))
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── outbox_list ────────────────────────────────────────────────────────
  server.registerTool(
    "outbox_list",
    {
      title: "List operator outbox rows",
      description:
        "List staged outbound rows so an agent can see what's already pending operator approval before staging another. Defaults to the awaiting_approval bucket.",
      inputSchema: {
        state: z
          .enum([
            "draft",
            "awaiting_approval",
            "approved",
            "sent",
            "rejected",
            "expired",
          ])
          .optional()
          .describe("Filter by state. Default: awaiting_approval."),
        limit: z.number().int().min(1).max(50).optional(),
        workspaceId: z.string().optional(),
      },
    },
    async ({ state, limit, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const rows = await listOutbox(ws, {
          state: state ?? "awaiting_approval",
          limit: limit ?? 20,
        })
        if (rows.length === 0) {
          return textResult(`No outbox rows in state ${state ?? "awaiting_approval"}.`)
        }
        const text = rows
          .map((r) => {
            const head = `${r.id}  [${r.state}]  ${r.surface} · ${r.action} → ${r.targetLabel ?? r.targetId}`
            const body = r.renderedText.split("\n").slice(0, 3).join("  ")
            return `${head}\n  ${body}`
          })
          .join("\n\n")
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
