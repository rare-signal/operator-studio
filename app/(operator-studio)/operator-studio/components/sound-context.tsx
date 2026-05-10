"use client"

/**
 * Global sound preference + arm-state, mounted once in the Operator
 * Studio shell. Two reasons to live above any single page:
 *
 *   - Persistence: the on/off toggle is per-browser (localStorage),
 *     not per-route. Users flip it once and forget it.
 *   - Arm state: the AudioContext can only `resume()` inside a real
 *     user gesture. We capture that gesture from the toggle button
 *     itself and remember the armed state for every other page that
 *     wants to fire cues.
 */

import * as React from "react"

import {
  armSoundEngine,
  getSoundEngineState,
  isSoundEngineArmed,
  playSound,
  type SoundEvent,
} from "@/lib/operator-studio/sound-engine"

const STORAGE_KEY = "operator_studio_sound_enabled"

type EngineState = "unsupported" | "suspended" | "running" | "closed"

interface SoundContextValue {
  /** User-visible: do they want sound at all? Persisted. */
  enabled: boolean
  /** AudioContext is actually running and can produce sound. */
  armed: boolean
  /** enabled but the engine could not be armed (autoplay-blocked,
   *  unsupported browser). Drives the visible-fallback dot. */
  blocked: boolean
  engineState: EngineState
  /** Toggle on/off. Must be called from a user-gesture handler when
   *  switching from off → on, since arming the AudioContext counts as
   *  the gesture consumer. */
  setEnabled: (next: boolean) => Promise<void>
  /** Re-arm without flipping `enabled` — useful from the test button. */
  rearm: () => Promise<boolean>
  /** Fire a cue. No-op when disabled or not armed. */
  fire: (event: SoundEvent, dedupeKey?: string) => void
}

const SoundContext = React.createContext<SoundContextValue | null>(null)

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = React.useState(false)
  const [armed, setArmed] = React.useState(false)
  const [engineState, setEngineState] = React.useState<EngineState>("suspended")

  // Hydrate persisted preference. Don't auto-arm: the browser will
  // refuse without a gesture, leaving us in `enabled && !armed`
  // (a.k.a. blocked). The toggle button surfaces that visibly so the
  // user knows to click once.
  React.useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY)
      if (v === "1") setEnabledState(true)
    } catch {
      // private mode / disabled storage — sound stays off
    }
    setEngineState(getSoundEngineState())
  }, [])

  // Keep `armed` in sync with the underlying AudioContext when the tab
  // regains focus (Safari aggressively suspends backgrounded tabs).
  // Try to re-arm proactively on visibility — may fail without a fresh
  // user gesture, but the click/touch handler below catches those.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && enabled && !isSoundEngineArmed()) {
        armSoundEngine().then((ok) => {
          setArmed(ok)
          setEngineState(getSoundEngineState())
        })
      } else {
        setArmed(isSoundEngineArmed())
        setEngineState(getSoundEngineState())
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [enabled])

  // Auto-rearm on any user gesture in the page. This is the
  // load-bearing fix for "sound goes silent after a while and even
  // the test won't play": iOS Safari suspends the AudioContext
  // aggressively (tab backgrounded, idle) and requires a fresh user
  // gesture to resume. Listening at document level in capture phase
  // means *any* tap (chat interaction, button click, scroll-tap)
  // silently rearms — the user never has to click the speaker again.
  // Idempotent and cheap when already armed.
  React.useEffect(() => {
    if (!enabled) return
    let inflight = false
    const tryRearm = () => {
      if (inflight || isSoundEngineArmed()) return
      inflight = true
      armSoundEngine()
        .then((ok) => {
          if (ok) {
            setArmed(true)
            setEngineState(getSoundEngineState())
          }
        })
        .finally(() => {
          inflight = false
        })
    }
    document.addEventListener("click", tryRearm, { capture: true })
    document.addEventListener("touchstart", tryRearm, { capture: true })
    document.addEventListener("keydown", tryRearm, { capture: true })
    return () => {
      document.removeEventListener("click", tryRearm, { capture: true })
      document.removeEventListener("touchstart", tryRearm, { capture: true })
      document.removeEventListener("keydown", tryRearm, { capture: true })
    }
  }, [enabled])

  const setEnabled = React.useCallback(async (next: boolean) => {
    setEnabledState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {
      // ignore
    }
    if (next) {
      const ok = await armSoundEngine()
      setArmed(ok)
      setEngineState(getSoundEngineState())
    } else {
      // Leave the AudioContext alive — closing/recreating it is more
      // failure-prone than just gating playback on `enabled`.
      setArmed(isSoundEngineArmed())
    }
  }, [])

  const rearm = React.useCallback(async () => {
    const ok = await armSoundEngine()
    setArmed(ok)
    setEngineState(getSoundEngineState())
    return ok
  }, [])

  const fire = React.useCallback(
    (event: SoundEvent, dedupeKey?: string) => {
      if (!enabled) return
      if (!isSoundEngineArmed()) return
      playSound(event, dedupeKey)
    },
    [enabled]
  )

  const value = React.useMemo<SoundContextValue>(
    () => ({
      enabled,
      armed,
      blocked: enabled && !armed && engineState !== "unsupported",
      engineState,
      setEnabled,
      rearm,
      fire,
    }),
    [enabled, armed, engineState, setEnabled, rearm, fire]
  )

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>
}

export function useSound(): SoundContextValue {
  const ctx = React.useContext(SoundContext)
  if (!ctx) {
    // Defensive: rendered outside the provider (e.g. a unit test). Return
    // a no-op shape so callers don't have to null-check at every site.
    return {
      enabled: false,
      armed: false,
      blocked: false,
      engineState: "unsupported",
      setEnabled: async () => {},
      rearm: async () => false,
      fire: () => {},
    }
  }
  return ctx
}
