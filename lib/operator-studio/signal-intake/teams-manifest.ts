export interface TeamsSignalChannel {
  name: string
  purpose: string
  groupId: string
  tenantId: string
  channelId: string
  webUrl: string
}

const groupId = "a56413dd-7152-4b64-ac44-fca6283bc870"
const tenantId = "30f8f693-7362-4c47-b04b-b0dfbab4877d"

export const TELEGENTO_TEAMS_CHANNELS: TeamsSignalChannel[] = [
  {
    name: "Feedback",
    purpose: "Product feedback, bug reports, and user-facing request intake.",
    groupId,
    tenantId,
    channelId:
      "19:c7IccnetQGLA0GFiAcXByGXt0O_YZzTnS5VbUuqAmDU1@thread.tacv2",
    webUrl:
      "https://teams.microsoft.com/l/channel/19%3Ac7IccnetQGLA0GFiAcXByGXt0O_YZzTnS5VbUuqAmDU1%40thread.tacv2/Feedback?groupId=a56413dd-7152-4b64-ac44-fca6283bc870&tenantId=30f8f693-7362-4c47-b04b-b0dfbab4877d",
  },
  {
    name: "Lead Disputes",
    purpose:
      "Discussion of disputable calls, EnrollHere traceability, and automation needs.",
    groupId,
    tenantId,
    channelId: "19:b82f29fa6ca14fca97580e6a67d65881@thread.tacv2",
    webUrl:
      "https://teams.microsoft.com/l/channel/19%3Ab82f29fa6ca14fca97580e6a67d65881%40thread.tacv2/Lead%20Disputes?groupId=a56413dd-7152-4b64-ac44-fca6283bc870&tenantId=30f8f693-7362-4c47-b04b-b0dfbab4877d",
  },
  {
    name: "Misc System Alerts",
    purpose: "Webhook-based overflow alerts and integration smoke signals.",
    groupId,
    tenantId,
    channelId: "19:d8254b0dbacf4918b63eec4af2b5499d@thread.tacv2",
    webUrl:
      "https://teams.microsoft.com/l/channel/19%3Ad8254b0dbacf4918b63eec4af2b5499d%40thread.tacv2/Misc%20System%20Alerts?groupId=a56413dd-7152-4b64-ac44-fca6283bc870&tenantId=30f8f693-7362-4c47-b04b-b0dfbab4877d",
  },
  {
    name: "Performance",
    purpose: "Automated performance and momentum alerts.",
    groupId,
    tenantId,
    channelId: "19:a0480196f0ff455aba87c4a5de62c01d@thread.tacv2",
    webUrl:
      "https://teams.microsoft.com/l/channel/19%3Aa0480196f0ff455aba87c4a5de62c01d%40thread.tacv2/Performance?groupId=a56413dd-7152-4b64-ac44-fca6283bc870&tenantId=30f8f693-7362-4c47-b04b-b0dfbab4877d",
  },
]
