"use client"

/**
 * Top-level work-lane picker for the cockpit. Mobile-first vertical
 * list of lanes for the active workspace, with "+ Create new lane".
 * Selection is purely client-side (localStorage) so switching never
 * triggers a page reload — downstream cockpit panes consume the
 * `selectedLaneId` and refetch as needed.
 */

import * as React from "react"
import { Plus } from "lucide-react"

export interface WorkLanePickerLane {
  id: string
  workspaceId: string
  name: string
  description: string | null
  execAgentId: string | null
  execAgentKind: string | null
  createdAt: string
  archivedAt: string | null
}

interface LanePickerProps {
  workspaceId: string
  selectedLaneId: string | null
  onSelect: (laneId: string) => void
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

export function LanePicker({
  workspaceId,
  selectedLaneId,
  onSelect,
}: LanePickerProps) {
  const [lanes, setLanes] = React.useState<WorkLanePickerLane[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch(
        `/api/operator-studio/work-lanes?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" }
      )
      if (!r.ok) {
        setError(`HTTP ${r.status}`)
        return
      }
      const data = (await r.json()) as { lanes?: WorkLanePickerLane[] }
      setLanes(Array.isArray(data?.lanes) ? data.lanes : [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed")
    }
  }, [workspaceId])

  React.useEffect(() => {
    refresh()
    const id = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(id)
  }, [refresh])

  // Auto-select first lane on first load if nothing selected.
  React.useEffect(() => {
    if (selectedLaneId) return
    if (lanes.length === 0) return
    onSelect(lanes[0].id)
  }, [lanes, selectedLaneId, onSelect])

  async function createLane(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const r = await fetch("/api/operator-studio/work-lanes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, name }),
      })
      if (!r.ok) {
        setError(`HTTP ${r.status}`)
        return
      }
      const data = (await r.json()) as { lane?: WorkLanePickerLane }
      if (data?.lane) {
        setNewName("")
        setCreating(false)
        await refresh()
        onSelect(data.lane.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full px-3 py-2 bg-neutral-950 border-b border-neutral-800 text-sm text-neutral-200">
      <div className="flex items-center gap-2 overflow-x-auto">
        {lanes.map((lane) => {
          const active = lane.id === selectedLaneId
          return (
            <button
              key={lane.id}
              onClick={() => onSelect(lane.id)}
              className={
                "px-3 py-1.5 rounded-full whitespace-nowrap border " +
                (active
                  ? "bg-neutral-100 text-neutral-900 border-neutral-100"
                  : "bg-neutral-900 text-neutral-200 border-neutral-700 hover:border-neutral-500")
              }
              aria-pressed={active}
            >
              {lane.name}
            </button>
          )
        })}
        <button
          onClick={() => setCreating((v) => !v)}
          className="px-3 py-1.5 rounded-full border border-dashed border-neutral-600 text-neutral-300 hover:text-neutral-100 hover:border-neutral-400 flex items-center gap-1"
          aria-label="Create new lane"
        >
          <Plus size={14} /> New lane
        </button>
      </div>
      {creating ? (
        <form onSubmit={createLane} className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Lane name"
            disabled={busy}
            className="flex-1 px-2 py-1 rounded bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder:text-neutral-500"
          />
          <button
            type="submit"
            disabled={busy || newName.trim().length === 0}
            className="px-3 py-1 rounded bg-neutral-100 text-neutral-900 disabled:opacity-40"
          >
            Create
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs text-red-400">lane picker: {error}</p>
      ) : null}
    </div>
  )
}
