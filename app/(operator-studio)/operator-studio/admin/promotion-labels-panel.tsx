"use client"

import * as React from "react"
import { Loader2, Plus, Tag, Trash2 } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"
import { cn } from "@/registry/new-york-v4/lib/utils"
import type { OperatorPromotionLabel } from "@/lib/operator-studio/promotion-labels"

const COLOR_OPTIONS: Array<{ value: string; dot: string; ring: string }> = [
  { value: "emerald", dot: "bg-emerald-500", ring: "ring-emerald-500/40" },
  { value: "amber", dot: "bg-amber-500", ring: "ring-amber-500/40" },
  { value: "rose", dot: "bg-rose-500", ring: "ring-rose-500/40" },
  { value: "sky", dot: "bg-sky-500", ring: "ring-sky-500/40" },
  { value: "violet", dot: "bg-violet-500", ring: "ring-violet-500/40" },
  { value: "slate", dot: "bg-slate-500", ring: "ring-slate-500/40" },
]

interface FormState {
  label: string
  aiContext: string
  color: string
}

const BLANK: FormState = { label: "", aiContext: "", color: "emerald" }

export function PromotionLabelsPanel() {
  const [labels, setLabels] = React.useState<OperatorPromotionLabel[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<FormState>(BLANK)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(
        "/api/operator-studio/promotion-labels?includeArchived=1",
        { cache: "no-store" }
      )
      if (!r.ok) throw new Error("Failed to load labels")
      const data = (await r.json()) as { labels: OperatorPromotionLabel[] }
      setLabels(data.labels ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function startEdit(l: OperatorPromotionLabel) {
    setEditingId(l.id)
    setForm({
      label: l.label,
      aiContext: l.aiContext,
      color: l.color ?? "emerald",
    })
  }

  function startCreate() {
    setEditingId(null)
    setForm(BLANK)
  }

  async function save() {
    if (!form.label.trim()) {
      setError("Label name required.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const url = editingId
        ? `/api/operator-studio/promotion-labels/${encodeURIComponent(editingId)}`
        : "/api/operator-studio/promotion-labels"
      const r = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label.trim(),
          aiContext: form.aiContext,
          color: form.color,
        }),
      })
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? "Save failed")
      }
      setForm(BLANK)
      setEditingId(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function setArchived(l: OperatorPromotionLabel, archived: boolean) {
    setError(null)
    try {
      const r = await fetch(
        `/api/operator-studio/promotion-labels/${encodeURIComponent(l.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        }
      )
      if (!r.ok) throw new Error("Failed to update")
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function deleteLabel(l: OperatorPromotionLabel) {
    if (
      !confirm(
        `Delete "${l.label}" permanently? Any historical passages keep their highlight but lose this label.`
      )
    )
      return
    setError(null)
    try {
      const r = await fetch(
        `/api/operator-studio/promotion-labels/${encodeURIComponent(l.id)}`,
        { method: "DELETE" }
      )
      if (!r.ok) throw new Error("Delete failed")
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const active = labels.filter((l) => !l.archivedAt)
  const archived = labels.filter((l) => l.archivedAt)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Promotion labels</h2>
        <p className="text-sm text-muted-foreground">
          Define the named flags an operator picks when promoting a
          highlighted passage. Each label carries an AI-readable
          definition — the agent reads it alongside the elevated text so
          the label means something downstream (Wayseer prompts, KB
          generation, MCP tools).
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Form */}
      <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {editingId ? "Edit label" : "New label"}
          </h3>
          {editingId && (
            <Button size="sm" variant="ghost" onClick={startCreate}>
              Cancel edit
            </Button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Label name
            </label>
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Decision"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              AI context — what this label means
            </label>
            <Textarea
              value={form.aiContext}
              onChange={(e) =>
                setForm({ ...form, aiContext: e.target.value })
              }
              rows={3}
              placeholder="e.g. The operator is committing to this approach. Treat the highlighted text as a directive — downstream prompts should weight it as authoritative."
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setForm({ ...form, color: c.value })}
                aria-label={`${c.value} color`}
                aria-pressed={form.color === c.value}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border transition-all",
                  c.dot,
                  form.color === c.value
                    ? `ring-2 ring-offset-2 ring-offset-background ${c.ring}`
                    : "opacity-70 hover:opacity-100"
                )}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editingId ? "Save changes" : "Create label"}
          </Button>
        </div>
      </div>

      {/* Active list */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Active ({active.length})
        </h3>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : active.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground">
            No labels yet. Create one above to give Highlight + Promote a
            taxonomy.
          </div>
        ) : (
          <ul className="space-y-2">
            {active.map((l) => (
              <LabelRow
                key={l.id}
                label={l}
                editing={editingId === l.id}
                onEdit={() => startEdit(l)}
                onArchive={() => void setArchived(l, true)}
                onDelete={() => void deleteLabel(l)}
              />
            ))}
          </ul>
        )}
      </div>

      {archived.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Archived ({archived.length})
          </h3>
          <ul className="space-y-2">
            {archived.map((l) => (
              <LabelRow
                key={l.id}
                label={l}
                editing={false}
                onEdit={() => startEdit(l)}
                onArchive={() => void setArchived(l, false)}
                onDelete={() => void deleteLabel(l)}
                archivedView
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function LabelRow({
  label,
  editing,
  onEdit,
  onArchive,
  onDelete,
  archivedView = false,
}: {
  label: OperatorPromotionLabel
  editing: boolean
  onEdit: () => void
  onArchive: () => void
  onDelete: () => void
  archivedView?: boolean
}) {
  const dot =
    COLOR_OPTIONS.find((c) => c.value === label.color)?.dot ??
    "bg-muted-foreground"
  return (
    <li
      className={cn(
        "rounded-lg border bg-background p-3 transition-colors",
        editing && "ring-2 ring-emerald-500/40",
        archivedView && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn("mt-1 h-3 w-3 shrink-0 rounded-full", dot)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm font-semibold">{label.label}</span>
            {archivedView && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                archived
              </span>
            )}
          </div>
          {label.aiContext && (
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
              {label.aiContext}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={onArchive}>
            {archivedView ? "Unarchive" : "Archive"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-rose-600 hover:text-rose-700"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </li>
  )
}
