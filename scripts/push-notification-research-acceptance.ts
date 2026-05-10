/**
 * Acceptance gate for `step-push-notification-research`:
 *   1. KB entry `kb-2026-05-10-push-notification-options-for-customer-of-one` exists.
 *   2. Body length > 2500 chars.
 *   3. Body contains a markdown comparison table (heuristic: `|` and `---`).
 *   4. At least 5 distinct option names appear (Pushover, ntfy, Telegram,
 *      Discord, iMessage, Pushbullet, Twilio, APNs, Shortcut, email).
 *   5. A single explicit recommendation header is present
 *      (`**Recommended:**` or `**Recommendation:**`).
 *
 * Exit 0 = green, 1 = an assertion failed.
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

const { getEntryById } = await import("../lib/operator-studio/knowledge")
const { GLOBAL_WORKSPACE_ID } = await import(
  "../lib/operator-studio/workspaces"
)
const { getPgPool } = await import("../lib/server/db/client")

const ENTRY_ID = "kb-2026-05-10-push-notification-options-for-customer-of-one"

const OPTION_NAMES = [
  "Pushover",
  "ntfy",
  "Telegram",
  "Discord",
  "iMessage",
  "Pushbullet",
  "Twilio",
  "APNs",
  "Shortcut",
  "email",
]

let failed = 0
function ok(label: string) {
  console.log(`  ✓ ${label}`)
}
function fail(label: string, detail: string) {
  failed += 1
  console.error(`  ✗ ${label}\n      ${detail}`)
}

async function main() {
  console.log(`[push-notification-research-acceptance] entry=${ENTRY_ID}`)

  const entry = await getEntryById(GLOBAL_WORKSPACE_ID, ENTRY_ID)
  if (!entry) {
    fail("kb entry exists", `no row for ${ENTRY_ID}`)
    return
  }
  ok(`kb entry exists (title="${entry.title}", type=${entry.entryType})`)

  const body = entry.bodyMarkdown ?? ""
  if (body.length <= 2500) {
    fail("body length > 2500", `got ${body.length}`)
  } else {
    ok(`body length = ${body.length}`)
  }

  if (body.includes("|") && body.includes("---")) {
    ok("body contains markdown comparison table heuristic (| and ---)")
  } else {
    fail("body contains markdown comparison table", "missing | or ---")
  }

  const found = OPTION_NAMES.filter((name) =>
    body.toLowerCase().includes(name.toLowerCase()),
  )
  if (found.length >= 5) {
    ok(`body mentions ≥5 options by name (${found.length}: ${found.join(", ")})`)
  } else {
    fail(
      "body mentions ≥5 options by name",
      `only matched ${found.length}: ${found.join(", ")}`,
    )
  }

  if (body.includes("**Recommended:**") || body.includes("**Recommendation:**")) {
    ok("body contains explicit recommendation marker")
  } else {
    fail(
      "body contains **Recommended:** or **Recommendation:**",
      "neither marker present",
    )
  }
}

try {
  await main()
} finally {
  await getPgPool().end()
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`)
  process.exit(1)
}
console.log("\nall green.")
process.exit(0)
