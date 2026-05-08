/**
 * GET /api/operator-studio/agents/:id/stream
 *
 * Server-Sent Events feed of snapshot updates for one agent. Replaces
 * the per-pane polling loop in Bento.
 *
 *   event: snapshot
 *   data: { ...AgentSnapshot }
 *
 * Implementation: server-side polls the same snapshot pipeline used by
 * the GET .../snapshot route on a fast cadence, dedupes by a small
 * fingerprint, and emits only when the snapshot actually changed. Both
 * tmux and JSONL agents share this path so the client only knows about
 * one event type.
 *
 * Cadence:
 *   - Live (streaming/thinking/tool-running) → 500ms
 *   - Idle                                   → 3000ms
 *
 * A heartbeat comment is emitted every 15s so intermediate proxies and
 * the browser keep the connection alive when nothing is changing.
 */

import type { NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { captureTmuxPane } from "@/lib/server/agent-bridge/tmux"
import { getAppSessionTail } from "@/lib/server/agent-bridge/app-sessions"
import { isValidJsonlId, isValidSessionName } from "@/lib/server/agent-bridge/exec"
import { parseAgentId } from "@/lib/server/agent-bridge/types"
import type { AgentSnapshot } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

const LIVE_INTERVAL_MS = 500
const IDLE_INTERVAL_MS = 3000
const HEARTBEAT_MS = 15_000

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }
  const { id } = await ctx.params
  const parsed = parseAgentId(decodeURIComponent(id))
  if (parsed.kind === null) {
    return new Response(JSON.stringify({ error: parsed.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (parsed.kind === "tmux" && !isValidSessionName(parsed.ref)) {
    return new Response(JSON.stringify({ error: "Invalid tmux session name" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (parsed.kind !== "tmux" && !isValidJsonlId(parsed.ref)) {
    return new Response(JSON.stringify({ error: "Invalid session id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const linesRaw = Number(req.nextUrl.searchParams.get("lines") ?? 40)
  const lines = Math.max(4, Math.min(2000, linesRaw || 40))

  // Narrow once so the closure below sees a non-null kind.
  const kind: "tmux" | "claude" | "codex" = parsed.kind
  const ref: string = parsed.ref

  async function buildSnapshot(): Promise<AgentSnapshot | { error: string }> {
    if (kind === "tmux") {
      const cap = await captureTmuxPane(ref, lines)
      if ("error" in cap) return { error: cap.error }
      const trimmed = cap.content.split("\n").slice(-lines).join("\n")
      return {
        id: `tmux:${ref}`,
        kind: "tmux",
        capturedAt: cap.capturedAt,
        status: /[#$>]\s*$/.test(trimmed.trim()) ? "idle" : "streaming",
        text: trimmed,
      }
    }
    const tail = await getAppSessionTail(kind, ref, lines)
    if ("error" in tail) return { error: tail.error }
    return {
      id: `${kind}:${ref}` as AgentSnapshot["id"],
      kind,
      capturedAt: new Date().toISOString(),
      status: tail.status,
      turns: tail.turns,
      fileMtime: tail.fileMtime,
      pendingBytes: tail.pendingBytes,
    }
  }

  // Fingerprint = cheap hash of the content that actually drives the UI.
  // For JSONL: per-turn role + part kinds + text/summary lengths. For
  // tmux: the trailing 4 KB of the captured pane.
  function fingerprint(snap: AgentSnapshot): string {
    if (snap.kind === "tmux") {
      const t = snap.text ?? ""
      return `tmux:${t.length}:${t.slice(-4096)}`
    }
    const turns = snap.turns ?? []
    const sig = turns
      .map((tn) => {
        const parts = tn.parts
          .map((p) => {
            if (p.kind === "text") return `t${p.text.length}`
            if (p.kind === "thinking") return `h${p.text.length}`
            if (p.kind === "tool_use") return `u${p.name}:${p.summary.length}`
            if (p.kind === "tool_result") return `r${p.summary.length}`
            return "i"
          })
          .join(",")
        return `${tn.role}|${parts}`
      })
      .join(";")
    return `${snap.status}#${snap.fileMtime ?? ""}#${snap.pendingBytes ?? 0}#${sig}`
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      let lastFp = ""
      let cancelled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let heartbeat: ReturnType<typeof setInterval> | null = null

      function write(s: string) {
        if (cancelled) return
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          /* controller closed */
        }
      }

      function emit(event: string, data: unknown) {
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      async function tick() {
        if (cancelled) return
        const snap = await buildSnapshot()
        if (cancelled) return
        let nextDelay = IDLE_INTERVAL_MS
        if ("error" in snap) {
          emit("error", { error: snap.error })
        } else {
          const fp = fingerprint(snap)
          if (fp !== lastFp) {
            lastFp = fp
            emit("snapshot", snap)
          }
          const live =
            snap.status === "streaming" ||
            snap.status === "thinking" ||
            snap.status === "tool-running"
          nextDelay = live ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS
        }
        if (!cancelled) {
          timer = setTimeout(tick, nextDelay)
        }
      }

      // Open with a hello comment so the browser sees the response
      // start immediately (helps EventSource detect connection success
      // without buffering through the dev proxy).
      write(": connected\n\n")

      heartbeat = setInterval(() => write(`: ping\n\n`), HEARTBEAT_MS)

      const onAbort = () => {
        cancelled = true
        if (timer) clearTimeout(timer)
        if (heartbeat) clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      req.signal.addEventListener("abort", onAbort)

      tick()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable nginx-style proxy buffering when behind one.
      "X-Accel-Buffering": "no",
    },
  })
}
