/**
 * MCP tools for plans — outline, single-step, and search.
 *
 * Design notes:
 *
 * - All three return `text` content with markdown projections (see
 *   `views/plan-view.ts`). Markdown is what LLMs actually consume best;
 *   JSON tool returns force the agent to do its own rendering.
 *
 * - `plan.outline` defaults to `maxDepth=2`. For a deeply-nested plan
 *   this is the level-of-detail cutoff that keeps responses readable.
 *   Steps deeper than maxDepth show "(N children deeper)" so the agent
 *   knows there's more without paying for it; drill down via `plan.step`.
 *
 * - `plan.search` does substring matching against title and description.
 *   We don't use the Postgres tsvector full-text path here because plan
 *   step content is small enough that a workspace-wide LIKE-style scan
 *   is fast, and substring matching gives more predictable behavior
 *   than tsvector stemming when an agent searches for things like
 *   "MCP" or step IDs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import {
  getActivePlan,
  getPlanById,
  listPlans,
} from "@/lib/operator-studio/plans"
import type { McpContext } from "../context.js"
import {
  capTextWithBudget,
  renderListWithBudget,
} from "../budget.js"
import {
  renderPlanOutline,
  renderPlanStep,
  renderSearchMatch,
} from "../views/plan-view.js"

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

export function registerPlanTools(server: McpServer, ctx: McpContext) {
  // ─── plan.outline ───────────────────────────────────────────────────────
  server.registerTool(
    "plan_outline",
    {
      title: "Plan outline",
      description:
        "Render the active plan (or a specific plan) as a depth-limited tree of titles, statuses, and step ids. Use this first to get the shape of the plan, then call `plan_step` to drill into individual steps.",
      inputSchema: {
        planId: z
          .string()
          .optional()
          .describe(
            "Specific plan id. Omit to use the active plan for the configured workspace."
          ),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .max(8)
          .optional()
          .describe(
            "Tree depth cutoff. Default 2 — top-level steps plus one level of children. Increase only if you need to see grandchildren."
          ),
        workspaceId: z
          .string()
          .optional()
          .describe("Override the configured default workspace."),
      },
    },
    async ({ planId, maxDepth, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const depth = maxDepth ?? 2
      try {
        const plan = planId
          ? await getPlanById(ws, planId)
          : await getActivePlan(ws, null, ctx.reviewer)
        if (!plan) {
          return errorResult(
            `No plan found${planId ? ` with id ${planId}` : ""} in workspace ${ws}.`
          )
        }
        const text = renderPlanOutline(plan, depth)
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── plan.step ──────────────────────────────────────────────────────────
  server.registerTool(
    "plan_step",
    {
      title: "Plan step detail",
      description:
        "Fetch full title, description, and immediate children of a single plan step. Pair with `plan_outline` to navigate the tree.",
      inputSchema: {
        stepId: z
          .string()
          .describe("Step id (the backticked id from `plan_outline`)."),
        includeChildren: z
          .boolean()
          .optional()
          .describe(
            "If true, include each child's description preview. Default false (children list only)."
          ),
        planId: z
          .string()
          .optional()
          .describe(
            "Specific plan id to look in. Omit to search the active plan, then fall back to listing every plan in the workspace."
          ),
        workspaceId: z.string().optional(),
      },
    },
    async ({ stepId, includeChildren, planId, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        // Try the named plan, then the active plan, then every plan in
        // the workspace. Step ids are workspace-unique in practice but
        // we don't enforce that here; this fallback chain catches the
        // common case where the agent has the step id but not the
        // plan id (which is exactly what we want — `plan.outline` only
        // surfaces step ids, not plan ids).
        const candidates = []
        if (planId) {
          const p = await getPlanById(ws, planId)
          if (p) candidates.push(p)
        }
        if (!planId) {
          const active = await getActivePlan(ws, null, ctx.reviewer)
          candidates.push(active)
        }
        let found = candidates
          .map((p) => ({
            plan: p,
            step: p.steps.find((s) => s.id === stepId),
          }))
          .find((m) => m.step !== undefined)

        if (!found) {
          const all = await listPlans(ws)
          for (const p of all) {
            const step = p.steps.find((s) => s.id === stepId)
            if (step) {
              found = { plan: p, step }
              break
            }
          }
        }

        if (!found || !found.step) {
          return errorResult(
            `Step ${stepId} not found in workspace ${ws}.`
          )
        }
        const text = renderPlanStep(found.plan, found.step, {
          includeChildren: includeChildren ?? false,
        })
        const capped = capTextWithBudget(text)
        return textResult(capped.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── plan.search ────────────────────────────────────────────────────────
  server.registerTool(
    "plan_search",
    {
      title: "Plan step search",
      description:
        "Substring-match against step titles and descriptions across every plan in the workspace. Returns step ids + plan breadcrumbs + a snippet of the match. Case-insensitive.",
      inputSchema: {
        query: z.string().min(1).describe("Substring to match."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max matches to return. Default 20."),
        workspaceId: z.string().optional(),
      },
    },
    async ({ query, limit, workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      const cap = limit ?? 20
      try {
        const plans = await listPlans(ws)
        const lower = query.toLowerCase()
        const matches: Array<{
          plan: (typeof plans)[number]
          step: (typeof plans)[number]["steps"][number]
        }> = []
        for (const plan of plans) {
          for (const step of plan.steps) {
            const haystack =
              `${step.title}\n${step.description ?? ""}`.toLowerCase()
            if (haystack.includes(lower)) {
              matches.push({ plan, step })
              if (matches.length >= cap) break
            }
          }
          if (matches.length >= cap) break
        }

        if (matches.length === 0) {
          return textResult(
            `No matches for "${query}" across ${plans.length} plan${plans.length === 1 ? "" : "s"} in workspace ${ws}.`
          )
        }

        const header = `# ${matches.length} match${matches.length === 1 ? "" : "es"} for "${query}"\n\n`
        const rendered = renderListWithBudget({
          items: matches,
          render: (m) => `${renderSearchMatch(m.step, m.plan, query)}\n`,
          header,
        })
        return textResult(rendered.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  // ─── plans.list ─────────────────────────────────────────────────────────
  // Useful orientation tool — "what plans exist at all?" Doesn't load
  // step trees, just titles + metadata.
  server.registerTool(
    "plans_list",
    {
      title: "List plans",
      description:
        "List every plan in the workspace, ordered like the sidebar (pinned + active first, then by recency). Returns titles, ids, state, and step counts.",
      inputSchema: {
        workspaceId: z.string().optional(),
      },
    },
    async ({ workspaceId }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const plans = await listPlans(ws)
        if (plans.length === 0) {
          return textResult(`_No plans in workspace ${ws}._`)
        }
        const header = `# Plans in workspace \`${ws}\` (${plans.length})\n\n`
        const rendered = renderListWithBudget({
          items: plans,
          render: (p) => {
            const meta: string[] = [p.state]
            if (p.pinned) meta.push("pinned")
            if (p.ownerName) meta.push(`owner: ${p.ownerName}`)
            return `- \`${p.id}\` **${p.title}** _(${meta.join(" · ")})_ — ${p.steps.length} step${p.steps.length === 1 ? "" : "s"}\n`
          },
          header,
        })
        return textResult(rendered.text)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
