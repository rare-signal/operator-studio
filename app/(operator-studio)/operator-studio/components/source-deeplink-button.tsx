"use client"

import * as React from "react"
import { Check, ExternalLink, Terminal } from "lucide-react"

import { cn } from "@/registry/new-york-v4/lib/utils"
import type { SourceDeepLink } from "@/lib/operator-studio/source-deeplinks"

/**
 * Renders a deep-link affordance that adapts its behavior to the
 * link kind:
 *
 *   - `kind: "url"` → anchor that triggers the OS's URL scheme
 *     handler (e.g. `codex://`, `cursor://`, `https://`). Opens in a
 *     new tab so the operator's place in Operator Studio survives.
 *   - `kind: "command"` → button that copies the resume command to
 *     the clipboard, shows a transient "Copied" state, and surfaces
 *     the project hint as a tooltip.
 *
 * Two visual sizes via `size`: `header` (paired with the existing
 * Info / Promote / Review / Copy chrome at the top of the thread) and
 * `inline` (small chip used inside the per-message hover toolbar,
 * matching the other 10px hover affordances).
 */
export function SourceDeepLinkButton({
  link,
  size = "header",
}: {
  link: SourceDeepLink
  size?: "header" | "inline"
}) {
  const [copied, setCopied] = React.useState(false)

  if (link.kind === "url") {
    const Cls =
      size === "header"
        ? "inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md border border-input hover:bg-muted transition-colors text-foreground/85"
        : "inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        title={link.url}
        className={Cls}
      >
        <ExternalLink
          className={size === "header" ? "h-3 w-3" : "h-2.5 w-2.5"}
        />
        {link.label}
      </a>
    )
  }

  // Command kind — clipboard. Capture the narrowed fields into
  // locals so TS keeps the discriminant after the early return above.
  const command = link.command
  const hint = link.hint
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard write can fail in non-secure contexts; the user
      // sees no feedback, but we don't crash. Surfacing an error UI
      // would be more annoying than helpful for a copy action.
    }
  }

  const Cls =
    size === "header"
      ? "inline-flex items-center gap-1 h-7 px-2 text-xs rounded-md border border-input hover:bg-muted transition-colors text-foreground/85"
      : "inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`${command}\n\n${hint}`}
      className={cn(Cls, copied && "text-emerald-600 dark:text-emerald-400")}
    >
      {copied ? (
        <Check className={size === "header" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      ) : (
        <Terminal className={size === "header" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      )}
      {copied ? "Copied" : link.label}
    </button>
  )
}
