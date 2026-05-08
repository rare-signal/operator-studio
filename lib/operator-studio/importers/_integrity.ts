/**
 * Importer-registry integrity checks.
 *
 * Verifies registered importers are fully wired up across:
 *   - the client-side IMPORTER_SOURCE_IDS constant (dashboard, sessions
 *     page, pulse page auto-ingest)
 *   - SOURCE_APP_LABELS / SOURCE_APP_COLORS (typed Records — TS already
 *     enforces, but we double-check at runtime)
 *   - AVATAR_FALLBACK_COLORS in source-apps.tsx (Record<string, string>,
 *     so TS doesn't enforce — silent gray-fallback if missing)
 *   - getThreadDeepLink branches in source-deeplinks.ts
 *   - the contract that `discover()` doesn't throw
 *
 * Used by:
 *   - `pnpm integrity:importers` — full human-readable report; exits
 *     nonzero on any failure. Wire into CI.
 *   - dev-server startup (instrumentation.ts) — loud warning on stderr
 *     for any failure so omissions can't slip through unnoticed.
 *
 * Why a runtime check on top of TypeScript: the silent-failure spots
 * are all `Record<string, T>` partial maps and hand-maintained
 * constants. Those are the bugs that hide for weeks until a real user
 * with the missed source files a "why is the chip gray?" report.
 */

import * as fs from "fs"
import * as path from "path"

import { getThreadDeepLink } from "../source-deeplinks"
import {
  IMPORTER_SOURCE_IDS,
  SOURCE_APP_COLORS,
  SOURCE_APP_LABELS,
  type OperatorSourceApp,
  type OperatorThread,
} from "../types"
import { listImporters } from "./index"

export interface IntegrityResult {
  name: string
  ok: boolean
  detail: string
}

export interface IntegrityReport {
  results: IntegrityResult[]
  failures: IntegrityResult[]
  passed: number
  total: number
}

export interface CheckOptions {
  /**
   * Skip the discover() smoke test. Discovery can take seconds for
   * sources with many local files (Codex on a heavy machine takes
   * ~40s for 800 sessions); the dev-startup pass skips it so the
   * server boots fast. The CLI runs it.
   */
  skipDiscoverProbe?: boolean
}

