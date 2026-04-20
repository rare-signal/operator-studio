"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronsUpDown, Globe, Layers, Plus } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"

export interface WorkspaceSummary {
  id: string
  label: string
  isGlobal: boolean
}

interface Props {
  active: WorkspaceSummary
  workspaces: WorkspaceSummary[]
}

export function WorkspaceSwitcher({ active, workspaces }: Props) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [newLabel, setNewLabel] = React.useState("")
  const [newId, setNewId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const switchTo = async (workspaceId: string) => {
    if (workspaceId === active.id) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Switch failed")
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed")
    } finally {
      setBusy(false)
    }
  }

  const createAndSwitch = async () => {
    const id = (newId || newLabel)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
    const label = newLabel.trim()
    if (!id || !label) {
      setError("Both id and label are required")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, label }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Create failed")
      await switchTo(data.workspace.id)
      setCreating(false)
      setNewLabel("")
      setNewId("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
              {active.isGlobal ? (
                <Globe className="h-3.5 w-3.5" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs text-muted-foreground">
                Workspace
              </span>
              <span className="truncate text-sm font-medium">
                {active.label}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Switch workspace
          </DropdownMenuLabel>
          {workspaces.map((w) => {
            const isActive = w.id === active.id
            return (
              <DropdownMenuItem
                key={w.id}
                onSelect={() => switchTo(w.id)}
                disabled={busy}
                className="gap-2"
              >
                {w.isGlobal ? (
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{w.label}</span>
                {isActive && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setCreating(true)
            }}
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Workspaces are isolated. Threads, messages, summaries, and chat
              sessions are scoped to the workspace you create them in. You can
              promote threads to the global library or pull them down later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-workspace-label" className="text-xs">
                Display name
              </Label>
              <Input
                id="new-workspace-label"
                autoFocus
                value={newLabel}
                onChange={(e) => {
                  setNewLabel(e.target.value)
                  if (!newId) {
                    const slug = e.target.value
                      .trim()
                      .toLowerCase()
                      .replace(/[^a-z0-9-]+/g, "-")
                      .replace(/^-+|-+$/g, "")
                    setNewId(slug)
                  }
                }}
                placeholder="Off-site planning Q4"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-workspace-id" className="text-xs">
                Workspace id
              </Label>
              <Input
                id="new-workspace-id"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="offsite-q4"
              />
              <p className="text-xs text-muted-foreground">
                Used internally. Lowercase, dashes only.
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreating(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={createAndSwitch} disabled={busy}>
              {busy ? "Creating…" : "Create and switch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
