"use client"

import * as React from "react"
import { AlertTriangle, Check, Copy, KeyRound, Trash2 } from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card, CardContent } from "@/registry/new-york-v4/ui/card"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import type {
  ApiTokenRow,
  CreatedToken,
} from "@/lib/operator-studio/tokens"
import type { WorkspaceSummary } from "@/app/components/workspace-switcher"

interface TokensPanelProps {
  workspaces: WorkspaceSummary[]
}

interface ApiError {
  error: string
  issues?: Array<{ path?: (string | number)[]; message: string }>
}

const ANY_WORKSPACE = "__any__"

export function TokensPanel({ workspaces }: TokensPanelProps) {
  const [tokens, setTokens] = React.useState<ApiTokenRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [listError, setListError] = React.useState<string | null>(null)

  const [label, setLabel] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [workspaceId, setWorkspaceId] = React.useState<string>(ANY_WORKSPACE)
  const [apiWorkspaces, setApiWorkspaces] =
    React.useState<WorkspaceSummary[]>(workspaces)

  const [creating, setCreating] = React.useState(false)
  const [createError, setCreateError] = React.useState<ApiError | null>(null)
  const [newToken, setNewToken] = React.useState<CreatedToken | null>(null)
  const [copied, setCopied] = React.useState(false)

  const [confirmRevokeId, setConfirmRevokeId] = React.useState<string | null>(
    null
  )
  const [revokeError, setRevokeError] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res = await fetch("/api/operator-studio/tokens", {
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) {
        setListError(data?.error ?? `Failed with status ${res.status}`)
        return
      }
      setTokens(data.tokens ?? [])
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Network error")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  // Populate reviewer as default display name.
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const stored = localStorage.getItem("operator_studio_reviewer")
    if (stored) setDisplayName(stored)
  }, [])

  // Fetch current workspaces list via API (fallback to SSR-provided list).
  React.useEffect(() => {
    fetch("/api/workspaces", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.workspaces)) {
          setApiWorkspaces(data.workspaces)
        }
      })
      .catch(() => {})
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError(null)
    setNewToken(null)
    setCreating(true)
    try {
      const body = {
        label: label.trim(),
        displayName: displayName.trim(),
        workspaceId:
          workspaceId === ANY_WORKSPACE ? null : workspaceId,
      }
      const res = await fetch("/api/operator-studio/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data ?? { error: `Failed with status ${res.status}` })
        return
      }
      setNewToken(data.token as CreatedToken)
      setLabel("")
      await reload()
    } catch (err) {
      setCreateError({
        error: err instanceof Error ? err.message : "Network error",
      })
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (id: string) => {
    setRevokeError(null)
    try {
      const res = await fetch(`/api/operator-studio/tokens/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setRevokeError(data?.error ?? `Failed with status ${res.status}`)
        return
      }
      setConfirmRevokeId(null)
      await reload()
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Network error")
    }
  }

  const handleCopy = async () => {
    if (!newToken) return
    try {
      await navigator.clipboard.writeText(newToken.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const curlExample = newToken
    ? `curl -X POST "$OPERATOR_STUDIO_URL/api/operator-studio/ingest?title=test" \\
     -H "Authorization: Bearer ${newToken.token}" \\
     -H "Content-Type: text/plain" \\
     --data "User: hi\\n\\nAssistant: hey"`
    : ""

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold tracking-tight">
            Create a token
          </h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Tokens authenticate ingest scripts, IDE hooks, and CI jobs against
          the <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/operator-studio/ingest</code>{" "}
          endpoint. The display name becomes the attribution on anything
          imported with this token.
        </p>

        <form
          onSubmit={handleCreate}
          className="grid gap-4 rounded-lg border p-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="token-label">Label</Label>
            <Input
              id="token-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. MacBook shell hook"
              required
              disabled={creating}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="token-display-name">Display name</Label>
            <Input
              id="token-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your reviewer name"
              required
              disabled={creating}
            />
            <p className="text-xs text-muted-foreground">
              Stored with each import as the <code>importedBy</code>{" "}
              attribution.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="token-workspace">Workspace scope</Label>
            <Select
              value={workspaceId}
              onValueChange={setWorkspaceId}
              disabled={creating}
            >
              <SelectTrigger id="token-workspace" className="w-full">
                <SelectValue placeholder="Any workspace" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_WORKSPACE}>
                  Any workspace (global token)
                </SelectItem>
                {apiWorkspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A global token can act in any workspace the caller selects
              via query param or cookie. A scoped token is restricted to
              its workspace.
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

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create token"}
            </Button>
          </div>
        </form>
      </section>

      {newToken && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  Token created — copy it now
                </p>
                <p className="text-sm text-foreground/80">
                  This is the only time this token is shown — store it now.
                  Once you dismiss this card, the plaintext value cannot be
                  recovered.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Plaintext token
              </Label>
              <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                <code className="flex-1 truncate font-mono text-xs text-foreground">
                  {newToken.token}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                >
                  {copied ? (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Example
              </Label>
              <pre className="overflow-x-auto rounded-md border bg-background p-3 text-xs text-foreground/80">
                {curlExample}
              </pre>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setNewToken(null)}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">
            Existing tokens
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

        {revokeError && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {revokeError}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading tokens…</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tokens yet. Create one above.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Label</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Display name
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Prefix</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Workspace
                  </th>
                  <th className="px-3 py-2 text-left font-medium">
                    Created by
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Last used
                  </th>
                  <th className="px-3 py-2 text-right font-medium tabular-nums">
                    Uses
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const isRevoked = !!t.revokedAt
                  const rowCls = isRevoked
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                  return (
                    <tr
                      key={t.id}
                      className={`border-t ${rowCls}`}
                    >
                      <td className="px-3 py-2">{t.label}</td>
                      <td className="px-3 py-2">{t.displayName}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {t.tokenPrefix}…
                      </td>
                      <td className="px-3 py-2">
                        {t.workspaceId ? t.workspaceId : "any"}
                      </td>
                      <td className="px-3 py-2">{t.createdBy}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatDate(t.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {t.lastUsedAt ? formatDate(t.lastUsedAt) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                        {t.useCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        {isRevoked ? (
                          <Badge variant="secondary">Revoked</Badge>
                        ) : (
                          <Badge variant="default">Active</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!isRevoked &&
                          (confirmRevokeId === t.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => void handleRevoke(t.id)}
                              >
                                Confirm
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmRevokeId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmRevokeId(t.id)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Revoke
                            </Button>
                          ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
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
