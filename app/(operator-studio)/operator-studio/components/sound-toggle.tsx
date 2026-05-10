"use client"

import * as React from "react"
import { Volume2, VolumeX, AlertTriangle } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"

import { useSound } from "./sound-context"

/**
 * Small header affordance for global sound. The button click acts as
 * the user gesture that arms the AudioContext when flipping enabled
 * on, so the toggle and the arm both happen in one interaction.
 *
 * Visible status:
 *   - VolumeX (muted) when disabled
 *   - Volume2 (active) when enabled & armed
 *   - Volume2 + amber dot when enabled but blocked (autoplay refused
 *     or tab suspended) — clicking the test cue inside the menu re-arms
 */
export function SoundToggle() {
  const { enabled, armed, blocked, engineState, setEnabled, rearm, fire } =
    useSound()

  const unsupported = engineState === "unsupported"
  const Icon = enabled ? Volume2 : VolumeX
  const label = unsupported
    ? "Audio unsupported in this browser"
    : !enabled
      ? "Sound off — click to enable"
      : blocked
        ? "Sound enabled, but blocked. Click to re-arm."
        : "Sound on"

  const handleToggle = async () => {
    await setEnabled(!enabled)
  }

  const handleTest = async () => {
    if (!enabled) await setEnabled(true)
    else if (!armed) await rearm()
    fire("test", `test:${Date.now()}`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
          disabled={unsupported}
        >
          <Icon className="h-4 w-4" />
          {blocked && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5 items-center justify-center"
            >
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400/70 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Attention sounds
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            void handleToggle()
          }}
        >
          {enabled ? (
            <>
              <VolumeX className="mr-2 h-3.5 w-3.5" />
              Mute all sounds
            </>
          ) : (
            <>
              <Volume2 className="mr-2 h-3.5 w-3.5" />
              Enable sounds
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            void handleTest()
          }}
        >
          <Volume2 className="mr-2 h-3.5 w-3.5" />
          Play test cue
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {unsupported && (
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                This browser does not expose WebAudio. Sound cues are
                disabled.
              </span>
            </p>
          )}
          {!unsupported && enabled && blocked && (
            <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Audio is paused by the browser. Tap "Play test cue" to
                re-arm — many mobile browsers suspend audio when the
                tab is backgrounded.
              </span>
            </p>
          )}
          {!unsupported && enabled && !blocked && (
            <p>
              Plays a soft cue when a thread comes to rest, a job
              finishes, or David's review queue grows. Debounced to
              avoid spam.
            </p>
          )}
          {!unsupported && !enabled && (
            <p>
              Off by default. Enable to hear when threads come to rest
              or jobs finish — useful for leaving Operator Studio open
              in a side window.
            </p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
