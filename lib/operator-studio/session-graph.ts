/**
 * Pure graph-layout math for the Session Space visualizer.
 *
 * Extracted so it's testable without a DOM and so the layout logic
 * doesn't bloat the component file.
 *
 * Input: a list of threads, each with an id and optional parentThreadId.
 * Output: positioned nodes (column, row) + a list of edges. The UI
 * renders nodes as cards in CSS grid and edges as SVG lines overlayed.
 *
 * Algorithm:
 *
 * 1. Partition threads into tree roots (no parent in the session) and
 *    child links (parent IS in the session). Cross-session parents are
 *    treated as roots — we don't render edges to threads outside the
 *    session.
 *
 * 2. For each root, walk children in time order and assign columns by
 *    depth. Column 0 = root, column 1 = first-level fork, etc.
 *
 * 3. Assign row indices so siblings stack vertically (never overlap).
 *    Row indices are dense — no gaps — so the UI can render row-
 *    height * row as the y coordinate.
 */

export interface GraphNodeInput {
  id: string
  parentThreadId: string | null
  createdAt: string // ISO
  title: string
  reviewState: string
  messageCount: number
  sourceApp: string
}

export interface GraphNode {
  id: string
  title: string
  reviewState: string
  messageCount: number
  sourceApp: string
  /** 0-indexed column — fork depth. */
  column: number
  /** 0-indexed row — vertical slot. */
  row: number
}

export interface GraphEdge {
  fromId: string
  toId: string
}

export interface SessionGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Total columns needed to render this graph (max column + 1). */
  columns: number
  /** Total rows needed to render this graph (max row + 1). */
  rows: number
}

/**
 * Compute the graph layout. Stable: same input → same output.
 *
 * Threads not in the session's thread list but referenced as parents
 * are ignored (we don't have data for them anyway). Threads with
 * cycles (shouldn't happen but be defensive) are broken at the cycle.
 */
export function buildSessionGraph(
  threads: GraphNodeInput[]
): SessionGraph {
  if (threads.length === 0) {
    return { nodes: [], edges: [], columns: 0, rows: 0 }
  }

  const byId = new Map<string, GraphNodeInput>()
  for (const t of threads) byId.set(t.id, t)

  // Children-of index. Only links where parent is also in the session
  // count — cross-session parents become their own roots.
  const childrenByParent = new Map<string, GraphNodeInput[]>()
  const roots: GraphNodeInput[] = []
  for (const t of threads) {
    if (t.parentThreadId && byId.has(t.parentThreadId)) {
      const bucket = childrenByParent.get(t.parentThreadId) ?? []
      bucket.push(t)
      childrenByParent.set(t.parentThreadId, bucket)
    } else {
      roots.push(t)
    }
  }

  // Sort everything by creation time so older things are higher.
  const byCreatedAsc = (a: GraphNodeInput, b: GraphNodeInput) =>
    a.createdAt.localeCompare(b.createdAt)
  roots.sort(byCreatedAsc)
  for (const bucket of childrenByParent.values()) {
    bucket.sort(byCreatedAsc)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const visited = new Set<string>()
  let nextRow = 0
  let maxColumn = 0

  function walk(thread: GraphNodeInput, column: number) {
    if (visited.has(thread.id)) return // cycle guard
    visited.add(thread.id)
    const row = nextRow++
    maxColumn = Math.max(maxColumn, column)
    nodes.push({
      id: thread.id,
      title: thread.title,
      reviewState: thread.reviewState,
      messageCount: thread.messageCount,
      sourceApp: thread.sourceApp,
      column,
      row,
    })
    const kids = childrenByParent.get(thread.id) ?? []
    for (const kid of kids) {
      edges.push({ fromId: thread.id, toId: kid.id })
      walk(kid, column + 1)
    }
  }

  for (const root of roots) walk(root, 0)

  // Safety net: if a thread got excluded from roots because its parent
  // IS in the session but we never walked it (e.g. cycle, or ordering
  // quirk), treat it as a root so it still renders. Prevents silent
  // data loss in the UI.
  for (const t of threads) {
    if (!visited.has(t.id)) walk(t, 0)
  }

  return {
    nodes,
    edges,
    columns: maxColumn + 1,
    rows: nextRow,
  }
}
