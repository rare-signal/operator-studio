/**
 * Importer-registry integrity check (CLI).
 *
 * Thin wrapper around `lib/operator-studio/importers/_integrity` —
 * runs the same checks called at dev-server startup (instrumentation.ts)
 * and prints a human-readable report. Exits nonzero on any failure so
 * it can run as part of CI / pre-merge.
 *
 * Usage:
 *   pnpm integrity:importers          # full report
 *   pnpm integrity:importers --quiet  # only failures
 */

import { checkImporterRegistry } from "../lib/operator-studio/importers/_integrity"

const QUIET = process.argv.includes("--quiet")
const report = checkImporterRegistry()

if (!QUIET || report.failures.length > 0) {
  console.log("Importer-registry integrity check")
  console.log("─".repeat(50))
  for (const r of report.results) {
    if (QUIET && r.ok) continue
    const mark = r.ok ? "OK  " : "FAIL"
    console.log(`[${mark}] ${r.name}: ${r.detail}`)
  }
  console.log("─".repeat(50))
  console.log(
    `${report.passed}/${report.total} checks passed${
      report.failures.length ? `  —  ${report.failures.length} failure(s)` : ""
    }`
  )
}

process.exit(report.failures.length === 0 ? 0 : 1)