export function checkImporterRegistry(
  opts: CheckOptions = {}
): IntegrityReport {
  const results: IntegrityResult[] = []
  const record = (name: string, ok: boolean, detail: string) =>
    results.push({ name, ok, detail })

  const importers = listImporters()
  const constantSet = new Set<OperatorSourceApp>(IMPORTER_SOURCE_IDS)

  // ── Registry ↔ IMPORTER_SOURCE_IDS parity ──
  const registeredAll = new Set<OperatorSourceApp>()
  for (const i of importers) {
    registeredAll.add(i.id)
    for (const a of i.aliases ?? []) registeredAll.add(a)
  }
  const missingFromConstant = importers
    .map((i) => i.id)
    .filter((id) => {
      if (constantSet.has(id)) return false
      const aliases = importers.find((m) => m.id === id)?.aliases ?? []
      return !aliases.some((a) => constantSet.has(a))
    })
  record(
    "registry → IMPORTER_SOURCE_IDS",
    missingFromConstant.length === 0,
    missingFromConstant.length === 0
      ? `${importers.length} importer(s) all reachable from IMPORTER_SOURCE_IDS`
      : `missing from IMPORTER_SOURCE_IDS: ${missingFromConstant.join(", ")}`
  )

  const orphanInConstant = IMPORTER_SOURCE_IDS.filter(
    (id) => !registeredAll.has(id)
  )
  record(
    "IMPORTER_SOURCE_IDS → registry",
    orphanInConstant.length === 0,
    orphanInConstant.length === 0
      ? "no orphans"
      : `IMPORTER_SOURCE_IDS entries without a matching importer: ${orphanInConstant.join(", ")}`
  )

  // ── Per-source UI metadata ──
  for (const id of IMPORTER_SOURCE_IDS) {
    record(
      `SOURCE_APP_LABELS[${id}]`,
      !!SOURCE_APP_LABELS[id],
      SOURCE_APP_LABELS[id] ?? "(missing)"
    )
    record(
      `SOURCE_APP_COLORS[${id}]`,
      !!SOURCE_APP_COLORS[id],
      SOURCE_APP_COLORS[id] ?? "(missing)"
    )
  }

  // ── AVATAR_FALLBACK_COLORS in source-apps.tsx ──
  // Scrape the source rather than importing (the file pulls in React
  // and we want this check to run server-side without a JSX runtime).
  const sourceAppsPath = path.join(
    process.cwd(),
    "app",
    "(operator-studio)",
    "operator-studio",
    "components",
    "source-apps.tsx"
  )
  let sourceAppsSrc = ""
  try {
    sourceAppsSrc = fs.readFileSync(sourceAppsPath, "utf-8")
  } catch {
    record(
      "source-apps.tsx readable",
      false,
      `could not read ${sourceAppsPath}`
    )
  }
  if (sourceAppsSrc) {
    const avatarBlock =
      sourceAppsSrc
        .split("AVATAR_FALLBACK_COLORS")[1]
        ?.split("AVATAR_FALLBACK_DEFAULT")[0] ?? ""
    for (const id of IMPORTER_SOURCE_IDS) {
      const re = new RegExp(
        `(?:^|\\s|{)(?:"${id}"|${id.replace(/-/g, "\\-")}):`,
        "m"
      )
      const present = re.test(avatarBlock)
      record(
        `AVATAR_FALLBACK_COLORS[${id}]`,
        present,
        present ? "present" : "(missing — falls back to default gray)"
      )
    }
  }

  // ── Deep-link coverage ──
  for (const id of IMPORTER_SOURCE_IDS) {
    const synthetic = makeSyntheticThread(id)
    const link = getThreadDeepLink(synthetic)
    record(
      `getThreadDeepLink(${id})`,
      link !== null,
      link
        ? `${link.kind}: ${link.kind === "url" ? link.url : link.command}`
        : "(returns null — no deep-link branch)"
    )
  }

  // ── discover() smoke test ──
  if (!opts.skipDiscoverProbe) {
    for (const importer of importers) {
      try {
        const t0 = Date.now()
        const result = importer.discover()
        const elapsed = Date.now() - t0
        record(
          `discover(${importer.id})`,
          true,
          `${result.sessions.length} session(s), ${result.skipped.length} skipped (${elapsed}ms)`
        )
      } catch (err) {
        record(
          `discover(${importer.id})`,
          false,
          `THREW (contract violation): ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  const failures = results.filter((r) => !r.ok)
  return {
    results,
    failures,
    passed: results.length - failures.length,
    total: results.length,
  }
}

function makeSyntheticThread(id: OperatorSourceApp): OperatorThread {
  // Minimal thread shape that exercises each deeplink branch's
  // fallback ladder. Per-source fields are populated only when needed
  // to coax a non-null link out of getThreadDeepLink.
  return {
    id: "thread-00000000-0000-0000-0000-000000000000",
    workspaceId: "ws-test",
    sourceApp: id,
    sourceThreadKey: `${id}-test-key`,
    sourceLocator:
      id === "claude" || id === "claude-code"
        ? "/Users/x/.claude/projects/-Users-x-foo/00000000-0000-0000-0000-000000000000.jsonl"
        : "/tmp/test",
    importedBy: "integrity-check",
    importedAt: "2026-01-01T00:00:00.000Z",
    importRunId: null,
    rawTitle: "test",
    rawSummary: null,
    promotedTitle: null,
    promotedSummary: null,
    privacyState: "private",
    reviewState: "imported",
    tags: [],
    projectSlug: null,
    ownerName: null,
    whyItMatters: null,
    captureReason: null,
    parentThreadId: null,
    promotedFromId: null,
    pulledFromId: null,
    visibleInStudio: true,
    messageCount: 0,
    archivedAt: null,
    markedDoneAt: null,
    markedDoneBy: null,
    markedDoneSource: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}
