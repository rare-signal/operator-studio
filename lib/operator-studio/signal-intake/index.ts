import { AZURE_DEVOPS_DEFAULTS, getAzureDevopsSignals } from "./azure-devops"
import { TELEGENTO_TEAMS_CHANNELS } from "./teams-manifest"
import { getSeedTeamsSignals } from "./teams-seed"
import type { SignalIntakeSnapshot } from "./types"

export async function getSignalIntakeSnapshot(): Promise<SignalIntakeSnapshot> {
  const ado = await getAzureDevopsSignals()
  const teamsSeed = getSeedTeamsSignals()
  const firstChannel = TELEGENTO_TEAMS_CHANNELS[0]

  return {
    generatedAt: new Date().toISOString(),
    ado: {
      ...AZURE_DEVOPS_DEFAULTS,
      live: ado.live,
      error: ado.error,
    },
    teams: {
      teamName: "Telegento",
      groupId: firstChannel?.groupId ?? "",
      tenantId: firstChannel?.tenantId ?? "",
      live: false,
      error: "Microsoft Graph OAuth is not wired yet. Channel IDs and seed signals are captured.",
    },
    candidates: [...ado.candidates, ...teamsSeed].sort((a, b) => {
      const order = { urgent: 0, high: 1, normal: 2, watch: 3 }
      return order[a.priority] - order[b.priority]
    }),
  }
}
