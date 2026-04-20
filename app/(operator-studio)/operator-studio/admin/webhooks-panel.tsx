"use client"

import * as React from "react"
import { Pause, Play, Trash2, Webhook } from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import type { WebhookSubRow } from "@/lib/operator-studio/webhook-subscriptions"
import type { WorkspaceSummary } from "@/app/components/workspace-switcher"

interface WebhooksPanelProps {
  activeWorkspace: WorkspaceSummary
}

interface ApiError {
  error: string
  issues?: Array<{ path?: (string | number)[]; message: string }>
}

const SUPPORTED_EVENTS = [
  "thread.imported",
  "thread.promoted",
  "thread.archived",
  "message.promoted",
]

const EXAMPLE_PAYLOAD = `{
  "event": "thread.promoted",
  "workspaceId": "global",
  "timestamp": "2026-04-20T12:00:00.000Z",
  "threadId": "thread-abc",
  "title": "fix sidebar layout bug",
  "promotedBy": "dlc",
  "summary": "…",
  "tags": ["design", "bug"],
  "projectSlug": "studio"
}`

const DELIVERY_HEADERS = `POST <your-url>
Content-Type: application/json
X-OperatorStudio-Event: thread.promoted
X-OperatorStudio-Delivery: <uuid>
X-OperatorStudio-Timestamp: 2026-04-20T12:00:00.000Z
X-OperatorStudio-Signature: sha256=<hmac-of-body-with-your-secret>`

