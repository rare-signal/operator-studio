"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Forward,
  Loader2,
} from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"

interface ContinuumDigestSource {
  threadId: string
  title: string
  sourceApp: string
  turnCount: number
  minutesSinceLastTurn: number | null
}

interface OperatorFraming {
  excerpt: string
  turnIndex: number
  label: "earliest framing" | "best-scored direction" | "most recent"
  score: number
}

interface ContinuumDecision {
  excerpt: string
  turnIndex: number
  trigger: string
  role: "user" | "assistant"
}

interface ActivePlanLane {
  letter: string | null
  openSteps: Array<{
    id: string
    n: number
    title: string
    description: string
  }>
  inMotionStep: { id: string; n: number; title: string } | null
  coveredCount: number
  totalCount: number
}

interface ActivePlanSnapshot {
  id: string
  title: string
  goal: string | null
  outcome: string | null
  sourceThreadLane: string | null
  lanes: ActivePlanLane[]
}

interface SiblingThread {
  threadId: string
  title: string
  sourceApp: string
  turnCount: number
  minutesAgo: number
}

interface SpinUpHint {
  lane: string
  stepId: string
  stepN: number
  stepTitle: string
  suggestedPrompt: string
}

interface ContinuumDigest {
  kind: "heuristic" | "heuristic-v2" | "rollup-derived"
  source: ContinuumDigestSource
  lastUserDirection: { excerpt: string; turnIndex: number } | null
  lastAssistantMove: { excerpt: string; turnIndex: number } | null
  // v2-only — undefined on v1 rows.
  operatorFramings?: OperatorFraming[]
  decisions?: ContinuumDecision[]
  activePlan?: ActivePlanSnapshot | null
  siblingThreads?: SiblingThread[]
  spinUpHints?: SpinUpHint[]
  rollup: {
    headline: string
    needToKnow: string[]
    carryForward: string | null
  } | null
  breakGlassUrl: string
}

interface PersistedContinuum {
  id: string
  digest: ContinuumDigest
  resumePrompt: string
}

interface ContinuumButtonProps {
  threadId: string
}

