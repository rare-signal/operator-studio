/**
 * David Review queue — categorized projection of `operator_review_items`.
 *
 * Same underlying table; this module only adds a category pivot so the
 * UI/CLI/MCP can show "what kind of decision am I being asked to make?"
 * Keeps review items as a first-class concept distinct from
 * implementation tasks (which live as plan steps).
 *
 * Categories are derived deterministically from `sourceType` so adding
 * a new source type (Azure DevOps, Teams, etc.) doesn't require a
 * schema change.
 */

import "server-only"

import {
  EXECUTIVE_RECOMMENDATION_SOURCE_TYPE,
} from "./executive-recommendations"
import { PLAN_SPRAWL_SOURCE_TYPE } from "./plan-inventory"
import {
  listReviewItems,
  type ReviewItem,
  type ReviewItemSourceType,
} from "./review-items"

export type DavidReviewCategory =
  | "executive"
  | "sprawl"
  | "agent"
  | "intake"
  | "other"

const INTAKE_SOURCE_TYPES = new Set<string>([
  "ado",
  "teams",
  "known_issue",
  "product_narrative",
  "deployment",
  "signal_intake",
])

export function categorizeReviewItem(item: ReviewItem): DavidReviewCategory {
  return categorizeBySourceType(item.sourceType)
}

export function categorizeBySourceType(
  sourceType: ReviewItemSourceType
): DavidReviewCategory {
  if (sourceType === EXECUTIVE_RECOMMENDATION_SOURCE_TYPE) return "executive"
  if (sourceType === PLAN_SPRAWL_SOURCE_TYPE) return "sprawl"
  if (sourceType === "agent") return "agent"
  if (INTAKE_SOURCE_TYPES.has(String(sourceType))) return "intake"
  return "other"
}

export interface DavidReviewBucket {
  category: DavidReviewCategory
  count: number
  items: ReviewItem[]
}

export interface DavidReviewQueue {
  workspaceId: string
  generatedAt: string
  totalOpen: number
  buckets: DavidReviewBucket[]
}

const CATEGORY_ORDER: DavidReviewCategory[] = [
  "executive",
  "sprawl",
  "intake",
  "agent",
  "other",
]

export interface GetDavidReviewQueueOptions {
  /** When true, include closed states (imported/promoted/rejected/snoozed). */
  includeClosed?: boolean
  /** Per-bucket cap. Default 50. */
  limitPerBucket?: number
}

export async function getDavidReviewQueue(
  workspaceId: string,
  opts: GetDavidReviewQueueOptions = {}
): Promise<DavidReviewQueue> {
  const items = await listReviewItems(workspaceId, {
    includeClosed: opts.includeClosed,
    limit: 500,
  })
  const cap = opts.limitPerBucket ?? 50

  const grouped = new Map<DavidReviewCategory, ReviewItem[]>()
  for (const cat of CATEGORY_ORDER) grouped.set(cat, [])
  for (const item of items) {
    const cat = categorizeReviewItem(item)
    const arr = grouped.get(cat) ?? []
    if (arr.length < cap) arr.push(item)
    grouped.set(cat, arr)
  }

  const buckets: DavidReviewBucket[] = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    count: grouped.get(cat)?.length ?? 0,
    items: grouped.get(cat) ?? [],
  }))

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    totalOpen: items.length,
    buckets,
  }
}
