import { sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RelatedThreadHit {
  id: string
  rawTitle: string | null
  promotedTitle: string | null
  reviewState: string
  sourceApp: string
  tags: string[]
  similarity: number
}

/**
 * Find threads similar to a given thread. Combines two signals:
 *
 *   1. Full-text similarity via the `search_tsv` generated column — the
 *      source thread's title / summary / why-it-matters are assembled into
 *      a `plainto_tsquery`, ranked via `ts_rank_cd` against other threads.
 *   2. Tag overlap — Jaccard-ish count of shared tag elements via jsonb
 *      intersection. Tags aren't indexed in the tsvector, so this is what
 *      links "two threads both tagged `nextjs`" that might not share body
 *      vocabulary.
 *
 * Results are deduped by thread id (text match wins when both signals fire)
 * and ordered by a combined score of `ts_rank_cd` + `0.15 * shared_tags`.
 *
 * Filters:
 *   - same workspace
 *   - excludes the source thread itself
 *   - `visible_in_studio = 1`
 *   - similarity > 0 OR at least one shared tag
 *
 * Returns [] if the source thread has no queryable text AND no tags.
 */
export async function findRelatedThreads(
  workspaceId: string,
  threadId: string,
  limit: number
): Promise<RelatedThreadHit[]> {
  const cappedLimit = Math.max(1, Math.min(limit, 20))
  const db = getDb()

  const result = await db.execute<{
    id: string
    raw_title: string | null
    promoted_title: string | null
    review_state: string
    source_app: string
    tags: string[] | null
    similarity: number
  }>(sql`
    WITH src AS (
      SELECT
        coalesce(promoted_title, raw_title, '') || ' ' ||
        coalesce(promoted_summary, raw_summary, '') || ' ' ||
        coalesce(why_it_matters, '') AS query_text,
        coalesce(tags, '[]'::jsonb) AS src_tags
      FROM operator_threads
      WHERE id = ${threadId}
        AND workspace_id = ${workspaceId}
    ),
    src_tag_set AS (
      SELECT jsonb_array_elements_text(src.src_tags) AS tag FROM src
    ),
    candidates AS (
      SELECT
        t.id,
        t.raw_title,
        t.promoted_title,
        t.review_state,
        t.source_app,
        t.tags,
        CASE
          WHEN length(trim(src.query_text)) > 0
               AND t.search_tsv @@ plainto_tsquery('english', src.query_text)
          THEN ts_rank_cd(t.search_tsv, plainto_tsquery('english', src.query_text))
          ELSE 0
        END AS text_rank,
        (
          SELECT count(*) FROM jsonb_array_elements_text(coalesce(t.tags, '[]'::jsonb)) AS cand_tag
          WHERE cand_tag IN (SELECT tag FROM src_tag_set)
        )::int AS shared_tags
      FROM operator_threads t, src
      WHERE t.workspace_id = ${workspaceId}
        AND t.id <> ${threadId}
        AND t.visible_in_studio = 1
    )
    SELECT
      id,
      raw_title,
      promoted_title,
      review_state,
      source_app,
      tags,
      (text_rank + 0.15 * shared_tags)::float AS similarity
    FROM candidates
    WHERE text_rank > 0 OR shared_tags > 0
    ORDER BY similarity DESC
    LIMIT ${cappedLimit}
  `)

  return result.rows.map((row) => ({
    id: row.id,
    rawTitle: row.raw_title,
    promotedTitle: row.promoted_title,
    reviewState: row.review_state,
    sourceApp: row.source_app,
    tags: (row.tags as string[] | null) ?? [],
    similarity: Number(row.similarity) || 0,
  }))
}
