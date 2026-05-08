"use client"

import * as React from "react"
import Link from "next/link"

import type { OutboxRow, OutboxState } from "@/lib/operator-studio/outbox"

const STATE_LABELS: Record<OutboxState, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved (in flight)",
  sent: "Sent",
  rejected: "Rejected",
  expired: "Expired",
}

const STATE_DOT: Record<OutboxState, string> = {
  draft: "bg-stone-400",
  awaiting_approval: "bg-amber-500",
  approved: "bg-sky-500",
  sent: "bg-emerald-500",
  rejected: "bg-stone-500",
  expired: "bg-stone-400",
}

interface Props {
  initialItems: OutboxRow[]
  initialCounts: Record<OutboxState, number>
}

export function OutboxListClient({ initialItems, initialCounts }: Props) {
  const [items] = React.useState<OutboxRow[]>(initialItems)
  const [counts] = React.useState<Record<OutboxState, number>>(initialCounts)

  return (
    <div className="mx-auto max-w-5xl px-5 py-6">
      <header className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-[18px] font-medium tracking-tight">Outbox</h1>
        <p className="text-[12px] text-muted-foreground">
          Every outbound communication staged for proofread + per-row, PIN-armed
          approval. Nothing leaves the machine without your keys.
        </p>
      </header>
      <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
        {(Object.keys(STATE_LABELS) as OutboxState[]).map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 rounded border bg-card px-2 py-1"
          >
            <span className={`size-1.5 rounded-full ${STATE_DOT[s]}`} />
            {STATE_LABELS[s]} · {counts[s] ?? 0}
          </span>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border bg-card px-5 py-8 text-center text-[13px] text-muted-foreground">
          No outbox rows yet. Agents stage outbound here via{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
            POST /api/operator-studio/outbox
          </code>
          .
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((row) => (
            <li key={row.id} className="px-4 py-3">
              <Link
                href={`/operator-studio/outbox/${row.id}`}
                className="block hover:bg-muted/40 -mx-4 -my-3 px-4 py-3 rounded-md"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[row.state]}`}
                      title={STATE_LABELS[row.state]}
                    />
                    <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                      {row.surface} · {row.action}
                    </span>
                    <span className="text-[12px] font-medium truncate">
                      {row.targetLabel ?? row.targetId}
                    </span>
                  </div>
                  <time
                    className="text-[10px] text-muted-foreground shrink-0"
                    title={row.proposedAt}
                  >
                    {new Date(row.proposedAt).toLocaleString()}
                  </time>
                </div>
                <p className="mt-1 text-[12px] text-foreground/85 line-clamp-2 whitespace-pre-wrap">
                  {row.renderedText}
                </p>
                {row.rationale && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground line-clamp-1">
                    {row.rationale}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
