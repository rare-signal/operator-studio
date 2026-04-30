import { sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"

// ─── Types ──────────────────────────────────────────────────────────────────

export type ActivityKind =
  | "thread.imported"
  | "thread.appended"
  | "thread.promoted"
  | "thread.archived"
  | "message.promoted"
  | "summary.created"
  | "chat.session.started"
  | "chat.message.sent"

/**
 * Did the human operator initiate this event, or did the system do
 * it on their behalf? Drives the UI's muted-vs-loud styling.
 *
 *   user   — the operator deliberately did this (clicked promote,
 *            typed a chat message, archived a thread)
 *   system — the harness / importer / watcher did this passively
 *            (discovery import found a new file, append-on-grow
 *            captured new turns from disk, AI replied to a chat
 *            message we routed)
 */
export type ActivityTrigger = "user" | "system"

export interface ActivityEvent {
  /** Synthetic unique id, stable per (kind, source row). */
  id: string
  kind: ActivityKind
  /** ISO timestamp of when the event occurred. */
  at: string
  /** Actor attribution (displayName / importedBy / promotedBy / operatorName). */
  actor: string
  /** Thread this event is tied to. For `chat.session.started` this may be an
   *  empty string when the session wasn't scoped to a thread. */
  threadId: string
  /** Promoted title wins, falling back to raw title. May be null for very
   *  bare threads. */
  threadTitle: string | null
  /** Was this a deliberate operator action, or did the system do it
   *  passively on the operator's behalf? */
  trigger: ActivityTrigger
  /** Kind-specific extras. */
  details: Record<string, unknown>
}

// ─── Row shape returned by the UNION ALL query ──────────────────────────────

interface ActivityRow {
  kind: ActivityKind
  at: Date
  actor: string | null
  thread_id: string
  thread_title: string | null
  synthetic_id: string
  trigger: ActivityTrigger
  details_json: Record<string, unknown> | null
  [key: string]: unknown
}

// ─── Main query ─────────────────────────────────────────────────────────────

/**
 * Build the workspace-wide activity feed by UNION ALL-ing the six event sources.
 * Ordered by `at DESC` with an optional cursor (`beforeIso`) for pagination.
 *
 * Each branch filters by `workspace_id`, projects the shared column set, and
 * carries a synthetic id unique within its kind. The top-level query applies
 * one `WHERE at < $cursor` so every branch benefits from the same bound.
 *
 * `thread.promoted` detects promotion by `review_state = 'promoted'` AND
 * `promoted_title IS NOT NULL`, using `updated_at` as the timestamp (there's
 * no dedicated `promotedAt` column on the thread row).
 */
export async function getActivityFeed(
  workspaceId: string,
  limit: number,
  beforeIso?: string
): Promise<ActivityEvent[]> {
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit) || 50, 200))

  let before: Date | null = null
  if (beforeIso) {
    const parsed = new Date(beforeIso)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Invalid `before` cursor")
    }
    before = parsed
  }

  const db = getDb()

  // Build cursor predicate once; applied to the wrapping query rather than
  // each UNION branch, since the outer ORDER BY + LIMIT still gets to use
  // the predicate after the union assembles the rows.
  const cursorClause = before
    ? sql`WHERE at < ${before.toISOString()}::timestamptz`
    : sql``

  const result = await db.execute<ActivityRow>(sql`
    SELECT kind, at, actor, thread_id, thread_title, synthetic_id, trigger, details_json
    FROM (
      -- thread.imported (system: discovery + append-on-grow find new files)
      SELECT
        'thread.imported'::text                AS kind,
        t.created_at                           AS at,
        t.imported_by                          AS actor,
        t.id                                   AS thread_id,
        coalesce(t.promoted_title, t.raw_title) AS thread_title,
        'thread.imported:' || t.id             AS synthetic_id,
        'system'::text                         AS trigger,
        jsonb_build_object(
          'sourceApp', t.source_app,
          'importRunId', t.import_run_id
        )                                      AS details_json
      FROM operator_threads t
      WHERE t.workspace_id = ${workspaceId}

      UNION ALL

      -- thread.appended (system: ongoing capture of new turns landing
      -- in already-imported threads). Bucketed per (thread, hour) so
      -- one ongoing conversation generates ~one feed item per hour
      -- of activity, not one per turn. The first bucket per thread is
      -- skipped because thread.imported already covers it.
      SELECT
        'thread.appended'::text                AS kind,
        ab.last_at                             AS at,
        coalesce(t.imported_by, 'operator')    AS actor,
        ab.thread_id                           AS thread_id,
        coalesce(t.promoted_title, t.raw_title) AS thread_title,
        'thread.appended:' || ab.thread_id || ':' || extract(epoch from ab.bucket_at)::text AS synthetic_id,
        'system'::text                         AS trigger,
        jsonb_build_object(
          'sourceApp', t.source_app,
          'messageCount', ab.n_messages,
          'bucketStart', ab.bucket_at,
          'bucketEnd', ab.last_at
        )                                      AS details_json
      FROM (
        SELECT
          thread_id,
          date_trunc('hour', created_at) AS bucket_at,
          count(*)::int                  AS n_messages,
          max(created_at)                AS last_at
        FROM operator_thread_messages
        WHERE workspace_id = ${workspaceId}
        GROUP BY thread_id, date_trunc('hour', created_at)
      ) ab
      LEFT JOIN operator_threads t ON t.id = ab.thread_id
      LEFT JOIN (
        SELECT thread_id, min(date_trunc('hour', created_at)) AS first_bucket_at
        FROM operator_thread_messages
        WHERE workspace_id = ${workspaceId}
        GROUP BY thread_id
      ) fb ON fb.thread_id = ab.thread_id
      WHERE ab.bucket_at > coalesce(fb.first_bucket_at, ab.bucket_at)

      UNION ALL

      -- thread.promoted (user: deliberate promotion review action)
      SELECT
        'thread.promoted'::text                AS kind,
        t.updated_at                           AS at,
        t.imported_by                          AS actor,
        t.id                                   AS thread_id,
        coalesce(t.promoted_title, t.raw_title) AS thread_title,
        'thread.promoted:' || t.id             AS synthetic_id,
        'user'::text                           AS trigger,
        jsonb_build_object(
          'promotedTitle', t.promoted_title,
          'tags', t.tags
        )                                      AS details_json
      FROM operator_threads t
      WHERE t.workspace_id = ${workspaceId}
        AND t.review_state = 'promoted'
        AND t.promoted_title IS NOT NULL

      UNION ALL

      -- thread.archived (user: deliberate archive)
      SELECT
        'thread.archived'::text                AS kind,
        t.archived_at                          AS at,
        t.imported_by                          AS actor,
        t.id                                   AS thread_id,
        coalesce(t.promoted_title, t.raw_title) AS thread_title,
        'thread.archived:' || t.id             AS synthetic_id,
        'user'::text                           AS trigger,
        jsonb_build_object(
          'reviewState', t.review_state
        )                                      AS details_json
      FROM operator_threads t
      WHERE t.workspace_id = ${workspaceId}
        AND t.archived_at IS NOT NULL

      UNION ALL

      -- message.promoted (user: explicit promote click)
      SELECT
        'message.promoted'::text               AS kind,
        m.promoted_at                          AS at,
        m.promoted_by                          AS actor,
        m.thread_id                            AS thread_id,
        coalesce(t.promoted_title, t.raw_title) AS thread_title,
        'message.promoted:' || m.id            AS synthetic_id,
        'user'::text                           AS trigger,
        jsonb_build_object(
          'messageId', m.id,
          'turnIndex', m.turn_index,
          'role', m.role,
          'promotionKind', m.promotion_kind,
          'promotionNote', m.promotion_note
        )                                      AS details_json
      FROM operator_thread_messages m
      LEFT JOIN operator_threads t ON t.id = m.thread_id
      WHERE m.workspace_id = ${workspaceId}
        AND m.promoted_at IS NOT NULL

      UNION ALL

      -- summary.created (user when manual/promoted; system when auto)
      SELECT
        'summary.created'::text                AS kind,
        s.created_at                           AS at,
        s.created_by                           AS actor,
        s.thread_id                            AS thread_id,
        coalesce(t.promoted_title, t.raw_title) AS thread_title,
        'summary.created:' || s.id             AS synthetic_id,
        CASE WHEN s.summary_kind = 'auto' THEN 'system' ELSE 'user' END AS trigger,
        jsonb_build_object(
          'summaryKind', s.summary_kind
        )                                      AS details_json
      FROM operator_thread_summaries s
      LEFT JOIN operator_threads t ON t.id = s.thread_id
      WHERE s.workspace_id = ${workspaceId}

      UNION ALL

      -- chat.session.started (user: starting a continuation chat)
      SELECT
        'chat.session.started'::text           AS kind,
        cs.created_at                          AS at,
        cs.operator_name                       AS actor,
        coalesce(cs.thread_id, '')             AS thread_id,
        coalesce(t.promoted_title, t.raw_title, cs.session_title) AS thread_title,
        'chat.session.started:' || cs.id       AS synthetic_id,
        'user'::text                           AS trigger,
        jsonb_build_object(
          'sessionId', cs.id,
          'sessionTitle', cs.session_title
        )                                      AS details_json
      FROM operator_chat_sessions cs
      LEFT JOIN operator_threads t ON t.id = cs.thread_id
      WHERE cs.workspace_id = ${workspaceId}

      UNION ALL

      -- chat.message.sent (user when role=user; system when AI replied)
      SELECT
        'chat.message.sent'::text              AS kind,
        cm.created_at                          AS at,
        cs.operator_name                       AS actor,
        coalesce(cs.thread_id, '')             AS thread_id,
        coalesce(t.promoted_title, t.raw_title, cs.session_title) AS thread_title,
        'chat.message.sent:' || cm.id          AS synthetic_id,
        CASE WHEN cm.role = 'user' THEN 'user' ELSE 'system' END AS trigger,
        jsonb_build_object(
          'messageId', cm.id,
          'sessionId', cm.session_id,
          'role', cm.role,
          'modelLabel', cm.model_label
        )                                      AS details_json
      FROM operator_chat_messages cm
      LEFT JOIN operator_chat_sessions cs ON cs.id = cm.session_id
      LEFT JOIN operator_threads t ON t.id = cs.thread_id
      WHERE cm.workspace_id = ${workspaceId}
    ) events
    ${cursorClause}
    ORDER BY at DESC
    LIMIT ${cappedLimit}
  `)

  return result.rows
    .filter((row) => row.at != null)
    .map((row) => ({
      id: row.synthetic_id,
      kind: row.kind,
      at: new Date(row.at).toISOString(),
      actor: (row.actor ?? "").trim() || "operator",
      threadId: row.thread_id ?? "",
      threadTitle: row.thread_title,
      trigger: row.trigger,
      details: row.details_json ?? {},
    }))
}
