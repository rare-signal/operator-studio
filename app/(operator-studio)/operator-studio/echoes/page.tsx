import type { Metadata } from "next"

import { buildFixtureEchoes } from "@/lib/operator-studio/wayseer/fixtures-echoes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

import { EchoesView } from "./echoes-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Echoes" }

/**
 * Echoes — your own words, in chronological order, with quiet
 * recurrence indicators. The agent's job is matching, not naming.
 *
 * No titles, no rationales, no temperatures. The operator reads their
 * own verbatim turns and decides for themselves which ones rhyme.
 *
 * Replaces (or sits beside) Trails. Reads from a fixture today; once
 * the real producer lands, this is a thin client over an API that
 * returns the same shape.
 */
export default async function EchoesPage() {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const feed = buildFixtureEchoes({ workspaceId, now: new Date() })
  return <EchoesView feed={feed} />
}
