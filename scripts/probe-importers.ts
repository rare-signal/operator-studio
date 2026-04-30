/**
 * Smoke-test every registered importer against this machine's local
 * data. Prints a short summary per source — session count, skip count,
 * a sample title, and the recognized format version — without
 * persisting anything to the database.
 *
 * Usage: `pnpm tsx scripts/probe-importers.ts`
 */

import {
  listImporters,
  type ParsedSession,
} from "../lib/operator-studio/importers"

function summarize(sessions: ParsedSession[]) {
  const formatVersions = new Map<string, number>()
  for (const s of sessions) {
    const v = String(
      (s.metadata as Record<string, unknown>)?.sourceFormatVersion ?? "unknown"
    )
    formatVersions.set(v, (formatVersions.get(v) ?? 0) + 1)
  }
  return Array.from(formatVersions.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")
}

function pickSample(sessions: ParsedSession[]) {
  if (!sessions.length) return ""
  const sorted = [...sessions].sort((a, b) => {
    const ad = a.lastActivityAt ?? a.createdAt ?? ""
    const bd = b.lastActivityAt ?? b.createdAt ?? ""
    return bd.localeCompare(ad)
  })
  const top = sorted[0]
  const when = top.lastActivityAt ?? top.createdAt ?? "—"
  return `  most recent: "${top.title.slice(0, 80)}" (${when}, ${top.messages.length} msgs)`
}

const importers = listImporters()
console.log(`Probing ${importers.length} registered importers…\n`)

let totalSkips = 0
for (const importer of importers) {
  const t0 = Date.now()
  const result = importer.discover()
  const elapsed = Date.now() - t0
  totalSkips += result.skipped.length
  console.log(
    `[${importer.id}] ${result.sessions.length} sessions, ${result.skipped.length} skipped (${elapsed}ms)`
  )
  if (result.sessions.length) console.log(`  formats: ${summarize(result.sessions)}`)
  console.log(pickSample(result.sessions))
  if (result.skipped.length) {
    const sample = result.skipped.slice(0, 3)
    for (const s of sample) {
      console.log(`  skip: ${s.locator} — ${s.reason}`)
    }
    if (result.skipped.length > sample.length) {
      console.log(`  …and ${result.skipped.length - sample.length} more`)
    }
  }
  console.log()
}

console.log(`Total skips across sources: ${totalSkips}`)
