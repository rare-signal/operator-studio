"use client"

import * as React from "react"
import { Loader2, Sparkles } from "lucide-react"

import { cn } from "@/registry/new-york-v4/lib/utils"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import {
  PROMOTION_KIND_COLORS,
  PROMOTION_KIND_DESCRIPTIONS,
  PROMOTION_KIND_EMOJI,
  PROMOTION_KIND_LABELS,
  type OperatorThreadPassage,
  type PromotionKind,
} from "@/lib/operator-studio/types"

const KINDS = Object.keys(PROMOTION_KIND_LABELS) as PromotionKind[]

/**
 * First-class promotion dialog. Replaces the per-message popover
 * (which buried promotion behind a 64-px-wide chip with a single-line
 * note input) and serves as the action target for the selection
 * action bar's "Promote…" button.
 *
 * Two modes, picked from props:
 *
 *   • **Whole turn** — `passageText` undefined. Promotes the entire
 *     message with the chosen kind + note.
 *   • **Selected passage** — `passageText` set. Saves a passage
 *     record AND promotes the parent message; the passage text is
 *     shown as a quote header so the operator confirms what they're
 *     elevating before committing.
 */
export function PromoteMessageDialog({
  open,
  onOpenChange,
  threadId,
  messageId,
  source,
  passageText,
  defaultKind = "fire",
  onPromoteMessage,
  onPassageCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  threadId: string
  messageId: string
  source: "transcript" | "continuation"
  /**
   * If provided, the dialog is in "promote this passage" mode — the
   * text is shown as a quote and a passage row is saved alongside the
   * message-level promotion.
   */
  passageText?: string
  defaultKind?: PromotionKind
  onPromoteMessage: (
    id: string,
    source: "transcript" | "continuation",
    kind: PromotionKind,
    note: string
  ) => void | Promise<void>
  /**
   * Called when a passage was just created (passage mode only). Lets
   * the parent timeline update its passages map without a refetch.
   */
  onPassageCreated?: (p: OperatorThreadPassage) => void
}) {
  const [kind, setKind] = React.useState<PromotionKind>(defaultKind)
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset on open so a previous draft doesn't bleed across two
  // separate promotions of different turns.
  React.useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setNote("")
    setError(null)
  }, [open, defaultKind, messageId, passageText])

  const isPassage = !!passageText && passageText.trim().length > 0

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      // Passage mode → save the passage first, then promote the
      // message. Two writes in sequence so a failure on the message
      // promote doesn't strand a passage; we surface the error and
      // leave the passage in place for the operator to retry.
      if (isPassage) {
        const res = await fetch(
          `/api/operator-studio/threads/${threadId}/passages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messageId,
              text: passageText,
              note: note || undefined,
            }),
          }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(
            body?.code === "stale_selection"
              ? "Selection drifted from the live message — reselect and retry."
              : body?.error ?? "Couldn’t save passage."
          )
          return
        }
        const body = (await res.json()) as { passage: OperatorThreadPassage }
        onPassageCreated?.(body.passage)
      }
      await onPromoteMessage(messageId, source, kind, note)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promotion failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {isPassage ? "Promote this passage" : "Promote this turn"}
          </DialogTitle>
          <DialogDescription>
            {isPassage
              ? "Save the highlighted text as a passage and elevate the parent turn."
              : "Mark this entire turn as elevated so it surfaces in promoted views and exports."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected text preview — only in passage mode. The blockquote
              styling makes it unambiguous which sliver of the message is
              being saved, before the operator commits. */}
          {isPassage && (
            <blockquote className="rounded-md border-l-2 border-emerald-500 bg-muted/40 px-3 py-2 text-[13px] italic text-foreground/80">
              {passageText!.length > 360
                ? `${passageText!.slice(0, 360).trim()}…`
                : passageText}
            </blockquote>
          )}

          {/* Kind picker — tiles, not a row of chips. Each tile shows
              emoji, label, and a short description so the operator
              doesn't need to memorize what kind X means. */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Kind
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KINDS.map((k) => {
                const active = kind === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                      active
                        ? cn(
                            "border-foreground/40",
                            PROMOTION_KIND_COLORS[k]
                          )
                        : "border-border/60 bg-background hover:bg-muted/40"
                    )}
                  >
                    <span className="mt-0.5 text-base leading-none">
                      {PROMOTION_KIND_EMOJI[k]}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-medium">
                        {PROMOTION_KIND_LABELS[k]}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {PROMOTION_KIND_DESCRIPTIONS[k]}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Note — multi-line so operators can write a real "why this
              matters" without trying to fit it on one line. */}
          <div className="space-y-2">
            <Label htmlFor="promote-note" className="text-xs uppercase tracking-wider text-muted-foreground">
              Why does this matter?
            </Label>
            <Textarea
              id="promote-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="One or two sentences on what makes this worth keeping. Optional."
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault()
                  if (!saving) handleSubmit()
                }
              }}
            />
            <p className="text-[10px] text-muted-foreground/70">
              ⌘/Ctrl + Enter to promote.
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Promoting…
              </>
            ) : (
              <>
                <span className="mr-1">{PROMOTION_KIND_EMOJI[kind]}</span>
                Promote as {PROMOTION_KIND_LABELS[kind]}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
