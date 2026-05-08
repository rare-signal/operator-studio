import { TELEGENTO_TEAMS_CHANNELS } from "./teams-manifest"
import type { SignalCandidate } from "./types"

const byName = new Map(TELEGENTO_TEAMS_CHANNELS.map((channel) => [channel.name, channel]))

export function getSeedTeamsSignals(): SignalCandidate[] {
  const feedback = byName.get("Feedback")
  const leadDisputes = byName.get("Lead Disputes")

  return [
    {
      id: "teams-feedback-call-listening-viewing",
      source: "microsoft-teams",
      sourceLabel: "Teams · Feedback",
      title: "Call listening/viewing error",
      body:
        "Mitch reported that team members hit an error when opening call details and listening to individual calls.",
      priority: "high",
      suggestedAction: "import-task",
      externalUrl: feedback?.webUrl,
      sourceRef: {
        system: "teams",
        teamOrProject: "Telegento",
        channelOrArea: "Feedback",
        remoteId: feedback?.channelId ?? "Feedback",
      },
      actor: "Mitch Buder",
      status: "new signal",
      updatedAt: "2026-05-05T14:58:00.000Z",
      updatedAtLabel: "May 5, 2026 7:58 AM",
      tags: ["feedback", "call-detail", "audio", "bug"],
      live: false,
    },
    {
      id: "teams-feedback-disputable-calls",
      source: "microsoft-teams",
      sourceLabel: "Teams · Feedback",
      title: "View and trace disputable calls",
      body:
        "Robert needs a way to view disputable calls. Short term: expose a UID or identifier that traces back to EnrollHere. Long term: search or alerts to consolidate and hand over disputable call context.",
      priority: "high",
      suggestedAction: "attach-context",
      externalUrl: feedback?.webUrl,
      sourceRef: {
        system: "teams",
        teamOrProject: "Telegento",
        channelOrArea: "Feedback",
        remoteId: feedback?.channelId ?? "Feedback",
      },
      actor: "Micky Sakora",
      status: "new signal",
      updatedAt: "2026-05-05T20:52:00.000Z",
      updatedAtLabel: "May 5, 2026 1:52 PM",
      tags: ["feedback", "lead-disputes", "enrollhere", "automation"],
      live: false,
    },
    {
      id: "teams-feedback-scorecard-questions",
      source: "microsoft-teams",
      sourceLabel: "Teams · Feedback",
      title: "Scorecard question update path",
      body:
        "James needs a way to update scorecard and QA questions. Short term: send new questions to check against. Long term: elevated-user self-serve UI.",
      priority: "normal",
      suggestedAction: "watch",
      externalUrl: feedback?.webUrl,
      sourceRef: {
        system: "teams",
        teamOrProject: "Telegento",
        channelOrArea: "Feedback",
        remoteId: feedback?.channelId ?? "Feedback",
      },
      actor: "Micky Sakora",
      status: "new signal",
      updatedAt: "2026-05-05T20:52:00.000Z",
      updatedAtLabel: "May 5, 2026 1:52 PM",
      tags: ["feedback", "scorecards", "qa", "admin"],
      live: false,
    },
    {
      id: "teams-lead-disputes-automation-watch",
      source: "microsoft-teams",
      sourceLabel: "Teams · Lead Disputes",
      title: "Watch lead-dispute automation needs",
      body:
        "Treat this channel as the intake lane for dispute-related workflow automation, especially anything that reduces manual EnrollHere handoff work.",
      priority: "watch",
      suggestedAction: "watch",
      externalUrl: leadDisputes?.webUrl,
      sourceRef: {
        system: "teams",
        teamOrProject: "Telegento",
        channelOrArea: "Lead Disputes",
        remoteId: leadDisputes?.channelId ?? "Lead Disputes",
      },
      status: "channel watch",
      updatedAt: "2026-05-05T20:52:00.000Z",
      updatedAtLabel: "manifest captured",
      tags: ["lead-disputes", "automation", "watch"],
      live: false,
    },
  ]
}
