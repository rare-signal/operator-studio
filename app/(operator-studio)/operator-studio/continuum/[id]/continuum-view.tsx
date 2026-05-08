"use client"

import * as React from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"

import type { PersistedContinuum } from "@/lib/operator-studio/continuum"

interface ContinuumViewProps {
  continuum: PersistedContinuum
}

/**
 * Read-only Continuum surface — the URL form. A fresh agent (or a
 * tab-hopping operator) can be pointed here directly; everything they
 * need to keep moving is on this single page.
 */
export function ContinuumView({ continuum }: ContinuumViewProps) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(continuum.resumePrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard write can fail under permissions; silently no-op.
    }
  }

  const { digest } = continuum
  // Branch on the digest version. v2 is a strict superset of v1 — the
  // legacy `lastUserDirection` is still populated, so the v1-only path
  // only kicks in for handoffs minted before the v2 builder shipped.
  const isV2 = digest.kind === "heuristic-v2"

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Digest pane */}
      <div className="space-y-5 text-sm">
        {digest.rollup?.headline && (
          <Field label="Headline">
            <p>{digest.rollup.headline}</p>
          </Field>
        )}

        {/* v2: active plan snapshot */}
        {isV2 && digest.activePlan && (
          <Field
            label={
              digest.activePlan.sourceThreadLane
                ? `Plan · I was in Lane ${digest.activePlan.sourceThreadLane}`
                : "Plan"
            }
          >
            <p className="font-medium">{digest.activePlan.title}</p>
            {digest.activePlan.goal && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Goal: {digest.activePlan.goal}
              </p>
            )}
            {digest.activePlan.outcome && (
              <p className="text-xs text-muted-foreground">
                Outcome: {digest.activePlan.outcome}
              </p>
            )}
            <div className="mt-2 space-y-2">
              {digest.activePlan.lanes
                .filter((l) => l.letter && l.openSteps.length > 0)
                .map((lane) => {
                  const youHere =
                    lane.letter === digest.activePlan?.sourceThreadLane
                  return (
                    <div key={lane.letter ?? "unrouted"} className="text-xs">
                      <div
                        className={
                          youHere
                            ? "font-semibold"
                            : "font-medium text-muted-foreground"
                        }
                      >
                        Lane {lane.letter} ({lane.coveredCount}/
                        {lane.totalCount}){youHere ? " ← me" : ""}
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground mt-0.5">
                        {lane.openSteps.slice(0, 5).map((s) => (
                          <li key={s.id}>
                            {s.n}. {s.title}
                            {lane.inMotionStep?.id === s.id ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {" "}
                                (in motion)
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
            </div>
          </Field>
        )}

        {/* v2: operator framings */}
        {isV2 &&
          digest.operatorFramings &&
          digest.operatorFramings.length > 0 && (
            <Field label="What I said (clearest moments)">
              <div className="space-y-2 text-xs">
                {digest.operatorFramings.map((f, i) => (
                  <div key={i}>
                    <div className="text-muted-foreground italic">
                      {f.label} · turn {f.turnIndex + 1}
                      {f.score > 0 ? ` · score ${f.score}` : ""}
                    </div>
                    <p className="text-foreground mt-0.5">{f.excerpt}</p>
                  </div>
                ))}
              </div>
            </Field>
          )}

        {/* v1 fallback */}
        {!isV2 && digest.lastUserDirection && (
          <Field label="Last direction from operator">
            <p className="text-muted-foreground">
              {digest.lastUserDirection.excerpt}
            </p>
          </Field>
        )}

        {/* v2: decisions */}
        {isV2 && digest.decisions && digest.decisions.length > 0 && (
          <Field label="Decisions made in-thread">
            <ul className="space-y-1.5 text-xs">
              {digest.decisions.map((d, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">
                    turn {d.turnIndex + 1} · {d.role} ·{" "}
                    <code className="text-[10px]">{d.trigger}</code>
                  </span>
                  <p className="text-foreground mt-0.5">{d.excerpt}</p>
                </li>
              ))}
            </ul>
          </Field>
        )}

        {digest.lastAssistantMove && (
          <Field label="Agent's last move">
            <p className="text-muted-foreground">
              {digest.lastAssistantMove.excerpt}
            </p>
          </Field>
        )}

        {/* v2: sibling threads */}
        {isV2 &&
          digest.siblingThreads &&
          digest.siblingThreads.length > 0 && (
            <Field label="Other threads in flight">
              <ul className="space-y-0.5 text-xs">
                {digest.siblingThreads.map((t) => (
                  <li key={t.threadId}>
                    <span className="text-foreground">{t.title}</span>{" "}
                    <span className="text-muted-foreground">
                      ({t.sourceApp}, {t.turnCount} turns, {t.minutesAgo}m
                      ago)
                    </span>
                  </li>
                ))}
              </ul>
            </Field>
          )}

        {/* v2: spin-up hints */}
        {isV2 && digest.spinUpHints && digest.spinUpHints.length > 0 && (
          <Field label="Agents to spin up next">
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {digest.spinUpHints.map((h) => (
                <li key={h.stepId}>
                  Lane {h.lane}, step {h.stepN}: {h.stepTitle}
                </li>
              ))}
            </ul>
          </Field>
        )}

        {digest.rollup?.needToKnow && digest.rollup.needToKnow.length > 0 && (
          <Field label="Carries forward (rollup)">
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              {digest.rollup.needToKnow.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Field>
        )}
        {digest.rollup?.carryForward && (
          <Field label="Where it left off">
            <p className="text-muted-foreground">
              {digest.rollup.carryForward}
            </p>
          </Field>
        )}
      </div>

      {/* Prompt pane */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Resume prompt
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
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
        <pre className="flex-1 rounded-md border bg-muted/30 p-4 text-xs whitespace-pre-wrap font-mono overflow-auto">
          {continuum.resumePrompt}
        </pre>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
}
