import type { Metadata } from "next"
import { Suspense } from "react"

import { loadActivePlan } from "@/app/2/v2/data/load"
import { loadPulseGraph, selectorFromQuery } from "@/app/2/v2/data/load-pulse"
import { PlanAndWork } from "@/app/2/v2/components/plan-and-work"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import type { PulseGraph } from "@/app/2/v2/data/load-pulse"
import {
  getShowcaseActivePlanAdapted,
  getShowcasePulseGraph,
  isShowcase,
} from "@/lib/operator-studio/showcase-loader"

// Build-time literal — `scripts/showcase-build.ts` substitutes to
// "force-static" for the showcase export.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Plan" }

/**
 * Plan + Work — combined surface. Both views mount together; a top
 * tab rail toggles which one is visible via CSS so flipping back and
 * forth is instant (no skeleton, no Pulse poll restart, no canvas
 * re-measure). The legacy /operator-studio/pulse route redirects here
 * with `?tab=work` so old links still land in the right place.
 *
 * Echo mode (no LLM endpoint configured) is detected server-side so
 * the AI-assist affordances never render in disabled state.
 */
export default function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const llmConfigured = Boolean(
    process.env.WORKBOOK_CLUSTER_ENDPOINTS ||
      process.env.WORKBOOK_FAST_ENDPOINTS ||
      process.env.WORKBOOK_BALANCED_ENDPOINTS
  )

  return (
    <Suspense fallback={<PlanSkeleton />}>
      <PlanAndWorkContent
        llmConfigured={llmConfigured}
        searchParams={searchParams}
      />
    </Suspense>
  )
}

function pickFirst(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v
  if (Array.isArray(v)) return v[0] ?? null
  return null
}

async function PlanAndWorkContent({
  llmConfigured,
  searchParams,
}: {
  llmConfigured: boolean
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const rawTab = pickFirst(params.tab)
  const tab: "plan" | "work" = rawTab === "work" ? "work" : "plan"

  if (isShowcase()) {
    return (
      <PlanAndWork
        plan={getShowcaseActivePlanAdapted()}
        pulseGraph={getShowcasePulseGraph() as PulseGraph | null}
        previousPulseGraph={null}
        initialTab={tab}
        pulseHomePrefix="/operator-studio"
        llmConfigured={false}
      />
    )
  }

  const planIdOverride = pickFirst(params.planId)
  const selector = selectorFromQuery({
    sessionId: pickFirst(params.sessionId),
    fromSessionId: pickFirst(params.fromSessionId),
    toSessionId: pickFirst(params.toSessionId),
  })
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  // Load both surfaces in parallel — the combined view mounts them
  // simultaneously and toggles with CSS, so we want both tabs' data
  // ready on first paint regardless of which one the URL picks.
  const [plan, pulseGraph] = await Promise.all([
    loadActivePlan(workspaceId, planIdOverride).catch(() => null),
    loadPulseGraph(workspaceId, selector).catch(() => null),
  ])
  // When the live session is "just getting started" (mirrors the
  // todTail < 15 min check in pulse-view.tsx), eagerly load the
  // previous session so Pulse can render it inline below a horizontal
  // rule. Keeps the surface useful before the new session has
  // accumulated anything to look at.
  const previousPulseGraph =
    pulseGraph &&
    pulseGraph.mode === "single" &&
    pulseGraph.session.durationMinutes < 15 &&
    pulseGraph.prevSessionId
      ? await loadPulseGraph(workspaceId, {
          kind: "single",
          sessionId: pulseGraph.prevSessionId,
        }).catch(() => null)
      : null
  return (
    <PlanAndWork
      plan={plan}
      pulseGraph={pulseGraph}
      previousPulseGraph={previousPulseGraph}
      initialTab={tab}
      pulseHomePrefix="/operator-studio"
      llmConfigured={llmConfigured}
    />
  )
}

function PlanSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16">
      <div className="h-3 w-40 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-6" />
      <div className="h-10 w-[70%] rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-3" />
      <div className="h-10 w-[55%] rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-12" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-sm bg-stone-200/60 dark:bg-stone-800/60 animate-pulse"
          />
        ))}
      </div>
    </div>
  )
}
