/**
 * Token budgeting for MCP tool responses.
 *
 * Every read tool returns text content with a hard cap. We approximate
 * tokens at 4 chars/token (close enough for English; LLM tokenizers
 * vary). When a response would overflow, we truncate explicitly and
 * emit a "truncated" footer with a hint about how to narrow the query
 * — never silent.
 *
 * Why a budget at all: the entire point of this MCP server is to keep
 * agent context small. A plan with 200 deeply-nested steps could blow
 * out a context window if rendered raw. Truncating with a visible
 * marker gives the agent a chance to drill down with a follow-up call
 * (`plan.step`, `plan.search`) instead of silently losing data.
 */

/** Default per-tool response budget, in approximate tokens. */
export const DEFAULT_BUDGET_TOKENS = 8000

/** Coarse char→token approximation. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Render a list of items into text under a token budget.
 *
 * Each item is rendered via `render`. Items are appended one at a time
 * until adding the next item would exceed the budget. When that
 * happens, we emit a truncation footer and stop. Returns the assembled
 * text plus stats so the caller can decide whether to attach extra
 * metadata (e.g. structuredContent for the MCP client).
 */
export function renderListWithBudget<T>({
  items,
  render,
  header = "",
  footerWhenTruncated,
  budgetTokens = DEFAULT_BUDGET_TOKENS,
}: {
  items: T[]
  render: (item: T, index: number) => string
  header?: string
  footerWhenTruncated?: (omitted: number, total: number) => string
  budgetTokens?: number
}): { text: string; emitted: number; truncated: boolean } {
  const budgetChars = budgetTokens * 4
  let body = header
  let emitted = 0

  for (let i = 0; i < items.length; i++) {
    const piece = render(items[i], i)
    if (body.length + piece.length > budgetChars) break
    body += piece
    emitted++
  }

  const truncated = emitted < items.length
  if (truncated) {
    const omitted = items.length - emitted
    body += "\n"
    body +=
      footerWhenTruncated?.(omitted, items.length) ??
      `\n[truncated: ${omitted} of ${items.length} items omitted to fit token budget. Narrow your query or call drill-down tools (plan.step, thread.summary) for specific items.]\n`
  }

  return { text: body, emitted, truncated }
}

/**
 * Cap a single string at the budget. Used for free-form content like
 * thread summaries where we don't want to silently drop the tail.
 */
export function capTextWithBudget(
  text: string,
  budgetTokens: number = DEFAULT_BUDGET_TOKENS
): { text: string; truncated: boolean } {
  const budgetChars = budgetTokens * 4
  if (text.length <= budgetChars) return { text, truncated: false }
  const head = text.slice(0, budgetChars)
  return {
    text: `${head}\n\n[truncated: response exceeded ${budgetTokens}-token budget; tail omitted. Use a more specific tool to fetch a targeted slice.]`,
    truncated: true,
  }
}
