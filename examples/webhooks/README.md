# Webhook receivers

When a thread is imported or promoted, Operator Studio can POST to any URL
you configure. Per-workspace subscriptions are managed in the Admin UI
(`/operator-studio/admin`). A zero-DB global subscriber is available via
`OPERATOR_STUDIO_PROMOTION_WEBHOOK_URL`.

## Delivery contract

Every delivery has these headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-OperatorStudio-Event` | Event name (`thread.imported`, `thread.promoted`, etc) |
| `X-OperatorStudio-Delivery` | UUID unique to this delivery (for dedupe on your side) |
| `X-OperatorStudio-Timestamp` | ISO8601 timestamp |
| `X-OperatorStudio-Signature` | `sha256=<hex>` — HMAC of the raw request body, only present when a secret is configured |

Verify the signature like this:

```ts
import { createHmac, timingSafeEqual } from "crypto"

function verify(rawBody: string, headerSig: string, secret: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex")
  return headerSig.length === expected.length &&
    timingSafeEqual(Buffer.from(headerSig), Buffer.from(expected))
}
```

## Event payloads

All events share this envelope:

```json
{
  "event": "thread.promoted",
  "workspaceId": "global",
  "timestamp": "2026-04-20T12:34:56.789Z",
  "...event-specific fields..."
}
```

### `thread.imported`

```json
{
  "event": "thread.imported",
  "workspaceId": "global",
  "timestamp": "2026-04-20T12:34:56.789Z",
  "threadId": "thread-...",
  "title": "fix sidebar layout bug",
  "source": "claude-code",
  "detectedFormat": "labeled-transcript",
  "messageCount": 4,
  "importedBy": "alex",
  "tags": ["nextjs", "layout"],
  "projectSlug": "acme-app"
}
```

### `thread.promoted`

```json
{
  "event": "thread.promoted",
  "workspaceId": "global",
  "timestamp": "2026-04-20T12:34:56.789Z",
  "threadId": "thread-...",
  "promotedTitle": "router.refresh() doesn't bust fetch cache in parent layouts",
  "promotedSummary": "...",
  "whyItMatters": "...",
  "tags": ["nextjs", "app-router"],
  "projectSlug": "acme-app",
  "promotedBy": "alex"
}
```

## Reference receivers

- [`slack-announce.ts`](./slack-announce.ts) — a tiny Next.js (or any Node)
  route that forwards `thread.promoted` events to a Slack Incoming Webhook
  as a formatted block message. Drop it behind any endpoint and point
  Operator Studio at it.
- [`discord-announce.ts`](./discord-announce.ts) — same idea, Discord flavor.

## Retry

Deliveries are fire-and-forget on the Operator Studio side — we do not
retry failures (yet). Use the Admin UI to see `last_status` per
subscription and debug with your receiver's own logs. If you need durable
delivery, terminate the webhook at your own queue (Inngest, Temporal, a
Redis list) and retry from there.
