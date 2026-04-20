import "server-only"

import { sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MetricsSummary {
  totalThreads: number
  threadsByState: {
    imported: number
    inReview: number
    promoted: number
    archived: number
  }
  threadsBySource: Array<{ sourceApp: string; count: number }>
  promotedMessageCount: number
  continuationChatSessions: number
  continuationChatMessages: number
  uniqueImportersCount: number
  uniquePromotersCount: number
}

export interface DailyCounts {
  date: string // ISO YYYY-MM-DD
  imported: number
  promoted: number
}

export interface TopAuthor {
  displayName: string
  imported: number
  promoted: number
}

// ─── Summary ────────────────────────────────────────────────────────────────

/**
 * Whole-workspace snapshot. Visible-only for thread totals; archived threads
 * still count toward the archived bucket so the number reflects the full
 * lifecycle.
 */
export async function getMetricsSummary(
  workspaceId: string
): Promise<MetricsSummary> {
  const db = getDb()

  const threadStats = await db.execute<{
    total: string
    imported: string
    in_review: string
    promoted: string
    archived: string
    unique_importers: string
  }>(sql`
    SELECT
      count(*) FILTER (WHERE visible_in_studio = 1) AS total,
      count(*) FILTER (WHERE review_state = 'imported'  AND visible_in_studio = 1) AS imported,
      count(*) FILTER (WHERE review_state = 'in-review' AND visible_in_studio = 1) AS in_review,
      count(*) FILTER (WHERE review_state = 'promoted'  AND visible_in_studio = 1) AS promoted,
      count(*) FILTER (WHERE review_state = 'archived') AS archived,
      count(DISTINCT imported_by) FILTER (WHERE visible_in_studio = 1) AS unique_importers
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
  `)

  const threadsBySourceRes = await db.execute<{
    source_app: string
    count: string
  }>(sql`
    SELECT source_app, count(*)::text AS count
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
      AND visible_in_studio = 1
    GROUP BY source_app
    ORDER BY count(*) DESC, source_app ASC
  `)

  const promotedMsgRes = await db.execute<{
    count: string
    unique_promoters: string
  }>(sql`
    SELECT
      count(*)::text AS count,
      count(DISTINCT promoted_by)::text AS unique_promoters
    FROM operator_thread_messages
    WHERE workspace_id = ${workspaceId}
      AND promoted_at IS NOT NULL
  `)

  const chatSessionsRes = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM operator_chat_sessions
    WHERE workspace_id = ${workspaceId}
  `)

  const chatMessagesRes = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM operator_chat_messages
    WHERE workspace_id = ${workspaceId}
  `)

  const t = threadStats.rows[0] ?? {
    total: "0",
    imported: "0",
    in_review: "0",
    promoted: "0",
    archived: "0",
    unique_importers: "0",
  }
  const m = promotedMsgRes.rows[0] ?? { count: "0", unique_promoters: "0" }

  return {
    totalThreads: Number(t.total) || 0,
    threadsByState: {
      imported: Number(t.imported) || 0,
      inReview: Number(t.in_review) || 0,
      promoted: Number(t.promoted) || 0,
      archived: Number(t.archived) || 0,
    },
    threadsBySource: threadsBySourceRes.rows.map((r) => ({
      sourceApp: r.source_app,
      count: Number(r.count) || 0,
    })),
    promotedMessageCount: Number(m.count) || 0,
    continuationChatSessions:
      Number(chatSessionsRes.rows[0]?.count ?? 0) || 0,
    continuationChatMessages:
      Number(chatMessagesRes.rows[0]?.count ?? 0) || 0,
    uniqueImportersCount: Number(t.unique_importers) || 0,
    uniquePromotersCount: Number(m.unique_promoters) || 0,
  }
}

// ─── Daily counts ───────────────────────────────────────────────────────────

/**
 * Last N days inclusive, with zero-filled gaps via a generate_series left join.
 * `imported` counts threads created on that day (imported_at::date). `promoted`
 * counts thread-level promotions on that day — we proxy this with the thread's
 * updated_at for rows whose current state is "promoted", since the schema does
 * not carry a dedicated `promoted_at` on the thread row itself.
 */
