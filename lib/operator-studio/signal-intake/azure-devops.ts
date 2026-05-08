import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { SignalCandidate } from "./types"

const execFileAsync = promisify(execFile)

const ORGANIZATION = "https://dev.azure.com/ClarifyingMarketingGroup"
const PROJECT = "IT"

interface AdoWorkItem {
  fields?: Record<string, unknown>
  id?: number
  url?: string
}

interface AdoQueryResponse {
  workItems?: AdoWorkItem[]
}

function field(fields: Record<string, unknown> | undefined, key: string) {
  const value = fields?.[key]
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function identityName(fields: Record<string, unknown> | undefined, key: string) {
  const value = fields?.[key]
  if (!value || typeof value !== "object") return field(fields, key)
  const identity = value as { displayName?: unknown; uniqueName?: unknown }
  if (typeof identity.displayName === "string") return identity.displayName
  if (typeof identity.uniqueName === "string") return identity.uniqueName
  return ""
}

function priorityFor(title: string, state: string): SignalCandidate["priority"] {
  const text = `${title} ${state}`.toLowerCase()
  if (text.includes("sales floor") || text.includes("lead vendor")) return "urgent"
  if (text.includes("disputable") || text.includes("enrollhere")) return "high"
  if (state.toLowerCase() === "active") return "high"
  return "normal"
}

export async function getAzureDevopsSignals(): Promise<{
  live: boolean
  error?: string
  candidates: SignalCandidate[]
}> {
  const wiql =
    "SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo], [System.Tags], [System.ChangedDate], [System.WorkItemType] FROM WorkItems WHERE [System.TeamProject] = 'IT' AND [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC"

  try {
    const { stdout } = await execFileAsync(
      "az",
      [
        "boards",
        "query",
        "--organization",
        ORGANIZATION,
        "--project",
        PROJECT,
        "--wiql",
        wiql,
        "--output",
        "json",
      ],
      { timeout: 15_000 },
    )

    const data = JSON.parse(stdout) as AdoQueryResponse | AdoWorkItem[]
    const workItems = Array.isArray(data) ? data : (data.workItems ?? [])

    return {
      live: true,
      candidates: workItems.slice(0, 12).map((item) => {
        const fields = item.fields
        const id = item.id ? String(item.id) : field(fields, "System.Id")
        const title = field(fields, "System.Title") || `Work item ${id}`
        const state = field(fields, "System.State")
        const type = field(fields, "System.WorkItemType")
        const assignedTo = identityName(fields, "System.AssignedTo")
        const tags = field(fields, "System.Tags")
          .split(";")
          .map((tag) => tag.trim())
          .filter(Boolean)
        const changedDate = field(fields, "System.ChangedDate")

        return {
          id: `ado-${id}`,
          source: "azure-devops",
          sourceLabel: `ADO · ${type || "Work Item"} #${id}`,
          title,
          body: `Azure DevOps item #${id} is ${state || "open"} in ${PROJECT}${assignedTo ? ` and assigned to ${assignedTo}` : ""}. Importing creates an Operator Studio task candidate while preserving the upstream work item link.`,
          priority: priorityFor(title, state),
          suggestedAction: "import-task",
          externalUrl: `${ORGANIZATION}/${PROJECT}/_workitems/edit/${id}`,
          sourceRef: {
            system: "azure-devops",
            teamOrProject: PROJECT,
            remoteId: id,
          },
          actor: assignedTo,
          status: state,
          updatedAt: changedDate || undefined,
          updatedAtLabel: changedDate
            ? new Date(changedDate).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "changed recently",
          tags,
          live: true,
        } satisfies SignalCandidate
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Azure DevOps error"
    return {
      live: false,
      error: message,
      candidates: [],
    }
  }
}

export const AZURE_DEVOPS_DEFAULTS = {
  organization: ORGANIZATION,
  project: PROJECT,
}