export function WebhooksPanel({ activeWorkspace }: WebhooksPanelProps) {
  const [subs, setSubs] = React.useState<WebhookSubRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [listError, setListError] = React.useState<string | null>(null)

  const [label, setLabel] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [secret, setSecret] = React.useState("")
  const [events, setEvents] = React.useState("")

  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<ApiError | null>(null)

  const [actionError, setActionError] = React.useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  )

  const reload = React.useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res = await fetch("/api/operator-studio/webhooks", {
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) {
        setListError(data?.error ?? `Failed with status ${res.status}`)
        return
      }
      setSubs(data.subscriptions ?? [])
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      const body: Record<string, string> = {
        label: label.trim(),
        url: url.trim(),
      }
      if (secret.trim()) body.secret = secret.trim()
      if (events.trim()) body.events = events.trim()

      const res = await fetch("/api/operator-studio/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data ?? { error: `Failed with status ${res.status}` })
        return
      }
      setLabel("")
      setUrl("")
      setSecret("")
      setEvents("")
      await reload()
    } catch (err) {
      setCreateError({
        error: err instanceof Error ? err.message : "Network error",
      })
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (id: string, disabled: boolean) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/operator-studio/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setActionError(data?.error ?? `Failed with status ${res.status}`)
        return
      }
      await reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Network error")
    }
  }

  const handleDelete = async (id: string) => {
    setActionError(null)
    try {
      const res = await fetch(`/api/operator-studio/webhooks/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setActionError(data?.error ?? `Failed with status ${res.status}`)
        return
      }
      setConfirmDeleteId(null)
      await reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Network error")
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Webhook className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight">
            Subscribe a webhook
          </h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Webhooks fire on thread and message lifecycle events in the{" "}
          <strong>{activeWorkspace.label}</strong> workspace. Deliveries are
          fire-and-forget with a 10 second timeout; last status is recorded
          on each subscription.
        </p>

        <form
          onSubmit={handleCreate}
          className="grid gap-4 rounded-lg border p-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="webhook-label">Label</Label>
            <Input
              id="webhook-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Slack #agent-activity"
              required
              disabled={creating}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="webhook-url">URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/operator-studio"
              required
              disabled={creating}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="webhook-secret">Secret (optional)</Label>
            <Input
              id="webhook-secret"
              type="text"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="HMAC signing key"
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">
              If provided, every delivery is signed with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                X-OperatorStudio-Signature: sha256=…
              </code>{" "}
              over the raw body.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="webhook-events">Events (optional)</Label>
            <Input
              id="webhook-events"
              value={events}
              onChange={(e) => setEvents(e.target.value)}
              placeholder="thread.promoted,thread.imported"
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated. Leave blank to receive every event. Supported:{" "}
              {SUPPORTED_EVENTS.map((e, i) => (
                <React.Fragment key={e}>
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {e}
                  </code>
                  {i < SUPPORTED_EVENTS.length - 1 ? ", " : ""}
                </React.Fragment>
              ))}
              .
            </p>
          </div>

          {createError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
              <p className="font-medium">{createError.error}</p>
              {createError.issues && createError.issues.length > 0 && (
                <ul className="mt-1 ml-5 list-disc text-xs text-foreground/80">
                  {createError.issues.map((i, idx) => (
                    <li key={idx}>
                      {i.path?.join(".") || "field"}: {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create subscription"}
            </Button>
          </div>
        </form>
      </section>

      <Separator />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Active subscriptions
          </h2>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void reload()}
          >
            Refresh
          </Button>
        </div>

        {listError && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {listError}
          </div>
        )}

        {actionError && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {actionError}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">
            Loading subscriptions…
          </p>
        ) : subs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No subscriptions in this workspace yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Label</th>
                  <th className="px-3 py-2 text-left font-medium">URL</th>
                  <th className="px-3 py-2 text-left font-medium">Events</th>
                  <th className="px-3 py-2 text-left font-medium">Secret</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Created by
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Last delivered
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Last status
                  </th>
                  <th className="px-3 py-2 text-left font-medium">State</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const disabled = !!s.disabledAt
                  return (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2 text-foreground">{s.label}</td>
                      <td className="px-3 py-2">
                        <span className="block max-w-[240px] truncate font-mono text-xs text-foreground/80">
                          {s.url}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground/80">
                        {s.events ? s.events : "all"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {s.hasSecret ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {s.createdBy}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {s.lastDeliveredAt
                          ? formatDate(s.lastDeliveredAt)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusCell status={s.lastStatus} />
                      </td>
                      <td className="px-3 py-2">
                        {disabled ? (
                          <Badge variant="secondary">Paused</Badge>
                        ) : (
                          <Badge variant="default">Enabled</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {disabled ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleToggle(s.id, false)}
                            >
                              <Play className="mr-1.5 h-3.5 w-3.5" />
                              Resume
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleToggle(s.id, true)}
                            >
                              <Pause className="mr-1.5 h-3.5 w-3.5" />
                              Pause
                            </Button>
                          )}
                          {confirmDeleteId === s.id ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => void handleDelete(s.id)}
                              >
                                Confirm
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDeleteId(s.id)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Separator />

      <section>
        <h2 className="mb-3 text-xl font-semibold tracking-tight">
          Delivery format
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Each event is POSTed as JSON. If the subscription has a secret,
          every delivery is signed with an HMAC-SHA256 header so the
          receiver can verify it came from Operator Studio.
        </p>

        <div className="mb-6">
          <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            Request headers
          </Label>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-foreground/80">
            {DELIVERY_HEADERS}
          </pre>
        </div>

        <div>
          <Label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            Example payload (thread.promoted)
          </Label>
          <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs text-foreground/80">
            {EXAMPLE_PAYLOAD}
          </pre>
        </div>
      </section>
    </div>
  )
}

function StatusCell({ status }: { status: number | null }) {
  if (status === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  let cls = "text-foreground"
  if (status >= 200 && status < 300) cls = "text-emerald-600 dark:text-emerald-400"
  else if (status >= 300 && status < 400)
    cls = "text-amber-600 dark:text-amber-400"
  else cls = "text-red-600 dark:text-red-400"
  return (
    <span className={`font-mono text-xs font-medium ${cls}`}>{status}</span>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}
