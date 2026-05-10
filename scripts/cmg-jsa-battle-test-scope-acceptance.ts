/**
 * Acceptance gate for `step-cmg-jsa-battle-test-discovery`:
 *   1. KB entry `kb-2026-05-10-cmg-jsa-battle-test-scope` exists.
 *   2. Body length > 4000 chars.
 *   3. Body contains all required section headers.
 *   4. Body names >= 5 distinct existing-surface items (lib modules,
 *      API routes, plan-step ids, pnpm scripts).
 *   5. Body lists >= 3 distinct gaps each paired with a fix proposal.
 *   6. Body proposes >= 5 follow-on cards with titles.
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

const ENTRY_ID = "kb-2026-05-10-cmg-jsa-battle-test-scope"

const REQUIRED_HEADERS = [
  "TL;DR",
  "Existing surface inventory",
  "The end-to-end loop we're battle-testing",
  "Gaps blocking the battle test",
  "Risks + open questions",
  "Recommended implementation cards",
]

const SURFACE_ITEMS = [
  "lib/operator-studio/ado-triage.ts",
  "lib/operator-studio/ado-keyed-intake.ts",
  "lib/operator-studio/ingest/ado-poller.ts",
  "lib/operator-studio/ingest/ado-read-model.ts",
  "lib/operator-studio/ingest/ado-scheduler.ts",
  "lib/operator-studio/signal-intake/teams-manifest.ts",
  "lib/operator-studio/signal-intake/teams-seed.ts",
  "lib/operator-studio/outbound-gate.ts",
  "app/api/operator-studio/ado/[id]/route.ts",
  "app/api/operator-studio/outbound/route.ts",
  "app/api/operator-studio/signal-intake/route.ts",
  "step-cmg-jsa-product",
  "step-cmg-telegento-pipeline",
  "step-cmg-cd-safety",
  "pnpm os:ado",
  "pnpm os:ado-triage",
  "scripts/seed-software-factory-nucleus.ts",
  "scripts/spawn-cmg-jsa-discovery-worker.ts",
  "TELEGENTO_TEAMS_CHANNELS",
]

let failed = 0
function ok(label: string) {
  console.log(`  ✓ ${label}`)
}
function fail(label: string, detail: string) {
  failed += 1
  console.error(`  ✗ ${label}\n      ${detail}`)
}

function countNumberedItems(body: string, sectionHeader: string): number {
  // Count top-level numbered list items in the section beginning with
  // `## ${sectionHeader}` up to the next `## ` header.
  const start = body.indexOf(`## ${sectionHeader}`)
  if (start < 0) return 0
  const rest = body.slice(start + sectionHeader.length + 3)
  const end = rest.indexOf("\n## ")
  const section = end < 0 ? rest : rest.slice(0, end)
  const matches = section.match(/^\d+\.\s+/gm) ?? []
  return matches.length
}

async function main() {
  console.log(`[cmg-jsa-battle-test-scope-acceptance] entry=${ENTRY_ID}`)

  const entry = await getEntryById(GLOBAL_WORKSPACE_ID, ENTRY_ID)
  if (!entry) {
    fail("kb entry exists", `no row for ${ENTRY_ID}`)
    return
  }
  ok(`kb entry exists (title="${entry.title}", type=${entry.entryType})`)

  const body = entry.bodyMarkdown ?? ""
  if (body.length <= 4000) {
    fail("body length > 4000", `got ${body.length}`)
  } else {
    ok(`body length = ${body.length}`)
  }

  for (const header of REQUIRED_HEADERS) {
    if (body.includes(header)) ok(`body contains section "${header}"`)
    else fail(`body contains section "${header}"`, "header missing")
  }

  const surfaceHits = SURFACE_ITEMS.filter((item) => body.includes(item))
  if (surfaceHits.length < 5) {
    fail(
      "body names >= 5 existing-surface items",
      `only ${surfaceHits.length} hits: ${surfaceHits.join(", ")}`
    )
  } else {
    ok(`body names ${surfaceHits.length} existing-surface items`)
  }

  const gapCount = countNumberedItems(body, "Gaps blocking the battle test")
  if (gapCount < 3) {
    fail(
      "body lists >= 3 gaps",
      `only ${gapCount} numbered gap entries detected`
    )
  } else {
    ok(`body lists ${gapCount} gaps`)
  }

  const cardCount = countNumberedItems(body, "Recommended implementation cards")
  if (cardCount < 5) {
    fail(
      "body proposes >= 5 follow-on cards",
      `only ${cardCount} numbered card entries detected`
    )
  } else {
    ok(`body proposes ${cardCount} follow-on cards`)
  }

  const titleCount = (body.match(/\*\*Title:\*\*/g) ?? []).length
  if (titleCount < 5) {
    fail(
      "follow-on cards have **Title:** markers",
      `only ${titleCount} **Title:** markers detected`
    )
  } else {
    ok(`${titleCount} **Title:** markers detected`)
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
