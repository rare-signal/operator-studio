import Link from "next/link"
import { Compass, Pin, Plus, Target, Trophy } from "lucide-react"

import { listPlans } from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { Button } from "@/registry/new-york-v4/ui/button"

export const dynamic = "force-dynamic"

const STATE_TONE: Record<string, string> = {
  drafting: "text-amber-700 dark:text-amber-300 bg-amber-500/10",
  active: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10",
  paused: "text-stone-600 dark:text-stone-400 bg-stone-500/10",
  shipped: "text-blue-700 dark:text-blue-300 bg-blue-500/10",
  archived: "text-stone-500 dark:text-stone-500 bg-stone-500/10",
}

export default async function PlansPage() {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const plans = await listPlans(workspaceId).catch(() => [])

  return (
    <div className="mx-auto max-w-4xl px-8 py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Plans
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            All plans
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every durable unit of intent in this workspace. Pinned and
            active plans first, then by recency.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/operator-studio/plan">
            <Plus className="mr-1 size-4" />
            New plan
          </Link>
        </Button>
      </header>

      {plans.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 px-6 py-16 text-center">
          <Compass className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No plans yet. Start one from the Plan page.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-4">
            <Link href="/operator-studio/plan">
              <Plus className="mr-1 size-4" />
              New plan
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {plans.map((plan) => {
            const stepCount = plan.steps.length
            const doneCount = plan.steps.filter(
              (s) => s.status === "covered"
            ).length
            const tone = STATE_TONE[plan.state] ?? STATE_TONE.drafting
            return (
              <li key={plan.id}>
                <Link
                  href="/operator-studio/plan"
                  className="block rounded-md border border-stone-200 dark:border-stone-800 bg-card px-4 py-3 hover:border-stone-300 dark:hover:border-stone-700 hover:bg-accent/40 transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Target className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {plan.title || "Untitled plan"}
                    </span>
                    {plan.pinned && (
                      <Pin className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    )}
                    {plan.state === "shipped" && (
                      <Trophy className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
                    )}
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone}`}
                    >
                      {plan.state}
                    </span>
                  </div>
                  {plan.goal && (
                    <p className="ml-5 mt-1 truncate text-xs text-muted-foreground">
                      {plan.goal}
                    </p>
                  )}
                  <div className="ml-5 mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">
                      {stepCount === 0
                        ? "no steps"
                        : `${doneCount}/${stepCount} step${stepCount === 1 ? "" : "s"}`}
                    </span>
                    <span>·</span>
                    <span>updated {formatRelative(plan.updatedAt)}</span>
                    {plan.ownerName && (
                      <>
                        <span>·</span>
                        <span className="truncate">
                          owner {plan.ownerName}
                        </span>
                      </>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const diffMs = Date.now() - t
  const min = Math.round(diffMs / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}
