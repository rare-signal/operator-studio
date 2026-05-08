"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Flame, Highlighter, Loader2, Tag } from "lucide-react"

import { cn } from "@/registry/new-york-v4/lib/utils"
import type { OperatorThreadPassage } from "@/lib/operator-studio/types"
import type { OperatorPromotionLabel } from "@/lib/operator-studio/promotion-labels"

/** Tailwind class for the colored dot next to a label name. Mirrors
 *  the small-set palette the admin form exposes. */
function labelDotClass(color: string | null): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-500"
    case "amber":
      return "bg-amber-500"
    case "rose":
      return "bg-rose-500"
    case "sky":
      return "bg-sky-500"
    case "violet":
      return "bg-violet-500"
    case "slate":
      return "bg-slate-500"
    default:
      return "bg-muted-foreground"
  }
}

const SELECTION_DEBOUNCE_MS = 220
// Filter accidental cursor placement / single-character clicks but
// keep short words like "API" / "the" eligible — double-click word
// selection is now a primary entry point.
const MIN_SELECTION_CHARS = 2

type ActiveSelection = {
  text: string
  messageId: string
  // Anchor rect for placing the bar above the selection.
  rect: DOMRect
}

/**
 * Selection-aware floating action bar. Replaces the old auto-popup
 * "Promote passage" chip which the operator hated for being:
 *
 *   • intrusive — fired on every selectionchange, including drags
 *   • tiny — single button, hard to read
 *   • single-purpose — only one action available
 *
 * The new bar:
 *
 *   • debounces selectionchange so it only appears after the cursor
 *     settles (no re-flashing during a drag)
 *   • requires a minimum selection length (5 chars) so accidental
 *     double-clicks don't trigger it
 *   • only attaches to selections inside a transcript bubble (uses
 *     the data-passage-message-id ancestor as scope)
 *   • offers TWO actions — instant Highlight, and Promote… which
 *     opens the first-class <PromoteMessageDialog> seeded with the
 *     selected passage
 *
 * Promote… dispatches a `os:promote-message` CustomEvent that the
 * matching <TimelineMessage> listens for; that event-bus pattern
 * keeps us from threading another callback through 6 different call
 * sites in thread-detail.tsx.
 */
