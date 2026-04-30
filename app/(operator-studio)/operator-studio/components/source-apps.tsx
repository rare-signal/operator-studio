"use client"

import Image from "next/image"
import * as React from "react"

import type { OperatorSourceApp } from "@/lib/operator-studio/types"
import { SOURCE_APP_LABELS } from "@/lib/operator-studio/types"
import { cn } from "@/lib/utils"

type SourceAppDisplay = {
  label: string
  shortLabel: string
  iconSrc: string | null
  chipClassName: string
}

const warmAmber =
  "border-[#f0d7a6] bg-[#fff7e4] text-[#8e5d17] dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100"
const warmOrange =
  "border-[#f0d7bf] bg-[#fff5ea] text-[#8f5d29] dark:border-orange-900/50 dark:bg-orange-950/25 dark:text-orange-100"
const coolSky =
  "border-[#cfe0f5] bg-[#eef6ff] text-[#315f92] dark:border-sky-900/50 dark:bg-sky-950/25 dark:text-sky-100"
const coolTeal =
  "border-[#c7e7de] bg-[#eefbf8] text-[#0f6f68] dark:border-teal-900/50 dark:bg-teal-950/25 dark:text-teal-100"
const coolCyan =
  "border-[#cde6ef] bg-[#eef9fc] text-[#245e74] dark:border-cyan-900/50 dark:bg-cyan-950/25 dark:text-cyan-100"
const coolEmerald =
  "border-[#c7e9d4] bg-[#eefbf3] text-[#146c43] dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-100"
const coolIndigo =
  "border-[#cfd1f4] bg-[#eeeffd] text-[#393e91] dark:border-indigo-900/50 dark:bg-indigo-950/25 dark:text-indigo-100"
const warmPink =
  "border-[#f2c7dc] bg-[#fdeef4] text-[#8a3565] dark:border-pink-900/50 dark:bg-pink-950/25 dark:text-pink-100"
const warmYellow =
  "border-[#ecdfa8] bg-[#fdf8e0] text-[#7a5c12] dark:border-yellow-900/50 dark:bg-yellow-950/25 dark:text-yellow-100"
const neutral =
  "border-border/70 bg-muted/70 text-muted-foreground dark:bg-muted/40"

const SOURCE_APP_DISPLAY: Record<OperatorSourceApp, SourceAppDisplay> = {
  codex: {
    label: SOURCE_APP_LABELS.codex,
    shortLabel: "Codex",
    iconSrc: null,
    chipClassName: warmOrange,
  },
  cursor: {
    label: SOURCE_APP_LABELS.cursor,
    shortLabel: "Cursor",
    iconSrc: null,
    chipClassName: coolSky,
  },
  claude: {
    label: SOURCE_APP_LABELS.claude,
    shortLabel: "Claude",
    iconSrc: null,
    chipClassName: warmAmber,
  },
  "claude-code": {
    label: SOURCE_APP_LABELS["claude-code"],
    shortLabel: "C-Code",
    iconSrc: null,
    chipClassName: warmAmber,
  },
  opencode: {
    label: SOURCE_APP_LABELS.opencode,
    shortLabel: "OpenC",
    iconSrc: null,
    chipClassName: coolIndigo,
  },
  chatgpt: {
    label: SOURCE_APP_LABELS.chatgpt,
    shortLabel: "CGPT",
    iconSrc: null,
    chipClassName: coolEmerald,
  },
  openai: {
    label: SOURCE_APP_LABELS.openai,
    shortLabel: "OAI",
    iconSrc: null,
    chipClassName: coolEmerald,
  },
  gemini: {
    label: SOURCE_APP_LABELS.gemini,
    shortLabel: "Gem",
    iconSrc: null,
    chipClassName: coolSky,
  },
  anthropic: {
    label: SOURCE_APP_LABELS.anthropic,
    shortLabel: "Anthr",
    iconSrc: null,
    chipClassName: warmAmber,
  },
  antigravity: {
    label: SOURCE_APP_LABELS.antigravity,
    shortLabel: "Anti-G",
    iconSrc: null,
    chipClassName: coolTeal,
  },
  void: {
    label: SOURCE_APP_LABELS.void,
    shortLabel: "Void",
    iconSrc: null,
    chipClassName: coolCyan,
  },
  aider: {
    label: SOURCE_APP_LABELS.aider,
    shortLabel: "Aider",
    iconSrc: null,
    chipClassName: warmPink,
  },
  zed: {
    label: SOURCE_APP_LABELS.zed,
    shortLabel: "Zed",
    iconSrc: null,
    chipClassName: coolIndigo,
  },
  copilot: {
    label: SOURCE_APP_LABELS.copilot,
    shortLabel: "CoPi",
    iconSrc: null,
    chipClassName: neutral,
  },
  webhook: {
    label: SOURCE_APP_LABELS.webhook,
    shortLabel: "Hook",
    iconSrc: null,
    chipClassName: warmYellow,
  },
  manual: {
    label: SOURCE_APP_LABELS.manual,
    shortLabel: "Manual",
    iconSrc: null,
    chipClassName: neutral,
  },
}

const SOURCE_APP_KEYS = Object.keys(SOURCE_APP_DISPLAY) as OperatorSourceApp[]

export const IMPORT_SHOWCASE_LANES: Array<Exclude<OperatorSourceApp, "manual">> = [
  "claude",
  "codex",
  "opencode",
  "cursor",
  "chatgpt",
  "gemini",
]

