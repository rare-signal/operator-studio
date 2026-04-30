/**
 * Theme constellation as a real graph — themes are nodes, edges are
 * co-occurrence within the same message above a threshold. Then runs
 * a tiny deterministic-seeded Fruchterman-Reingold-style layout to
 * produce stable (x, y) positions for SVG rendering.
 *
 * Why bother with a layout instead of a flat tag cloud:
 * - A tag cloud answers "what words appear a lot."
 * - A constellation answers "what concepts cluster together" — you
 *   see, e.g., {chokidar, watcher, fs, polling} forming one cluster
 *   and {plan, step, promote, fulfillment} forming another. That's
 *   the actual subject map of your work.
 *
 * Pure function, no DOM. Layout is deterministic given the same input
 * — uses a seeded PRNG so screenshots are reproducible.
 */

import type { ThemeTerm } from "./theme-extractor"

export interface ConstellationNode {
  term: string
  weight: number
  messageHits: number
  /** Position in the unit square [0,1] × [0,1]. UI scales to viewport. */
  x: number
  y: number
}

export interface ConstellationEdge {
  a: string
  b: string
  /** Number of messages mentioning both. */
  weight: number
}

export interface ConstellationGraph {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
}

export interface BuildOptions {
  /** Min co-occurrence count for an edge to exist. Default 3. */
  minCoOccur?: number
  /** Iterations of the layout. Default 60. */
  iterations?: number
  /** Optional cap on node count. Default 30. */
  topN?: number
}

// Cheap mulberry32 PRNG, deterministic given a seed string.
function seededRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let s = h >>> 0
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildConstellation(
  themes: ThemeTerm[],
  messages: Array<{ content: string }>,
  opts: BuildOptions = {}
): ConstellationGraph {
  const minCoOccur = opts.minCoOccur ?? 3
  const iterations = opts.iterations ?? 60
  const topN = opts.topN ?? 30

  const limited = themes.slice(0, topN)
  if (limited.length === 0) {
    return { nodes: [], edges: [] }
  }

  // Build co-occurrence counts. For each message, find which terms
  // appear in its content; for each pair, increment the edge weight.
  const lowered = limited.map((t) => ({
    term: t.term,
    needle: t.term.toLowerCase(),
  }))
  const pairCounts = new Map<string, number>()
  for (const m of messages) {
    const lc = m.content.toLowerCase()
    const present: string[] = []
    for (const { term, needle } of lowered) {
      // Word-ish match — needle bracketed by non-letter.
      const re = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`)
      if (re.test(lc)) present.push(term)
    }
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const [a, b] =
          present[i] < present[j]
            ? [present[i], present[j]]
            : [present[j], present[i]]
        const key = `${a}\u0000${b}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const edges: ConstellationEdge[] = []
  for (const [key, weight] of pairCounts.entries()) {
    if (weight < minCoOccur) continue
    const [a, b] = key.split("\u0000")
    edges.push({ a, b, weight })
  }

  // Initial random positions, deterministic by seed.
  const rng = seededRng(limited.map((t) => t.term).join(","))
  const nodes: ConstellationNode[] = limited.map((t) => ({
    term: t.term,
    weight: t.weight,
    messageHits: t.messageHits,
    x: 0.1 + rng() * 0.8,
    y: 0.1 + rng() * 0.8,
  }))
  const indexByTerm = new Map(nodes.map((n, i) => [n.term, i]))

  // Force-directed iterations. Repulsion between every node, attraction
  // along edges. Cooling schedule shrinks step size over time.
  const k = 0.18 // ideal edge length
  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations
    const disp = nodes.map(() => ({ x: 0, y: 0 }))

    // Repulsion: every pair pushes apart, with falloff.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const d2 = dx * dx + dy * dy + 1e-6
        const force = (k * k) / d2
        const ux = (dx / Math.sqrt(d2)) * force
        const uy = (dy / Math.sqrt(d2)) * force
        disp[i].x += ux
        disp[i].y += uy
        disp[j].x -= ux
        disp[j].y -= uy
      }
    }
    // Attraction: edges pull connected nodes together.
    for (const e of edges) {
      const i = indexByTerm.get(e.a)
      const j = indexByTerm.get(e.b)
      if (i == null || j == null) continue
      const dx = nodes[i].x - nodes[j].x
      const dy = nodes[i].y - nodes[j].y
      const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6
      const force = ((dist * dist) / k) * Math.log2(1 + e.weight)
      const ux = (dx / dist) * force * 0.02
      const uy = (dy / dist) * force * 0.02
      disp[i].x -= ux
      disp[i].y -= uy
      disp[j].x += ux
      disp[j].y += uy
    }
    // Apply with step cap.
    const stepCap = 0.05 * cooling
    for (let i = 0; i < nodes.length; i++) {
      const d = disp[i]
      const mag = Math.sqrt(d.x * d.x + d.y * d.y) + 1e-6
      const limit = Math.min(mag, stepCap)
      nodes[i].x += (d.x / mag) * limit
      nodes[i].y += (d.y / mag) * limit
      // Keep inside [0.05, 0.95].
      nodes[i].x = Math.max(0.05, Math.min(0.95, nodes[i].x))
      nodes[i].y = Math.max(0.05, Math.min(0.95, nodes[i].y))
    }
  }

  return { nodes, edges }
}
