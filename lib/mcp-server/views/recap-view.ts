/**
 * Markdown projection for `progress_recap`.
 *
 * Renders the window-scoped counts plus an optional comparison block
 * against a prior window (same duration immediately before `since`).
 * Deltas are framed as "vs prior window" rather than absolute numbers
 * because the agent's question is usually "am I going faster or
 * slower?" not "what's the raw count?"
 *
 * Active-plan coverage is appended as a footer — point-in-time, NOT
 * windowed. The recap is upfront about which numbers are deltas and
 * which are snapshots so the agent doesn't conflate the two.
 */

import type {
  ActivePlanCoverage,
  ProgressRecap,
} from "@/lib/operator-studio/queries"

function formatDelta(current: number, prior: number | null): string {
  if (prior === null) return ""
  if (prior === 0 && current === 0) return " _(no change)_"
  if (prior === 0) return ` _(↑ from 0)_`
  const diff = current - prior
  if (diff === 0) return " _(no change vs prior)_"
  const pct = Math.round((diff / prior) * 100)
  const arrow = diff > 0 ? "↑" : "↓"
  return ` _(${arrow} ${Math.abs(diff)}, ${pct >= 0 ? "+" : ""}${pct}% vs prior)_`
}

function formatWindowLabel(since: string, until: string): string {
  const sinceD = new Date(since)
  const untilD = new Date(until)
  const sameDay =
    sinceD.toISOString().slice(0, 10) === untilD.toISOString().slice(0, 10)
  if (sameDay) return sinceD.toISOString().slice(0, 10)
  return `${sinceD.toISOString().slice(0, 10)} → ${untilD.toISOString().slice(0, 10)}`
}

export function renderProgressRecap({
  current,
  prior,
  coverage,
  windowName,
}: {
  current: ProgressRecap
  prior: ProgressRecap | null
  coverage: ActivePlanCoverage | null
  windowName: string
}): string {
  const lines: string[] = []
  const windowLabel = formatWindowLabel(
    current.window.since,
    current.window.until
  )
  lines.push(`# Progress recap · ${windowName}`)
  lines.push(`_window: ${windowLabel}${prior ? " · with delta vs prior" : ""}_`)
  lines.push("")

  // ── Activity ──────────────────────────────────────────────────────────────
  lines.push("## Activity")
  lines.push("")
  lines.push(
    `- **${current.sessions.count}** session${current.sessions.count === 1 ? "" : "s"}${formatDelta(
      current.sessions.count,
      prior?.sessions.count ?? null
    )}`
  )
  lines.push(
    `- **${current.sessions.threadsTouched}** thread${current.sessions.threadsTouched === 1 ? "" : "s"} touched${formatDelta(
      current.sessions.threadsTouched,
      prior?.sessions.threadsTouched ?? null
    )}`
  )
  lines.push(
    `- **${current.sessions.messagesAuthored}** message${current.sessions.messagesAuthored === 1 ? "" : "s"} authored${formatDelta(
      current.sessions.messagesAuthored,
      prior?.sessions.messagesAuthored ?? null
    )}`
  )
  lines.push(
    `- **${current.threads.importedInWindow}** thread${current.threads.importedInWindow === 1 ? "" : "s"} newly imported${formatDelta(
      current.threads.importedInWindow,
      prior?.threads.importedInWindow ?? null
    )}`
  )
  lines.push("")

  // ── Wins ──────────────────────────────────────────────────────────────────
  lines.push("## Wins (promotions + ships)")
  lines.push("")
  lines.push(
    `- **${current.threads.promotedInWindow}** thread${current.threads.promotedInWindow === 1 ? "" : "s"} promoted${formatDelta(
      current.threads.promotedInWindow,
      prior?.threads.promotedInWindow ?? null
    )}`
  )
  lines.push(
    `- **${current.messages.promotedInWindow}** message${current.messages.promotedInWindow === 1 ? "" : "s"} promoted${formatDelta(
      current.messages.promotedInWindow,
      prior?.messages.promotedInWindow ?? null
    )}`
  )
  lines.push(
    `- **${current.plans.shippedInWindow}** plan${current.plans.shippedInWindow === 1 ? "" : "s"} shipped${formatDelta(
      current.plans.shippedInWindow,
      prior?.plans.shippedInWindow ?? null
    )}`
  )
  if (current.plans.archivedInWindow > 0 || (prior?.plans.archivedInWindow ?? 0) > 0) {
    lines.push(
      `- **${current.plans.archivedInWindow}** plan${current.plans.archivedInWindow === 1 ? "" : "s"} archived${formatDelta(
        current.plans.archivedInWindow,
        prior?.plans.archivedInWindow ?? null
      )}`
    )
  }
  lines.push("")

  // ── Steps newly evidenced ─────────────────────────────────────────────────
  // Honest about the proxy: we don't have a status-change audit log,
  // so "newly evidenced" = first-ever fulfillment landed in the
  // window. Close to "this is when work showed up against the step"
  // but not identical to "this step was marked covered today."
  lines.push("## Steps newly evidenced")
  lines.push(
    `_first-ever fulfillment in window — proxy for "work landed against this step"_`
  )
  lines.push("")
  lines.push(
    `- **${current.fulfillments.stepsFirstFulfilledCount}** step${current.fulfillments.stepsFirstFulfilledCount === 1 ? "" : "s"}${formatDelta(
      current.fulfillments.stepsFirstFulfilledCount,
      prior?.fulfillments.stepsFirstFulfilledCount ?? null
    )}`
  )
  lines.push(
    `- **${current.fulfillments.totalInWindow}** total fulfillment${current.fulfillments.totalInWindow === 1 ? "" : "s"} attached${formatDelta(
      current.fulfillments.totalInWindow,
      prior?.fulfillments.totalInWindow ?? null
    )}`
  )
  if (current.fulfillments.stepsFirstFulfilled.length > 0) {
    lines.push("")
    for (const s of current.fulfillments.stepsFirstFulfilled) {
      const date = s.firstFulfilledAt.slice(0, 10)
      lines.push(
        `  - \`${s.stepId}\` ${s.stepTitle} _(${s.planTitle}, ${date})_`
      )
    }
    if (
      current.fulfillments.stepsFirstFulfilledCount >
      current.fulfillments.stepsFirstFulfilled.length
    ) {
      const omitted =
        current.fulfillments.stepsFirstFulfilledCount -
        current.fulfillments.stepsFirstFulfilled.length
      lines.push(
        `  - _…and ${omitted} more. Increase \`limit\` or call \`plan_step\` on a specific id._`
      )
    }
  }
  lines.push("")

  // ── Active plan snapshot (NOT windowed) ───────────────────────────────────
  if (coverage) {
    const pct =
      coverage.totalSteps === 0
        ? 0
        : Math.round((coverage.covered / coverage.totalSteps) * 100)
    lines.push("## Active plan — point-in-time snapshot")
    lines.push(
      `_${coverage.planTitle} (\`${coverage.planId}\`) — NOT windowed; current state of the tree_`
    )
    lines.push("")
    lines.push(
      `- **${coverage.covered}/${coverage.totalSteps}** covered (${pct}%)`
    )
    lines.push(`- ${coverage.inMotion} in-motion`)
    lines.push(`- ${coverage.open} open`)
    if (coverage.skipped > 0) lines.push(`- ${coverage.skipped} skipped`)
  }

  return lines.join("\n")
}
