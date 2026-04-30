"use client"

import * as React from "react"
import { Loader2, Trash2 } from "lucide-react"

import { cn } from "@/registry/new-york-v4/lib/utils"
import type { OperatorThreadPassage } from "@/lib/operator-studio/types"

/**
 * Inline visual highlights for promoted passages, rendered as
 * absolute-positioned overlay rectangles inside the message bubble.
 *
 * Why overlays, not DOM-wrapping the matching `<mark>` elements?
 *   1. **No mutation of React-managed DOM.** Wrapping markdown output
 *      in `<mark>` requires walking text nodes and splitting them,
 *      which fights with React's reconciliation on every rerender.
 *      Overlays sit on top, sourced from `Range.getClientRects()`.
 *   2. **Multi-line / multi-element passages just work.** A passage
 *      that crosses a `<strong>` boundary or a paragraph break
 *      returns multiple rects; we render one button per rect.
 *   3. **Cheap to recompute** on resize / passage list change via a
 *      single ResizeObserver + a textContent traversal.
 *
 * The bubble must be `position: relative` so our absolute overlays
 * resolve to its coordinate system. Clicking an overlay opens a
 * popover with provenance + an Unpromote action.
 */
export function PassageHighlights({
  bubbleRef,
  passages,
  onPassageDeleted,
}: {
  bubbleRef: React.RefObject<HTMLElement | null>
  passages: OperatorThreadPassage[]
  onPassageDeleted?: (id: string) => void
}) {
  type Hit = {
    passage: OperatorThreadPassage
    top: number
    left: number
    width: number
    height: number
    /** First rect of a multi-line passage carries the popover anchor. */
    isAnchor: boolean
  }

  const [hits, setHits] = React.useState<Hit[]>([])
  const [popover, setPopover] = React.useState<{
    passage: OperatorThreadPassage
    top: number
    left: number
  } | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // Recompute rects whenever passages change, the bubble resizes, or
  // the window resizes. Layout effect so we paint on the same frame
  // as the rerender that produced new content.
  React.useLayoutEffect(() => {
    const root = bubbleRef.current
    if (!root || passages.length === 0) {
      setHits([])
      return
    }

    function compute() {
      if (!root) return
      const next: Hit[] = []
      const rootRect = root.getBoundingClientRect()
      // Capture scroll offset so popovers anchored later don't drift
      // when the bubble is mid-scroll.
      for (const passage of passages) {
        const range = findTextRange(root, passage.textSnapshot)
        if (!range) continue
        const rects = Array.from(range.getClientRects())
        rects.forEach((r, i) => {
          if (r.width === 0 || r.height === 0) return
          next.push({
            passage,
            top: r.top - rootRect.top,
            left: r.left - rootRect.left,
            width: r.width,
            height: r.height,
            isAnchor: i === 0,
          })
        })
      }
      setHits(next)
    }

    compute()

    const ro = new ResizeObserver(compute)
    ro.observe(root)
    window.addEventListener("resize", compute)
    // The MarkdownProse output may stream in over a frame or two; a
    // mutation observer cheaply catches that without us having to
    // pierce the rendering pipeline.
    const mo = new MutationObserver(compute)
    mo.observe(root, { childList: true, subtree: true, characterData: true })

    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener("resize", compute)
    }
  }, [bubbleRef, passages])

  // Close the popover on Escape or outside click.
  React.useEffect(() => {
    if (!popover) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopover(null)
    }
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (t.closest("[data-os-passage-popover]")) return
      if (t.closest("[data-os-passage-hit]")) return
      setPopover(null)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDocClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDocClick)
    }
  }, [popover])

  async function handleUnpromote(p: OperatorThreadPassage) {
    if (busyId) return
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/operator-studio/passages/${p.id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        onPassageDeleted?.(p.id)
        setPopover(null)
      }
    } finally {
      setBusyId(null)
    }
  }

  if (hits.length === 0 && !popover) return null

  return (
    <>
      {hits.map((h, i) => {
        const isPromotedKind = !!h.passage.note
        return (
          <button
            key={`${h.passage.id}-${i}`}
            type="button"
            data-os-passage-hit={h.passage.id}
            onClick={(e) => {
              e.stopPropagation()
              if (!h.isAnchor) {
                // Find this passage's anchor hit for popover positioning.
                const anchor = hits.find(
                  (x) => x.passage.id === h.passage.id && x.isAnchor
                )
                if (anchor) {
                  setPopover({
                    passage: h.passage,
                    top: anchor.top + anchor.height + 4,
                    left: anchor.left,
                  })
                }
                return
              }
              setPopover({
                passage: h.passage,
                top: h.top + h.height + 4,
                left: h.left,
              })
            }}
            title={
              h.passage.note
                ? `“${h.passage.note}” — ${h.passage.promotedBy}`
                : `Highlighted by ${h.passage.promotedBy}`
            }
            aria-label="View passage details"
            className={cn(
              "absolute rounded-sm transition-colors cursor-pointer",
              isPromotedKind
                ? "bg-amber-300/35 hover:bg-amber-400/50 dark:bg-amber-500/25 dark:hover:bg-amber-500/40"
                : "bg-emerald-300/30 hover:bg-emerald-400/45 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/35"
            )}
            style={{
              top: h.top,
              left: h.left,
              width: h.width,
              height: h.height,
            }}
          />
        )
      })}

      {popover && (
        <div
          data-os-passage-popover
          role="dialog"
          aria-label="Passage details"
          className="absolute z-30 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
          style={{ top: popover.top, left: Math.max(0, popover.left) }}
        >
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>
              by <strong className="font-medium text-foreground/90">
                {popover.passage.promotedBy}
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>
              {new Date(popover.passage.promotedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
          <blockquote className="mb-2 max-h-32 overflow-y-auto rounded border-l-2 border-emerald-500 bg-muted/40 px-2 py-1 text-[12px] italic leading-snug text-foreground/85">
            {popover.passage.textSnapshot.length > 320
              ? `${popover.passage.textSnapshot.slice(0, 320).trim()}…`
              : popover.passage.textSnapshot}
          </blockquote>
          {popover.passage.note && (
            <p className="mb-2 text-[12px] leading-snug text-foreground/85">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Note
              </span>
              <br />
              {popover.passage.note}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleUnpromote(popover.passage)}
              disabled={busyId === popover.passage.id}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              {busyId === popover.passage.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Unpromote
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Locate the first occurrence of `text` inside `root`'s rendered
 * text content and return a Range covering it. Walks text nodes,
 * concatenates them with their cumulative offsets, then maps the
 * substring index back to (startNode, startOffset) / (endNode,
 * endOffset).
 *
 * Whitespace is normalized to a single space because MarkdownProse
 * collapses newlines into spaces for paragraph rendering — the raw
 * snapshot can contain "\n\n" where the rendered DOM has " ".
 */
function findTextRange(root: Element, raw: string): Range | null {
  const needle = normalizeWhitespace(raw)
  if (!needle) return null

  type Slot = { node: Text; start: number; length: number }
  const slots: Slot[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip empty/whitespace-only text nodes nested inside the
      // overlay layer itself if the component is reused.
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let cursor = 0
  let acc = ""
  let n: Node | null = walker.nextNode()
  while (n) {
    const text = (n as Text).data
    const norm = normalizeWhitespace(text)
    slots.push({ node: n as Text, start: cursor, length: norm.length })
    acc += norm
    cursor += norm.length
    n = walker.nextNode()
  }

  const idx = acc.indexOf(needle)
  if (idx < 0) return null
  const endIdx = idx + needle.length

  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0

  for (const s of slots) {
    if (idx >= s.start && idx <= s.start + s.length && !startNode) {
      // Map normalized offset back into the raw text node by walking
      // forward and counting non-whitespace-collapsed characters.
      const rawText = s.node.data
      const localTarget = idx - s.start
      startOff = unnormalizedIndex(rawText, localTarget)
      startNode = s.node
    }
    if (endIdx >= s.start && endIdx <= s.start + s.length) {
      const rawText = s.node.data
      const localTarget = endIdx - s.start
      endOff = unnormalizedIndex(rawText, localTarget)
      endNode = s.node
      break
    }
  }
  if (!startNode || !endNode) return null

  const range = document.createRange()
  try {
    range.setStart(startNode, Math.min(startOff, startNode.data.length))
    range.setEnd(endNode, Math.min(endOff, endNode.data.length))
  } catch {
    return null
  }
  return range
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/**
 * Given a raw string and a target offset measured in
 * normalized-whitespace coordinates, return the index in the raw
 * string. Used to translate post-collapse offsets back into the live
 * DOM so Range positions land cleanly.
 */
function unnormalizedIndex(raw: string, normalizedTarget: number): number {
  let normCount = 0
  let lastWasSpace = true
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    const isSpace = /\s/.test(c)
    if (isSpace) {
      if (!lastWasSpace) {
        normCount += 1
      }
      lastWasSpace = true
    } else {
      lastWasSpace = false
      normCount += 1
    }
    if (normCount > normalizedTarget) {
      return i
    }
  }
  return raw.length
}
