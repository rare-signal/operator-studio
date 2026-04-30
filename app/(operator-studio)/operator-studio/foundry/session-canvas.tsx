"use client"

/**
 * Session Canvas — the breathtaking hero element above the Foundry
 * KPI strip. For the current (or latest) session, render every thread
 * as a "pod" with:
 *
 *   - A visual turn-signature DNA strip showing the rhythm of the
 *     conversation (user turns vs assistant turns, length-weighted).
 *   - The four bookend messages always visible on the pod:
 *       • first prompt (from you)
 *       • first reply (from the agent)
 *       • latest prompt
 *       • latest reply
 *   - Click anywhere on the pod → open the thread.
 *   - Click a specific bookend card → deep-link to that message.
 *
 * Visual language departs from the rest of Foundry deliberately:
 * glass-morphism, gradient accent per source, animated ambient glow.
 * The rest of Foundry is intelligence-grade tabular density; the
 * canvas is the emotional hit that sets the tone.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  GitFork,
  MessageCircle,
  Sparkles,
  Zap,
} from "lucide-react"

import { defaultSessionLabel } from "@/lib/operator-studio/sessions"
import type { OperatorSession } from "@/lib/operator-studio/types"

// ─── Types mirrored from FoundryViewProps ──────────────────────────────────

interface CanvasThreadMeta {
  id: string
  title: string | null
  sourceApp: string
  reviewState: string
  messageCount: number
  parentThreadId: string | null
  createdAt: string
}

interface CanvasBookend {
  id: string
  content: string
  turnIndex: number
  createdAt: string
}

interface CanvasThreadData {
  threadId: string
  firstUser: CanvasBookend | null
  firstAssistant: CanvasBookend | null
  lastUser: CanvasBookend | null
  lastAssistant: CanvasBookend | null
  signature: Array<{ role: string; length: number; turnIndex: number }>
}

interface Props {
  session: OperatorSession | null
  threads: CanvasThreadMeta[]
  data: CanvasThreadData[]
}

// ─── Source palette — each source gets a signature color pair ──────────────

const SOURCE_PALETTE: Record<
  string,
  { glow: string; border: string; accent: string; label: string }
> = {
  claude: {
    glow: "from-amber-500/25 to-rose-500/10",
    border: "border-amber-500/40",
    accent: "text-amber-300",
    label: "CLAUDE",
  },
  "claude-code": {
    glow: "from-amber-500/25 to-rose-500/10",
    border: "border-amber-500/40",
    accent: "text-amber-300",
    label: "CLAUDE CODE",
  },
  opencode: {
    glow: "from-violet-500/25 to-indigo-500/10",
    border: "border-violet-500/40",
    accent: "text-violet-300",
    label: "OPENCODE",
  },
  codex: {
    glow: "from-cyan-500/25 to-sky-500/10",
    border: "border-cyan-500/40",
    accent: "text-cyan-300",
    label: "CODEX",
  },
  chatgpt: {
    glow: "from-emerald-500/25 to-teal-500/10",
    border: "border-emerald-500/40",
    accent: "text-emerald-300",
    label: "CHATGPT",
  },
  gemini: {
    glow: "from-violet-500/25 to-fuchsia-500/10",
    border: "border-violet-500/40",
    accent: "text-violet-300",
    label: "GEMINI",
  },
  manual: {
    glow: "from-zinc-500/15 to-zinc-400/5",
    border: "border-zinc-500/40",
    accent: "text-zinc-300",
    label: "MANUAL",
  },
}

function paletteFor(src: string) {
  return SOURCE_PALETTE[src] ?? SOURCE_PALETTE.manual
}

// ─── Main ──────────────────────────────────────────────────────────────────

export function SessionCanvas({ session, threads, data }: Props) {
  const router = useRouter()
  if (!session || threads.length === 0) return null

  const dataById = React.useMemo(() => {
    const m = new Map<string, CanvasThreadData>()
    for (const d of data) m.set(d.threadId, d)
    return m
  }, [data])

  const label =
    session.label ??
    defaultSessionLabel(
      new Date(session.startedAt),
      new Date(session.endedAt)
    )
  const isLive =
    new Date(session.endedAt).getTime() >= Date.now() - 3 * 60 * 60 * 1000

  return (
    <section
      className="relative overflow-hidden rounded-sm border border-zinc-800/80"
      style={{
        // Layered background: deep black, two radial glows, faint grid.
        backgroundImage: [
          "radial-gradient(ellipse 600px 300px at 15% 10%, rgba(245, 158, 11, 0.08), transparent 60%)",
          "radial-gradient(ellipse 500px 300px at 85% 100%, rgba(6, 182, 212, 0.08), transparent 60%)",
          "linear-gradient(to bottom, #0a0b10 0%, #08090c 100%)",
        ].join(","),
      }}
    >
      {/* faint grid lines */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: [
            "linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px)",
            "linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)",
          ].join(","),
          backgroundSize: "24px 24px",
        }}
      />

      <header className="relative flex items-center justify-between border-b border-zinc-800/60 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-sm bg-zinc-900/80 px-2 py-1 ring-1 ring-zinc-800">
            <Sparkles className="h-3 w-3 text-amber-400" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-zinc-400">
              active canvas
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-wide text-zinc-100 font-sans">
                {label}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/40">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  live
                </span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-600">
              {threads.length} thread{threads.length === 1 ? "" : "s"} · click
              any card to drill in
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            router.push(`/operator-studio/sessions/${session.id}`)
          }
          className="rounded-sm border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 text-[10px] uppercase tracking-widest text-zinc-300 transition-colors hover:border-amber-500/40 hover:bg-zinc-800/80 hover:text-amber-300"
        >
          open session →
        </button>
      </header>

      <div
        className="relative grid gap-3 p-3"
        style={{
          gridTemplateColumns:
            threads.length === 1
              ? "minmax(0, 1fr)"
              : threads.length === 2
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(auto-fill, minmax(380px, 1fr))",
        }}
      >
        {threads.map((t) => (
          <ThreadPod
            key={t.id}
            meta={t}
            data={dataById.get(t.id) ?? null}
            onOpen={() => router.push(`/operator-studio/threads/${t.id}`)}
            onOpenMessage={(msgId) =>
              router.push(`/operator-studio/threads/${t.id}#msg-${msgId}`)
            }
          />
        ))}
      </div>
    </section>
  )
}

