import type { Metadata } from "next"

import { SoundProvider } from "../components/sound-context"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import CockpitClient from "./cockpit-client"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Cockpit" }

export default async function CockpitPage() {
  const workspaceId = await getActiveWorkspaceId()
  return (
    <SoundProvider>
      <CockpitClient workspaceId={workspaceId} />
    </SoundProvider>
  )
}
