"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import type {
  FactoryPlanStep,
  SoftwareFactory,
} from "@/lib/operator-studio/factories"
import type { OutboxRow } from "@/lib/operator-studio/outbox"
import type { InboxEvent } from "@/lib/operator-studio/inbox"
import type { AdoSchedulerStatus } from "@/lib/operator-studio/ingest/ado-scheduler"

interface Props {
  factory: SoftwareFactory
  contextHeader: string
  awaitingOutbox: OutboxRow[]
  recentOutbox: OutboxRow[]
  recentInbox: InboxEvent[]
  planSteps: FactoryPlanStep[]
  schedulerStatus: AdoSchedulerStatus
}

const STATUS_DOT: Record<string, string> = {
  "in-motion": "bg-amber-500",
  open: "bg-stone-400",
  covered: "bg-emerald-500",
  skipped: "bg-stone-300",
}

const STATUS_ORDER: Record<string, number> = {
  "in-motion": 0,
  open: 1,
  covered: 2,
  skipped: 3,
}

export function FactoryViewClient({
  factory,
  contextHeader,
  awaitingOutbox,
  recentOutbox,
  recentInbox,
  planSteps,
  schedulerStatus,
}: Props) {
  const stepCounts = planSteps.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})
  const sortedSteps = [...planSteps].sort((a, b) => {
    const da = STATUS_ORDER[a.status] ?? 9
    const db = STATUS_ORDER[b.status] ?? 9
    if (da !== db) return da - db
    return b.updatedAt.localeCompare(a.updatedAt)
  })
  const router = useRouter()
  const [copied, setCopied] = React.useState(false)
  const [polling, setPolling] = React.useState(false)
  const [pollResult, setPollResult] = React.useState<null | {
    finishedAt: string
    itemsSeen: number
    rowsIngested: number
    rowsSkippedDuplicate: number
    commentsIngested: number
    commentsSkippedDuplicate: number
    error?: string
  }>(null)

  function copyHeader() {
    navigator.clipboard.writeText(contextHeader).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined
    )
  }

  async function pollAdoNow() {
    setPolling(true)
    setPollResult(null)
    try {
      const r = await fetch("/api/operator-studio/ingest/ado", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factoryId: factory.id }),
      })
      const data = await r.json()
      if (!r.ok) {
        setPollResult({
          finishedAt: new Date().toISOString(),
          itemsSeen: 0,
          rowsIngested: 0,
          rowsSkippedDuplicate: 0,
          commentsIngested: 0,
          commentsSkippedDuplicate: 0,
          error: data?.error ?? "poll failed",
        })
      } else {
        setPollResult({
          finishedAt: data.pollFinishedAt,
          itemsSeen: data.itemsSeen,
          rowsIngested: data.rowsIngested,
          rowsSkippedDuplicate: data.rowsSkippedDuplicate,
          commentsIngested: data.commentsIngested ?? 0,
          commentsSkippedDuplicate: data.commentsSkippedDuplicate ?? 0,
          error: data.errors?.[0],
        })
        if (data.rowsIngested > 0 || data.commentsIngested > 0)
          router.refresh()
      }
    } catch (err) {
      setPollResult({
        finishedAt: new Date().toISOString(),
        itemsSeen: 0,
        rowsIngested: 0,
        rowsSkippedDuplicate: 0,
        commentsIngested: 0,
        commentsSkippedDuplicate: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setPolling(false)
    }
  }

  // Latest ado event timestamp = de-facto "last seen ADO change".
  const lastAdoEvent =
    recentInbox.find((e) => e.surface === "ado")?.occurredAt ?? null

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 sm:px-5 sm:py-6 space-y-4 sm:space-y-6">
      <header>
        <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Software factory
        </p>
        <h1 className="mt-0.5 text-[20px] font-medium tracking-tight">
          {factory.label}
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {factory.orgName} · {factory.productName}
          {factory.productProdUrl && (
            <>
              {" · "}
              <a
                href={factory.productProdUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {factory.productProdUrl.replace(/^https?:\/\//, "")}
              </a>
            </>
          )}
        </p>
      </header>

      {/* Identity / system map */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-3 sm:px-4 py-2 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Factory identity
          </span>
          <span className="text-[10px] text-muted-foreground">
            id <code className="font-mono">{factory.id}</code>
          </span>
        </div>
        <dl className="grid grid-cols-[110px_1fr] sm:grid-cols-[160px_1fr] gap-x-3 sm:gap-x-4 gap-y-1.5 px-4 py-3 text-[12px]">
          <dt className="text-muted-foreground">Repo path</dt>
          <dd className="font-mono break-all">
            {factory.productRepoPath ?? "—"}
          </dd>
          <dt className="text-muted-foreground">Prod URL</dt>
          <dd>
            {factory.productProdUrl ? (
              <a
                href={factory.productProdUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {factory.productProdUrl}
              </a>
            ) : (
              "—"
            )}
          </dd>
          {factory.commsSubstrates.length > 0 && (
            <>
              <dt className="text-muted-foreground">Comms substrates</dt>
              <dd className="space-y-1">
                {factory.commsSubstrates.map((s, i) => (
                  <div key={i} className="font-mono text-[11px]">
                    <span className="text-foreground">{s.kind}</span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {Object.entries(s.details)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(", ")}
                    </span>
                  </div>
                ))}
              </dd>
            </>
          )}
          {factory.audience.length > 0 && (
            <>
              <dt className="text-muted-foreground">Audience</dt>
              <dd>
                <ul className="space-y-1">
                  {factory.audience.map((a, i) => (
                    <li key={i}>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground">
                        {" — "}
                        {a.role}
                      </span>
                      {a.identity && (
                        <span className="ml-2 text-[11px] font-mono text-muted-foreground">
                          {a.identity}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          {factory.operatorNotes && (
            <>
              <dt className="text-muted-foreground">Operator notes</dt>
              <dd className="italic">{factory.operatorNotes}</dd>
            </>
          )}
        </dl>
      </section>

      {/* Inbox */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Inbox · upstream events
          </span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
            {schedulerStatus.enabled ? (
              <span
                className={`inline-flex items-center gap-1 ${
                  schedulerStatus.running
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-stone-500"
                }`}
                title={
                  schedulerStatus.lastTickFinishedAt
                    ? `last tick ${new Date(schedulerStatus.lastTickFinishedAt).toLocaleString()}`
                    : "scheduler armed; first tick pending"
                }
              >
                <span
                  className={`size-1.5 rounded-full ${
                    schedulerStatus.running ? "bg-emerald-500" : "bg-stone-400"
                  }`}
                />
                auto every {Math.round(schedulerStatus.intervalMs / 1000)}s
                {schedulerStatus.ticks > 0 && ` · ${schedulerStatus.ticks} ticks`}
              </span>
            ) : (
              <span
                className="text-muted-foreground"
                title="set OPERATOR_STUDIO_ADO_AUTOPOLL=true to enable auto-poll"
              >
                auto-poll off
              </span>
            )}
            {lastAdoEvent && (
              <span
                className="text-muted-foreground"
                title={lastAdoEvent}
              >
                last ADO event {new Date(lastAdoEvent).toLocaleString()}
              </span>
            )}
            <button
              type="button"
              onClick={pollAdoNow}
              disabled={polling}
              className="rounded border bg-background px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
              title="Run an ADO poll now (read-only)"
            >
              {polling ? "Polling…" : "Poll ADO now"}
            </button>
          </div>
        </div>
        {pollResult && (
          <div
            className={`border-b px-4 py-1.5 text-[11px] ${
              pollResult.error
                ? "bg-red-500/10 text-red-700 dark:text-red-400"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {pollResult.error
              ? `Poll error: ${pollResult.error}`
              : `Polled at ${new Date(pollResult.finishedAt).toLocaleTimeString()} · seen=${pollResult.itemsSeen} · new=${pollResult.rowsIngested} · dedup=${pollResult.rowsSkippedDuplicate} · comments_new=${pollResult.commentsIngested} · comments_dedup=${pollResult.commentsSkippedDuplicate}`}
          </div>
        )}
        {recentInbox.length === 0 ? (
          <p className="px-3 sm:px-4 py-4 text-[12px] text-muted-foreground">
            No upstream events yet for this factory. ADO comments, state
            transitions, Teams posts, and stakeholder requests will land
            here when ingest is wired.
          </p>
        ) : (
          <ul className="divide-y">
            {recentInbox.map((ev) => (
              <li key={ev.id} className="px-3 sm:px-4 py-2.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="font-mono uppercase tracking-wider text-muted-foreground">
                    {ev.surface} · {ev.upstreamKind}
                  </span>
                  {ev.actorName && (
                    <span className="text-foreground">{ev.actorName}</span>
                  )}
                  <time
                    className="ml-auto text-muted-foreground"
                    title={ev.occurredAt}
                  >
                    {new Date(ev.occurredAt).toLocaleString()}
                  </time>
                </div>
                {ev.textExcerpt && (
                  <p className="mt-1 text-[12px] line-clamp-2 whitespace-pre-wrap">
                    {ev.textExcerpt}
                  </p>
                )}
                {ev.llmInitialLog && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground line-clamp-2">
                    LLM read: {ev.llmInitialLog}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Plan — steps tagged to this factory */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-3 sm:px-4 py-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Plan · steps tagged to this factory
          </span>
          <span className="text-[10px] text-muted-foreground">
            {planSteps.length} total
            {Object.entries(stepCounts).map(([s, n]) => (
              <span key={s} className="ml-2">
                {s}: {n}
              </span>
            ))}
          </span>
        </div>
        {sortedSteps.length === 0 ? (
          <p className="px-3 sm:px-4 py-4 text-[12px] text-muted-foreground">
            No plan steps tagged to this factory yet. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              scripts/backfill-plan-steps-factory.ts
            </code>{" "}
            to classify existing steps, or set <code className="text-[11px]">factoryId</code>{" "}
            on new steps via{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              upsertPlanStep
            </code>
            .
          </p>
        ) : (
          <ul className="divide-y">
            {sortedSteps.slice(0, 30).map((step) => (
              <li key={step.id} className="px-3 sm:px-4 py-2.5">
                <Link
                  href={`/operator-studio/plan?step=${encodeURIComponent(step.id)}`}
                  className="block hover:bg-muted/40 -mx-3 sm:-mx-4 -my-2.5 px-3 sm:px-4 py-2.5"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[step.status] ?? "bg-stone-400"}`}
                      title={step.status}
                    />
                    <span className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground">
                      {step.status}
                    </span>
                    <span className="text-[12.5px] font-medium truncate">
                      {step.title}
                    </span>
                    <time
                      className="ml-auto text-[10px] text-muted-foreground"
                      title={step.updatedAt}
                    >
                      {new Date(step.updatedAt).toLocaleDateString()}
                    </time>
                  </div>
                  {step.description && (
                    <p className="mt-1 text-[11.5px] text-foreground/80 line-clamp-2 whitespace-pre-wrap">
                      {step.description}
                    </p>
                  )}
                </Link>
              </li>
            ))}
            {sortedSteps.length > 30 && (
              <li className="px-3 sm:px-4 py-2 text-[10.5px] text-muted-foreground">
                + {sortedSteps.length - 30} more — view in /operator-studio/plan
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Outbox — awaiting first */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-3 sm:px-4 py-2 flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Outbox · awaiting approval
          </span>
          <Link
            href="/operator-studio/outbox"
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            All outbox →
          </Link>
        </div>
        {awaitingOutbox.length === 0 ? (
          <p className="px-3 sm:px-4 py-4 text-[12px] text-muted-foreground">
            Nothing awaiting your approval. The LLM stages outbound here;
            you proofread + arm the gate before anything ships.
          </p>
        ) : (
          <ul className="divide-y">
            {awaitingOutbox.map((row) => (
              <li key={row.id} className="px-3 sm:px-4 py-2.5">
                <Link
                  href={`/operator-studio/outbox/${row.id}`}
                  className="block hover:bg-muted/40 -mx-3 sm:-mx-4 -my-2.5 px-3 sm:px-4 py-2.5"
                >
                  <div className="flex items-baseline gap-2 text-[11px]">
                    <span className="font-mono uppercase tracking-wider text-muted-foreground">
                      {row.surface} · {row.action}
                    </span>
                    <span className="font-medium">
                      {row.targetLabel ?? row.targetId}
                    </span>
                    <time
                      className="ml-auto text-muted-foreground"
                      title={row.proposedAt}
                    >
                      {new Date(row.proposedAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-[12px] line-clamp-2 whitespace-pre-wrap">
                    {row.renderedText}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recentOutbox.length > awaitingOutbox.length && (
        <section className="rounded-lg border bg-card">
          <div className="border-b px-3 sm:px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Outbox · recent (any state)
          </div>
          <ul className="divide-y">
            {recentOutbox
              .filter((r) => r.state !== "awaiting_approval")
              .slice(0, 10)
              .map((row) => (
                <li key={row.id} className="px-3 sm:px-4 py-2.5">
                  <Link
                    href={`/operator-studio/outbox/${row.id}`}
                    className="block hover:bg-muted/40 -mx-3 sm:-mx-4 -my-2.5 px-3 sm:px-4 py-2.5"
                  >
                    <div className="flex items-baseline gap-2 text-[11px]">
                      <span className="font-mono uppercase tracking-wider text-muted-foreground">
                        {row.surface} · {row.state}
                      </span>
                      <span className="font-medium">
                        {row.targetLabel ?? row.targetId}
                      </span>
                      {row.sentAt && (
                        <time
                          className="ml-auto text-muted-foreground"
                          title={row.sentAt}
                        >
                          {new Date(row.sentAt).toLocaleString()}
                        </time>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      {/* Agent context bundle — copy-paste-able */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-3 sm:px-4 py-2 flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Agent context bundle
          </span>
          <button
            type="button"
            onClick={copyHeader}
            className="rounded border bg-background px-2 py-1 text-[11px] hover:bg-muted"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="overflow-x-auto px-3 sm:px-4 py-3 font-mono text-[10.5px] sm:text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {contextHeader}
        </pre>
        <p className="border-t px-3 sm:px-4 py-2 text-[10.5px] text-muted-foreground">
          Hand this header to a Claude/Codex worker at launch. The agent
          receives an unambiguous repo / product / audience scope and the
          outbound-via-outbox rule.
        </p>
      </section>
    </div>
  )
}
