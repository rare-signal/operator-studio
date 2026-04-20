/**
 * Slack announcer for Operator Studio thread.promoted events.
 *
 * Drop this as a Next.js API route (e.g. app/api/os-hooks/slack/route.ts)
 * or adapt to any Node HTTP handler. Point an Operator Studio webhook
 * subscription at it:
 *
 *   Admin → Webhooks → New
 *     Label   : Slack #eng-knowledge
 *     URL     : https://your-host/api/os-hooks/slack
 *     Secret  : <openssl rand -hex 32>   (paste the same value into
 *                SLACK_HOOK_SIGNING_SECRET below)
 *     Events  : thread.promoted
 *
 * Environment:
 *   SLACK_INCOMING_WEBHOOK_URL — from Slack app settings
 *   SLACK_HOOK_SIGNING_SECRET  — matches the webhook subscription secret
 *   OPERATOR_STUDIO_PUBLIC_URL — used to build thread links
 */

import { createHmac, timingSafeEqual } from "crypto"

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()

  // Verify HMAC signature.
  const signingSecret = process.env.SLACK_HOOK_SIGNING_SECRET
  if (signingSecret) {
    const presented = req.headers.get("x-operatorstudio-signature") ?? ""
    const expected =
      "sha256=" + createHmac("sha256", signingSecret).update(rawBody).digest("hex")
    if (
      presented.length !== expected.length ||
      !timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
    ) {
      return new Response("bad signature", { status: 401 })
    }
  }

  const event = req.headers.get("x-operatorstudio-event") ?? ""
  if (event !== "thread.promoted") {
    return new Response("ignored", { status: 200 })
  }

  const payload = JSON.parse(rawBody) as {
    threadId: string
    promotedTitle: string
    promotedSummary: string
    whyItMatters: string | null
    tags: string[]
    projectSlug: string | null
    promotedBy: string
  }

  const baseUrl = process.env.OPERATOR_STUDIO_PUBLIC_URL ?? ""
  const link = `${baseUrl}/operator-studio/threads/${payload.threadId}`

  const slackUrl = process.env.SLACK_INCOMING_WEBHOOK_URL
  if (!slackUrl) {
    return new Response("SLACK_INCOMING_WEBHOOK_URL not set", { status: 500 })
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `New promoted thread: ${payload.promotedTitle}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: payload.promotedSummary.slice(0, 2500),
      },
    },
    ...(payload.whyItMatters
      ? [
          {
            type: "section",
            text: { type: "mrkdwn", text: `_${payload.whyItMatters.slice(0, 500)}_` },
          },
        ]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: [
            `Promoted by *${payload.promotedBy}*`,
            payload.projectSlug ? `project \`${payload.projectSlug}\`` : null,
            payload.tags.length > 0 ? payload.tags.map((t) => `\`${t}\``).join(" ") : null,
            `<${link}|Open in Operator Studio>`,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      ],
    },
  ]

  const res = await fetch(slackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  })

  return new Response(res.ok ? "ok" : "slack error", { status: res.ok ? 200 : 502 })
}
