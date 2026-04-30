/**
 * Discord announcer for Operator Studio thread.promoted events.
 *
 * Same pattern as slack-announce.ts — HMAC-verify the delivery, forward a
 * formatted message to a Discord webhook. Configure in the Admin UI with
 * the same secret you put in DISCORD_HOOK_SIGNING_SECRET.
 *
 * Environment:
 *   DISCORD_INCOMING_WEBHOOK_URL — from Discord channel settings
 *   DISCORD_HOOK_SIGNING_SECRET  — matches the webhook subscription secret
 *   OPERATOR_STUDIO_PUBLIC_URL   — used to build thread links
 */

import { createHmac, timingSafeEqual } from "crypto"

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text()

  const signingSecret = process.env.DISCORD_HOOK_SIGNING_SECRET
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

  const discordUrl = process.env.DISCORD_INCOMING_WEBHOOK_URL
  if (!discordUrl) {
    return new Response("DISCORD_INCOMING_WEBHOOK_URL not set", { status: 500 })
  }

  const fields: Array<{ name: string; value: string; inline?: boolean }> = []
  if (payload.projectSlug) {
    fields.push({ name: "Project", value: payload.projectSlug, inline: true })
  }
  if (payload.tags.length > 0) {
    fields.push({ name: "Tags", value: payload.tags.join(", "), inline: true })
  }
  if (payload.whyItMatters) {
    fields.push({
      name: "Why it matters",
      value: payload.whyItMatters.slice(0, 1000),
    })
  }

  const embed = {
    title: payload.promotedTitle.slice(0, 256),
    description: payload.promotedSummary.slice(0, 4000),
    url: link,
    color: 0x7b61ff,
    fields,
    footer: { text: `Promoted by ${payload.promotedBy}` },
    timestamp: new Date().toISOString(),
  }

  const res = await fetch(discordUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  })

  return new Response(res.ok ? "ok" : "discord error", { status: res.ok ? 200 : 502 })
}
