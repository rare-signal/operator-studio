import "server-only"

import { getFactory, renderFactoryContextHeader } from "./factories"
import { getRecencyContext, renderRecencyContext } from "./recency-context"

/**
 * Agent startup manifest — the smallest contract a fresh
 * Claude/Codex/Hermes/local-model worker should read before doing
 * anything in this workspace.
 *
 * Per `step-agent-startup-tool-manifest` from the 2026-05-08 review.
 *
 * One source of truth, three consumers:
 *   - MCP tool `agent_startup_manifest` (registered in
 *     lib/mcp-server/tools/work-context.ts or similar)
 *   - CLI: `pnpm tsx scripts/agent-prompt.ts [factoryId]`
 *   - Internal: any future agent-launch path (F5) that wants the
 *     bundle baked into its launch prompt
 *
 * Output is plain text, ≤300 lines on a typical workspace,
 * structured so an LLM can grep-style it (stable headers,
 * verb-noun action lines).
 */

export interface RenderManifestOptions {
  workspaceId: string
  /** Active factory the agent is being dispatched to. Defaults to
   *  factory-clarifying-telegento (the JSA lane). */
  factoryId?: string
}

const TOOLS_FIRST_RULES = [
  "1. Use Operator Studio tools FIRST. Do not write product-native records to the filesystem.",
  "   - KB articles + claims    → MCP knowledge_*       (NOT *.md files)",
  "   - Plan cards               → MCP plan_*            (NOT a TODO.md)",
  "   - Outbox stage             → MCP outbox_stage_*    (NEVER `az boards` / Teams API directly)",
  "   - Inbox poll               → POST /api/operator-studio/ingest/ado",
  "   - Active context           → MCP work_context_*    /  pnpm os:context",
  "",
  "2. Outbound communication is gated. NEVER send a Teams message, ADO comment, or",
  "   stakeholder ping outside the outbox. The outbox writer enforces a per-row,",
  "   payload-hash-bound, PIN-armed approval before anything reaches an external surface.",
  "",
  "3. Bound to ONE factory. Do not edit other factories' code. The launch context",
  "   names your repo + product. Stay inside it.",
  "",
  "4. Honest about uncertainty. If you can't do something, say so and stage a request",
  "   for the operator. Do not invent state, IDs, or commit hashes.",
  "",
  "5. Mark thread done. When you finish, end with the configured done-phrase",
  "   (default: `task_done`) so Operator Studio's watcher closes the loop.",
]

const FIRST_MOVES = [
  "First moves on a fresh dispatch:",
  "  a. Read the FACTORY CONTEXT block above to know your repo / product / audience.",
  "  b. Run `pnpm os:context` (or call MCP work_context_*) to see what's hot RIGHT NOW.",
  "  c. If a card was named at launch, MCP plan_step <id> to read it in full.",
  "  d. If you need stakeholder context (a comment thread, a ticket history),",
  "     check the Inbox panel of /operator-studio/factory/<your-factory> — do NOT",
  "     re-implement an ADO/Teams reader. Use what's already there.",
  "  e. Engineer in your bound repo. When you have something to say to the team,",
  "     stage it via MCP outbox_stage_ado_comment.",
]

export async function renderAgentManifest(
  opts: RenderManifestOptions
): Promise<string> {
  const factoryId = opts.factoryId ?? "factory-clarifying-telegento"
  const factory = await getFactory(opts.workspaceId, factoryId)

  const lines: string[] = []
  lines.push(`# Operator Studio agent startup manifest`)
  lines.push(
    `# Source: lib/operator-studio/agent-manifest.ts. Do not paraphrase — copy verbatim.`
  )
  lines.push(``)

  if (factory) {
    lines.push(renderFactoryContextHeader(factory))
    lines.push(``)
  } else {
    lines.push(`[FACTORY CONTEXT]`)
    lines.push(`Factory '${factoryId}' not found in workspace ${opts.workspaceId}.`)
    lines.push(`List factories at /operator-studio/factory or via the database.`)
    lines.push(`[/FACTORY CONTEXT]`)
    lines.push(``)
  }

  lines.push(`## Rules of engagement`)
  for (const r of TOOLS_FIRST_RULES) lines.push(r)
  lines.push(``)
  for (const m of FIRST_MOVES) lines.push(m)
  lines.push(``)

  // Inline the recency packet so the agent has "what's hot right now"
  // without a second tool call.
  try {
    const recency = await getRecencyContext(opts.workspaceId)
    lines.push(renderRecencyContext(recency))
  } catch (err) {
    lines.push(`## Recency`)
    lines.push(
      `(unavailable — ${err instanceof Error ? err.message : String(err)})`
    )
  }

  return lines.join("\n")
}
