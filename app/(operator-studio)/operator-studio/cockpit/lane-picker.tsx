"use client"

/**
 * Lane entry view — the cockpit's primary entry experience.
 *
 * On cold reload (no localStorage hint, new device, cache clear, ngrok
 * vs LAN), this is what David sees first. It is NOT a chip strip — it
 * is the full-screen entry list. From here he taps an existing lane to
 * jump in OR taps "Create new lane" to start a fresh one. The default
 * lane (if backfilled by migration) shows like any other row; there is
 * no auto-route into it.
 *
 * Per-lane rows surface at-a-glance metadata served by the
 * /api/operator-studio/work-lanes GET endpoint:
 *   - exec label + last activity + liveness (or "no exec set")
 *   - live worker count
 *   - ready-for-review count (needs David's eyes)
 *
 * localStorage is used only as a soft "last lane I had open" hint by
 * the cockpit's parent; this view doesn't persist anything itself.
 */

import * as React from "react"
import { Plus } from "lucide-react"

export interface EnrichedWorkLanePickerLane {
  id: string
  workspaceId: string
  name: string
  description: string | null
  execAgentId: string | null
  execAgentKind: string | null
  createdAt: string
  archivedAt: string | null
  exec: {
    agentId: string
    agentKind: string
    label: string | null
    lastActivityAt: string | null
    isLive: boolean
  } | null
  liveWorkerCount: number
  readyForReviewCount: number
}

const LS_KEY_PREFIX = "operator-studio:active-lane:"

export function getStoredActiveLaneId(workspaceId: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(LS_KEY_PREFIX + workspaceId)
  } catch {
    return null
  }
}

export function setStoredActiveLaneId(
  workspaceId: string,
  laneId: string | null
): void {
  if (typeof window === "undefined") return
  try {
    if (laneId) window.localStorage.setItem(LS_KEY_PREFIX + workspaceId, laneId)
    else window.localStorage.removeItem(LS_KEY_PREFIX + workspaceId)
  } catch {
    /* ignore */
  }
}

interface LaneEntryViewProps {
  workspaceId: string
  lanes: EnrichedWorkLanePickerLane[]
  loaded: boolean
  error: string | null
  onSelect: (laneId: string) => void
  onRefresh: () => Promise<unknown>
}

export function LaneEntryView({
  workspaceId,
  lanes,
  loaded,
  error,
  onSelect,
  onRefresh,
}: LaneEntryViewProps) {
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [createError, setCreateError] = React.useState<string | null>(null)

  async function createLane(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setCreateError(null)
    try {
      const r = await fetch("/api/operator-studio/work-lanes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, name }),
      })
      if (!r.ok) {
        setCreateError(`HTTP ${r.status}`)
        return
      }
      const data = (await r.json()) as { lane?: { id: string } }
      setNewName("")
      setCreating(false)
      await onRefresh()
      if (data?.lane?.id) onSelect(data.lane.id)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "create failed")
    } finally {
      setBusy(false)
    }
  }

  const empty = loaded && lanes.length === 0

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-4 pt-5 pb-3">
        <div className="text-[14px] font-semibold text-stone-900 dark:text-stone-100">
          Work lanes
        </div>
        <div className="mt-0.5 text-[12px] text-stone-500 dark:text-stone-500">
          {empty
            ? "Start a new lane to anoint an executive and spawn workers from there."
            : "Tap a lane to jump back in, or start a new one."}
        </div>
      </div>

      <div className="px-3 pb-2">
        {creating ? (
          <form
            onSubmit={createLane}
            className="flex items-center gap-2 px-1 py-1"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Lane name (e.g. 'Customer onboarding')"
              disabled={busy}
              className="flex-1 px-3 py-2 rounded-md bg-white dark:bg-stone-900 border border-stone-300 dark:border-stone-700 text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400"
            />
            <button
              type="submit"
              disabled={busy || newName.trim().length === 0}
              className="px-3 py-2 rounded-md bg-emerald-600 text-white text-[12.5px] font-semibold disabled:opacity-40 hover:bg-emerald-700"
            >
              Create
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCreating(false)
                setNewName("")
              }}
              className="px-2 py-2 rounded-md text-[12px] text-stone-500 hover:text-stone-700"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold"
          >
            <Plus className="h-4 w-4" />
            Create new lane
          </button>
        )}
        {createError && (
          <div className="mt-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            {createError}
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          Couldn&apos;t load lanes: {error}
        </div>
      )}

      {!loaded ? (
        <div className="px-3 py-6 text-center text-[12px] text-stone-500">
          Loading lanes…
        </div>
      ) : lanes.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-stone-500">
          No lanes yet — create one to begin.
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800 border-y border-stone-200 dark:border-stone-800">
          {lanes.map((lane) => (
            <LaneRow key={lane.id} lane={lane} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </div>
  )
}

function LaneRow({
  lane,
  onSelect,
}: {
  lane: EnrichedWorkLanePickerLane
  onSelect: (laneId: string) => void
}) {
  const execLabel =
    lane.exec?.label ??
    (lane.execAgentId ? lane.execAgentId.slice(0, 24) : "no exec set")
  const isLive = lane.exec?.isLive ?? false
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(lane.id)}
        className="w-full text-left px-4 py-3 active:bg-stone-100 dark:active:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-900"
      >
        <div className="flex items-center gap-2">
          <span
            className={
              "inline-block h-1.5 w-1.5 rounded-full " +
              (lane.exec
                ? isLive
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-stone-400"
                : "bg-stone-300 dark:bg-stone-600")
            }
            aria-hidden
          />
          <span className="text-[13px] font-semibold text-stone-900 dark:text-stone-100 truncate">
            {lane.name}
          </span>
          {lane.readyForReviewCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/60 text-[9.5px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
              {lane.readyForReviewCount} needs your eyes
            </span>
          )}
          <span className="ml-auto text-[10px] text-stone-500">
            {formatRelative(lane.exec?.lastActivityAt ?? lane.createdAt)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11px] text-stone-500">
          <span className="truncate" title={lane.execAgentId ?? ""}>
            {execLabel}
          </span>
          {lane.liveWorkerCount > 0 && (
            <span>
              {lane.liveWorkerCount} worker
              {lane.liveWorkerCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {lane.description && (
          <div className="mt-1 text-[11.5px] text-stone-500 dark:text-stone-500 line-clamp-2">
            {lane.description}
          </div>
        )}
      </button>
    </li>
  )
}

function formatRelative(iso: string | null) {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const m = Math.round(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}
