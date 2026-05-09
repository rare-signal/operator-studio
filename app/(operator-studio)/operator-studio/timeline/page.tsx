import type { Metadata } from "next"
import Link from "next/link"

import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { getTimeline } from "@/lib/operator-studio/timeline"
import { listFactories } from "@/lib/operator-studio/factories"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Timeline" }

interface SearchParams {
  factory?: string
  limit?: string
}

const KIND_DOT: Record<string, string> = {
  "inbox.ado.change": "bg-sky-500",
  "inbox.ado.comment": "bg-sky-600",
  "inbox.teams.message": "bg-violet-500",
  "inbox.other": "bg-stone-400",
  "outbox.staged": "bg-amber-400",
  "outbox.approved": "bg-emerald-400",
  "outbox.sent": "bg-emerald-600",
  "outbox.rejected": "bg-stone-500",
  "plan.touched": "bg-indigo-500",
  "review.raised": "bg-rose-400",
  "review.decided": "bg-rose-600",
  "kb.created": "bg-teal-500",
  "kb.updated": "bg-teal-400",
  "agent.bound": "bg-orange-500",
  "agent.detached": "bg-stone-500",
}

function humanAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const workspaceId = await getActiveWorkspaceId()
  const factories = await listFactories(workspaceId)
  const factoryFilter = sp.factory && sp.factory !== "all" ? sp.factory : null
  const limit = sp.limit ? Number(sp.limit) : 80

  const events = await getTimeline(workspaceId, {
    factoryId: factoryFilter,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 80,
  })

  return (
    <div className="mx-auto max-w-3xl px-3 sm:px-5 py-4 sm:py-6 space-y-4">
      <header>
        <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Operations timeline
        </p>
        <h1 className="mt-0.5 text-[18px] font-medium tracking-tight">
          What's been happening
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          A temporal narrative across upstream events, outbox staging,
          plan-step touches, review queue, KB activity, and agent
          bindings. Not another dashboard — read top-to-bottom.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">Filter:</span>
        <Link
          href="/operator-studio/timeline"
          className={`rounded border px-2 py-1 ${!factoryFilter ? "bg-foreground text-background" : "bg-card hover:bg-muted"}`}
        >
          All factories
        </Link>
        {factories.map((f) => (
          <Link
            key={f.id}
            href={`/operator-studio/timeline?factory=${encodeURIComponent(f.id)}`}
            className={`rounded border px-2 py-1 ${factoryFilter === f.id ? "bg-foreground text-background" : "bg-card hover:bg-muted"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center text-[13px] text-muted-foreground">
          No events in the last 14 days for this scope. Try Poll ADO now
          on the factory page, or stage a row via MCP{" "}
          <code className="text-[11px]">outbox_stage_ado_comment</code>.
        </div>
      ) : (
        <ol className="space-y-1.5">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg border bg-card px-3 sm:px-4 py-2.5">
              <div className="flex items-baseline gap-2 text-[11px]">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${KIND_DOT[e.kind] ?? "bg-stone-400"}`}
                  title={e.kind}
                />
                <span className="font-mono uppercase tracking-wider text-muted-foreground">
                  {e.kind}
                </span>
                {e.actor && (
                  <span className="text-foreground">{e.actor}</span>
                )}
                <time
                  className="ml-auto text-muted-foreground"
                  title={e.occurredAt}
                >
                  {humanAgo(e.occurredAt)}
                </time>
              </div>
              {e.link ? (
                <Link
                  href={e.link}
                  className="mt-1 block text-[12.5px] font-medium hover:text-primary truncate"
                >
                  {e.summary}
                </Link>
              ) : (
                <div className="mt-1 text-[12.5px] font-medium truncate">
                  {e.summary}
                </div>
              )}
              {e.detail && (
                <p className="mt-0.5 text-[11.5px] text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                  {e.detail}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
