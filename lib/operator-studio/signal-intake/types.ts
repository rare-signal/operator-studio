export type SignalSource = "azure-devops" | "microsoft-teams"

export type SignalPriority = "urgent" | "high" | "normal" | "watch"

export type SignalAction =
  | "import-task"
  | "attach-context"
  | "draft-reply"
  | "watch"

export interface SignalCandidate {
  id: string
  source: SignalSource
  sourceLabel: string
  title: string
  body: string
  priority: SignalPriority
  suggestedAction: SignalAction
  externalUrl?: string
  sourceRef: {
    system: string
    teamOrProject: string
    channelOrArea?: string
    remoteId: string
  }
  actor?: string
  status?: string
  /** ISO timestamp when the upstream signal last changed or was observed. */
  updatedAt?: string
  updatedAtLabel: string
  tags: string[]
  live: boolean
}

export interface SignalIntakeSnapshot {
  generatedAt: string
  ado: {
    organization: string
    project: string
    live: boolean
    error?: string
  }
  teams: {
    teamName: string
    groupId: string
    tenantId: string
    live: boolean
    error?: string
  }
  candidates: SignalCandidate[]
}
