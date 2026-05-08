"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import type { OutboxRow } from "@/lib/operator-studio/outbox"

interface Props {
  initialRow: OutboxRow
  initialPayloadHash: string
}

export function OutboxRowClient({ initialRow, initialPayloadHash }: Props) {
  const router = useRouter()
  const [row, setRow] = React.useState<OutboxRow>(initialRow)
  const [payloadHash, setPayloadHash] =
    React.useState<string>(initialPayloadHash)
  const [editing, setEditing] = React.useState<boolean>(false)
  const [renderedText, setRenderedText] = React.useState<string>(
    initialRow.renderedText
  )
  const [pin, setPin] = React.useState<string>("")
  const [busy, setBusy] = React.useState<null | "save" | "approve" | "reject">(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [flash, setFlash] = React.useState<string | null>(null)

  const isTerminal = row.state === "sent" || row.state === "rejected"

  async function saveEdit() {
    setBusy("save")
    setError(null)
    try {
      // Edits update both the rendered text (for proofread) AND the
      // payload.text the writer will actually send. The two diverging
      // would defeat the proofread, so the simple form keeps them in
      // lockstep for ado.addComment.
      const nextPayload = { ...row.payload, text: renderedText }
      const r = await fetch(`/api/operator-studio/outbox/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          renderedText,
          payload: nextPayload,
          editedBy: "operator",
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? "edit failed")
      setRow(data.item)
      setPayloadHash(data.payloadHash)
      setEditing(false)
      setFlash("Edits saved. Approval cleared — re-approve to send.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function approveAndSend() {
    setBusy("approve")
    setError(null)
    setFlash(null)
    try {
      const r = await fetch(`/api/operator-studio/outbox/${row.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) {
        throw new Error(data?.error ?? "approval failed")
      }
      setFlash("Sent.")
      setPin("")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    setBusy("reject")
    setError(null)
    try {
      const reason = window.prompt("Reason for rejecting (optional):") ?? undefined
      const r = await fetch(`/api/operator-studio/outbox/${row.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error ?? "reject failed")
      setRow(data.item)
      setFlash("Rejected.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <Link
        href="/operator-studio/outbox"
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        ← Outbox
      </Link>
      <header className="mt-2 mb-5">
        <h1 className="text-[16px] font-medium tracking-tight">
          {row.targetLabel ?? row.targetId}
        </h1>
        <p className="mt-0.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {row.surface} · {row.action} · {row.state}
        </p>
      </header>

      {flash && (
        <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-400">
          {flash}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <section className="mb-5 rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Rendered text — what gets sent
          </span>
          {!isTerminal &&
            (editing ? (
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy === "save"}
                className="rounded border bg-background px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
              >
                {busy === "save" ? "Saving…" : "Save edit"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded border bg-background px-2 py-1 text-[11px] hover:bg-muted"
              >
                Edit
              </button>
            ))}
        </div>
        <div className="px-4 py-3">
          {editing ? (
            <textarea
              value={renderedText}
              onChange={(e) => setRenderedText(e.target.value)}
              rows={Math.max(6, renderedText.split("\n").length)}
              className="w-full rounded border bg-background px-2 py-1.5 font-mono text-[13px] resize-vertical"
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {row.renderedText}
            </pre>
          )}
        </div>
      </section>

      <dl className="mb-6 grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        <dt className="text-muted-foreground">Surface</dt>
        <dd>{row.surface}</dd>
        <dt className="text-muted-foreground">Action</dt>
        <dd className="font-mono">{row.action}</dd>
        <dt className="text-muted-foreground">Target</dt>
        <dd>{row.targetLabel ?? row.targetId}</dd>
        {row.audience.length > 0 && (
          <>
            <dt className="text-muted-foreground">Audience</dt>
            <dd>{row.audience.join(", ")}</dd>
          </>
        )}
        {row.rationale && (
          <>
            <dt className="text-muted-foreground">Rationale</dt>
            <dd className="italic">{row.rationale}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Payload hash</dt>
        <dd className="font-mono text-[11px] break-all">{payloadHash}</dd>
        <dt className="text-muted-foreground">Proposed</dt>
        <dd title={row.proposedAt}>{new Date(row.proposedAt).toLocaleString()}</dd>
        {row.sentAt && (
          <>
            <dt className="text-muted-foreground">Sent</dt>
            <dd title={row.sentAt}>{new Date(row.sentAt).toLocaleString()}</dd>
          </>
        )}
        {row.sendError && (
          <>
            <dt className="text-muted-foreground">Send error</dt>
            <dd className="text-red-600 dark:text-red-400">{row.sendError}</dd>
          </>
        )}
      </dl>

      {!isTerminal && !editing && (
        <section className="rounded-lg border bg-card">
          <div className="border-b px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Approve + send
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              className="rounded border bg-background px-2 py-1 text-[13px] w-24"
              aria-label="Outbound PIN"
            />
            <button
              type="button"
              onClick={approveAndSend}
              disabled={busy === "approve" || !pin.trim()}
              className="rounded border border-emerald-600/60 bg-emerald-600/10 px-3 py-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/20 disabled:opacity-50"
            >
              {busy === "approve" ? "Sending…" : "Approve + send"}
            </button>
            <button
              type="button"
              onClick={reject}
              disabled={busy === "reject"}
              className="rounded border px-3 py-1 text-[12px] hover:bg-muted disabled:opacity-50"
            >
              Reject
            </button>
            <span className="ml-auto text-[10px] text-muted-foreground">
              Approval is single-use. Edits clear it.
            </span>
          </div>
        </section>
      )}
    </div>
  )
}
