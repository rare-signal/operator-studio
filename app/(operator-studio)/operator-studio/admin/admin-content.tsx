"use client"

import * as React from "react"
import { KeyRound, Webhook } from "lucide-react"

import { Separator } from "@/registry/new-york-v4/ui/separator"
import type { WorkspaceSummary } from "@/app/components/workspace-switcher"
import { TokensPanel } from "./tokens-panel"
import { WebhooksPanel } from "./webhooks-panel"

interface AdminContentProps {
  activeWorkspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
}

type AdminSection = "tokens" | "webhooks"

export function AdminContent({
  activeWorkspace,
  workspaces,
}: AdminContentProps) {
  const [section, setSection] = React.useState<AdminSection>("tokens")

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Administration
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Mint API tokens for ingest scripts and manage outbound webhook
          subscriptions for this workspace.
        </p>
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
      </nav>

      <Separator className="mb-8" />

      {section === "tokens" ? (
        <TokensPanel workspaces={workspaces} />
      ) : (
        <WebhooksPanel activeWorkspace={activeWorkspace} />
      )}
    </div>
  )
}
