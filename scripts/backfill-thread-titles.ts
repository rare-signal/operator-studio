/**
 * Backfill thread titles for previously-imported Claude Code / Codex
 * sessions.
 *
 * Why: until now, the importers derived a thread title from the
 * first user message ("What's up, Claude? I am providing you feedback
 * on…"). The parsers were just updated to surface Claude Code's
 * `{type:"ai-title"}` JSONL line and Codex's session_index.jsonl
 * thread_name, but threads imported before that fix still carry the
 * old prompt-derived title in operator_threads.raw_title.
 *
 * What this does: walks every thread with sourceApp ∈ {claude-code,
 * codex} that has a sourceLocator (path to the on-disk source file),
 * re-runs the parser, and updates raw_title if it changed AND the
 * user hasn't promoted a custom title (promoted_title is null).
 *
 * Run with:
 *   pnpm tsx scripts/backfill-thread-titles.ts            # dry run
 *   pnpm tsx scripts/backfill-thread-titles.ts --apply    # write changes
 */

import { eq } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorThreads } from "../lib/server/db/schema"
import { parseCodexFile } from "../lib/operator-studio/importers/codex"
import { loadClaudeDesktopTitleIndex } from "../lib/operator-studio/importers/claude-code"

// Re-implement the Claude Code aiTitle scan inline — we don't want to
// re-read messages just to find one line. Cheap stream over the JSONL.
import * as fs from "fs"
import * as path from "path"

function deriveClaudeTitle(
  filePath: string,
  desktopTitles: Map<string, string>
): string | null {
  // Priority 1: Claude Desktop's local_*.json `title` (what the user
  // sees in Recents). Match by the bare session UUID — Claude Code's
  // CLI names its JSONLs <sessionId>.jsonl.
  const sessionUuid = path.basename(filePath, path.extname(filePath))
  const desktopTitle = desktopTitles.get(sessionUuid)
  if (desktopTitle) return desktopTitle

  // Priority 2: the JSONL's ai-title line.
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed) as {
          type?: unknown
          aiTitle?: unknown
        }
        if (
          obj.type === "ai-title" &&
          typeof obj.aiTitle === "string" &&
          obj.aiTitle.trim()
        ) {
          return obj.aiTitle.trim()
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file unreadable — leave as-is
  }
  return null
}

interface BackfillResult {
  scanned: number
  updates: Array<{ id: string; from: string; to: string; sourceApp: string }>
  unchanged: number
  noLocator: number
  noNewTitle: number
  promotedSkipped: number
  errors: number
}

async function run(apply: boolean): Promise<BackfillResult> {
  const db = getDb()
  const desktopTitles = loadClaudeDesktopTitleIndex()
  const result: BackfillResult = {
    scanned: 0,
    updates: [],
    unchanged: 0,
    noLocator: 0,
    noNewTitle: 0,
    promotedSkipped: 0,
    errors: 0,
  }

  const rows = await db
    .select({
      id: operatorThreads.id,
      sourceApp: operatorThreads.sourceApp,
      rawTitle: operatorThreads.rawTitle,
      promotedTitle: operatorThreads.promotedTitle,
      sourceLocator: operatorThreads.sourceLocator,
      sourcePayloadJson: operatorThreads.sourcePayloadJson,
    })
    .from(operatorThreads)

  for (const row of rows) {
    // The importer accepts both "claude" and "claude-code" as inputs
    // but the column actually stores "claude" for filesystem-imported
    // sessions. Match both spellings defensively.
    const isClaude =
      row.sourceApp === "claude" || row.sourceApp === "claude-code"
    const isCodex = row.sourceApp === "codex"
    if (!isClaude && !isCodex) continue
    result.scanned++

    // The on-disk path lives in either source_locator or
    // source_payload_json.filePath (legacy).
    let filePath = row.sourceLocator
    if (!filePath && row.sourcePayloadJson) {
      const payload = row.sourcePayloadJson as Record<string, unknown>
      if (typeof payload.filePath === "string") filePath = payload.filePath
    }
    if (!filePath) {
      result.noLocator++
      continue
    }

    let newTitle: string | null = null
    try {
      if (isClaude) {
        newTitle = deriveClaudeTitle(filePath, desktopTitles)
      } else if (isCodex) {
        const parsed = parseCodexFile(filePath)
        // parseCodexFile returns the new (preferred-AI) title
        // already, so any non-null result is what we want.
        newTitle = parsed?.title ?? null
      }
    } catch {
      result.errors++
      continue
    }

    if (!newTitle) {
      result.noNewTitle++
      continue
    }

    const current = row.rawTitle ?? ""
    if (current === newTitle) {
      result.unchanged++
      continue
    }

    // Don't overwrite if the user has already promoted a custom title.
    if (row.promotedTitle && row.promotedTitle.trim()) {
      result.promotedSkipped++
      continue
    }

    result.updates.push({
      id: row.id,
      from: current,
      to: newTitle,
      sourceApp: row.sourceApp,
    })

    if (apply) {
      await db
        .update(operatorThreads)
        .set({ rawTitle: newTitle, updatedAt: new Date() })
        .where(eq(operatorThreads.id, row.id))
    }
  }

  return result
}

async function main() {
  const apply = process.argv.includes("--apply")
  const result = await run(apply)

  console.log("\nBackfill thread titles")
  console.log("=".repeat(60))
  console.log(`Mode:           ${apply ? "APPLY (writing changes)" : "DRY RUN"}`)
  console.log(`Scanned:        ${result.scanned}`)
  console.log(`Would update:   ${result.updates.length}`)
  console.log(`Unchanged:      ${result.unchanged}`)
  console.log(`Promoted (skip): ${result.promotedSkipped}`)
  console.log(`No new title:   ${result.noNewTitle}`)
  console.log(`No locator:     ${result.noLocator}`)
  console.log(`Errors:         ${result.errors}`)
  console.log()

  if (result.updates.length > 0) {
    console.log("Sample updates:")
    for (const u of result.updates.slice(0, 10)) {
      console.log(`  [${u.sourceApp}] ${u.id.slice(0, 24)}…`)
      console.log(`    from: ${truncate(u.from, 80)}`)
      console.log(`    to:   ${truncate(u.to, 80)}`)
    }
    if (result.updates.length > 10) {
      console.log(`  …and ${result.updates.length - 10} more`)
    }
    if (!apply) {
      console.log("\nRe-run with --apply to write these changes.")
    }
  }

  await getPgPool().end()
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