export function ContinuumButton({ threadId }: ContinuumButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [continuum, setContinuum] = React.useState<PersistedContinuum | null>(
    null
  )
  const [copied, setCopied] = React.useState(false)

  const ensureLoaded = React.useCallback(async () => {
    if (continuum || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/operator-studio/continuum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, reuseLatest: true }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Request failed (${res.status})`)
      }
      const j = await res.json()
      setContinuum(j.continuum)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build handoff")
    } finally {
      setLoading(false)
    }
  }, [continuum, loading, threadId])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) ensureLoaded()
  }

  const handleMintFresh = async () => {
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const res = await fetch("/api/operator-studio/continuum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Request failed (${res.status})`)
      }
      const j = await res.json()
      setContinuum(j.continuum)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build handoff")
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!continuum) return
    try {
      await navigator.clipboard.writeText(continuum.resumePrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard write can fail under permissions; silently no-op.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => handleOpenChange(true)}
        title="Continuum — hand this thread to a fresh agent"
      >
        <Forward className="h-3 w-3 mr-1" />
        Continuum
      </Button>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Continuum</DialogTitle>
          <DialogDescription>
            A handoff packet a fresh Claude/Codex session can pick up
            without inheriting this thread&apos;s tokens. Source thread
            stays in place — break-glass when the digest isn&apos;t
            enough.
          </DialogDescription>
        </DialogHeader>

        {loading && !continuum && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Building handoff…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {continuum && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden min-h-0 flex-1">
            {/* Digest pane (scrolls within the dialog) */}
            <div className="space-y-3 text-sm overflow-auto pr-2">
              <DigestField label="Source">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">
                    {continuum.digest.source.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {continuum.digest.source.sourceApp} ·{" "}
                    {continuum.digest.source.turnCount} turn
                    {continuum.digest.source.turnCount === 1 ? "" : "s"}
                    {continuum.digest.source.minutesSinceLastTurn !== null && (
                      <>
                        {" "}
                        · last touched{" "}
                        {formatAge(continuum.digest.source.minutesSinceLastTurn)}
                      </>
                    )}
                  </span>
                </div>
              </DigestField>

              {continuum.digest.rollup?.headline && (
                <DigestField label="Headline">
                  <p>{continuum.digest.rollup.headline}</p>
                </DigestField>
              )}

              {/* v2: active plan */}
              {continuum.digest.activePlan && (
                <DigestField
                  label={
                    continuum.digest.activePlan.sourceThreadLane
                      ? `Plan · I'm in Lane ${continuum.digest.activePlan.sourceThreadLane}`
                      : "Plan"
                  }
                >
                  <div className="space-y-1.5">
                    <p className="font-medium text-sm">
                      {continuum.digest.activePlan.title}
                    </p>
                    {continuum.digest.activePlan.lanes
                      .filter((l) => l.letter && l.openSteps.length > 0)
                      .map((lane) => (
                        <div key={lane.letter} className="text-xs">
                          <span
                            className={
                              lane.letter ===
                              continuum.digest.activePlan?.sourceThreadLane
                                ? "font-semibold"
                                : "text-muted-foreground"
                            }
                          >
                            Lane {lane.letter} ({lane.coveredCount}/
                            {lane.totalCount}):
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {lane.openSteps
                              .slice(0, 3)
                              .map((s) => `${s.n}. ${s.title}`)
                              .join(" · ")}
                            {lane.openSteps.length > 3 &&
                              ` · +${lane.openSteps.length - 3} more`}
                          </span>
                        </div>
                      ))}
                  </div>
                </DigestField>
              )}

              {/* v2: operator framings */}
              {continuum.digest.operatorFramings &&
                continuum.digest.operatorFramings.length > 0 && (
                  <DigestField label="What I said (clearest moments)">
                    <div className="space-y-2">
                      {continuum.digest.operatorFramings.map((f, i) => (
                        <div key={i} className="text-xs">
                          <span className="text-muted-foreground italic">
                            {f.label} · turn {f.turnIndex + 1}
                            {f.score > 0 ? ` · score ${f.score}` : ""}:
                          </span>{" "}
                          <span className="text-foreground">{f.excerpt}</span>
                        </div>
                      ))}
                    </div>
                  </DigestField>
                )}

              {/* v1 fallback when no v2 framings */}
              {(!continuum.digest.operatorFramings ||
                continuum.digest.operatorFramings.length === 0) &&
                continuum.digest.lastUserDirection && (
                  <DigestField label="Last direction from you">
                    <p className="line-clamp-4 text-muted-foreground">
                      {continuum.digest.lastUserDirection.excerpt}
                    </p>
                  </DigestField>
                )}

              {/* v2: decisions */}
              {continuum.digest.decisions &&
                continuum.digest.decisions.length > 0 && (
                  <DigestField label="Decisions made in-thread">
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {continuum.digest.decisions.map((d, i) => (
                        <li key={i}>
                          <span className="text-foreground">
                            (turn {d.turnIndex + 1}, {d.role})
                          </span>{" "}
                          {d.excerpt}
                        </li>
                      ))}
                    </ul>
                  </DigestField>
                )}

              {continuum.digest.lastAssistantMove && (
                <DigestField label="Agent's last move">
                  <p className="line-clamp-3 text-muted-foreground">
                    {continuum.digest.lastAssistantMove.excerpt}
                  </p>
                </DigestField>
              )}

              {/* v2: sibling threads */}
              {continuum.digest.siblingThreads &&
                continuum.digest.siblingThreads.length > 0 && (
                  <DigestField label="Other threads in flight">
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {continuum.digest.siblingThreads.map((t) => (
                        <li key={t.threadId}>
                          {t.title}{" "}
                          <span className="text-[10px]">
                            ({t.sourceApp}, {t.turnCount}t, {t.minutesAgo}m
                            ago)
                          </span>
                        </li>
                      ))}
                    </ul>
                  </DigestField>
                )}

              {/* v2: spin-up hints */}
              {continuum.digest.spinUpHints &&
                continuum.digest.spinUpHints.length > 0 && (
                  <DigestField label="Agents to spin up next">
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {continuum.digest.spinUpHints.map((h) => (
                        <li key={h.stepId}>
                          Lane {h.lane}, step {h.stepN}: {h.stepTitle}
                        </li>
                      ))}
                    </ul>
                  </DigestField>
                )}

              {continuum.digest.rollup?.needToKnow &&
                continuum.digest.rollup.needToKnow.length > 0 && (
                  <DigestField label="Carries forward (rollup)">
                    <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                      {continuum.digest.rollup.needToKnow.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </DigestField>
                )}
            </div>

            {/* Prompt pane */}
            <div className="flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Resume prompt
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <pre className="flex-1 rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono overflow-auto min-h-0">
                {continuum.resumePrompt}
              </pre>
            </div>
          </div>
        )}

        {continuum && (
          <div className="flex items-center justify-between pt-2 border-t shrink-0">
            <div className="flex items-center gap-2">
              <Link
                href={continuum.digest.breakGlassUrl}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <ArrowUpRight className="h-3 w-3" />
                Open source thread
              </Link>
              <span className="text-xs text-muted-foreground">·</span>
              <Link
                href={`/operator-studio/continuum/${continuum.id}`}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                target="_blank"
              >
                <ExternalLink className="h-3 w-3" />
                Standalone page
              </Link>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleMintFresh}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : null}
              Re-mint
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DigestField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function formatAge(minutes: number): string {
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
