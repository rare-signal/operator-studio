"use client"

import * as React from "react"
import { Sparkles, X, Check, Copy, ExternalLink } from "lucide-react"

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/registry/new-york-v4/ui/sidebar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/registry/new-york-v4/ui/dialog"
import { Button } from "@/registry/new-york-v4/ui/button"
import { cn } from "@/lib/utils"
import { useWayseer } from "./wayseer-context"

const DISMISS_KEY = "operator_studio_wayseer_cta_dismissed"

export function WayseerCta() {
  const { enabled } = useWayseer()
  const [mounted, setMounted] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1")
  }, [])

  const dismiss = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.localStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }, [])

  if (!mounted || enabled) return null

  return (
    <>
      {dismissed ? (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setOpen(true)}>
              <Sparkles className="size-4 text-violet-500" />
              <span>Activate Wayseer</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : (
        <WayseerCard onActivate={() => setOpen(true)} onDismiss={dismiss} />
      )}
      <WayseerModal open={open} onOpenChange={setOpen} />
    </>
  )
}

// ─── The big nebula card ─────────────────────────────────────────────────────

function WayseerCard({
  onActivate,
  onDismiss,
}: {
  onActivate: () => void
  onDismiss: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-lg p-px",
        "transition-transform duration-300 hover:scale-[1.01]"
      )}
    >
      {/* Animated conic ring */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-lg opacity-80 group-hover:opacity-100 transition-opacity"
        style={{
          background:
            "conic-gradient(from 0deg, #6366f1, #a855f7, #ec4899, #8b5cf6, #6366f1)",
          animation: "wayseer-spin 8s linear infinite",
        }}
      />
      {/* Inner card surface */}
      <span
        aria-hidden
        className="absolute inset-px rounded-[7px] bg-slate-950"
      />
      {/* Nebula clouds */}
      <span
        aria-hidden
        className="absolute inset-px rounded-[7px] opacity-90"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 18% 30%, rgba(168, 85, 247, 0.55), transparent 45%)",
            "radial-gradient(circle at 82% 70%, rgba(236, 72, 153, 0.45), transparent 45%)",
            "radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.4), transparent 60%)",
            "radial-gradient(circle at 75% 20%, rgba(56, 189, 248, 0.25), transparent 40%)",
          ].join(", "),
        }}
      />
      {/* Starfield */}
      <span
        aria-hidden
        className="absolute inset-px rounded-[7px]"
        style={{
          backgroundImage: [
            "radial-gradient(1px 1px at 14% 22%, rgba(255,255,255,0.9), transparent 60%)",
            "radial-gradient(1px 1px at 28% 78%, rgba(255,255,255,0.7), transparent 60%)",
            "radial-gradient(1px 1px at 42% 14%, rgba(255,255,255,0.8), transparent 60%)",
            "radial-gradient(1px 1px at 58% 62%, rgba(255,255,255,0.6), transparent 60%)",
            "radial-gradient(1px 1px at 71% 36%, rgba(255,255,255,0.9), transparent 60%)",
            "radial-gradient(1px 1px at 84% 84%, rgba(255,255,255,0.7), transparent 60%)",
            "radial-gradient(1.5px 1.5px at 92% 18%, rgba(255,255,255,1), transparent 60%)",
            "radial-gradient(1px 1px at 6% 60%, rgba(255,255,255,0.8), transparent 60%)",
          ].join(", "),
          animation: "wayseer-twinkle 4s ease-in-out infinite",
        }}
      />
      {/* Soft top highlight */}
      <span
        aria-hidden
        className="absolute inset-x-px top-px h-1/2 rounded-t-[7px]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0.08), transparent)",
        }}
      />

      {/* Click target — the whole card */}
      <button
        type="button"
        onClick={onActivate}
        aria-label="Activate Wayseer — AI insights for your sessions"
        className="relative flex w-full items-start gap-2.5 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 rounded-[7px]"
      >
        <span className="relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
          <Sparkles className="size-3.5 text-white drop-shadow-[0_0_6px_rgba(236,72,153,0.8)]" />
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: "0 0 12px 2px rgba(168, 85, 247, 0.45)",
              animation: "wayseer-pulse 2.4s ease-in-out infinite",
            }}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col pr-4">
          <span className="text-[13px] font-semibold leading-tight text-white">
            Activate Wayseer
          </span>
          <span className="mt-0.5 text-[11px] leading-snug text-violet-100/80">
            AI insights & summaries on every session.
          </span>
        </span>
      </button>

      {/* Dismiss — sibling, absolute-positioned so it's not nested in the card button */}
      <button
        type="button"
        aria-label="Dismiss Wayseer card"
        onClick={onDismiss}
        className="absolute right-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded-full text-white/60 hover:bg-white/15 hover:text-white transition-colors"
      >
        <X className="size-3" />
      </button>

      <style jsx>{`
        @keyframes wayseer-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes wayseer-twinkle {
          0%,
          100% {
            opacity: 0.55;
          }
          50% {
            opacity: 1;
          }
        }
        @keyframes wayseer-pulse {
          0%,
          100% {
            box-shadow: 0 0 8px 1px rgba(168, 85, 247, 0.35);
          }
          50% {
            box-shadow: 0 0 16px 4px rgba(236, 72, 153, 0.55);
          }
        }
      `}</style>
    </div>
  )
}

