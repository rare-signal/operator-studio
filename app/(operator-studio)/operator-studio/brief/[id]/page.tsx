import type { Metadata } from "next"
import { Suspense } from "react"

import { loadFullBrief, loadRecentBriefs } from "@/app/2/v2/data/load"
import { BriefView } from "@/app/2/v2/components/brief-view"
import { getSessionById } from "@/lib/operator-studio/queries"
import { defaultSessionLabel } from "@/lib/operator-studio/sessions"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (id === "today") return { title: "Brief — Today" }
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const session = await getSessionById(workspaceId, id).catch(() => null)
  const label =
    session?.label ??
    (session ? defaultSessionLabel(new Date(session.startedAt)) : null)
  return { title: label ? `Brief — ${label}` : "Brief" }
}

export default async function BriefPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <Suspense fallback={<BriefSkeleton />}>
      <BriefContent id={id} />
    </Suspense>
  )
}

async function BriefContent({ id }: { id: string }) {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const [brief, recentBriefs] = await Promise.all([
    loadFullBrief(workspaceId, id).catch(() => null),
    loadRecentBriefs(workspaceId).catch(() => []),
  ])
  return (
    <BriefView
      brief={brief}
      recentBriefs={recentBriefs}
      homePrefix="/operator-studio"
    />
  )
}

function BriefSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="h-3 w-24 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-2" />
      <div className="h-8 w-96 max-w-full rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-6" />
      <div className="space-y-4">
        <div className="h-32 rounded-md bg-stone-200/60 dark:bg-stone-800/60 animate-pulse" />
        <div className="h-48 rounded-md bg-stone-200/60 dark:bg-stone-800/60 animate-pulse" />
        <div className="h-64 rounded-md bg-stone-200/60 dark:bg-stone-800/60 animate-pulse" />
      </div>
    </div>
  )
}
