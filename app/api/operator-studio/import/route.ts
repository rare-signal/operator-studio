import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  importFromPayload,
  importFromSource,
  importSelectedFiles,
} from "@/lib/operator-studio/importers"
import { getRecentImportRuns } from "@/lib/operator-studio/queries"
import {
  OPERATOR_SOURCE_APPS,
  type OperatorSourceApp,
} from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

const sourceApps = OPERATOR_SOURCE_APPS

const postSchema = z.union([
  z.object({
    source: z.enum(sourceApps),
    filePaths: z.array(z.string().min(1).max(4096)).min(1).max(2000),
    importedBy: z.string().trim().min(1).max(128).optional(),
  }),
  z.object({
    source: z.enum(sourceApps),
    filePaths: z.undefined().optional(),
    payload: z.undefined().optional(),
    importedBy: z.string().trim().min(1).max(128).optional(),
  }),
  z.object({
    source: z.enum(sourceApps).optional(),
    payload: z.object({
      title: z.string().max(512).optional(),
      messages: z
        .array(
          z.object({
            role: z.string(),
            content: z.string(),
            timestamp: z.string().optional(),
          })
        )
        .min(1)
        .max(20_000),
      metadata: z.record(z.unknown()).optional(),
    }),
    importedBy: z.string().trim().min(1).max(128).optional(),
  }),
])

export async function GET(req: Request) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const runs = await getRecentImportRuns(workspaceId)
  return NextResponse.json({ runs })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const raw = await req.json().catch(() => null)
  const parsed = postSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data
  const importedBy =
    body.importedBy?.trim() || (await getDisplayName()) || "operator"

  if ("filePaths" in body && body.filePaths) {
    const result = await importSelectedFiles(
      workspaceId,
      body.filePaths,
      body.source as OperatorSourceApp,
      importedBy
    )
    return NextResponse.json(result)
  }

  if ("payload" in body && body.payload) {
    const result = await importFromPayload(
      workspaceId,
      {
        title: body.payload.title,
        messages: body.payload.messages,
        source: (body.source ?? "manual") as OperatorSourceApp,
        metadata: body.payload.metadata,
      },
      importedBy
    )
    return NextResponse.json(result)
  }

  if ("source" in body && body.source) {
    const result = await importFromSource(
      workspaceId,
      body.source as OperatorSourceApp,
      importedBy
    )
    return NextResponse.json(result)
  }

  return NextResponse.json(
    {
      error:
        "Provide 'source' for discovery import, 'filePaths' for selective import, or 'payload' for manual import",
    },
    { status: 400 }
  )
}
