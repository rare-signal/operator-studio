/**
 * pnpm os:operations — fast operations control-loop unfold for agents.
 *
 * Where `pnpm os:context` answers "what plan/scope am I in?" and
 * `pnpm os:state` answers "what's the operational snapshot?", this
 * answers "where is work actually moving (or not) right now?"
 *
 * It runs the same `deriveOperationsControlLoop` the Operations page
 * uses, then renders a concise plain-text view: lanes, cards needing
 * attention, stale/fallow/review-ready items, and the recommended
 * next action. Designed for an agent's startup unfold.
 *
 *   pnpm os:operations                  # plain text
 *   pnpm os:operations --json           # machine-readable
 *   pnpm os:operations --workspace=ID   # default: global
 *   pnpm os:operations --plan=PLAN_ID   # override active plan
 *   pnpm os:operations --all            # include landed + queued cards
 */

import {
  type ControlLoopStatus,
  type OperationsCard,
  type OperationsControlLoopView,
} from "../lib/operator-studio/operations"
import {
  type LaunchWaveLedger,
  type LaunchWaveRecord,
} from "../lib/operator-studio/launch-waves"
import { buildOperationsPayload } from "../lib/operator-studio/operations-payload"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"

interface Options {
  workspaceId: string
  planId: string | null
  json: boolean
  all: boolean
}

function parseArgs(argv: string[]): Options {
  let workspaceId = GLOBAL_WORKSPACE_ID
  let planId: string | null = null
  let json = false
  let all = false
  for (const a of argv) {
    if (a === "--json") json = true
    else if (a === "--all") all = true
    else if (a.startsWith("--workspace=")) workspaceId = a.slice(12) || workspaceId
    else if (a.startsWith("--plan=")) planId = a.slice(7) || null
    else if (a === "-h" || a === "--help") {
      console.error(
        "usage: pnpm os:operations [--json] [--all] [--workspace=ID] [--plan=PLAN_ID]"
      )
      process.exit(0)
    }
  }
  return { workspaceId, planId, json, all }
}

const STATUS_GLYPH: Record<ControlLoopStatus, string> = {
  actioning: "▶",
  arming: "·",
  fallow: "◌",
  review: "?",
  blocked: "!",
  landed: "✓",
  queued: "○",
}

