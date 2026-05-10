/**
 * Desktop control micro-lease for GUI automation.
 *
 * Pattern: any code path that fires AppleScript keystrokes (Cmd+N,
 * Cmd+V, Return, etc.) acquires a short-lived lease that names the
 * intended target app and a deadline 2–4s in the future. Before each
 * keystroke, the lease is re-verified against macOS's actual frontmost
 * process. If the user has tabbed away — Discord, browser, anything —
 * `verifyLeaseFocus` reports `user-collision` and the caller bails
 * immediately. The user's prompt is preserved upstream by the launch-
 * attempt fallback machinery; this module only owns the focus contract.
 *
 * Doctrine:
 *   - ≤ 4 second budget. GUI sequences must not hold a lock long
 *     enough to feel like the operator's machine is taken hostage.
 *   - Reacquire per phase. The new-session path acquires 4 separate
 *     leases (activate, new-session-shortcut, paste, submit) instead
 *     of one long lock. Between phases the workstation is fully the
 *     user's again.
 *   - Single active lease at a time. Two GUI sequences cannot run
 *     concurrently — racing keystrokes is the failure mode this whole
 *     module exists to prevent.
 *   - Auto-expire. A leaked lease (process crash, exception above the
 *     release call) clears itself after the deadline; nothing has to
 *     manually unwedge.
 *
 * The status surface (`getDesktopLeaseSnapshot`) is read by a small
 * UI indicator so the operator sees "Operator controlling Claude —
 * 2.1s left" while keystrokes are firing. The "recently ended"
 * timestamp lets the indicator linger briefly between phases of one
 * logical operation so it doesn't visibly flicker.
 */

import "server-only"

import { randomUUID } from "node:crypto"

import { runCommand } from "./exec"

export interface DesktopLease {
  id: string
  targetApp: string
  /** Free-form label such as `new-session:claude` or `send:codex`.
   *  Surfaced to the UI verbatim, so keep it short and human-readable. */
  purpose: string
  /** Optional sub-stage label updated by `verifyLeaseFocus`. */
  stage: string | null
  acquiredAt: string
  expiresAt: string
  lastFrontmost: string | null
}

interface LeaseState extends DesktopLease {
  acquiredAtMs: number
  expiresAtMs: number
}

/** UI-friendly snapshot. `recentlyEndedAt` is the wall-clock time the
 *  most-recent lease released, so the indicator can keep showing for
 *  ~1.5s of grace between back-to-back leases of one operation. */
export interface DesktopLeaseSnapshot {
  active: DesktopLease | null
  lastEndedAt: string | null
  lastTargetApp: string | null
  lastPurpose: string | null
}

const DEFAULT_LEASE_MS = 3_000
const MIN_LEASE_MS = 2_000
const MAX_LEASE_MS = 4_000

let activeLease: LeaseState | null = null
let lastEndedAtMs: number | null = null
let lastTargetApp: string | null = null
let lastPurpose: string | null = null

export type AcquireResult =
  | { ok: true; lease: DesktopLease }
  | { ok: false; error: string; status: number; conflict: DesktopLease | null }

export interface AcquireDesktopLeaseArgs {
  targetApp: string
  purpose: string
  /** Lease duration; clamped to [MIN, MAX]. Defaults to 3s. */
  durationMs?: number
}

export function acquireDesktopLease(
  args: AcquireDesktopLeaseArgs
): AcquireResult {
  expireIfStale()
  if (activeLease) {
    return {
      ok: false,
      error: `Another desktop lease is active (target=${activeLease.targetApp}, purpose=${activeLease.purpose})`,
      status: 409,
      conflict: serialize(activeLease),
    }
  }
  const now = Date.now()
  const duration = clamp(
    args.durationMs ?? DEFAULT_LEASE_MS,
    MIN_LEASE_MS,
    MAX_LEASE_MS
  )
  const expiresAtMs = now + duration
  activeLease = {
    id: randomUUID(),
    targetApp: args.targetApp,
    purpose: args.purpose,
    stage: null,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    lastFrontmost: null,
    acquiredAtMs: now,
    expiresAtMs,
  }
  return { ok: true, lease: serialize(activeLease) }
}

export function releaseDesktopLease(leaseId: string): void {
  if (activeLease && activeLease.id === leaseId) {
    lastEndedAtMs = Date.now()
    lastTargetApp = activeLease.targetApp
    lastPurpose = activeLease.purpose
    activeLease = null
  }
}

export type FocusVerdict =
  | { ok: true; frontmost: string }
  | {
      ok: false
      reason: "expired" | "wrong-lease" | "user-collision" | "probe-failed"
      frontmost: string | null
    }

/**
 * Re-check macOS frontmost against the lease's target app and stamp
 * the result onto the lease so the UI indicator shows where the focus
 * race went. Caller MUST treat any non-ok result as an immediate
 * abort — keystrokes fired after a `user-collision` go to whatever
 * window the user just clicked into.
 */
export async function verifyLeaseFocus(
  leaseId: string,
  stage: string
): Promise<FocusVerdict> {
  expireIfStale()
  if (!activeLease || activeLease.id !== leaseId) {
    return { ok: false, reason: "wrong-lease", frontmost: null }
  }
  activeLease.stage = stage
  const frontmost = await frontmostProcessName()
  if (activeLease) activeLease.lastFrontmost = frontmost
  // The async probe could have outlasted the deadline.
  expireIfStale()
  if (!activeLease || activeLease.id !== leaseId) {
    return { ok: false, reason: "expired", frontmost }
  }
  if (frontmost === null) {
    return { ok: false, reason: "probe-failed", frontmost: null }
  }
  if (frontmost !== activeLease.targetApp) {
    return { ok: false, reason: "user-collision", frontmost }
  }
  return { ok: true, frontmost }
}

async function frontmostProcessName(): Promise<string | null> {
  const r = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "System Events" to get name of first application process whose frontmost is true`,
    ],
    { timeoutMs: 2000 }
  )
  if (r.code !== 0) return null
  const name = r.stdout.trim()
  return name.length > 0 ? name : null
}

export function getDesktopLeaseSnapshot(): DesktopLeaseSnapshot {
  expireIfStale()
  return {
    active: activeLease ? serialize(activeLease) : null,
    lastEndedAt: lastEndedAtMs ? new Date(lastEndedAtMs).toISOString() : null,
    lastTargetApp,
    lastPurpose,
  }
}

function expireIfStale(): void {
  if (activeLease && activeLease.expiresAtMs <= Date.now()) {
    lastEndedAtMs = activeLease.expiresAtMs
    lastTargetApp = activeLease.targetApp
    lastPurpose = activeLease.purpose
    activeLease = null
  }
}

function serialize(s: LeaseState): DesktopLease {
  return {
    id: s.id,
    targetApp: s.targetApp,
    purpose: s.purpose,
    stage: s.stage,
    acquiredAt: s.acquiredAt,
    expiresAt: s.expiresAt,
    lastFrontmost: s.lastFrontmost,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi)
}