export function SelectionActionBar({
  threadId,
  containerRef,
}: {
  threadId: string
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [active, setActive] = React.useState<ActiveSelection | null>(null)
  const [highlighting, setHighlighting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const debounceRef = React.useRef<number | null>(null)

  // Labels are admin-configurable per workspace. Lazy-load once and
  // refresh on focus so a label added in the admin panel shows up
  // here without a hard reload.
  const [labels, setLabels] = React.useState<OperatorPromotionLabel[]>([])
  const [labelsLoaded, setLabelsLoaded] = React.useState(false)
  const [labelMenuOpen, setLabelMenuOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadLabels() {
      try {
        const r = await fetch("/api/operator-studio/promotion-labels", {
          cache: "no-store",
        })
        if (!r.ok) throw new Error("failed")
        const data = (await r.json()) as { labels: OperatorPromotionLabel[] }
        if (!cancelled) {
          setLabels(data.labels ?? [])
          setLabelsLoaded(true)
        }
      } catch {
        if (!cancelled) setLabelsLoaded(true)
      }
    }
    void loadLabels()
    function onVisible() {
      if (document.visibilityState === "visible") void loadLabels()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  // Debounced selectionchange handler. We don't trust the first event
  // because a click-drag-release fires several in quick succession and
  // the rect math is unreliable mid-drag.
  React.useEffect(() => {
    function compute(): ActiveSelection | null {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
      const text = sel.toString()
      if (!text || text.trim().length < MIN_SELECTION_CHARS) return null

      const range = sel.getRangeAt(0)
      const node =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement
      if (!node) return null

      // Scope: must live inside the timeline scroll container AND
      // inside a bubble carrying data-passage-message-id. Either fail
      // and we don't show the bar — selecting in the metadata drawer,
      // input bar, etc. is a no-op.
      if (containerRef.current && !containerRef.current.contains(node)) {
        return null
      }
      const bubble = node.closest("[data-passage-message-id]")
      if (!bubble) return null
      const messageId = bubble.getAttribute("data-passage-message-id")
      if (!messageId) return null

      const rect = range.getBoundingClientRect()
      // getBoundingClientRect returns 0,0,0,0 on collapsed/empty
      // selections. The earlier text check should have filtered those
      // but belt + braces.
      if (rect.width === 0 && rect.height === 0) return null

      return { text, messageId, rect }
    }

    function schedule(delay: number) {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
      debounceRef.current = window.setTimeout(() => {
        const next = compute()
        setActive(next)
      }, delay)
    }

    // selectionchange handles keyboard selection (Shift+arrow) and the
    // mid-drag updates we want to debounce.
    function onSelectionChange() {
      schedule(SELECTION_DEBOUNCE_MS)
    }
    // mouseup is the reliable path for any mouse-driven selection —
    // click-drag, double-click (word), triple-click (paragraph). On
    // some browsers selectionchange doesn't fire for double-click
    // when the selection lands on the same range it was on before, so
    // we explicitly recompute on mouseup as well. A short 60ms delay
    // gives the selection state time to settle.
    function onMouseUp() {
      schedule(60)
    }

    document.addEventListener("selectionchange", onSelectionChange)
    document.addEventListener("mouseup", onMouseUp)
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange)
      document.removeEventListener("mouseup", onMouseUp)
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [containerRef])

  // Hide the bar on Escape — keyboard users get a quick out without
  // having to click off.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && active) {
        setActive(null)
        setError(null)
        const sel = window.getSelection()
        sel?.removeAllRanges()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active])

  if (!active) return null

  // Anchor: above the selection rect. Clamp to the viewport so the
  // bar doesn't escape on selections near the top edge.
  const PADDING = 8
  // Bumped from 40 → 54 to make room for the sub-label row beneath
  // each button. The labels disambiguate the two actions in a small
  // menu without forcing the operator to hover for a tooltip.
  const BAR_HEIGHT = 54
  const VERT_GAP = 6
  let top = active.rect.top - BAR_HEIGHT - VERT_GAP
  if (top < PADDING) {
    // No room above — flip below the selection.
    top = active.rect.bottom + VERT_GAP
  }
  const left = Math.max(
    PADDING,
    Math.min(
      window.innerWidth - 240 - PADDING,
      active.rect.left + active.rect.width / 2 - 120
    )
  )

  async function handleHighlight(labelId?: string | null) {
    if (!active) return
    setHighlighting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/operator-studio/threads/${threadId}/passages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: active.messageId,
            text: active.text,
            ...(labelId ? { labelId } : {}),
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(
          body?.code === "stale_selection"
            ? "Text drifted — reselect and retry."
            : "Couldn’t save."
        )
        setTimeout(() => setError(null), 2500)
        return
      }
      const body = (await res.json()) as { passage: OperatorThreadPassage }
      document.dispatchEvent(
        new CustomEvent<OperatorThreadPassage>("os:passage-created", {
          detail: body.passage,
        })
      )
      window.getSelection()?.removeAllRanges()
      setActive(null)
      setLabelMenuOpen(false)
    } finally {
      setHighlighting(false)
    }
  }

  function handlePromote() {
    if (!active) return
    document.dispatchEvent(
      new CustomEvent<{ messageId: string; passageText: string }>(
        "os:promote-message",
        {
          detail: { messageId: active.messageId, passageText: active.text },
        }
      )
    )
    // Don't clear the selection here — leaving it visible while the
    // dialog sits on top makes the connection between "this text" and
    // the dialog's preview obvious. The dialog handles its own
    // dismissal.
    setActive(null)
  }

  // Portal to body so the bar's fixed positioning isn't constrained
  // by transformed/clipped ancestors (the timeline column has its own
  // overflow context).
  // Bar is wider when labels exist (room for the third action).
  const hasLabels = labels.length > 0
  const BAR_WIDTH = hasLabels ? 320 : 240

  return createPortal(
    <div
      onMouseDown={(e) => {
        // Prevent click-stealing the selection — without this, clicking
        // a button collapses the selection before the handler runs and
        // active.text becomes empty.
        e.preventDefault()
      }}
      style={{ top: `${top}px`, left: `${left}px` }}
      className="fixed z-[60]"
    >
      <div
        role="toolbar"
        aria-label="Selection actions"
        className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-xl shadow-foreground/5"
        style={{ width: BAR_WIDTH, height: BAR_HEIGHT }}
      >
        <button
          type="button"
          onClick={() => void handleHighlight()}
          disabled={highlighting}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 transition-colors",
            "text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300",
            "disabled:opacity-60"
          )}
        >
          <span className="flex items-center gap-1.5 text-[12px] font-medium leading-none">
            {highlighting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Highlighter className="h-3.5 w-3.5" />
            )}
            Highlight
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80 leading-none">
            quick save
          </span>
        </button>

        {hasLabels && (
          <>
            <span aria-hidden className="h-7 w-px bg-border" />
            <button
              type="button"
              onClick={() => setLabelMenuOpen((v) => !v)}
              disabled={highlighting}
              aria-expanded={labelMenuOpen}
              aria-haspopup="menu"
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 transition-colors",
                "text-sky-700 hover:bg-sky-500/10 dark:text-sky-300",
                "disabled:opacity-60",
                labelMenuOpen && "bg-sky-500/10"
              )}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-medium leading-none">
                <Tag className="h-3.5 w-3.5" />
                Label…
              </span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80 leading-none">
                pick a flag
              </span>
            </button>
          </>
        )}

        <span aria-hidden className="h-7 w-px bg-border" />
        <button
          type="button"
          onClick={handlePromote}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
        >
          <span className="flex items-center gap-1.5 text-[12px] font-medium leading-none">
            <Flame className="h-3.5 w-3.5" />
            Promote…
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/80 leading-none">
            Add note
          </span>
        </button>
        {error && (
          <span
            role="alert"
            className="absolute -bottom-6 left-0 right-0 truncate text-center text-[10px] italic text-destructive"
          >
            {error}
          </span>
        )}
      </div>

      {labelMenuOpen && hasLabels && (
        <div
          role="menu"
          aria-label="Promotion labels"
          className="mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl shadow-foreground/5"
        >
          {labels.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitem"
              onClick={() => void handleHighlight(l.id)}
              disabled={highlighting}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-1 h-2 w-2 shrink-0 rounded-full",
                  labelDotClass(l.color)
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium leading-tight">
                  {l.label}
                </span>
                {l.aiContext && (
                  <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-muted-foreground">
                    {l.aiContext}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!labelsLoaded && (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
              Loading…
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  )
}