function fmtAge(ms: number): string {
  if (!Number.isFinite(ms)) return "—"
  const m = Math.round(ms / 60_000)
  if (m < 1) return "<1m"
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

function fmtCard(c: OperationsCard): string[] {
  const lines: string[] = []
  const glyph = STATUS_GLYPH[c.controlLoopStatus]
  const attn = c.needsAttention ? " ⚠" : ""
  lines.push(
    `  ${glyph} [${c.controlLoopStatus}] ${c.title}${attn}`
  )
  lines.push(`      ${c.stepId} · ${c.reason}`)
  if (c.nextAction) {
    lines.push(`      next: ${c.nextAction.kind} — ${c.nextAction.label}`)
  }
  if (c.workers.length > 0) {
    const w = c.workers
      .map((wk) => `${wk.kind}:${wk.agentId.slice(-6)} (${fmtAge(wk.ageMs)})`)
      .join(", ")
    lines.push(`      workers: ${w}`)
  }
  if (c.evidence.length > 0) {
    lines.push(`      evidence: ${c.evidence.length} review item(s) waiting`)
  }
  if (c.recommendations.length > 0) {
    const open = c.recommendations.filter(
      (r) => r.status === "proposed" || r.status === "approved"
    )
    if (open.length > 0) {
      lines.push(
        `      rec: ${open[0].kind} — ${open[0].title}${open.length > 1 ? ` (+${open.length - 1})` : ""}`
      )
    }
  }
  return lines
}

function renderOperations(view: OperationsControlLoopView, all: boolean): string {
  const lines: string[] = []
  const t = view.totals
  lines.push(`# Operations control loop — generated ${view.generatedAt}`)
  if (!view.planId) {
    lines.push("")
    lines.push("(no active plan in this workspace — nothing on the loop yet.)")
    lines.push("Suggested next: pnpm plan:card upsert --title='...' to seed a plan, or")
    lines.push("set an active plan via Operator Studio.")
    return lines.join("\n")
  }
  lines.push(
    `Plan: ${view.planTitle} [${view.planId}] state=${view.planState ?? "?"}`
  )
  lines.push(
    `Totals: actioning=${t.actioning} arming=${t.arming} fallow=${t.fallow} review=${t.review} blocked=${t.blocked} landed=${t.landed} queued=${t.queued} · needs-attention=${view.needsAttentionCount}`
  )

  // Headline rollups across lanes — what an agent should see first.
  const allCards: OperationsCard[] = view.lanes.flatMap((l) => l.cards)
  const attention = allCards.filter((c) => c.needsAttention)
  const fallow = allCards.filter((c) => c.controlLoopStatus === "fallow")
  const review = allCards.filter((c) => c.controlLoopStatus === "review")
  const blocked = allCards.filter((c) => c.controlLoopStatus === "blocked")
  const actioning = allCards.filter((c) => c.controlLoopStatus === "actioning")

  lines.push("")
  lines.push(`## Needs attention (${attention.length})`)
  if (attention.length === 0) {
    lines.push("  (none — nothing waiting on David's eye.)")
  } else {
    for (const c of attention.slice(0, 8)) lines.push(...fmtCard(c))
  }

  lines.push("")
  lines.push(`## Live now — actioning (${actioning.length})`)
  if (actioning.length === 0) {
    lines.push("  (none — no worker is writing right now.)")
  } else {
    for (const c of actioning.slice(0, 6)) lines.push(...fmtCard(c))
  }

  lines.push("")
  lines.push(`## Stale / fallow (${fallow.length})`)
  if (fallow.length === 0) {
    lines.push("  (none — no in-motion card has gone idle past threshold.)")
  } else {
    for (const c of fallow.slice(0, 6)) lines.push(...fmtCard(c))
  }

  lines.push("")
  lines.push(`## Review-ready (${review.length})`)
  if (review.length === 0) {
    lines.push("  (none — no covered cards have evidence pending review.)")
  } else {
    for (const c of review.slice(0, 6)) lines.push(...fmtCard(c))
  }

  lines.push("")
  lines.push(`## Blocked (${blocked.length})`)
  if (blocked.length === 0) {
    lines.push("  (none — no explicit blockers on the loop.)")
  } else {
    for (const c of blocked.slice(0, 6)) lines.push(...fmtCard(c))
  }

  lines.push("")
  lines.push(`## Lanes (${view.lanes.length})`)
  for (const lane of view.lanes) {
    if (lane.cards.length === 0) continue
    const c = lane.counts
    lines.push(
      `### ${lane.title} — ${lane.cards.length} card(s) · actioning=${c.actioning} arming=${c.arming} fallow=${c.fallow} review=${c.review} blocked=${c.blocked} landed=${c.landed} queued=${c.queued}`
    )
    const cards = all
      ? lane.cards
      : lane.cards.filter(
          (c) => c.controlLoopStatus !== "landed" && c.controlLoopStatus !== "queued"
        )
    if (cards.length === 0) {
      lines.push("  (only landed/queued cards in this lane — pass --all to list.)")
      continue
    }
    for (const card of cards.slice(0, 6)) lines.push(...fmtCard(card))
    if (cards.length > 6) {
      lines.push(`  … +${cards.length - 6} more (--all or open Operations page)`)
    }
  }

  if (view.unboundWorkers.length > 0) {
    lines.push("")
    lines.push(`## Unbound workers (${view.unboundWorkers.length})`)
    lines.push(
      "  These workers are running but not bound to a card in the active plan."
    )
    for (const w of view.unboundWorkers.slice(0, 6)) {
      lines.push(
        `  - ${w.kind}:${w.agentId.slice(-8)} ${w.isLive ? "LIVE" : fmtAge(w.ageMs)} — ${w.headline.slice(0, 80)}`
      )
    }
  }

  lines.push("")
  lines.push(`## Next actions (${view.nextActions.length})`)
  if (view.nextActions.length === 0) {
    lines.push("  (no open executive recommendations — agent should pick from")
    lines.push("   the Needs-attention list above, or scan the plan.)")
  } else {
    for (const r of view.nextActions) {
      lines.push(`  - [${r.kind}/${r.risk}] ${r.title}`)
      if (r.planStepId) lines.push(`      step: ${r.planStepId}`)
      if (r.rationale) lines.push(`      why: ${r.rationale.slice(0, 140)}`)
    }
  }

  // Recommended single action — picked from the same priority order
  // the UI uses (request_review > continue > launch > mark_covered).
  lines.push("")
  lines.push("## Recommended next")
  const rec = pickRecommended(view, attention, fallow, review)
  lines.push(`  ${rec}`)

  return lines.join("\n")
}

function renderLaunchWave(wave: LaunchWaveRecord): string[] {
  const sourceSummary =
    wave.sourceCounts.length > 0
      ? wave.sourceCounts
          .map((s) => `${s.source}=${s.count}${s.active ? `/${s.active} active` : ""}`)
          .join(" ")
      : "sources=none"
  const statusSummary = Object.entries(wave.statuses)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}=${count}`)
    .join(" ")
  const lines = [
    `  - ${wave.id} · launched=${wave.launchedAt ?? "?"} lastSeen=${wave.lastSeenAt ?? "?"}`,
    `      ${sourceSummary}${statusSummary ? ` · ${statusSummary}` : ""}`,
  ]
  for (const card of wave.boundCards.slice(0, 4)) {
    lines.push(
      `      card: ${card.planStepId}${card.planStepTitle ? ` — ${card.planStepTitle}` : ""}`
    )
  }
  if (wave.boundCards.length > 4) {
    lines.push(`      … +${wave.boundCards.length - 4} more card(s)`)
  }
  return lines
}

function renderLaunchWaveLedger(ledger: LaunchWaveLedger): string {
  const lines: string[] = []
  lines.push("")
  lines.push(
    `## Launch waves by source (${ledger.totals.waves} wave${ledger.totals.waves === 1 ? "" : "s"}, ${ledger.totals.launches} launch fact${ledger.totals.launches === 1 ? "" : "s"})`
  )
  if (ledger.emptyState) {
    lines.push(`  ${ledger.emptyState.title} — ${ledger.emptyState.body}`)
    return lines.join("\n")
  }
  const sourceSummary =
    ledger.totals.sourceCounts.length > 0
      ? ledger.totals.sourceCounts
          .map((s) => `${s.source}=${s.count}${s.active ? `/${s.active} active` : ""}`)
          .join(" ")
      : "none"
  const kindSummary =
    ledger.totals.kindCounts.length > 0
      ? ledger.totals.kindCounts.map((k) => `${k.kind}=${k.count}`).join(" ")
      : "none"
  lines.push(`  sources: ${sourceSummary}`)
  lines.push(`  binding kinds: ${kindSummary}`)
  for (const wave of ledger.waves.slice(0, 6)) {
    lines.push(...renderLaunchWave(wave))
  }
  if (ledger.waves.length > 6) {
    lines.push(`  … +${ledger.waves.length - 6} more wave(s)`)
  }
  return lines.join("\n")
}