// ─── Pod ───────────────────────────────────────────────────────────────────

function ThreadPod({
  meta,
  data,
  onOpen,
  onOpenMessage,
}: {
  meta: CanvasThreadMeta
  data: CanvasThreadData | null
  onOpen: () => void
  onOpenMessage: (messageId: string) => void
}) {
  const pal = paletteFor(meta.sourceApp)

  return (
    <div
      className={`group relative overflow-hidden rounded-sm border ${pal.border} bg-zinc-950/60 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/40`}
    >
      {/* gradient glow */}
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${pal.glow} opacity-60 transition-opacity group-hover:opacity-100`}
      />
      {/* corner beam */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/5 blur-3xl" />

      <div className="relative flex flex-col">
        {/* ── Pod header ── */}
        <button
          onClick={onOpen}
          className="flex items-start justify-between gap-2 border-b border-zinc-800/60 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[9px] font-semibold uppercase tracking-[0.25em] ${pal.accent}`}
              >
                {pal.label}
              </span>
              {meta.parentThreadId && (
                <span className="inline-flex items-center gap-0.5 rounded-sm bg-zinc-800/80 px-1 py-px text-[8px] uppercase tracking-widest text-zinc-400">
                  <GitFork className="h-2 w-2" />
                  fork
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-[9px] uppercase tracking-widest text-zinc-600">
                <MessageCircle className="h-2.5 w-2.5" />
                {meta.messageCount.toLocaleString()}
              </span>
            </div>
            <h3 className="mt-1 truncate text-sm font-semibold text-zinc-100 font-sans">
              {meta.title ?? "Untitled thread"}
            </h3>
          </div>
        </button>

        {/* ── DNA strip ── */}
        {data && data.signature.length > 0 && (
          <SignatureStrip signature={data.signature} accent={pal.accent} />
        )}

        {/* ── Bookends ── */}
        <div className="grid grid-cols-1 gap-0 sm:grid-cols-2">
          <div className="border-r border-zinc-800/60">
            <BookendTile
              label="first prompt"
              role="user"
              bookend={data?.firstUser ?? null}
              onOpen={onOpenMessage}
            />
            <div className="border-t border-zinc-800/60">
              <BookendTile
                label="first reply"
                role="assistant"
                bookend={data?.firstAssistant ?? null}
                onOpen={onOpenMessage}
              />
            </div>
          </div>
          <div>
            <BookendTile
              label="latest prompt"
              role="user"
              bookend={data?.lastUser ?? null}
              onOpen={onOpenMessage}
              showTurnBadge
            />
            <div className="border-t border-zinc-800/60">
              <BookendTile
                label="latest reply"
                role="assistant"
                bookend={data?.lastAssistant ?? null}
                onOpen={onOpenMessage}
                showTurnBadge
              />
            </div>
          </div>
        </div>

        {/* ── Open CTA ── */}
        <button
          onClick={onOpen}
          className="flex items-center justify-center gap-1.5 border-t border-zinc-800/60 bg-zinc-950/40 px-3 py-1.5 text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-900/60 hover:text-zinc-200"
        >
          <Zap className="h-3 w-3" />
          enter thread
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Signature DNA strip ───────────────────────────────────────────────────

function SignatureStrip({
  signature,
  accent,
}: {
  signature: Array<{ role: string; length: number; turnIndex: number }>
  accent: string
}) {
  // Normalize: max 120 bars, length on a log scale for visual sanity.
  // (A 20k-char monologue next to a 30-char "ok" message shouldn't eat
  // the whole strip.)
  const MAX_BARS = 120
  const bars = React.useMemo(() => {
    if (signature.length <= MAX_BARS) return signature
    // Downsample by taking every Nth.
    const step = signature.length / MAX_BARS
    const out: typeof signature = []
    for (let i = 0; i < MAX_BARS; i++) {
      out.push(signature[Math.floor(i * step)])
    }
    return out
  }, [signature])

  const max = Math.max(...bars.map((b) => Math.log2((b.length || 1) + 1)))

  return (
    <div
      className="relative border-b border-zinc-800/60 px-3 py-2"
      title={`${signature.length} turns — conversation DNA`}
    >
      <div className="flex items-end gap-[2px] h-9">
        {bars.map((b, i) => {
          const mag = Math.log2((b.length || 1) + 1)
          const h = max > 0 ? Math.max(3, (mag / max) * 32) : 3
          const isUser = b.role === "user"
          return (
            <div
              key={`${b.turnIndex}-${i}`}
              className={`w-full rounded-[1px] transition-opacity ${
                isUser ? "bg-cyan-400/80" : "bg-amber-400/80"
              } opacity-70 group-hover:opacity-100`}
              style={{ height: `${h}px` }}
            />
          )
        })}
      </div>
      <div
        className={`mt-1 flex items-center justify-between text-[8px] uppercase tracking-widest text-zinc-600`}
      >
        <span>
          <span className="text-cyan-400">●</span> you
        </span>
        <span className={accent}>dna · {signature.length} turns</span>
        <span>
          <span className="text-amber-400">●</span> agent
        </span>
      </div>
    </div>
  )
}

// ─── Bookend tile ──────────────────────────────────────────────────────────

function BookendTile({
  label,
  role,
  bookend,
  onOpen,
  showTurnBadge,
}: {
  label: string
  role: "user" | "assistant"
  bookend: CanvasBookend | null
  onOpen: (messageId: string) => void
  showTurnBadge?: boolean
}) {
  const isUser = role === "user"
  const accentColor = isUser ? "bg-cyan-400" : "bg-amber-400"
  const textAccent = isUser ? "text-cyan-300/90" : "text-amber-300/90"

  if (!bookend) {
    return (
      <div className="px-3 py-2.5">
        <div
          className={`flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-zinc-600`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${accentColor} opacity-40`} />
          {label}
        </div>
        <p className="mt-1 text-[11px] italic text-zinc-700 font-sans">
          no {role} turn yet
        </p>
      </div>
    )
  }

  // Smart excerpt: strip leading markdown header, then truncate.
  const excerpt = React.useMemo(() => {
    const stripped = bookend.content
      .replace(/^#+\s[^\n]*\n+/, "")
      .replace(/^```[\s\S]*?```\n*/, "")
      .trim()
    const MAX = 180
    if (stripped.length <= MAX) return stripped
    const cut = stripped.slice(0, MAX)
    const lastBreak = Math.max(
      cut.lastIndexOf(". "),
      cut.lastIndexOf("? "),
      cut.lastIndexOf("! "),
      cut.lastIndexOf("\n")
    )
    if (lastBreak > MAX * 0.5) return cut.slice(0, lastBreak + 1).trim() + "…"
    const lastSpace = cut.lastIndexOf(" ")
    return cut.slice(0, lastSpace > 0 ? lastSpace : MAX).trim() + "…"
  }, [bookend.content])

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onOpen(bookend.id)
      }}
      className="group/tile block w-full px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
    >
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-zinc-500">
        <span className={`h-1.5 w-1.5 rounded-full ${accentColor}`} />
        <span className={textAccent}>{label}</span>
        {showTurnBadge && (
          <span className="ml-auto text-zinc-600 tabular-nums">
            turn {bookend.turnIndex + 1}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11.5px] leading-[1.5] text-zinc-200 font-sans line-clamp-4 whitespace-pre-wrap">
        {excerpt}
      </p>
    </button>
  )
}
