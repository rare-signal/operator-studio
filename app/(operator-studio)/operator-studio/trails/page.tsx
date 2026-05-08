import type { Metadata } from "next"

import { loadActivePlan } from "@/app/2/v2/data/load"
import {
  buildFixtureTrails,
  buildStepTitleLookup,
  remapFixtureLinks,
} from "@/lib/operator-studio/wayseer/fixtures-trails"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

import { TrailsView } from "./trails-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Trails" }

/**
 * Trails — the Sleuth's surface. Cross-session synthesis of the
 * preoccupations the operator keeps returning to in their own words.
 *
 * The real Sleuth runner that pulls operator messages across recent
 * sessions and produces the TrailsResponse via an LLM is not yet
 * built; this page hydrates from the fixture so the surface is
 * reviewable end-to-end before the producer side exists. Same shape
 * `parseTrailsResponse` returns, so swapping the data source later is
 * a one-line change.
 *
 * Bridge to the live plan: when the active plan loads, we remap the
 * fixture's stub `linked_step_ids` to real step ids round-robin so
 * `→ Step:` chips on Trail cards (and the Trails-for-step section in
 * the StepModal) actually resolve to the user's real plan rather than
 * to opaque demo strings.
 */
export default async function TrailsPage() {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const activePlan = await loadActivePlan(workspaceId).catch(() => null)
  const planSteps =
    activePlan?.steps?.map((s) => ({ id: s.id, title: s.title })) ?? []

  const baseResponse = buildFixtureTrails({ workspaceId, now: new Date() })
  const response = remapFixtureLinks(baseResponse, planSteps)
  const stepTitlesById = buildStepTitleLookup(planSteps)

  return <TrailsView response={response} stepTitlesById={stepTitlesById} />
}
