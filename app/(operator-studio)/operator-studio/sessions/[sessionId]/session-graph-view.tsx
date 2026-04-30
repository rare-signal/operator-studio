"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { GitFork } from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import {
  buildSessionGraph,
  type GraphNode,
  type GraphEdge,
} from "@/lib/operator-studio/session-graph"
import type { OperatorThread } from "@/lib/operator-studio/types"

interface SessionGraphViewProps {
  threads: OperatorThread[]
}

// Layout constants. Card dimensions + gap drive where edges start/end.
const CARD_W = 240
const CARD_H = 64
const COL_GAP = 40
const ROW_GAP = 16

const REVIEW_STATE_COLORS: Record<string, string> = {
  imported: "border-zinc-400/50 bg-zinc-50 dark:bg-zinc-900/30",
  "in-review": "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30",
  promoted: "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30",
  archived: "border-red-400/30 bg-red-50/50 dark:bg-red-950/20 opacity-60",
}

/**
 * Visual graph of the threads in a session. Vertical time axis,
 * horizontal fork depth. Nodes = threads, edges = fork relationships.
 * Click a node to jump into the thread.
 *
 * Bespoke SVG rather than a library — the graphs are small (typically
 * <20 threads) and keeping this dep-free is worth the ~100 lines.
 */
export function SessionGraphView({ threads }: SessionGraphViewProps) {
  const router = useRouter()
  const graph = React.useMemo(() => {
    return buildSessionGraph(
      threads.map((t) => ({
        id: t.id,
        parentThreadId: t.parentThreadId,
        createdAt: t.createdAt,
        title: t.promotedTitle ?? t.rawTitle ?? "Untitled",
        reviewState: t.reviewState,
        messageCount: t.messageCount,
        sourceApp: t.sourceApp,
      }))
    )
  }, [threads])

  if (graph.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center">
        <GitFork className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          No threads to graph in this session yet.
        </p>
      </div>
    )
  }

  const width = graph.columns * CARD_W + (graph.columns - 1) * COL_GAP
  const height = graph.rows * CARD_H + (graph.rows - 1) * ROW_GAP

  function nodePos(node: GraphNode): { x: number; y: number } {
    return {
      x: node.column * (CARD_W + COL_GAP),
      y: node.row * (CARD_H + ROW_GAP),
    }
  }

  return (
    <div className="w-full overflow-auto rounded-lg border bg-background/40 p-4">
      <div
        className="relative"
        style={{ width, height, minWidth: width, minHeight: height }}
      >
        {/* Edges rendered as SVG underneath the cards */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={width}
          height={height}
        >
          {graph.edges.map((edge) => {
            const from = graph.nodes.find((n) => n.id === edge.fromId)
            const to = graph.nodes.find((n) => n.id === edge.toId)
            if (!from || !to) return null
            return (
              <EdgeLine
                key={`${edge.fromId}-${edge.toId}`}
                from={nodePos(from)}
                to={nodePos(to)}
              />
            )
          })}
        </svg>

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const { x, y } = nodePos(node)
          return (
            <button
              key={node.id}
              onClick={() =>
                router.push(`/operator-studio/threads/${node.id}`)
              }
              className={`absolute rounded-lg border-2 p-2.5 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                REVIEW_STATE_COLORS[node.reviewState] ??
                "border-border bg-card"
              }`}
              style={{
                left: x,
                top: y,
                width: CARD_W,
                height: CARD_H,
              }}
            >
              <p className="truncate text-xs font-medium">{node.title}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Badge
                  variant="secondary"
                  className="h-3.5 px-1 py-0 text-[9px] font-normal"
                >
                  {node.sourceApp}
                </Badge>
                <span>{node.messageCount} turns</span>
                <span>·</span>
                <span>{node.reviewState}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface EdgeLineProps {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/**
 * Draw an elbow-style connector from parent card's right-middle to
 * child card's left-middle. Git-log style: horizontal → vertical →
 * horizontal bend. Looks cleaner than straight diagonals for tree-
 * like fork graphs.
 */
function EdgeLine({ from, to }: EdgeLineProps) {
  const x1 = from.x + CARD_W
  const y1 = from.y + CARD_H / 2
  const x2 = to.x
  const y2 = to.y + CARD_H / 2
  // Midpoint where we make the corner. 60% of the way across the gap
  // puts the bend closer to the child, which reads better.
  const midX = x1 + (x2 - x1) * 0.6
  const path = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`
  return (
    <path
      d={path}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeDasharray="2 3"
      className="text-muted-foreground/40"
    />
  )
}
