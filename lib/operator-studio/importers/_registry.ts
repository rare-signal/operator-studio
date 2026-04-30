/**
 * Importer registry — the contract every per-source importer fulfills, and
 * the lookup table that lets the orchestrator iterate sources by id instead
 * of switch-statement-ing across them.
 *
 * Adding a new source is now: write one module, register it in `index.ts`,
 * touch `types.ts` for the enum, `source-deeplinks.ts` for the link branch,
 * and `source-apps.tsx` for the UI chip. No more N-place edits inside the
 * orchestrator.
 *
 * Two things this contract enforces beyond "spread the code around":
 *
 *   1. **Infallible parsing.** `discover()` returns sessions AND a list of
 *      skips with reasons — parser failures never throw, never crash the
 *      run, and never silently disappear. The orchestrator aggregates skips
 *      into the import-run so an operator reporting "OpenCode didn't import"
 *      gets answered by a SQL query, not a debug session on their machine.
 *
 *   2. **Format provenance.** Every parsed session stamps the upstream tool
 *      version (or `"unknown"`) into `metadata.sourceFormatVersion`. When
 *      Codex / Claude Code / OpenCode change formats, this tells us which
 *      threads need re-parsing without forcing a full re-import sweep.
 */

import type { OperatorSourceApp } from "../types"

// ─── Unified parsed-session shape ────────────────────────────────────────────

export interface ParsedMessage {
  role: "user" | "assistant" | "system"
  content: string
  /** ISO-8601 string. */
  timestamp?: string
  /**
   * Per-message metadata bag. Per-source parsers stash anchors here
   * (e.g. `codex_turn_id`) for the ingestion layer's
   * `deriveMessageMetadata` to surface into the row's `metadataJson`.
   * Kept opaque on purpose so adding new fields per source doesn't
   * widen this type.
   */
  metadata?: Record<string, unknown>
}

export interface ParsedSession {
  /** Stable id used for dedupe within `(workspaceId, sourceApp, ?)`. */
  sourceThreadId: string
  title: string
  messages: ParsedMessage[]
  /** ISO-8601. */
  createdAt: string | null
  /** ISO-8601. */
  lastActivityAt: string | null
  /** Best-effort project / cwd hint shown in the UI. */
  projectPath: string | null
  /**
   * Source-specific metadata. Convention: include `sourceFormatVersion`
   * (string, or `"unknown"`) and `filePath` when applicable.
   */
  metadata: Record<string, unknown>
}

// ─── Discovery + parse results ───────────────────────────────────────────────

export interface SkippedItem {
  /** What we tried to read — file path, db row id, etc. Operator-grokkable. */
  locator: string
  /** Short human-readable reason. Single line. */
  reason: string
}

export interface DiscoveryResult {
  sessions: ParsedSession[]
  /** Files / rows we found but couldn't ingest, with why. */
  skipped: SkippedItem[]
}

export type ParseResult =
  | { ok: true; session: ParsedSession }
  | { ok: false; locator: string; reason: string }

// ─── The registered module shape ─────────────────────────────────────────────

export interface ImporterModule {
  /** Canonical source-app id. Must be a member of `OPERATOR_SOURCE_APPS`. */
  id: OperatorSourceApp
  /**
   * Other enum values that route to this importer. The Claude Code
   * importer for example serves both `"claude"` and `"claude-code"`
   * because legacy rows use the bare `claude` value.
   */
  aliases?: OperatorSourceApp[]
  /**
   * True when `parseOne(locator)` is meaningful — i.e. a single-file or
   * single-row import flow makes sense. False for sources where the
   * unit of import is the entire store (none today, but possible for
   * sources whose data is inseparable like a single SQLite row that
   * depends on cross-row joins).
   */
  supportsSingleImport: boolean
  /**
   * Walk the source's storage and return everything we can parse, plus
   * a tally of what we couldn't and why. MUST NOT throw — surface all
   * errors via `skipped`. If the storage location doesn't exist at all
   * (source not installed), return `{sessions: [], skipped: []}`.
   */
  discover(): DiscoveryResult
  /**
   * Parse one session by locator. For file-based sources, `locator` is
   * the absolute file path. For SQLite-backed sources, it's the source
   * row id. MUST NOT throw — surface failures via `{ok: false, ...}`.
   */
  parseOne(locator: string): ParseResult
  /**
   * Optional per-message metadata extractor. Called at ingest time to
   * compute the value that lands in `messages.metadata_json`. Returns
   * `null` to mean "no metadata for this message." Default behavior
   * (no extractor) is `null` for every message.
   */
  deriveMessageMetadata?(msg: ParsedMessage): Record<string, unknown> | null
}

// ─── Registry plumbing ───────────────────────────────────────────────────────

const REGISTRY = new Map<OperatorSourceApp, ImporterModule>()

export function registerImporter(mod: ImporterModule): void {
  REGISTRY.set(mod.id, mod)
  for (const alias of mod.aliases ?? []) {
    REGISTRY.set(alias, mod)
  }
}

export function getImporter(sourceApp: OperatorSourceApp): ImporterModule | null {
  return REGISTRY.get(sourceApp) ?? null
}

export function listImporters(): ImporterModule[] {
  // De-dupe — aliases register the same module twice in the underlying map.
  return Array.from(new Set(REGISTRY.values()))
}

/**
 * True when there's a registered importer for this source app. Used by
 * API routes to give a 400-with-clear-message instead of a generic
 * "not wired up" error.
 */
export function hasImporter(sourceApp: OperatorSourceApp): boolean {
  return REGISTRY.has(sourceApp)
}
