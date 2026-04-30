import type { Metadata } from "next"
import { Suspense } from "react"

import {
  loadActivePlan,
  loadDriftRecovery,
  loadTodayBriefPreview,
} from "@/app/2/v2/data/load"
import { TodayView } from "@/app/2/v2/components/today-view"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Today" }

/**
 * Today — the daily landing surface. Shell lives in the layout, so
 * this page just renders its content. Async work runs inside a
 * <Suspense> boundary so navigation feels instant: the shell is
 * already mounted, the skeleton paints while data resolves.
 */
export default function TodayPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayContent />
    </Suspense>
  )
}

async function TodayContent() {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const [activePlan, driftRecovery, briefPreview] = await Promise.all([
    loadActivePlan(workspaceId).catch(() => null),
    loadDriftRecovery(workspaceId).catch(() => null),
    loadTodayBriefPreview(workspaceId).catch(() => null),
  ])
  return (
    <TodayView
      activePlan={activePlan}
      driftRecovery={driftRecovery}
      briefPreview={briefPreview}
      homePrefix="/operator-studio"
    />
  )
}

function TodaySkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="h-3 w-24 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-2" />
      <div className="h-8 w-72 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-3" />
      <div className="h-4 w-96 max-w-full rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse" />
      <div className="mt-8 space-y-4">
        <div className="h-28 rounded-md bg-stone-200/70 dark:bg-stone-800/70 animate-pulse" />
        <div className="h-28 rounded-md bg-stone-200/70 dark:bg-stone-800/70 animate-pulse" />
        <div className="h-28 rounded-md bg-stone-200/70 dark:bg-stone-800/70 animate-pulse" />
      </div>
    </div>
  )
}
