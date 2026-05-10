/**
 * Acceptance gate for `step-meta-berthier-discovery`:
 *   1. KB entry `kb-2026-05-10-meta-berthier-design` exists.
 *   2. Body length > 3000 chars.
 *   3. Body contains all section headers required by the brief:
 *      TL;DR, Read scope, Write scope, Connectors, Architecture,
 *      Recommended next moves.
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

const ENTRY_ID = "kb-2026-05-10-meta-berthier-design"
const REQUIRED_HEADERS = [
  "TL;DR",
  "Read scope",
  "Write scope",
  "Connectors",
  "Architecture",
  "Recommended next moves",
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
  console.log(`[meta-berthier-discovery-acceptance] entry=${ENTRY_ID}`)

  const entry = await getEntryById(GLOBAL_WORKSPACE_ID, ENTRY_ID)
  if (!entry) {
    fail("kb entry exists", `no row for ${ENTRY_ID}`)
    return
  }
  ok(`kb entry exists (title="${entry.title}", type=${entry.entryType})`)

  const body = entry.bodyMarkdown ?? ""
  if (body.length <= 3000) {
    fail("body length > 3000", `got ${body.length}`)
  } else {
    ok(`body length = ${body.length}`)
  }

  for (const header of REQUIRED_HEADERS) {
    if (body.includes(header)) ok(`body contains section "${header}"`)
    else fail(`body contains section "${header}"`, "header missing")
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
