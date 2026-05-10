/**
 * Persistent launch-attempt store.
 *
 * The new-session launch path (Cmd+N → paste → submit → JSONL reconcile)
 * has multiple stages that can fail in production: hot-mode arming,
 * macOS app activation, Accessibility-gated keystrokes, the paste/
 * submit dance, and the post-launch JSONL poll. When any of those fail
 * the operator-typed prompt MUST survive the failure so they can fall
 * back to the proven send-to-existing-agent path without retyping.
 *
 * Storage is intentionally a flat directory of JSON files under
 * `<cwd>/.operator-studio/launch-attempts/`. We don't need a DB
 * migration for this — a launch attempt is a short-lived record that
 * either gets resolved (operator picked an existing agent + we bound
 * it) or dismissed. The directory survives server restarts and is
 * trivially inspectable from a terminal.
 *
 * Records are NEVER auto-deleted. The operator decides when an attempt
 * is resolved or dismissed; until then the prompt is recoverable.
 */

import "server-only"

import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"

const ROOT = path.join(process.cwd(), ".operator-studio", "launch-attempts")

// Stage names mirror the structured failure stages emitted by
// /agents/new-session and the underlying createNewAppSessionAndSend
// helper. Kept as a closed string union so the UI can switch on it
// for stage-specific copy without parsing free-text errors.
export type LaunchAttemptStage =
  | "hot-mode"
  | "validate"
  | "activate"
  // Target app activated, but a different app was frontmost when we
  // verified — refusing to send keystrokes blind. Distinct stage so the
  // UI can tell the operator "we caught a focus race; fix the
  // foreground app and retry" instead of pretending paste failed.
  | "focus-after-activate"
  | "new-session-shortcut"
  // New-thread keystroke fired, but app was no longer frontmost when
  // we re-verified — the new thread may exist but focus moved.
  | "focus-after-new-session"
  // pbcopy itself failed — clipboard never got the prompt.
  | "clipboard-stage"
  // Cmd+V keystroke failed (typically Accessibility) before any text
  // could land in the composer.
  | "paste"
  // Paste landed (focus was verified immediately before ⌘V) but the
  // submit Return failed — operator just needs to press Return.
  | "submit"
  | "reconcile"
  // Pre-flight refusal: the requested worker launcher is unknown,
  // mismatched against the requested planner brain, not driveable by
  // /agents/new-session, or reported as unavailable by the backend
  // inventory. We never attempt the launch — the prompt is captured
  // verbatim with a concrete reason so the operator can fix the
  // launcher (or pick a different one) and retry.
  | "launcher-unavailable"
  // The launch produced no failure but the operator chose to capture
  // the prompt for manual handoff anyway — UI "stash this prompt".
  | "manual"
  // Legacy stage retained so old launch-attempt records on disk still
  // deserialize. New code paths emit `paste` or `submit` instead.
  | "paste-and-submit"

export type LaunchAttemptStatus = "pending" | "resolved" | "dismissed"

export interface LaunchAttemptRecord {
  id: string
  createdAt: string
  appKind: "claude" | "codex"
  // Verbatim prompt the operator submitted. NEVER truncated — the
  // whole point of this store is that a 12 KB prompt typed into a
  // launcher modal isn't lost when System Events refuses a keystroke.
  prompt: string
  // Origin context for plan-card binding on resolution.
  planStepId: string | null
  sourceRecommendationId: string | null
  // Diagnostic context.
  stage: LaunchAttemptStage
  // Plain-English message the UI renders verbatim. The original
  // technical error string is kept on `errorRaw` for debugging.
  message: string
  errorRaw: string | null
  // Optional structured evidence from the new-session helper (pre/
  // post snapshot ids, candidates, etc.) — helps the operator decide
  // whether to retry vs. fall back.
  evidence: Record<string, unknown> | null
  // Set when an operator resolves the attempt against an existing
  // Claude/Codex/tmux agent so we can bind the agent → planStepId.
  resolvedAt: string | null
  resolvedAgentId: string | null
  status: LaunchAttemptStatus
}

export interface CreateLaunchAttemptInput {
  appKind: "claude" | "codex"
  prompt: string
  planStepId: string | null
  sourceRecommendationId: string | null
  stage: LaunchAttemptStage
  message: string
  errorRaw: string | null
  evidence?: Record<string, unknown> | null
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true })
}

function recordPath(id: string): string {
  // Defense-in-depth: ids come from randomUUID so this is already
  // safe, but reject anything with a path separator just in case a
  // future caller routes external input here.
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error("Invalid launch-attempt id")
  }
  return path.join(ROOT, `${id}.json`)
}

export async function createLaunchAttempt(
  input: CreateLaunchAttemptInput
): Promise<LaunchAttemptRecord> {
  await ensureRoot()
  const record: LaunchAttemptRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    appKind: input.appKind,
    prompt: input.prompt,
    planStepId: input.planStepId,
    sourceRecommendationId: input.sourceRecommendationId,
    stage: input.stage,
    message: input.message,
    errorRaw: input.errorRaw,
    evidence: input.evidence ?? null,
    resolvedAt: null,
    resolvedAgentId: null,
    status: "pending",
  }
  await fs.writeFile(recordPath(record.id), JSON.stringify(record, null, 2), "utf-8")
  return record
}

export async function getLaunchAttempt(id: string): Promise<LaunchAttemptRecord | null> {
  try {
    const raw = await fs.readFile(recordPath(id), "utf-8")
    return JSON.parse(raw) as LaunchAttemptRecord
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
    throw e
  }
}

export async function listLaunchAttempts(opts?: {
  status?: LaunchAttemptStatus | "all"
  limit?: number
}): Promise<LaunchAttemptRecord[]> {
  const status = opts?.status ?? "pending"
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200))

  let files: string[]
  try {
    files = await fs.readdir(ROOT)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return []
    throw e
  }

  const records: LaunchAttemptRecord[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(ROOT, file), "utf-8")
      const rec = JSON.parse(raw) as LaunchAttemptRecord
      if (status !== "all" && rec.status !== status) continue
      records.push(rec)
    } catch {
      // Skip unreadable / malformed records — never let one bad file
      // break the whole list view.
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return records.slice(0, limit)
}

export async function resolveLaunchAttempt(
  id: string,
  args: { agentId: string | null; status: "resolved" | "dismissed" }
): Promise<LaunchAttemptRecord | null> {
  const existing = await getLaunchAttempt(id)
  if (!existing) return null
  const next: LaunchAttemptRecord = {
    ...existing,
    resolvedAt: new Date().toISOString(),
    resolvedAgentId: args.agentId,
    status: args.status,
  }
  await fs.writeFile(recordPath(id), JSON.stringify(next, null, 2), "utf-8")
  return next
}
