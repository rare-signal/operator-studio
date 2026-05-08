import type { Metadata } from "next"

import { isKbEnabled, listEntries } from "@/lib/operator-studio/knowledge"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

import { KnowledgeBaseClient } from "./knowledge-base-client"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Knowledge Base" }

/**
 * Knowledge Base — Living Wikipedia of OS Insights.
 *
 * Optional module per workspace. When disabled, renders an enable-prompt;
 * when enabled, renders the full home/detail surface modeled 1:1 on the
 * AIDA Observatory intelligence/memory page.
 */
export default async function KnowledgeBasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const initialSelected =
    typeof params.entry === "string" ? params.entry : null

  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const enabled = await isKbEnabled(workspaceId)
  const entries = enabled ? await listEntries(workspaceId) : []

  return (
    <KnowledgeBaseClient
      workspaceId={workspaceId}
      initialEnabled={enabled}
      initialEntries={entries}
      initialSelectedId={initialSelected}
    />
  )
}
