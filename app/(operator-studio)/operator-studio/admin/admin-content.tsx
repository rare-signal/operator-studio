"use client"

import * as React from "react"
import {
  Beaker,
  CheckCircle2,
  Download,
  FileText,
  Inbox,
  KeyRound,
  Layers,
  LayoutDashboard,
  Sparkles,
  Sun,
  Webhook,
} from "lucide-react"
import Link from "next/link"

import { Button } from "@/registry/new-york-v4/ui/button"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import type { WorkspaceSummary } from "@/app/components/workspace-switcher"
import { TokensPanel } from "./tokens-panel"
import { WebhooksPanel } from "./webhooks-panel"

interface AdminContentProps {
  activeWorkspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  donePhrase: string
}

type AdminSection = "tokens" | "webhooks" | "completion" | "beta"

const BETA_FEATURES: Array<{
  href: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  {
    href: "/operator-studio/today",
    label: "Today",
    description: "Daily cockpit — what shipped, what's queued, what stalled.",
    icon: Sun,
  },
  {
    href: "/operator-studio/brief/today",
    label: "Brief",
    description: "Generated daily brief stitched from recent activity.",
    icon: FileText,
  },
  {
    href: "/operator-studio/inbox",
    label: "Inbox",
    description: "Imported messages awaiting triage into plans.",
    icon: Inbox,
  },
  {
    href: "/operator-studio/memory",
    label: "Memory",
    description: "Raw thread library with filters by status and source.",
    icon: LayoutDashboard,
  },
  {
    href: "/operator-studio/sessions",
    label: "Sessions",
    description: "Per-session views grouping threads under their plans.",
    icon: Layers,
  },
  {
    href: "/operator-studio/foundry",
    label: "Foundry",
    description: "Skunkworks — experiments not ready for primary nav.",
    icon: Beaker,
  },
]

export function AdminContent({
  activeWorkspace,
  workspaces,
  donePhrase,
}: AdminContentProps) {
  const [section, setSection] = React.useState<AdminSection>("tokens")

  const exportHref = `/api/operator-studio/export?workspaceId=${encodeURIComponent(activeWorkspace.id)}`

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Administration
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Mint API tokens for ingest scripts, manage outbound webhook
            subscriptions, and reach beta features that are hidden from
            the primary nav.
          </p>
        </div>
        <a
          href={exportHref}
          download
          className="shrink-0"
          title={`Download a JSON export of the "${activeWorkspace.label}" workspace`}
        >
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export workspace
          </Button>
        </a>
      </header>

      <nav className="mb-8 flex items-center gap-1 rounded-lg border p-1">
        <button
          type="button"
          onClick={() => setSection("tokens")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            section === "tokens"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <KeyRound className="h-4 w-4" />
          API tokens
        </button>
        <button
          type="button"
          onClick={() => setSection("webhooks")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            section === "webhooks"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Webhook className="h-4 w-4" />
          Webhooks
        </button>
        <button
          type="button"
          onClick={() => setSection("completion")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            section === "completion"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          Thread done
        </button>
        <button
          type="button"
          onClick={() => setSection("beta")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            section === "beta"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          Beta features
        </button>
      </nav>

      <Separator className="mb-8" />

      {section === "tokens" && <TokensPanel workspaces={workspaces} />}
      {section === "webhooks" && (
        <WebhooksPanel activeWorkspace={activeWorkspace} />
      )}
      {section === "completion" && <ThreadDonePanel donePhrase={donePhrase} />}
      {section === "beta" && <BetaFeaturesPanel />}
    </div>
  )
}

function ThreadDonePanel({ donePhrase }: { donePhrase: string }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(donePhrase)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — silently no-op; the phrase is still
      // visible right next to the button so the operator can copy by
      // hand.
    }
  }
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Thread completion sentinel</h2>
        <p className="text-sm text-muted-foreground">
          Type this exact phrase as a user turn in any agentic chat
          (Claude, Codex, etc.) to flag the thread as done. Operator
          Studio scans imported user messages for the phrase and shows
          a green checkmark on that thread&apos;s lane in the Work tab.
          Agent messages that quote the phrase are ignored — only your
          turns count.
        </p>
      </div>
      <div className="rounded-lg border bg-muted/30 p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Active phrase
        </p>
        <div className="flex items-center justify-between gap-3">
          <code className="text-sm font-mono">{donePhrase}</code>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="shrink-0"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Match is case- and whitespace-insensitive but requires the
        whole user message to be just the phrase — that way casual
        discussion of the feature won&apos;t false-positive. Override
        the default by setting <code>OPERATOR_STUDIO_DONE_PHRASE</code>{" "}
        in your environment.
      </p>
    </div>
  )
}

function BetaFeaturesPanel() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Beta features</h2>
        <p className="text-sm text-muted-foreground">
          Surfaces hidden from the primary sidebar so the shipping nav
          stays focused on Plan and Work. Most of these are either
          deprecation candidates or live in a future LLM layer above the
          non-LLM core.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {BETA_FEATURES.map((feature) => {
          const Icon = feature.icon
          return (
            <li key={feature.href}>
              <Link
                href={feature.href}
                className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{feature.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
