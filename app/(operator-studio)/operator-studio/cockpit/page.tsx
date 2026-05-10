import type { Metadata } from "next"

import { SoundProvider } from "../components/sound-context"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import CockpitClient from "./cockpit-client"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Cockpit" }

interface CockpitPageProps {
  searchParams: Promise<{ exec?: string }>
}

export default async function CockpitPage({ searchParams }: CockpitPageProps) {
  const sp = await searchParams
  const workspaceId = await getActiveWorkspaceId()
  return (
    <SoundProvider>
      <CockpitClient
        initialExecAgentId={sp.exec ?? null}
        workspaceId={workspaceId}
      />
    </SoundProvider>
  )
}
