import "server-only"

import { createHmac, randomUUID } from "crypto"
import { and, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { webhookSubscriptions } from "@/lib/server/db/schema"

/**
 * Outbound webhook service.
 *
 * Callers fire events via `emitWebhookEvent(workspaceId, event, payload)`.
 * Subscribed receivers (rows in `webhook_subscriptions` for that workspace,
 * optionally filtered by event name) get a POST with the payload. Each
 * delivery includes HMAC-SHA256 headers for signature verification.
 *
 * Delivery is fire-and-forget and non-blocking on the hot path — we don't
 * want a slow webhook to stall an ingest or promotion. Failures update
 * `last_status` on the subscription so admins can see dead endpoints.
 *
 * A single shared endpoint can also be configured globally via
 * `OPERATOR_STUDIO_PROMOTION_WEBHOOK_URL` as a zero-DB escape hatch.
 */

export type WebhookEvent =
  | "thread.imported"
  | "thread.promoted"
  | "thread.archived"
  | "message.promoted"

export interface WebhookPayload {
  event: WebhookEvent
  workspaceId: string
  timestamp: string
  // Flexible — each event type stuffs its own fields here.
  [key: string]: unknown
}

export function emitWebhookEvent(
  workspaceId: string,
  event: WebhookEvent,
  payload: Omit<WebhookPayload, "event" | "workspaceId" | "timestamp">
): void {
  // If an absolute public base URL is configured, build a click-through
  // link for thread-scoped events so receivers (Slack / Discord / etc) can
  // deep-link back into Operator Studio without hardcoding the host.
  const publicBase = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  const threadId = typeof payload.threadId === "string" ? payload.threadId : null
  const publicUrl =
    publicBase && threadId
      ? `${publicBase}/operator-studio/threads/${threadId}`
      : undefined

  // Fire and forget — we don't await here. Errors are logged on the row.
  void deliver(workspaceId, event, {
    ...payload,
    event,
    workspaceId,
    timestamp: new Date().toISOString(),
    ...(publicUrl ? { publicUrl } : {}),
  })
}

async function deliver(
  workspaceId: string,
  event: WebhookEvent,
  payload: WebhookPayload
): Promise<void> {
  // Global escape hatch subscriber (env-configured, no DB row).
  const envUrl = process.env.OPERATOR_STUDIO_PROMOTION_WEBHOOK_URL?.trim()
  const envSecret = process.env.OPERATOR_STUDIO_PROMOTION_WEBHOOK_SECRET?.trim()
  if (envUrl) {
    void post(envUrl, envSecret ?? null, payload).catch(() => undefined)
  }

  // DB-backed subscribers.
  let subs: Array<typeof webhookSubscriptions.$inferSelect> = []
  try {
    const db = getDb()
    subs = await db
      .select()
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.workspaceId, workspaceId),
          isNull(webhookSubscriptions.disabledAt)
        )
      )
  } catch {
    // DB unavailable — env hook may still have fired.
    return
  }

  const delivery = subs.map(async (sub) => {
    // Event filter: null = all events, otherwise must match comma-list.
    if (sub.events) {
      const allowed = sub.events.split(",").map((e) => e.trim()).filter(Boolean)
      if (allowed.length > 0 && !allowed.includes(event)) return
    }
    const status = await post(sub.url, sub.secret, payload).catch(() => -1)
    try {
      const db = getDb()
      await db
        .update(webhookSubscriptions)
        .set({
          lastDeliveredAt: new Date(),
          lastStatus: status,
        })
        .where(eq(webhookSubscriptions.id, sub.id))
    } catch {
      // best-effort
    }
  })

  await Promise.allSettled(delivery)
}

async function post(
  url: string,
  secret: string | null,
  payload: WebhookPayload
): Promise<number> {
  const body = JSON.stringify(payload)
  const deliveryId = randomUUID()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-OperatorStudio-Event": payload.event,
    "X-OperatorStudio-Delivery": deliveryId,
    "X-OperatorStudio-Timestamp": payload.timestamp,
  }
  if (secret) {
    const sig = createHmac("sha256", secret).update(body).digest("hex")
    headers["X-OperatorStudio-Signature"] = `sha256=${sig}`
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  })
  return res.status
}