export async function getDailyCounts(
  workspaceId: string,
  days: number
): Promise<DailyCounts[]> {
  const db = getDb()
  const clampedDays = Math.max(1, Math.min(Math.floor(days), 365))

  const result = await db.execute<{
    date: string
    imported: string
    promoted: string
  }>(sql`
    WITH series AS (
      SELECT generate_series(
        (CURRENT_DATE - (${clampedDays - 1}::int))::date,
        CURRENT_DATE::date,
        '1 day'::interval
      )::date AS day
    ),
    imports AS (
      SELECT imported_at::date AS day, count(*) AS c
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND imported_at >= (CURRENT_DATE - (${clampedDays - 1}::int))
      GROUP BY imported_at::date
    ),
    promotions AS (
      SELECT updated_at::date AS day, count(*) AS c
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND review_state = 'promoted'
        AND updated_at >= (CURRENT_DATE - (${clampedDays - 1}::int))
      GROUP BY updated_at::date
    )
    SELECT
      to_char(s.day, 'YYYY-MM-DD') AS date,
      COALESCE(i.c, 0)::text AS imported,
      COALESCE(p.c, 0)::text AS promoted
    FROM series s
    LEFT JOIN imports i ON i.day = s.day
    LEFT JOIN promotions p ON p.day = s.day
    ORDER BY s.day ASC
  `)

  return result.rows.map((r) => ({
    date: r.date,
    imported: Number(r.imported) || 0,
    promoted: Number(r.promoted) || 0,
  }))
}

// ─── Top authors ────────────────────────────────────────────────────────────

/**
 * Top operators by imported + promoted count in the last N days. `imported`
 * is attribution from `operator_threads.imported_by`. `promoted` counts
 * distinct threads the operator has promoted (message-level promotions are
 * attributed to `promoted_by` on the message row).
 */
export async function getTopAuthors(
  workspaceId: string,
  days: number,
  limit: number
): Promise<TopAuthor[]> {
  const db = getDb()
  const clampedDays = Math.max(1, Math.min(Math.floor(days), 365))
  const clampedLimit = Math.max(1, Math.min(Math.floor(limit), 100))

  const result = await db.execute<{
    display_name: string
    imported: string
    promoted: string
  }>(sql`
    WITH imports AS (
      SELECT imported_by AS name, count(*) AS c
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND imported_at >= (CURRENT_DATE - (${clampedDays - 1}::int))
      GROUP BY imported_by
    ),
    promotions AS (
      SELECT promoted_by AS name, count(*) AS c
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND promoted_at IS NOT NULL
        AND promoted_at >= (CURRENT_DATE - (${clampedDays - 1}::int))
      GROUP BY promoted_by
    ),
    combined AS (
      SELECT name FROM imports
      UNION
      SELECT name FROM promotions
    )
    SELECT
      c.name AS display_name,
      COALESCE(i.c, 0)::text AS imported,
      COALESCE(p.c, 0)::text AS promoted
    FROM combined c
    LEFT JOIN imports i ON i.name = c.name
    LEFT JOIN promotions p ON p.name = c.name
    WHERE c.name IS NOT NULL
    ORDER BY (COALESCE(i.c, 0) + COALESCE(p.c, 0)) DESC,
             c.name ASC
    LIMIT ${clampedLimit}
  `)

  return result.rows.map((r) => ({
    displayName: r.display_name,
    imported: Number(r.imported) || 0,
    promoted: Number(r.promoted) || 0,
  }))
}

// ─── Top tags ───────────────────────────────────────────────────────────────

/**
 * Expand the `tags` jsonb array with `jsonb_array_elements_text`, group, count.
 */
export async function getTopTags(
  workspaceId: string,
  limit: number
): Promise<Array<{ tag: string; count: number }>> {
  const db = getDb()
  const clampedLimit = Math.max(1, Math.min(Math.floor(limit), 100))

  const result = await db.execute<{ tag: string; count: string }>(sql`
    SELECT tag, count(*)::text AS count
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND visible_in_studio = 1
    ) expanded
    WHERE tag IS NOT NULL AND tag <> ''
    GROUP BY tag
    ORDER BY count(*) DESC, tag ASC
    LIMIT ${clampedLimit}
  `)

  return result.rows.map((r) => ({
    tag: r.tag,
    count: Number(r.count) || 0,
  }))
}
