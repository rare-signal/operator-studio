/**
 * Seed the push-notification options KB entry.
 *
 *   pnpm tsx scripts/seed-push-notification-research-kb.ts
 *
 * Discovery output for `step-push-notification-research`. Idempotent.
 */

import { createRequire } from "node:module"
const requireFromHere = createRequire(import.meta.url)
const serverOnlyId = requireFromHere.resolve("server-only")
requireFromHere.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })

const { upsertEntry } = await import("../lib/operator-studio/knowledge")
const { GLOBAL_WORKSPACE_ID } = await import(
  "../lib/operator-studio/workspaces"
)
const { getPgPool } = await import("../lib/server/db/client")

const ENTRY_ID = "kb-2026-05-10-push-notification-options-for-customer-of-one"

const BODY = `# Push notification options for a customer-of-one cockpit (David)

## TL;DR

**Recommended: ntfy.sh hosted.** It is free, requires no account, has a polished iOS app, accepts a one-line \`curl\` from the cockpit's Node backend, and ships sub-5s notifications in practice. Pushover is the strong runner-up (one-time $5, more polished UX, formal rate-limiting), and a Telegram bot is the best fallback if David wants buttons / inline actions or already lives in Telegram. Everything else (Pushbullet, Discord webhooks, Twilio SMS, iMessage relay, iOS Shortcuts, plain email) is either friction-heavy, latency-flaky, paid, or fragile in a way that does not justify picking it as the daily driver.

## Comparison table

Legend: ✓ pass · ⚠ acceptable with caveats · ✗ fails the criterion.

| Option | Free for 1 user | Self-host? | Mobile latency | Backend trigger | Phone setup | Rich (title/body/url) | Reliable on flaky cell | Rate-limit story |
|---|---|---|---|---|---|---|---|---|
| **ntfy.sh** (hosted) | ✓ free, no account | ✓ optional | ✓ <5s typical | ✓ \`POST https://ntfy.sh/<topic>\` | ⚠ install iOS app, sub topic | ✓ title + body + click URL + actions | ✓ APNs-backed | ⚠ soft caps on free hosted |
| **Pushover** | ⚠ $5 one-time per platform | ✗ hosted only | ✓ <5s | ✓ \`POST api.pushover.net/1/messages.json\` | ⚠ install app + buy license | ✓ title + body + url + priority | ✓ APNs-backed, mature | ✓ 10k msgs/mo free after license |
| **Telegram bot** | ✓ free | ✗ Telegram cloud | ✓ <5s | ✓ \`POST api.telegram.org/bot.../sendMessage\` | ⚠ install Telegram + start bot | ✓ markdown + inline buttons | ✓ proven globally | ✓ 30/sec per bot |
| **Pushbullet** | ⚠ free tier 100 push/mo | ✗ hosted only | ⚠ ~10s | ✓ simple REST | ⚠ install app | ⚠ title + body, weaker UX | ⚠ mixed reports | ⚠ free cap is 100/mo |
| **Discord webhook** | ✓ free | ✗ Discord cloud | ⚠ 5–30s, depends on mobile push settings | ✓ webhook POST | ✓ already installed for most | ⚠ embeds, but app is noisy | ⚠ Discord prioritizes DMs poorly | ⚠ 30/min per webhook |
| **APNs direct** | ✗ $99/yr Apple Dev | ✗ Apple-only | ✓ <2s | ⚠ HTTP/2 + JWT signing | ✗ ship a custom iOS app | ✓ full | ✓ canonical | ✓ |
| **Twilio SMS** | ⚠ trial credit only, then per-message | ✗ hosted | ⚠ 5–30s | ✓ SDK or REST | ✓ no app needed | ✗ text only, no URL handling | ⚠ carrier filtering | ⚠ rate-limited by carrier |
| **iMessage relay** (Mac) | ✓ free | ✓ local | ✓ <5s when Mac is awake | ⚠ AppleScript shell-out | ✓ already on iPhone | ⚠ text + link, no buttons | ✗ Mac must be online & awake | ⚠ Apple throttles aggressive sends |
| **iOS Shortcut + webhook** | ✓ free | ✓ local | ⚠ depends on poll cadence | ⚠ Shortcut polls or background URL | ⚠ build/import the Shortcut | ⚠ basic notif | ⚠ unreliable in background | ✓ |
| **Plain email → Mail** | ✓ free | ✓ if self-SMTP | ⚠ 30s–minutes | ✓ SMTP from Node | ✓ already configured | ⚠ subject + body | ⚠ Mail batches push | ✓ |

## Top 3 deep-dives

### 1. ntfy.sh (hosted) — recommended

ntfy is an open-source pub/sub notification service. The hosted instance at \`ntfy.sh\` is free, anonymous, and requires only a topic name (any URL-safe string — David picks a hard-to-guess one and treats it as a shared secret). The iOS app subscribes to that topic; any HTTP POST to the topic URL fires a notification. APNs handles delivery, so phone-locked / cell-flaky behavior is identical to a first-party iOS app.

Setup friction: install ntfy iOS app (~30s), tap "+" → enter topic name → done. No account, no tokens, no keychain. The same topic can be subscribed by ntfy CLI on the Mac for desk-side mirroring.

Integration sketch:

\`\`\`bash
# Plain text — title in header, body in payload
curl -H "Title: Worker ready for review" \\
     -H "Priority: high" \\
     -H "Tags: white_check_mark" \\
     -H "Click: https://cockpit.local/agents/abc-123" \\
     -d "claude:abc-123 finished step-push-notification-research" \\
     https://ntfy.sh/operator-studio-david-<random-suffix>
\`\`\`

Caveats:
- Hosted has soft rate limits (visit-time docs say "a few hundred per day per IP"). Customer-of-one volume is well below that, but a runaway worker loop could trip it. Worth wrapping the cockpit hook with a per-minute cap.
- Topic name is a bearer secret. If David ever pastes a topic into a public channel, anyone can publish to it. Mitigation: include a randomly generated 16-char suffix; rotate if leaked. ntfy also supports auth on self-hosted instances.
- iOS background notifications use silent push to wake the app, which Apple occasionally throttles. In practice ntfy's iOS app maintains a steady delivery rate; reports of >30s delays are rare and usually correlate with iOS Low Power Mode.

### 2. Pushover

Pushover is a 12+ year old hosted push service with mature iOS / Android / desktop apps. One-time $4.99 license per platform after a 30-day trial; free tier covers personal use post-purchase up to 10k messages / month / app token. Two identifiers: the per-user "user key" (David's account) and the per-app "API token" (cockpit registers as an "application" — free to create).

Setup friction: install Pushover iOS app, sign up, pay $5 once, generate an Application token in the web console, copy USER_KEY and APP_TOKEN into cockpit env. Slightly more friction than ntfy but UX is more polished — sound profiles, priority levels with mandatory ack, devices targeting.

Integration sketch:

\`\`\`bash
curl -s \\
  --form-string "token=$PUSHOVER_APP_TOKEN" \\
  --form-string "user=$PUSHOVER_USER_KEY" \\
  --form-string "title=Worker ready for review" \\
  --form-string "message=claude:abc-123 finished step-push-notification-research" \\
  --form-string "url=https://cockpit.local/agents/abc-123" \\
  --form-string "priority=1" \\
  https://api.pushover.net/1/messages.json
\`\`\`

Caveats:
- $5/platform fails the strict free-tier criterion, but the cap is high (10k/mo) and reliability is the best of any hosted option in this set.
- Priority 2 ("emergency") requires retry/expire params and forces user-side ack — useful for stuck-worker alerts but easy to over-use and become noise.
- Ignores rich payloads beyond title/message/url. No buttons.

### 3. Telegram bot

Best-in-class for richness. Create a bot via @BotFather (one-time chat conversation with Telegram's bot bot — outputs a bot token), then have David start a chat with the bot to seed his \`chat_id\`. Backend sends to that chat_id. Inline keyboards give clickable action buttons that route to a callback URL David can answer from the lock screen.

Setup friction: medium. David must already use Telegram (or install it). The chat_id discovery step is awkward (\`getUpdates\` after first bot DM). Once seeded it never changes.

Integration sketch:

\`\`\`bash
curl -s -X POST \\
  "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" \\
  -H "Content-Type: application/json" \\
  -d "$(jq -nc \\
        --arg chat "$TG_CHAT_ID" \\
        --arg text "*Worker ready for review*\\n\\\`claude:abc-123\\\` finished \\\`step-push-notification-research\\\`\\n[Open](https://cockpit.local/agents/abc-123)" \\
        '{chat_id:$chat, text:$text, parse_mode:"Markdown", disable_web_page_preview:true}')"
\`\`\`

Caveats:
- Bot tokens leaking → anyone can impersonate the bot. Rotate via @BotFather.
- Telegram is a chat app, not a notification app. The whole feed is at-risk for noise. Mitigation: a dedicated bot conversation that David mutes-but-not-mute (sound off, badge on).
- Inline-keyboard callbacks require an HTTP webhook David's backend exposes publicly. For a customer-of-one cockpit running on \`localhost:4200\` this means tunneling (Cloudflare Tunnel / Tailscale Funnel). That extra surface area is the reason Telegram falls behind ntfy for v1.

## Recommendation

**Recommendation:** ntfy.sh hosted, single topic, called from a thin server-side notify helper.

**Recommended:** ntfy.sh hosted (single explicit pick for v1).

Smallest first-ship sketch:

1. David installs the ntfy iOS app and subscribes to a topic named \`operator-studio-david-<random16>\` (random suffix lives in \`.env.local\` as \`NTFY_TOPIC\`).
2. Add \`lib/operator-studio/notify.ts\` exporting \`sendPhoneAlert({ title, body, clickUrl?, priority? })\`. Implementation: a single \`fetch\` POST to \`https://ntfy.sh/${'$'}{process.env.NTFY_TOPIC}\` with Title / Priority / Click headers. Throw on non-2xx so a broken topic surfaces in worker logs instead of silently dropping.
3. Wire one trigger first: the worker-status-changed handler in the cockpit, firing on the \`active → ready_for_review\` transition. Title = \`"Worker ready for review"\`. Body = \`"<agentId> finished <stepTitle>"\`. Click = the cockpit's deep link to that worker.
4. Add a per-minute in-process cap (\`max 5 alerts/min\` token bucket) so a runaway state-thrash cannot DOS the topic.
5. Add a \`pnpm notify:test\` script that hits the helper with a synthetic payload — David runs it once after install to confirm end-to-end delivery.

Everything else (stuck-worker alerts, blocker alerts, lane-level digests) layers on the same helper. If ntfy ever proves unreliable for David's use case, the helper is one file to swap to Pushover.

## Hooks needed in operator-studio

Server-side wiring required before the recommendation can fire alerts. Sketches only — no implementation here.

- **\`lib/operator-studio/notify.ts\`** — single exported \`sendPhoneAlert\` function. Reads \`NTFY_TOPIC\` from env, no-ops with a console warning if unset (so dev environments without a topic do not crash).
- **Cockpit worker-status hook** — the existing review-status update path (the one that flips workers into \`ready_for_review\`) gains one \`await sendPhoneAlert(...)\` call, fire-and-forget with \`.catch(console.error)\` so notification failure never blocks the status transition.
- **Per-minute rate limit** — small in-process token bucket (a 5-line Map keyed by minute) inside \`notify.ts\`. Drops alerts past the cap with a warn log; David sees missing alerts in logs rather than being spammed.
- **Optional v2 hooks** — stuck-worker detector (worker active >2h with no parrot), blocker-detected (worker emits a blocker chip), lane-level digest at meta-Berthier turn boundaries. Each is one additional caller of the same helper.
- **Env plumbing** — \`NTFY_TOPIC\` added to the \`.env.local\` template doc / setup README. No secret rotation infra needed for a customer-of-one cockpit; rotating means changing the topic string.
- **No DB tables.** Push delivery is fire-and-forget; if observability is later wanted, log to existing structured logs rather than a new table.

## Open questions for David

1. **Trigger scope.** Confirm the v1 trigger set: ready-for-review only? Or also blocked / errored / stuck-worker? Recommendation is ready-for-review only for v1, expand once signal-to-noise is calibrated.
2. **Quiet hours.** Should the notify helper drop or queue alerts during a configured window (e.g. 22:00–07:00 local)? Easy to add to \`notify.ts\`. Default proposal: no quiet hours; David mutes ntfy iOS app manually if he wants silence.
3. **Topic visibility.** Comfort level with the ntfy hosted instance seeing every alert title/body in plaintext? Self-hosting ntfy on the same machine as the cockpit (Docker, ~5min) gives end-to-end privacy at the cost of a dependency to keep up.
4. **Pushover fallback.** Pre-emptively wire a \`PUSHOVER_*\` branch in \`notify.ts\` so swapping providers is an env flip, or stay single-provider until ntfy actually fails? Recommendation: single provider until it fails; YAGNI.
5. **Mac-side mirror.** Run \`ntfy subscribe\` on the Mac as a launchd job so desk-side alerts mirror phone alerts? Cheap and additive; only worth it if David finds himself missing alerts when AirPods are out.
`

async function main() {
  const entry = await upsertEntry(GLOBAL_WORKSPACE_ID, {
    id: ENTRY_ID,
    entryType: "concept",
    stability: "draft",
    title:
      "Push notification options for customer-of-one cockpit alerts (David)",
    summary:
      "Surveys ntfy.sh, Pushover, Telegram, Pushbullet, Discord, APNs, Twilio SMS, iMessage relay, iOS Shortcuts, and email as phone-alert paths for the cockpit. Recommends ntfy.sh hosted with a thin notify.ts helper and a single ready-for-review trigger as the smallest first ship.",
    bodyMarkdown: BODY,
    tags: [
      "push-notifications",
      "cockpit",
      "mobile",
      "ntfy",
      "pushover",
      "telegram",
      "discovery",
    ],
    relatedEntryIds: [],
  })
  console.log(
    `Upserted KB entry: ${entry.id} (body=${entry.bodyMarkdown?.length ?? 0} chars)`,
  )
}

await main()
await getPgPool().end()
