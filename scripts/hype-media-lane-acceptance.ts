/**
 * Acceptance gate for `step-product-hype-media-lane-discovery`:
 *   1. KB entry `kb-2026-05-10-product-hype-media-lane` exists.
 *   2. Body length > 2000 chars.
 *   3. Body contains all of: "Cinema", "ClipMeta" (or "clip schema"),
 *      "ElevenLabs", "audience", "template", "inspiration".
 *
 * Exit 0 = green, 1 = an assertion failed, 2 = setup error.
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

const ENTRY_ID = "kb-2026-05-10-product-hype-media-lane"
const REQUIRED_TERMS = [
  "Cinema",
  "ElevenLabs",
  "audience",
  "template",
  "inspiration",
]
// Either "ClipMeta" or "clip schema" satisfies the schema-anchor check.
const SCHEMA_ANY = ["ClipMeta", "clip schema"]

let failed = 0
function ok(label: string) {
  console.log(`  ✓ ${label}`)
}
function fail(label: string, detail: string) {
  failed += 1
  console.error(`  ✗ ${label}\n      ${detail}`)
}

async function main() {
  console.log(`[hype-media-lane-acceptance] entry=${ENTRY_ID}`)

  const entry = await getEntryById(GLOBAL_WORKSPACE_ID, ENTRY_ID)
  if (!entry) {
    fail("kb entry exists", `no row for ${ENTRY_ID}`)
    return
  }
  ok(`kb entry exists (title="${entry.title}", type=${entry.entryType})`)

  const body = entry.bodyMarkdown ?? ""
  if (body.length <= 2000) {
    fail("body length > 2000", `got ${body.length}`)
  } else {
    ok(`body length = ${body.length}`)
  }

  for (const term of REQUIRED_TERMS) {
    if (body.includes(term)) ok(`body contains "${term}"`)
    else fail(`body contains "${term}"`, "term missing")
  }

  if (SCHEMA_ANY.some((t) => body.includes(t))) {
    ok(`body contains one of ${SCHEMA_ANY.map((t) => `"${t}"`).join(" / ")}`)
  } else {
    fail(
      `body contains one of ${SCHEMA_ANY.map((t) => `"${t}"`).join(" / ")}`,
      "neither term present"
    )
  }
}

await main()

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`)
  process.exit(1)
}
console.log("\nall green.")
process.exit(0)
