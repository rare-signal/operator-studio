import type { Metadata } from "next"

import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { getOutboxCounts, listOutbox } from "@/lib/operator-studio/outbox"

import { OutboxListClient } from "./outbox-list-client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Outbox" }

export default async function OutboxListPage() {
  const workspaceId = await getActiveWorkspaceId()
  const [items, counts] = await Promise.all([
    listOutbox(workspaceId, { limit: 100 }),
    getOutboxCounts(workspaceId),
  ])
  return <OutboxListClient initialItems={items} initialCounts={counts} />
}
