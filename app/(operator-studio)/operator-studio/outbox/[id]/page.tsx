import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { getOutbox } from "@/lib/operator-studio/outbox"
import { hashOutboundPayload } from "@/lib/operator-studio/outbound-gate"

import { OutboxRowClient } from "./outbox-row-client"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Outbox · row" }

export default async function OutboxRowPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const workspaceId = await getActiveWorkspaceId()
  const { id } = await params
  const row = await getOutbox(workspaceId, id)
  if (!row) return notFound()
  const payloadHash = hashOutboundPayload(row.payload)
  return <OutboxRowClient initialRow={row} initialPayloadHash={payloadHash} />
}
