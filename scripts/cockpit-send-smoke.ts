/**
 * Smoke-test: drop a literal "test test" into a specific Claude Code
 * Desktop session through the same code path the cockpit's
 * /api/operator-studio/agents/[id]/send route uses (focusByDeepLink +
 * sendToApp). One-shot — confirms the deep-link focus actually lands
 * paste in the right session without going through the dev server.
 *
 * Usage:
 *   pnpm tsx scripts/cockpit-send-smoke.ts <session-uuid> [text...]
 *
 * Exit codes: 0 ok, 1 focus failed, 2 send failed, 3 args.
 */
import { focusByDeepLink } from "../lib/server/agent-bridge/app-deeplink-focus"
import { sendToApp } from "../lib/server/agent-bridge/app-control"

async function main() {
  const sessionId = process.argv[2]
  const text = process.argv.slice(3).join(" ") || "test test"
  if (!sessionId) {
    console.error("usage: cockpit-send-smoke <session-uuid> [text...]")
    process.exit(3)
  }

  console.log(`[smoke] focusByDeepLink kind=claude session=${sessionId}`)
  const focused = await focusByDeepLink({ kind: "claude", sessionId })
  if ("error" in focused) {
    console.error(`[smoke] focus failed: ${focused.error}`)
    process.exit(1)
  }
  console.log(`[smoke] focus ok ${focused.skipped ? `(skipped: ${focused.reason})` : ""}`)

  console.log(`[smoke] sendToApp app=Claude text=${JSON.stringify(text)} submit=true`)
  const sent = await sendToApp({
    app: "Claude",
    text,
    submit: true,
  })
  if ("error" in sent) {
    console.error(`[smoke] send failed: ${sent.error}`)
    process.exit(2)
  }
  console.log(
    `[smoke] send ok bytes=${sent.sentTextLength} keys=${JSON.stringify(sent.sentKeys)} submitted=${sent.submitted}`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(99)
})
