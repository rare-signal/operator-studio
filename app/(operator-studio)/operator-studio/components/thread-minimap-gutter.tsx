"use client"

import * as React from "react"

import { cn } from "@/registry/new-york-v4/lib/utils"
import type { OperatorThreadPassage } from "@/lib/operator-studio/types"

/**
 * Right-side gutter alongside the thread timeline. Three layers:
 *
 *   1. **Per-turn density bar** — every message is a thin row whose
 *      height is proportional to its content length. Rows are tinted
 *      by role (user / assistant) so the silhouette of the thread
 *      jumps out at a glance.
 *   2. **Elevation marks** — promoted turns (amber) and turns with
 *      highlighted passages (emerald) get a saturated dot on top of
 *      their density row.
 *   3. **Viewport bracket** — translucent rectangle showing where the
 *      reader currently is in the thread, computed off the scroll
 *      container's scrollTop / scrollHeight ratios.
 *
 * Click anywhere in the gutter to jump to the nearest turn. Hover to
 * preview turn N + a short snippet of the message content.
 */
type MinimapMessage = {
  id: string
  role: "user" | "assistant" | string
  content: string
  promotedAt?: string | null
  promotionKind?: string | null
}

export function ThreadMinimapGutter({
  messages,
  passagesByMessage,
  onJump,
  scrollContainerRef,
}: {
  messages: MinimapMessage[]
  passagesByMessage: Map<string, OperatorThreadPassage[]>
  onJump: (messageId: string) => void
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}) {
  // Hover preview state: which message the cursor is near, and the
  // y-offset inside the gutter so we can position the tooltip.
  const [hover, setHover] = React.useState<{
    msg: MinimapMessage
    yPct: number
  } | null>(null)

  // Viewport bracket — top % and height % within the gutter, both
  // expressed as fractions of the scroll container's scrollHeight.
  // We update on scroll + resize and on the parent's content
  // changing (messages length is enough as a poke trigger).
  const [bracket, setBracket] = React.useState<{
    topPct: number
    heightPct: number
  } | null>(null)

  React.useEffect(() => {
    const el = scrollContainerRef?.current
    if (!el) return
    let raf = 0
    function update() {
      const e = scrollContainerRef?.current
      if (!e) return
      const total = e.scrollHeight
      if (total <= 0) {
        setBracket(null)
        return
      }
      // Clamp so the bracket never disappears off the rail when the
      // viewport happens to be larger than scrollHeight.
      const topPct = Math.max(0, Math.min(100, (e.scrollTop / total) * 100))
      const heightPct = Math.max(
        2,
        Math.min(100, (e.clientHeight / total) * 100)
      )
      setBracket({ topPct, heightPct })
    }
    function onScroll() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
    }
  }, [scrollContainerRef, messages.length])

  // Pre-compute density bars (top% / height% per message) so a single
  // pass renders both the density layer AND the hover hit map.
  const bars = React.useMemo(() => {
    if (messages.length === 0) return []
    // Floor each message at 30 chars so a 3-word "Yes." turn doesn't
    // collapse into nothing — the user still wants to know it
    // happened. Cap at 4000 so a 50k-char monster turn doesn't
    // monopolize the gutter.
    const weighted = messages.map((m) => ({
      msg: m,
      weight: Math.max(30, Math.min(4000, m.content.length || 30)),
    }))
    const total = weighted.reduce((s, w) => s + w.weight, 0) || 1
    let acc = 0
    return weighted.map(({ msg, weight }) => {
      const topPct = (acc / total) * 100
      const heightPct = (weight / total) * 100
      acc += weight
      return { msg, topPct, heightPct }
    })
  }, [messages])

  if (messages.length === 0) return null

  function pickAt(yPct: number): MinimapMessage | null {
    // bars is sorted by topPct; binary search would be overkill at
    // ~400 entries, linear is fine.
    for (const b of bars) {
      if (yPct >= b.topPct && yPct <= b.topPct + b.heightPct) {
        return b.msg
      }
    }
    return bars[bars.length - 1]?.msg ?? null
  }

  function onRailClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    const msg = pickAt(yPct)
    if (msg) onJump(msg.id)
  }

  function onRailMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    const msg = pickAt(yPct)
    if (msg) setHover({ msg, yPct })
  }

  return (
    <aside
      aria-label="Thread minimap"
      className="hidden lg:flex w-10 shrink-0 flex-col items-stretch border-l border-border/40 bg-muted/10 py-4 relative"
    >
      <span className="mx-auto mb-2 select-none text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
        Map
      </span>
      <div
        className="relative flex-1 mx-1 cursor-pointer"
        onClick={onRailClick}
        onMouseMove={onRailMove}
        onMouseLeave={() => setHover(null)}
        role="navigation"
      >
        {/* Layer 1 — density bars */}
        {bars.map(({ msg, topPct, heightPct }) => {
          const isUser = msg.role === "user"
          return (
            <div
              key={`bar-${msg.id}`}
              className={cn(
                "absolute left-0 right-0",
                isUser
                  ? "bg-primary/30 dark:bg-primary/40"
                  : "bg-muted-foreground/25 dark:bg-muted-foreground/30"
              )}
              style={{
                top: `${topPct}%`,
                height: `${Math.max(heightPct, 0.4)}%`,
              }}
            />
          )
        })}

        {/* Layer 2 — elevation marks (promoted / has-passages) */}
        {bars.map(({ msg, topPct, heightPct }) => {
          const isPromoted = !!msg.promotedAt
          const hasPassages = (passagesByMessage.get(msg.id)?.length ?? 0) > 0
          if (!isPromoted && !hasPassages) return null
          const tone = isPromoted ? "bg-amber-500" : "bg-emerald-500"
          const ring =
            isPromoted && hasPassages
              ? "ring-2 ring-emerald-400/60"
              : ""
          return (
            <button
              key={`mark-${msg.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onJump(msg.id)
              }}
              title={
                isPromoted && hasPassages
                  ? "Promoted · highlighted passages"
                  : isPromoted
                    ? "Promoted message"
                    : "Highlighted passages"
              }
              className={cn(
                "absolute left-1/2 -translate-x-1/2 h-2 w-2 rounded-full transition-all hover:h-2.5 hover:w-2.5 z-20",
                tone,
                ring
              )}
              style={{ top: `calc(${topPct + heightPct / 2}% - 4px)` }}
              aria-label={`Jump to ${
                isPromoted ? "promoted" : "highlighted"
              } message`}
            />
          )
        })}

        {/* Layer 3 — viewport bracket */}
        {bracket && (
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 z-10 rounded-sm border border-foreground/30 bg-foreground/5 pointer-events-none"
            style={{
              top: `${bracket.topPct}%`,
              height: `${bracket.heightPct}%`,
            }}
          />
        )}
      </div>

      {/* Hover preview tooltip — positioned in the gutter at the
          cursor's y, but pinned to the LEFT edge of the gutter so it
          extends into the timeline area where there's room. */}
      {hover && (
        <div
          className="pointer-events-none absolute z-30 max-w-72 -translate-x-full -translate-y-1/2 rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-lg"
          style={{
            top: `calc(${hover.yPct}% + 1.5rem)`,
            right: "calc(100% + 0.25rem)",
          }}
        >
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {hover.msg.role}
          </div>
          <div className="line-clamp-2 leading-snug">
            {hover.msg.content.slice(0, 80).trim()}
            {hover.msg.content.length > 80 ? "…" : ""}
          </div>
        </div>
      )}
    </aside>
  )
}