function pickRecommended(
  view: OperationsControlLoopView,
  attention: OperationsCard[],
  fallow: OperationsCard[],
  review: OperationsCard[]
): string {
  if (view.nextActions.length > 0) {
    const a = view.nextActions[0]
    return `Act on executive recommendation: [${a.kind}] ${a.title}`
  }
  if (review.length > 0) {
    return `Review evidence on ${review[0].title} (${review[0].stepId}) — ${review[0].evidence.length} item(s) pending.`
  }
  if (fallow.length > 0) {
    return `Re-attach a worker to fallow card: ${fallow[0].title} (${fallow[0].stepId}) — ${fallow[0].reason}.`
  }
  if (attention.length > 0) {
    return `Inspect attention card: ${attention[0].title} (${attention[0].stepId}) — ${attention[0].reason}.`
  }
  return "Loop is idle — pick the highest-priority open card from the plan and launch a worker."
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  try {
    const payload = await buildOperationsPayload({
      workspaceId: opts.workspaceId,
      planId: opts.planId,
      recentLimit: 24,
    })

    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log(renderOperations(payload.view, opts.all))
      console.log(renderLaunchWaveLedger(payload.launchWaveLedger))
    }
  } catch (e) {
    console.error("os:operations failed:", (e as Error).message)
    console.error((e as Error).stack?.split("\n").slice(0, 12).join("\n"))
    process.exitCode = 1
  } finally {
    await getPgPool().end()
  }
}

main()
