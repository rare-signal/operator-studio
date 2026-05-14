/**
 * ADO → Telegento sync-back sweep (closes the feedback loop).
 *
 *   pnpm tsx scripts/telegento-ado-sync-back.ts [--dry-run] [--apply]
 *                                                [--max-comments=N]
 *                                                [--max-tickets=N]
 *
 * For every Telegento known-issue advisory linked to an ADO ticket
 * (requested_by_ado_id set), this sweep:
 *
 *   1. Lists comments on that ADO ticket since the advisory's
 *      `last_synced_ado_comment_id` cursor.
 *   2. Filters out the bridge's own outbox-posted comments (avoids a
 *      loop) and trivially-short bodies.
 *   3. Relays survivors as Telegento `stakeholder_posts` (kind=note),
 *      atomically advancing the sync cursor.
 *
 * Default is dry-run. `--apply` writes for real.
 *
 * Env required:
 *   ADO_PAT                          — read-only on Work Items, .env.local
 *   TELEGENTO_INTERNAL_API_TOKEN     — Bearer for Telegento internal API
 *                                      (or shell into Telegento AWS first)
 *
 * Audit trail: every relay is logged with (knownIssueId, adoWorkItemId,
 * adoCommentId, stakeholderPostId, authorName).
 */

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })

const { sweepAdoSyncBack } = await import(
  "../lib/operator-studio/telegento-bridge/ado-sync-back"
)

interface CliArgs {
  dryRun: boolean
  maxComments: number | null
  maxTickets: number | null
}

function parseArgs(argv: string[]): CliArgs {
  // Default is dry-run for safety; --apply flips it.
  let dryRun = true
  let maxComments: number | null = null
  let maxTickets: number | null = null
  for (const raw of argv) {
    if (raw === "--dry-run" || raw === "-n") {
      dryRun = true
      continue
    }
    if (raw === "--apply") {
      dryRun = false
      continue
    }
    if (raw.startsWith("--max-comments=")) {
      const n = Number(raw.slice("--max-comments=".length))
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --max-comments value: ${raw}`)
      }
      maxComments = Math.trunc(n)
      continue
    }
    if (raw.startsWith("--max-tickets=")) {
      const n = Number(raw.slice("--max-tickets=".length))
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --max-tickets value: ${raw}`)
      }
      maxTickets = Math.trunc(n)
      continue
    }
    if (raw === "--help" || raw === "-h") {
      printUsage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${raw}`)
  }
  return { dryRun, maxComments, maxTickets }
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  pnpm tsx scripts/telegento-ado-sync-back.ts [--dry-run|--apply] [--max-comments=N] [--max-tickets=N]",
      "",
      "Default is --dry-run (no writes). Pass --apply to actually create stakeholder_posts.",
    ].join("\n")
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()
  console.log(
    `telegento-ado-sync-back: ${args.dryRun ? "DRY RUN" : "APPLY"} | max-comments=${args.maxComments ?? "∞"} max-tickets=${args.maxTickets ?? "∞"}`
  )

  const report = await sweepAdoSyncBack({
    dryRun: args.dryRun,
    maxComments: args.maxComments ?? undefined,
    maxTickets: args.maxTickets ?? undefined,
  })

  console.log(`\n— per-relay log —`)
  if (report.relays.length === 0) {
    console.log(`  (no comments relayed)`)
  } else {
    for (const r of report.relays) {
      console.log(
        `  ${r.knownIssueId} ← ADO #${r.adoWorkItemId} comment ${r.adoCommentId} by ${r.authorName} → stakeholder_post=${r.stakeholderPostId}`
      )
    }
  }

  if (report.errors.length > 0) {
    console.log(`\n— errors —`)
    for (const e of report.errors) {
      console.log(`  ${e.knownIssueId}: ${e.message}`)
    }
  }

  const elapsedMs = Date.now() - startedAt
  console.log(`\n— summary —`)
  console.log(`  mode:                    ${args.dryRun ? "dry-run" : "apply"}`)
  console.log(`  tickets considered:      ${report.ticketsConsidered}`)
  console.log(`  tickets examined:        ${report.ticketsExamined}`)
  console.log(`  ado comments fetched:    ${report.commentsFetched}`)
  console.log(`  relayed:                 ${report.commentsRelayed}`)
  console.log(`  skipped (self):          ${report.commentsSkippedSelf}`)
  console.log(`  skipped (too short):     ${report.commentsSkippedShort}`)
  console.log(`  skipped (already-synced):${report.commentsSkippedAlreadySynced}`)
  console.log(`  errors:                  ${report.errors.length}`)
  console.log(`  elapsed:                 ${elapsedMs}ms`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(
      "telegento-ado-sync-back: fatal —",
      err instanceof Error ? err.message : err
    )
    if (err instanceof Error && err.stack) console.error(err.stack)
    process.exit(1)
  })
