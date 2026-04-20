import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getActivityFeed,
  type ActivityKind,
} from "@/lib/operator-studio/queries/activity"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const KINDS = [
  "thread.imported",
  "thread.promoted",
  "thread.archived",
  "message.promoted",
  "summary.created",
  "chat.session.started",
] as const

const kindSchema = z.enum(KINDS)

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z
    .string()
    .trim()
    .min(1)
    .optional()
    .refine(
      (v) => v == null || !Number.isNaN(new Date(v).getTime()),
      { message: "`before` must be an ISO timestamp" }
    ),
  kinds: z
    .string()
    .trim()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      return parts.length > 0 ? parts : undefined
    })
    .pipe(z.array(kindSchema).optional()),
})

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    before: url.searchParams.get("before") ?? undefined,
    kinds: url.searchParams.get("kinds") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { limit, before, kinds } = parsed.data
  const workspaceId = await getActiveWorkspaceId()

  // Over-fetch by 1 so we can report `hasMore` without a second query.
  const fetched = await getActivityFeed(workspaceId, limit + 1, before)

  // Apply kind filter in JS so we keep a single cached union query path.
  // For small/medium workspaces this is fine; if the feed grows large, push
  // the filter into the SQL layer.
  const filtered =
    kinds && kinds.length > 0
      ? fetched.filter((e) => kinds.includes(e.kind as ActivityKind))
      : fetched

  const hasMore = filtered.length > limit
  const events = hasMore ? filtered.slice(0, limit) : filtered

  return NextResponse.json({ events, hasMore })
}
