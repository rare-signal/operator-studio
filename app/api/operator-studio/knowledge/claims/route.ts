import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  isKbEnabled,
  listClaims,
  upsertClaim,
} from "@/lib/operator-studio/knowledge"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/knowledge/claims */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  if (!(await isKbEnabled(workspaceId))) {
    return NextResponse.json({ enabled: false, claims: [] })
  }
  const url = new URL(req.url)
  const activeOnly = url.searchParams.get("active") !== "0"
  const claims = await listClaims(workspaceId, { activeOnly })
  return NextResponse.json({ enabled: true, claims })
}

/** POST /api/operator-studio/knowledge/claims */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  if (!(await isKbEnabled(workspaceId))) {
    return NextResponse.json(
      { error: "Knowledge Base module not enabled for workspace." },
      { status: 403 }
    )
  }
  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null
  if (!body || typeof body !== "object" || typeof body.statement !== "string") {
    return NextResponse.json(
      { error: "Body required with `statement` string" },
      { status: 400 }
    )
  }
  const claim = await upsertClaim(workspaceId, {
    id: typeof body.id === "string" ? body.id : undefined,
    statement: body.statement,
    subject: typeof body.subject === "string" ? body.subject : null,
    confidence:
      typeof body.confidence === "number" ? body.confidence : undefined,
    sourceThreadId:
      typeof body.source_thread_id === "string"
        ? body.source_thread_id
        : null,
    sourceMessageId:
      typeof body.source_message_id === "string"
        ? body.source_message_id
        : null,
    sourcePassageId:
      typeof body.source_passage_id === "string"
        ? body.source_passage_id
        : null,
    sourceExcerpt:
      typeof body.source_excerpt === "string" ? body.source_excerpt : null,
    validAt: typeof body.valid_at === "string" ? body.valid_at : undefined,
    supersededById:
      typeof body.superseded_by_id === "string"
        ? body.superseded_by_id
        : null,
    modelProvider:
      typeof body.model_provider === "string" ? body.model_provider : null,
    modelName:
      typeof body.model_name === "string" ? body.model_name : null,
    promptVersion:
      typeof body.prompt_version === "string" ? body.prompt_version : null,
  })
  return NextResponse.json({ claim })
}