// ─── Activation modal ────────────────────────────────────────────────────────

type Provider = "local" | "hosted" | "direct"

const PROVIDERS: Record<
  Provider,
  {
    label: string
    tagline: string
    endpoint: string
    model: string
    notes: string
    link?: { label: string; href: string }
  }
> = {
  local: {
    label: "Local",
    tagline: "LM Studio · Ollama · llama.cpp · vLLM",
    endpoint: "http://localhost:1234/v1",
    model: "qwen2.5-7b-instruct",
    notes:
      "Runs on your machine. No tokens spent, no data leaves the box. Start the server in LM Studio (or `ollama serve`) and point Wayseer at it.",
    link: { label: "lmstudio.ai", href: "https://lmstudio.ai" },
  },
  hosted: {
    label: "Hosted",
    tagline: "OpenRouter · Groq · Together · Fireworks",
    endpoint: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-3.5-sonnet",
    notes:
      "Any OpenAI-compatible gateway works. Bring your own key and the model of your choice — Wayseer just speaks /chat/completions.",
    link: { label: "openrouter.ai", href: "https://openrouter.ai" },
  },
  direct: {
    label: "Direct",
    tagline: "OpenAI · Mistral · DeepSeek · Anthropic-compat proxy",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    notes:
      "Point straight at a provider's OpenAI-compatible endpoint. You own the key, you own the bill, you own the rate limit.",
  },
}

function WayseerModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [provider, setProvider] = React.useState<Provider>("local")
  const [copied, setCopied] = React.useState(false)
  const cfg = PROVIDERS[provider]

  const envSnippet = React.useMemo(
    () =>
      `WORKBOOK_CLUSTER_ENDPOINTS=${cfg.endpoint}\nWORKBOOK_CLUSTER_MODEL=${cfg.model}`,
    [cfg]
  )

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(envSnippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard blocked; no-op.
    }
  }, [envSnippet])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden border-violet-500/20 bg-slate-950 p-0 text-slate-100 sm:max-w-xl"
        showCloseButton={false}
      >
        {/* Hero */}
        <div className="relative overflow-hidden px-6 pb-6 pt-7">
          {/* Nebula backdrop */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: [
                "radial-gradient(ellipse at 15% 20%, rgba(168, 85, 247, 0.45), transparent 55%)",
                "radial-gradient(ellipse at 85% 30%, rgba(236, 72, 153, 0.35), transparent 55%)",
                "radial-gradient(ellipse at 50% 90%, rgba(56, 189, 248, 0.25), transparent 60%)",
                "radial-gradient(ellipse at 70% 60%, rgba(99, 102, 241, 0.4), transparent 55%)",
              ].join(", "),
            }}
          />
          {/* Stars */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: [
                "radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,0.9), transparent 60%)",
                "radial-gradient(1px 1px at 22% 64%, rgba(255,255,255,0.7), transparent 60%)",
                "radial-gradient(1px 1px at 38% 28%, rgba(255,255,255,0.8), transparent 60%)",
                "radial-gradient(1px 1px at 51% 78%, rgba(255,255,255,0.6), transparent 60%)",
                "radial-gradient(1.5px 1.5px at 67% 42%, rgba(255,255,255,1), transparent 60%)",
                "radial-gradient(1px 1px at 82% 70%, rgba(255,255,255,0.8), transparent 60%)",
                "radial-gradient(1px 1px at 90% 16%, rgba(255,255,255,0.9), transparent 60%)",
                "radial-gradient(1px 1px at 6% 84%, rgba(255,255,255,0.7), transparent 60%)",
              ].join(", "),
            }}
          />
          {/* Close */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 z-10 flex size-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>

          <div className="relative">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
                <Sparkles className="size-4 text-white drop-shadow-[0_0_8px_rgba(236,72,153,0.9)]" />
              </div>
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-violet-200/80">
                Wayseer
              </span>
            </div>
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-2xl font-semibold leading-tight text-white">
                Turn your sessions into{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, #c4b5fd, #f0abfc, #93c5fd)",
                  }}
                >
                  insight
                </span>
                .
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-violet-100/70">
                Wayseer is the optional AI layer for Operator Studio. Point it at
                any OpenAI-compatible endpoint and it will summarize threads,
                surface patterns across runs, auto-tag captures, and answer
                questions about what you and your agents have been doing.
              </DialogDescription>
            </DialogHeader>

            {/* Value bullets */}
            <ul className="relative mt-5 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-3">
              {[
                "Auto-summarize long sessions",
                "Search by meaning, not keyword",
                "Bring your own tokens",
              ].map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-violet-50/90 backdrop-blur-sm"
                >
                  <Check className="mt-0.5 size-3.5 shrink-0 text-violet-300" />
                  <span className="leading-snug">{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Body */}
        <div className="border-t border-white/5 bg-slate-950 px-6 py-5">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-violet-200/60">
            Pick how you want to power it
          </div>
          {/* Provider tabs */}
          <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-md border border-white/5 bg-white/[0.02] p-1">
            {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
              const active = p === provider
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={cn(
                    "rounded px-3 py-2 text-left transition-colors",
                    active
                      ? "bg-violet-500/15 ring-1 ring-violet-400/40"
                      : "hover:bg-white/[0.04]"
                  )}
                >
                  <div
                    className={cn(
                      "text-xs font-semibold",
                      active ? "text-violet-100" : "text-slate-200"
                    )}
                  >
                    {PROVIDERS[p].label}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-tight text-slate-400">
                    {PROVIDERS[p].tagline}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Notes */}
          <p className="mb-3 text-[12.5px] leading-relaxed text-slate-300/90">
            {cfg.notes}
            {cfg.link && (
              <>
                {" "}
                <a
                  href={cfg.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-violet-300 underline-offset-2 hover:underline"
                >
                  {cfg.link.label}
                  <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </p>

          {/* Env snippet */}
          <div className="overflow-hidden rounded-md border border-white/10 bg-black/40">
            <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                .env.local
              </span>
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-slate-200">
              {envSnippet}
            </pre>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Save to <code className="text-slate-300">.env.local</code> and
            restart the dev server. Wayseer activates the moment the endpoint
            answers a health probe — the echo-mode banner disappears, the
            composer wakes up, and analyses start running.
          </p>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-slate-300 hover:bg-white/5 hover:text-white"
            >
              Maybe later
            </Button>
            <Button
              type="button"
              onClick={copy}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_18px_rgba(168,85,247,0.45)] hover:from-violet-400 hover:to-fuchsia-400"
            >
              <Sparkles className="mr-1.5 size-4" />
              Copy & activate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
