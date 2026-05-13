/**
 * Telegento → Operator Studio feedback bridge sweep (v1).
 *
 *   pnpm tsx scripts/telegento-feedback-sweep.ts [--dry-run] [--max=N]
 *
 * For each pending feedback row on Telegento:
 *   1. Stage an ADO addComment outbox row (awaiting_approval) — IF
 *      the known-issue has a requested_by_ado_id anchor; otherwise skip.
 *   2. POST mark-forwarded back to Telegento with the outbox row id
 *      so the row isn't re-staged on the next sweep.
 *
 * --dry-run skips BOTH the staging and the mark-forwarded — it only
 *   fetches and prints what would happen.
 *
 * --max=N caps how many rows are processed in one sweep.
 *
 * David runs this manually for v1. After staged rows land in the
 * cockpit, he approves in chat ("send it") and the existing dispatch
 * path (approveAndSendOutbox → addWorkItemComment) takes over.
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

const { fetchPendingFeedback, markFeedbackForwarded } = await import(
  "../lib/operator-studio/telegento-bridge/feedback-fetcher"
)
const { stageFeedbackAsAdoComment, renderFeedbackMarkdown } = await import(
  "../lib/operator-studio/telegento-bridge/feedback-to-outbox"
)
const { getPgPool } = await import("../lib/server/db/client")

interface CliArgs {
  dryRun: boolean
  max: number | null
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false
  let max: number | null = null
  for (const raw of argv) {
    if (raw === "--dry-run" || raw === "-n") {
      dryRun = true
      continue
    }
    if (raw.startsWith("--max=")) {
      const n = Number(raw.slice("--max=".length))
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --max value: ${raw}`)
      }
      max = Math.trunc(n)
      continue
    }
    if (raw === "--help" || raw === "-h") {
      printUsage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${raw}`)
  }
  return { dryRun, max }
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  pnpm tsx scripts/telegento-feedback-sweep.ts [--dry-run] [--max=N]",
      "",
      "Flags:",
      "  --dry-run, -n    Fetch and preview only — no outbox writes, no mark-forwarded.",
      "  --max=N          Cap the number of rows processed.",
      "  --help, -h       Show this help.",
    ].join("\n")
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const startedAt = Date.now()
  console.log(
    `telegento-feedback-sweep: ${args.dryRun ? "DRY RUN — " : ""}fetching pending feedback…`
  )

  const all = await fetchPendingFeedback()
  const rows = args.max != null ? all.slice(0, args.max) : all
  console.log(
    `fetched ${all.length} pending row(s)${args.max != null ? ` (processing first ${rows.length})` : ""}`
  )

  let staged = 0
  let skipped = 0
  let failed = 0
  const failures: { feedbackId: string; error: string }[] = []

  for (const row of rows) {
    const header = `\n— feedback ${row.id} | known-issue ${row.knownIssueId} (${row.knownIssueTitle}) | verdict=${row.verdict}`
    console.log(header)
    console.log(
      `  submitted-by=${row.submittedByEmail} page-scope=${row.pageScope ?? "(unscoped)"} ado-anchor=${row.requestedByAdoId ?? "(none)"}`
    )

    if (row.requestedByAdoId == null) {
      console.log(
        `  skip — no requested_by_ado_id on the known-issue (v2 will create a new ticket)`
      )
      skipped++
      continue
    }

    if (args.dryRun) {
      console.log(`  [dry-run] would stage ADO #${row.requestedByAdoId}:`)
      const preview = renderFeedbackMarkdown(row)
        .split("\n")
        .map((l) => `    > ${l}`)
        .join("\n")
      console.log(preview)
      continue
    }

    try {
      const outcome = await stageFeedbackAsAdoComment(row)
      if (outcome.kind === "skipped") {
        skipped++
        continue
      }
      console.log(
        `  staged outbox=${outcome.outboxRowId} → ADO #${outcome.workItemId}`
      )
      await markFeedbackForwarded({
        feedbackId: row.id,
        outboxRowId: outcome.outboxRowId,
      })
      console.log(`  mark-forwarded ok`)
      staged++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  FAILED: ${msg}`)
      failed++
      failures.push({ feedbackId: row.id, error: msg })
    }
  }

  const elapsedMs = Date.now() - startedAt
  console.log(`\n— summary —`)
  console.log(`  fetched:   ${all.length}`)
  console.log(`  processed: ${rows.length}`)
  console.log(`  staged:    ${staged}${args.dryRun ? " (dry-run — nothing actually staged)" : ""}`)
  console.log(`  skipped:   ${skipped}`)
  console.log(`  failed:    ${failed}`)
  console.log(`  elapsed:   ${elapsedMs}ms`)

  if (failures.length > 0) {
    console.log(`\n— failures —`)
    for (const f of failures) {
      console.log(`  ${f.feedbackId}: ${f.error}`)
    }
  }

  if (!args.dryRun && staged > 0) {
    console.log(
      `\nStaged outbox rows are awaiting approval. Approve in chat ("send it") or via the cockpit.`
    )
  }
}

main()
  .then(async () => {
    await getPgPool().end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(
      "telegento-feedback-sweep: fatal —",
      err instanceof Error ? err.message : err
    )
    if (err instanceof Error && err.stack) console.error(err.stack)
    try {
      await getPgPool().end()
    } catch {}
    process.exit(1)
  })
