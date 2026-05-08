import type { Metadata } from "next"
import { Suspense } from "react"

import { loadActivePlan } from "@/app/2/v2/data/load"
import { isKbEnabled, listEntries } from "@/lib/operator-studio/knowledge"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

import { OperationsDesk } from "./operations-desk"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Operations" }

/**
 * Operations — operation-plan / lane / provenance index.
 *
 * Companion to Bento (the live chat cockpit) and Plan (the strategic
 * canvas). This page renders the relationship spine:
 *   project/plan → operation plan → lane → card → thread → message
 *                                        → KB context
 *                                        → blockers / fallow / review
 *
 * Recent-agent activity is loaded entirely client-side because the
 * disk scan was the SSR bottleneck on prior versions. Plan + KB are
 * fetched server-side so the lane shells and tagged context render
 * on first paint.
 */
export default function OperationsPage() {
  return (
    <Suspense fallback={<OperationsSkeleton />}>
      <OperationsContent />
    </Suspense>
  )
}

async function OperationsContent() {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const [activePlan, kb] = await Promise.all([
    loadActivePlan(workspaceId).catch(() => null),
    (async () => {
      try {
        if (!(await isKbEnabled(workspaceId))) return []
        const entries = await listEntries(workspaceId)
        return entries.map((e) => ({
          id: e.id,
          title: e.title,
          summary: e.summary ?? "",
          tags: e.tags ?? [],
        }))
      } catch {
        return []
      }
    })(),
  ])
  return <OperationsDesk activePlan={activePlan} initialKb={kb} />

}

function OperationsSkeleton() {
  return (
    <div className="px-6 py-8">
      <div className="h-3 w-24 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-2" />
      <div className="h-8 w-72 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-3" />
      <div className="h-4 w-96 max-w-full rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-8" />
      <div className="grid grid-cols-1 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-40 rounded-md bg-stone-200/70 dark:bg-stone-800/70 animate-pulse"
          />
        ))}
      </div>
    </div>
  )
}
