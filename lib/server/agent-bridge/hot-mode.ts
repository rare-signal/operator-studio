/**
 * Hot mode = "this server may pass keystrokes/prompts from Bento to
 * live agents". The threat we're defending against isn't network
 * attackers — it's *us*. AI calls AI calls AI. A casual click
 * shouldn't put the server in a state where one Claude can poke
 * another Claude on this workstation.
 *
 * Design = nuclear launch cover, not env-var deploy switch:
 *
 *   - State lives in process memory only. Server restart → disarmed.
 *     This is a feature: a hung loop that "won't stop arming itself"
 *     dies the moment you kill the dev server.
 *   - Arming requires a PIN (default "1010", overridable via
 *     `OPERATOR_STUDIO_HOT_MODE_PIN`). The PIN is ergonomics, not
 *     crypto — it stops accidental flips and stops an autonomous
 *     agent from arming the server by chance.
 *   - Arming has a duration cap (default 15 min, max 60 min). The
 *     "plastic cover" snaps shut on its own; you can't accidentally
 *     leave hot mode on overnight.
 *   - Disarm requires no PIN (failing safe is always free).
 */

const DEFAULT_PIN = "1010"
const DEFAULT_DURATION_MS = 15 * 60_000
const MAX_DURATION_MS = 60 * 60_000

// In Next.js dev mode each route handler can land in its own
// module-instance after HMR, so module-local `let` state diverges
// between /hot-mode (where we arm) and /[id]/send (where we check).
// A globalThis-keyed singleton survives those re-imports — and in prod
// it costs nothing because there's only one instance anyway.
interface HotModeRuntime {
  armedUntilMs: number
  armedAtMs: number
}
const GLOBAL_KEY = "__operatorStudioHotMode_v1__" as const
type GlobalWithHotMode = typeof globalThis & {
  [GLOBAL_KEY]?: HotModeRuntime
}
function runtime(): HotModeRuntime {
  const g = globalThis as GlobalWithHotMode
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { armedUntilMs: 0, armedAtMs: 0 }
  }
  return g[GLOBAL_KEY]!
}

export interface HotModeStatus {
  armed: boolean
  remainingMs: number
  defaultDurationMs: number
  maxDurationMs: number
  /** True when a non-default PIN has been configured via env. UI uses
   *  this to nudge the operator to set one if they're staying disarmed
   *  on the default. Never returns the actual PIN. */
  pinIsCustom: boolean
}

export function getHotModeStatus(): HotModeStatus {
  const remaining = Math.max(0, runtime().armedUntilMs - Date.now())
  return {
    armed: remaining > 0,
    remainingMs: remaining,
    defaultDurationMs: DEFAULT_DURATION_MS,
    maxDurationMs: MAX_DURATION_MS,
    pinIsCustom: Boolean(process.env.OPERATOR_STUDIO_HOT_MODE_PIN?.trim()),
  }
}

export function isHotModeArmed(): boolean {
  return Date.now() < runtime().armedUntilMs
}

function getPin(): string {
  return process.env.OPERATOR_STUDIO_HOT_MODE_PIN?.trim() || DEFAULT_PIN
}

export type ArmResult =
  | { ok: true; armedUntilMs: number; remainingMs: number }
  | { ok: false; reason: "bad-pin" | "duration-too-large" }

/** Arm hot mode for `durationMs` (clamped). Requires the correct PIN.
 *  Returns the new state on success. */
export function armHotMode(pin: string, durationMs?: number): ArmResult {
  if (typeof pin !== "string" || pin.trim() !== getPin()) {
    return { ok: false, reason: "bad-pin" }
  }
  const requested =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : DEFAULT_DURATION_MS
  if (requested > MAX_DURATION_MS) {
    return { ok: false, reason: "duration-too-large" }
  }
  const r = runtime()
  const now = Date.now()
  r.armedAtMs = now
  r.armedUntilMs = now + requested
  return { ok: true, armedUntilMs: r.armedUntilMs, remainingMs: requested }
}

export function disarmHotMode(): void {
  const r = runtime()
  r.armedUntilMs = 0
  r.armedAtMs = 0
}

/** For diagnostics. Not exposed over the wire. */
export function _internalArmedAtMs(): number {
  return runtime().armedAtMs
}