function getSourceDisplay(source: string): SourceAppDisplay {
  if (SOURCE_APP_KEYS.includes(source as OperatorSourceApp)) {
    return SOURCE_APP_DISPLAY[source as OperatorSourceApp]
  }

  return {
    label: source ? source.replace(/-/g, " ") : "Unknown",
    shortLabel: source ? source.slice(0, 2).toUpperCase() : "?",
    iconSrc: null,
    chipClassName:
      "border-border/70 bg-muted/70 text-muted-foreground dark:bg-muted/40",
  }
}

function fallbackLetter(label: string) {
  const trimmed = label.trim()
  return trimmed ? trimmed[0]?.toUpperCase() ?? "?" : "?"
}

// Per-source palette for the avatar's letter-fallback state. Tuned
// to stay subtle (muted background, mid-tone border) while keeping
// the letter glyph in a saturated hue — color identity rides on the
// text, not the fill, so it reads at a glance without shouting.
// Distinct from `chipClassName` because chip palettes use the same
// dark-tone-at-25%-opacity recipe across hues, which collapses into
// one indistinguishable blob at avatar size.
const AVATAR_FALLBACK_COLORS: Record<string, string> = {
  claude:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  "claude-code":
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  opencode:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
  codex:
    "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300",
  cursor:
    "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
  chatgpt:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  openai:
    "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300",
  gemini:
    "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300",
  anthropic:
    "border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-600/40 dark:bg-amber-600/10 dark:text-amber-200",
  antigravity:
    "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300",
  void:
    "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300",
  aider:
    "border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-500/40 dark:bg-pink-500/10 dark:text-pink-300",
  zed:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
  copilot:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/10 dark:text-slate-300",
  webhook:
    "border-yellow-300 bg-yellow-50 text-yellow-700 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-300",
  manual:
    "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-500/40 dark:bg-zinc-500/10 dark:text-zinc-300",
}
const AVATAR_FALLBACK_DEFAULT =
  "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-500/40 dark:bg-zinc-500/10 dark:text-zinc-300"

export function SourceAppAvatar({
  source,
  size = "md",
  className,
}: {
  source: string
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const meta = getSourceDisplay(source)
  const [imageFailed, setImageFailed] = React.useState(false)

  React.useEffect(() => {
    setImageFailed(false)
  }, [meta.iconSrc])

  const frameClassName =
    size === "sm"
      ? "h-5 w-5 rounded-md"
      : size === "lg"
        ? "h-8 w-8 rounded-xl"
        : "h-6 w-6 rounded-lg"

  // When there's no icon, fall back to a single-letter glyph painted
  // with a saturated per-source color (see AVATAR_FALLBACK_COLORS).
  // Many sources collide on the first letter (Claude/Codex/Cursor/
  // ChatGPT all "C") — color is what disambiguates them at a glance.
  const showLetterFallback = !meta.iconSrc || imageFailed
  const fallbackPalette =
    AVATAR_FALLBACK_COLORS[source] ?? AVATAR_FALLBACK_DEFAULT
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden shadow-sm",
        showLetterFallback
          ? cn("border", fallbackPalette)
          : "border border-white/10 bg-black/5 ring-1 ring-black/5 dark:bg-white/10",
        frameClassName,
        className
      )}
    >
      {meta.iconSrc && !imageFailed ? (
        <Image
          src={meta.iconSrc}
          alt={`${meta.label} icon`}
          fill
          sizes={size === "lg" ? "32px" : size === "sm" ? "20px" : "24px"}
          className="object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span className="text-[9px] font-semibold leading-none text-current">
          {fallbackLetter(meta.shortLabel)}
        </span>
      )}
    </span>
  )
}

export function SourceAppToken({
  source,
  showLabel = true,
  shortLabel = false,
  size = "md",
  variant = "pill",
  className,
  labelClassName,
}: {
  source: string
  showLabel?: boolean
  shortLabel?: boolean
  size?: "sm" | "md" | "lg"
  variant?: "pill" | "plain"
  className?: string
  labelClassName?: string
}) {
  const meta = getSourceDisplay(source)
  const label = shortLabel ? meta.shortLabel : meta.label
  const isPlain = variant === "plain"

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-2",
        isPlain
          ? "text-foreground"
          : cn("rounded-full border px-2.5 py-1 shadow-sm", meta.chipClassName),
        size === "sm" && (isPlain ? "gap-1.5 text-xs" : "gap-1.5 px-2 py-0.5 text-[11px]"),
        size === "md" && (isPlain ? "text-sm" : "text-xs"),
        size === "lg" && (isPlain ? "text-sm" : "px-3 py-1.5 text-sm"),
        className
      )}
      title={meta.label}
    >
      <SourceAppAvatar source={source} size={size} />
      {showLabel && (
        <span className={cn("truncate font-medium", labelClassName)}>
          {label}
        </span>
      )}
    </span>
  )
}

export function SupportedImportsStrip({
  className,
}: {
  className?: string
}) {
  return (
    <section className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/65">
        Import Sources
      </span>
      {IMPORT_SHOWCASE_LANES.map((source) => {
        const meta = getSourceDisplay(source)

        return (
          <span
            key={source}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-transparent px-2.5 py-1"
          >
            <SourceAppAvatar source={source} />
            <span className="text-xs font-medium">{meta.label}</span>
          </span>
        )
      })}
    </section>
  )
}
