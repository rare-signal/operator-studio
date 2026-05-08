import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  getFactory,
  renderFactoryContextHeader,
} from "@/lib/operator-studio/factories"
import { listOutbox } from "@/lib/operator-studio/outbox"
import { listInboxEvents } from "@/lib/operator-studio/inbox"

import { FactoryViewClient } from "./factory-view-client"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return { title: `Factory · ${id}` }
}

export default async function FactoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspaceId = await getActiveWorkspaceId()
  const factory = await getFactory(workspaceId, id)
  if (!factory) return notFound()

  const [awaitingOutbox, recentOutbox, recentInbox] = await Promise.all([
    listOutbox(workspaceId, { state: "awaiting_approval", limit: 20 }),
    listOutbox(workspaceId, { limit: 20 }),
    listInboxEvents(workspaceId, { factoryId: id, limit: 20 }),
  ])

  return (
    <FactoryViewClient
      factory={factory}
      contextHeader={renderFactoryContextHeader(factory)}
      awaitingOutbox={awaitingOutbox}
      recentOutbox={recentOutbox}
      recentInbox={recentInbox}
    />
  )
}
