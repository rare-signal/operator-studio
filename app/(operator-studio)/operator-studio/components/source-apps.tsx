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

const SOURCE_APP_DISPLAY: Record<OperatorSourceApp, SourceAppDisplay> = {
  codex: {
    label: SOURCE_APP_LABELS.codex,
    shortLabel: "Codex",
    iconSrc: "/operator-studio/source-apps/source-app-codex.png",
    chipClassName:
      "border-[#f0d7bf] bg-[#fff5ea] text-[#8f5d29] dark:border-orange-900/50 dark:bg-orange-950/25 dark:text-orange-100",
  },
  cursor: {
    label: SOURCE_APP_LABELS.cursor,
    shortLabel: "Cursor",
    iconSrc: "/operator-studio/source-apps/source-app-cursor.png",
    chipClassName:
      "border-[#cfe0f5] bg-[#eef6ff] text-[#315f92] dark:border-sky-900/50 dark:bg-sky-950/25 dark:text-sky-100",
  },
  claude: {
    label: SOURCE_APP_LABELS.claude,
    shortLabel: "Claude",
    iconSrc: "/operator-studio/source-apps/source-app-claude.png",
    chipClassName:
      "border-[#f0d7a6] bg-[#fff7e4] text-[#8e5d17] dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100",
  },
  antigravity: {
    label: SOURCE_APP_LABELS.antigravity,
    shortLabel: "Anti-G",
    iconSrc: "/operator-studio/source-apps/source-app-antigravity.png",
    chipClassName:
      "border-[#c7e7de] bg-[#eefbf8] text-[#0f6f68] dark:border-teal-900/50 dark:bg-teal-950/25 dark:text-teal-100",
  },
  void: {
    label: SOURCE_APP_LABELS.void,
    shortLabel: "Void",
    iconSrc: "/operator-studio/source-apps/source-app-void.png",
    chipClassName:
      "border-[#cde6ef] bg-[#eef9fc] text-[#245e74] dark:border-cyan-900/50 dark:bg-cyan-950/25 dark:text-cyan-100",
  },
  manual: {
    label: SOURCE_APP_LABELS.manual,
    shortLabel: "Manual",
    iconSrc: null,
    chipClassName:
      "border-border/70 bg-muted/70 text-muted-foreground dark:bg-muted/40",
  },
}

const SOURCE_APP_KEYS = Object.keys(SOURCE_APP_DISPLAY) as OperatorSourceApp[]

export const IMPORT_SHOWCASE_LANES: Array<Exclude<OperatorSourceApp, "manual">> = [
  "claude",
  "codex",
  "cursor",
  "antigravity",
  "void",
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

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-black/5 shadow-sm ring-1 ring-black/5 dark:bg-white/10",
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
