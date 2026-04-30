import { listImporters } from "./importers"
import type { OperatorSourceApp, OperatorThread } from "./types"

/**
 * Result of deciding how a `fork-with-upstream` request should behave.
 *
 * Extracted to a pure function so the decision is:
 * 1. Testable without a DB.
 * 2. Consistent between the API layer (what status to return) and the
 *    UI layer (what toast to show).
 *
 * The enum values are part of the public API contract — the UI
 * switches on them to decide whether to surface "pulled latest",
 * "no upstream file", "unsupported source", etc.
 */
export type UpstreamForkPlan =
  | {
      status: "attempt-reparse"
      filePath: string
      sourceApp: OperatorSourceApp
    }
  | {
      status: "no-locator"
      reason: "Parent has no sourceLocator — forking from stored copy."
    }
  | {
      status: "unsupported-source"
      sourceApp: OperatorSourceApp
      reason: string
    }

/**
 * Sources whose ingestion path supports re-parsing a single locator
 * back to messages. Computed lazily from the importer registry so
 * adding a new importer with `supportsSingleImport: true` immediately
 * makes its threads eligible for upstream re-parse without touching
 * this file. Tests can still override via `opts.supportedSources`.
 */
function defaultSupportedReparseSources(): ReadonlySet<OperatorSourceApp> {
  return new Set(
    listImporters()
      .filter((i) => i.supportsSingleImport)
      .map((i) => i.id)
  )
}

/**
 * Decide whether a fork-with-upstream request can actually re-parse the
 * source, or should silently fall back to a plain fork.
 *
 * Pure, synchronous, no side effects. The caller then executes the plan.
 *
 * `fallbackSources` lets tests override the supported set if needed;
 * production callers should omit it.
 */
export function planUpstreamFork(
  parent: Pick<OperatorThread, "sourceApp" | "sourceLocator">,
  opts?: { supportedSources?: ReadonlySet<OperatorSourceApp> }
): UpstreamForkPlan {
  const supported = opts?.supportedSources ?? defaultSupportedReparseSources()

  if (!parent.sourceLocator) {
    return {
      status: "no-locator",
      reason: "Parent has no sourceLocator — forking from stored copy.",
    }
  }

  if (!supported.has(parent.sourceApp)) {
    return {
      status: "unsupported-source",
      sourceApp: parent.sourceApp,
      reason: `Re-parse isn't wired up for "${parent.sourceApp}" — forking from stored copy.`,
    }
  }

  return {
    status: "attempt-reparse",
    filePath: parent.sourceLocator,
    sourceApp: parent.sourceApp,
  }
}

/**
 * Final result after executing an upstream fork plan. This is what the
 * API returns to the UI so toasts can be accurate.
 */
export type UpstreamForkOutcome =
  | { outcome: "pulled-upstream"; messageCount: number }
  | { outcome: "stored-copy"; reason: string }
  | { outcome: "reparse-failed"; error: string; reason: string }
