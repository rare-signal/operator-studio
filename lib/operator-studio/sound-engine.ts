/**
 * Sound attention layer — first slice.
 *
 * WebAudio-only (no binary assets). One AudioContext per browser tab,
 * created lazily on first user-gesture-arm via `armSoundEngine()`.
 * Browsers (Chrome, Safari, every mobile) refuse to start an
 * AudioContext outside a user gesture, so we treat "armed" as a
 * separate state from "enabled":
 *
 *   - enabled = user wants sound on (persisted in localStorage)
 *   - armed   = AudioContext is `running` (only true after a gesture)
 *   - blocked = enabled && !armed && we tried (visible UI fallback)
 *
 * Events are debounced per-key over `DEBOUNCE_MS` so re-renders or
 * rapid state thrashing don't produce a stutter of beeps.
 */

export type SoundEvent =
  | "thread_rest"
  | "job_done"
  | "david_review_ready"
  | "operation_done"
  | "attention_needed"
  | "test"

interface ToneSpec {
  /** Sequential beep frequencies in Hz. */
  freqs: number[]
  /** Duration of each beep, seconds. */
  beep: number
  /** Gap between beeps, seconds. */
  gap: number
  /** Peak gain (0..1). */
  gain: number
  /** Oscillator type. */
  type: OscillatorType
}

const TONES: Record<SoundEvent, ToneSpec> = {
  // Soft two-tone descending — "this thread came to rest". Calm, not
  // urgent; David should be able to hear several per session without
  // it becoming annoying.
  thread_rest: {
    freqs: [660, 440],
    beep: 0.09,
    gap: 0.04,
    gain: 0.16,
    type: "sine",
  },
  // Slightly brighter ascending pair — a job/operation finished.
  job_done: {
    freqs: [523.25, 783.99],
    beep: 0.1,
    gap: 0.03,
    gain: 0.18,
    type: "sine",
  },
  operation_done: {
    freqs: [523.25, 659.25, 783.99],
    beep: 0.08,
    gap: 0.03,
    gain: 0.18,
    type: "sine",
  },
  // Three rising pings — David's review queue grew. More attention
  // pull than a thread-rest, less than `attention_needed`.
  david_review_ready: {
    freqs: [587.33, 739.99, 880],
    beep: 0.08,
    gap: 0.05,
    gain: 0.2,
    type: "triangle",
  },
  // The "look at me" tone — short, slightly insistent triangle pair.
  attention_needed: {
    freqs: [880, 660, 880],
    beep: 0.09,
    gap: 0.05,
    gain: 0.22,
    type: "triangle",
  },
  test: {
    freqs: [523.25, 659.25, 783.99],
    beep: 0.09,
    gap: 0.04,
    gain: 0.2,
    type: "sine",
  },
}

const DEBOUNCE_MS = 800

let ctx: AudioContext | null = null
let lastFiredAt = new Map<string, number>()

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/**
 * Must be called inside a user-gesture handler (click, keypress).
 * Resumes a suspended AudioContext and returns whether the engine is
 * now able to produce sound.
 */
export async function armSoundEngine(): Promise<boolean> {
  const c = getCtx()
  if (!c) return false
  if (c.state === "suspended") {
    try {
      await c.resume()
    } catch {
      return false
    }
  }
  return c.state === "running"
}

export function isSoundEngineArmed(): boolean {
  return !!ctx && ctx.state === "running"
}

/**
 * Play one of the named cues. Silently no-ops if the engine isn't
 * armed yet — the caller is responsible for showing a visible fallback
 * when `enabled && !armed`.
 *
 * Optional `dedupeKey` collapses repeat calls within DEBOUNCE_MS so a
 * single state transition that re-fires across renders only emits one
 * beep. Defaults to the event name.
 */
export function playSound(event: SoundEvent, dedupeKey?: string): void {
  const c = ctx
  if (!c || c.state !== "running") return
  const key = dedupeKey ?? event
  const now = Date.now()
  const last = lastFiredAt.get(key) ?? 0
  if (now - last < DEBOUNCE_MS) return
  lastFiredAt.set(key, now)
  const spec = TONES[event]
  let t = c.currentTime
  for (const f of spec.freqs) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = spec.type
    osc.frequency.setValueAtTime(f, t)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(spec.gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + spec.beep)
    osc.connect(g).connect(c.destination)
    osc.start(t)
    osc.stop(t + spec.beep + 0.02)
    t += spec.beep + spec.gap
  }
}

/** Test/diagnostics: the audio context state, or "unsupported". */
export function getSoundEngineState():
  | "unsupported"
  | "suspended"
  | "running"
  | "closed" {
  if (typeof window === "undefined") return "unsupported"
  const c = getCtx()
  if (!c) return "unsupported"
  return c.state as "suspended" | "running" | "closed"
}
