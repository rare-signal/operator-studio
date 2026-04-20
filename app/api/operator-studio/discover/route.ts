import { NextResponse, type NextRequest } from "next/server"

import { isAuthenticated } from "@/lib/operator-studio/auth"
import {
  discoverClaudeSessions,
  type ParsedClaudeSession,
} from "@/lib/operator-studio/importers/claude-code"
import {
  discoverCodexSessions,
  type ParsedCodexSession,
} from "@/lib/operator-studio/importers/codex"
import type { OperatorSourceApp } from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

export interface DiscoveredSession {
  sourceThreadId: string
  title: string
  messageCount: number
  filePath: string | null
  projectHint: string | null
  createdAt: string | null
  lastActivityAt: string | null
  sourceApp: OperatorSourceApp
}

function toPreview(
  s: ParsedClaudeSession | ParsedCodexSession,
  sourceApp: OperatorSourceApp
): DiscoveredSession {
  return {
    sourceThreadId: s.sourceThreadId,
    title: s.title,
    messageCount: s.messages.length,
    filePath:
      ((s.metadata as Record<string, unknown>)?.filePath as string) ?? null,
    projectHint: s.projectPath ?? null,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    sourceApp,
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const source = req.nextUrl.searchParams.get(
    "source"
  ) as OperatorSourceApp | null

  if (!source) {
    return NextResponse.json(
      { error: "Provide ?source=claude|codex" },
      { status: 400 }
    )
  }

  let sessions: DiscoveredSession[] = []

  try {
    switch (source) {
      case "claude":
        sessions = discoverClaudeSessions().map((s) => toPreview(s, "claude"))
        break
      case "codex":
        sessions = discoverCodexSessions().map((s) => toPreview(s, "codex"))
        break
      default:
        return NextResponse.json(
          { error: `Discovery for "${source}" is not yet supported` },
          { status: 400 }
        )
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `Discovery failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        sessions: [],
      },
      { status: 500 }
    )
  }

  sessions.sort((a, b) => {
    const da = a.lastActivityAt ?? a.createdAt ?? ""
    const dbb = b.lastActivityAt ?? b.createdAt ?? ""
    return dbb.localeCompare(da)
  })

  return NextResponse.json({ sessions, count: sessions.length })
}
