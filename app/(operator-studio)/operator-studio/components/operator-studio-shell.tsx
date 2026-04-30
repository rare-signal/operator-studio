"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import {
  Brain,
  ChevronRight,
  Download,
  Eye,
  Activity,
  BarChart3,
  CircleDot,
  HelpCircle,
  Layers,
  Lock,
  Map as MapIcon,
  Pin,
  Plus,
  Search,
  Settings,
  Star,
  Terminal,
  Trophy,
  User,
  Zap,
} from "lucide-react"

// Read at module load so render doesn't have to re-check.
// `NEXT_PUBLIC_SHOWCASE` is inlined at build time by Next.js.
const SHOWCASE_MODE = process.env.NEXT_PUBLIC_SHOWCASE === "1"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/registry/new-york-v4/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/registry/new-york-v4/ui/sidebar"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"

import type { ThreadCountSummary } from "@/lib/operator-studio/queries"
import {
  REVIEW_STATE_COLORS,
  REVIEW_STATE_LABELS,
} from "@/lib/operator-studio/types"
import { ModeSwitcher } from "@/components/mode-switcher"
import {
  WorkspaceSwitcher,
  type WorkspaceSummary,
} from "@/app/components/workspace-switcher"
import { PasswordGate } from "./password-gate"
import { IdentityModal } from "./identity-modal"
import { RecentChatsRail } from "./recent-chats-rail"
import { SourceAppToken } from "./source-apps"
import { SuperSearchProvider, useSuperSearch } from "./super-search"
import { WayseerProvider } from "./wayseer-context"
import { WayseerCta } from "./wayseer-cta"

// ─── Types ───────────────────────────────────────────────────────────────────

interface OperatorStudioShellProps {
  /** Aggregated counts for the sidebar (state + source + total). Cheap
   *  to compute at the DB versus pulling full thread rows. */
  threadCounts: ThreadCountSummary
  activeWorkspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  children: React.ReactNode
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function OperatorStudioShell({
  threadCounts,
  activeWorkspace,
  workspaces,
  children,
}: OperatorStudioShellProps) {
  const [authed, setAuthed] = React.useState<boolean | null>(
    SHOWCASE_MODE ? true : null
  )
  const [reviewer, setReviewer] = React.useState<string | null>(
    SHOWCASE_MODE ? "Visitor" : null
  )
  const [needsIdentity, setNeedsIdentity] = React.useState(false)
  const [llmConfigured, setLlmConfigured] = React.useState<boolean | null>(
    SHOWCASE_MODE ? false : null
  )
  const [dismissedEchoBanner, setDismissedEchoBanner] =
    React.useState<boolean>(false)
  const router = useRouter()

  React.useEffect(() => {
    if (SHOWCASE_MODE) {
      // No /api/operator-studio/session endpoint in static export — read-only
      // shell with a synthetic "Visitor" identity, no auth, no LLM.
      return
    }
    fetch("/api/operator-studio/session")
      .then((r) => r.json())
      .then((data) => {
        setAuthed(data.authenticated)
        setLlmConfigured(!!data.llmConfigured)
        if (data.reviewer) {
          setReviewer(data.reviewer)
          localStorage.setItem("operator_studio_reviewer", data.reviewer)
        } else {
          const stored = localStorage.getItem("operator_studio_reviewer")
          if (stored) setReviewer(stored)
        }
        if (data.authenticated && !data.reviewer) {
          const stored = localStorage.getItem("operator_studio_reviewer")
          if (!stored) {
            setNeedsIdentity(true)
          } else {
            setReviewer(stored)
          }
        }
      })
      .catch(() => setAuthed(false))

    // Session-scoped dismissal so a power user who knows what echo mode is
    // can hide the banner without hiding it forever.
    setDismissedEchoBanner(
      window.sessionStorage.getItem("operator_studio_echo_banner_dismissed") ===
        "1"
    )
  }, [])

  const dismissEchoBanner = React.useCallback(() => {
    window.sessionStorage.setItem(
      "operator_studio_echo_banner_dismissed",
      "1"
    )
    setDismissedEchoBanner(true)
  }, [])

  const handlePasswordSuccess = React.useCallback(() => {
    setAuthed(true)
    const stored = localStorage.getItem("operator_studio_reviewer")
    if (stored) {
      setReviewer(stored)
    } else {
      setNeedsIdentity(true)
    }
  }, [])

  const handleIdentitySet = React.useCallback((name: string) => {
    setReviewer(name)
    setNeedsIdentity(false)
    localStorage.setItem("operator_studio_reviewer", name)
    fetch("/api/operator-studio/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerName: name }),
    })
  }, [])

  if (authed === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Loading Operator Studio…
          </p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return <PasswordGate onSuccess={handlePasswordSuccess} />
  }

  if (needsIdentity) {
    return <IdentityModal onComplete={handleIdentitySet} />
  }

  return (
    <WayseerProvider llmConfigured={llmConfigured}>
    <SidebarProvider>
      <SuperSearchProvider>
      <OperatorStudioSidebar
        threadCounts={threadCounts}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        reviewer={reviewer}
        onChangeIdentity={() => setNeedsIdentity(true)}
      />
      <RecentChatsRail workspaceId={activeWorkspace.id} />
      <SidebarInset className="flex flex-col h-svh overflow-hidden">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Operator Studio</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {reviewer && (
              <span className="text-xs text-muted-foreground">
                Operating as <strong>{reviewer}</strong>
              </span>
            )}
          </div>
        </header>
        {SHOWCASE_MODE ? (
          <div className="flex shrink-0 items-center gap-3 border-b bg-sky-500/10 px-4 py-1.5 text-xs text-sky-900 dark:text-sky-100">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              <strong>Read-only showcase.</strong> Static export of Operator
              Studio populated with the agentic chats that built it. Browse
              the plan, the work sessions, and {threadCounts.total} chats —
              writes are disabled. Source:{" "}
              <a
                href="https://github.com/rare-signal/operator-studio"
                className="underline hover:text-sky-700 dark:hover:text-sky-300"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/rare-signal/operator-studio
              </a>
              .
            </span>
          </div>
        ) : (
          llmConfigured === false &&
          !dismissedEchoBanner && (
            <div className="flex shrink-0 items-center gap-3 border-b bg-amber-500/10 px-4 py-1.5 text-xs text-amber-900 dark:text-amber-100">
              <Zap className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                <strong>Echo mode.</strong> No LLM endpoint configured —
                continuation chat echoes input, capture reasons stay blank,
                and auto-tag / auto-title fall back to heuristics. Set{" "}
                <code className="rounded bg-amber-500/20 px-1">
                  WORKBOOK_CLUSTER_ENDPOINTS
                </code>{" "}
                in <code>.env.local</code> and restart to enable.
              </span>
              <button
                type="button"
                onClick={dismissEchoBanner}
                className="rounded px-2 py-0.5 text-xs hover:bg-amber-500/20"
              >
                Dismiss
              </button>
            </div>
          )
        )}
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </SidebarInset>
      </SuperSearchProvider>
    </SidebarProvider>
    </WayseerProvider>
  )
}

// ─── Sidebar search ──────────────────────────────────────────────────────────

/**
 * Pretends to be the same input the user has been seeing, but is
 * actually a button that opens the SuperSearch palette. The visible
 * ⌘K hint discloses the hotkey from anywhere on the page.
 */
function SidebarSearch() {
  const { setOpen } = useSuperSearch()
  const [shortcutLabel, setShortcutLabel] = React.useState("⌘K")

  React.useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    setShortcutLabel(isMac ? "⌘K" : "Ctrl K")
  }, [])

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open search (⌘K)"
      className="relative flex h-8 w-full items-center gap-2 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 text-left truncate">Search threads, messages…</span>
      <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground">
        {shortcutLabel}
      </kbd>
    </button>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function OperatorStudioSidebar({
  threadCounts,
  activeWorkspace,
  workspaces,
  reviewer,
  onChangeIdentity,
}: {
  threadCounts: ThreadCountSummary
  activeWorkspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  reviewer: string | null
  onChangeIdentity: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeStateFilter = searchParams?.get("state")
  const activeView = searchParams?.get("view")
  const activeSourceFilter = searchParams?.get("source")

  const [promotedMsgCount, setPromotedMsgCount] = React.useState(0)

  React.useEffect(() => {
    if (SHOWCASE_MODE) return
    fetch("/api/operator-studio/messages?promoted=true")
      .then((r) => r.json())
      .then((data) => setPromotedMsgCount(data.messages?.length ?? 0))
      .catch(() => {})
  }, [])

  // Active Session Plan — the durable goal that the top sidebar group
  // scopes to. Fetched client-side so every workspace/page shares the
  // same resolver. Refetches when the pathname changes so switching
  // between Plan / Brief / Inbox shows the latest title after edits.
  const [activePlanTitle, setActivePlanTitle] = React.useState<string | null>(
    SHOWCASE_MODE ? "Build Operator Studio with Claude Code" : null
  )
  const [activePlanPinned, setActivePlanPinned] = React.useState(
    SHOWCASE_MODE ? true : false
  )
  const [activePlanState, setActivePlanState] = React.useState<string | null>(
    SHOWCASE_MODE ? "active" : null
  )
  React.useEffect(() => {
    if (SHOWCASE_MODE) return
    let cancelled = false
    function refetch() {
      fetch("/api/operator-studio/plans/active")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data?.plan) return
          setActivePlanTitle(data.plan.title ?? null)
          setActivePlanPinned(!!data.plan.pinned)
          setActivePlanState(data.plan.state ?? null)
        })
        .catch(() => {})
    }
    refetch()
    // The plan view dispatches this event after meta edits so the
    // sidebar reflects new title / pin / state without waiting for
    // the next pathname change.
    window.addEventListener("operator-studio:plan-updated", refetch)
    return () => {
      cancelled = true
      window.removeEventListener("operator-studio:plan-updated", refetch)
    }
  }, [pathname, activeWorkspace.id])

  const stateCounts = React.useMemo(() => {
    const counts = {
      promoted: threadCounts.byState["promoted"] ?? 0,
      "in-review": threadCounts.byState["in-review"] ?? 0,
      imported: threadCounts.byState["imported"] ?? 0,
      archived: threadCounts.byState["archived"] ?? 0,
    }
    // Combine promoted threads + promoted messages
    counts.promoted += promotedMsgCount
    return counts
  }, [threadCounts.byState, promotedMsgCount])

  const sourceCounts = React.useMemo(() => {
    return new Map<string, number>(Object.entries(threadCounts.bySource))
  }, [threadCounts.bySource])

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => router.push("/operator-studio")}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Terminal className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Operator Studio</span>
                <span className="text-xs text-muted-foreground">
                  Agent session review
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="px-1 pt-1">
          <WorkspaceSwitcher
            active={activeWorkspace}
            workspaces={workspaces}
          />
        </div>
        <div className="px-1 pt-1">
          <SidebarSearch />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {/* Session Plan surface — the durable unit of intent.
            Pared down to Plan + Work as the shippable surface; Today,
            Brief, Inbox, Memory, Sessions, Foundry are reachable from
            Admin → Beta features. Group label doubles as the plan
            switcher. */}
        <SidebarGroup>
          <SessionPlanGroupLabel
            title={activePlanTitle}
            pinned={activePlanPinned}
            state={activePlanState}
          />
          <SidebarSeparator className="my-1.5" />
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Plan and Work share one route (`/operator-studio/plan`)
                  and toggle inside it via `?tab=`. Each sidebar item
                  drops you on the right tab; active-state reads the
                  tab param so both don't highlight at once. The legacy
                  `/operator-studio/pulse` route 302s to plan?tab=work,
                  so we treat that path as Work-active too. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={
                    pathname === "/operator-studio/plan" &&
                    searchParams.get("tab") !== "work"
                  }
                  onClick={() => router.push("/operator-studio/plan")}
                >
                  <MapIcon className="size-4" />
                  Plan
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={
                    pathname === "/operator-studio/pulse" ||
                    (pathname === "/operator-studio/plan" &&
                      searchParams.get("tab") === "work")
                  }
                  onClick={() =>
                    router.push("/operator-studio/plan?tab=work")
                  }
                >
                  <CircleDot className="size-4" />
                  Work
                  <span className="ml-auto text-[8px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                    live
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Elevated supporting surfaces — observability adjacent to the
            core loop, not part of it. Rule above scopes Activity Log /
            Metrics as a separate section from the AAA Today/Plan/Work
            loop above. */}
        <SidebarSeparator className="my-1.5" />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/operator-studio/activity"}
                  onClick={() => router.push("/operator-studio/activity")}
                >
                  <Activity className="size-4" />
                  Activity Log
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/operator-studio/metrics"}
                  onClick={() => router.push("/operator-studio/metrics")}
                >
                  <BarChart3 className="size-4" />
                  Metrics
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* "More" surfaces (Today, Brief, Inbox, Memory, Sessions,
            Foundry) are reachable from Admin → Beta features so the
            shipping nav stays focused on Plan + Work.
            TODO(threads): the By Status / By Source groups below are
            entry points into raw threads. Want a discussion on how
            threads should integrate with Plan / Work rather than
            standing alongside them as a parallel navigation. */}
        <SidebarSeparator className="my-1.5" />

        {/* By Status */}
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel
              asChild
              className="group/label cursor-pointer text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <CollapsibleTrigger>
                <Eye className="mr-1 size-3.5" />
                By Status
                <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenuSub>
                  {(
                    [
                      ["promoted", Star, "Promoted"],
                      ["in-review", Search, "In Review"],
                      ["imported", Download, "Imported"],
                    ] as const
                  ).map(([state, Icon, label]) => (
                    <SidebarMenuSubItem key={state}>
                      <SidebarMenuSubButton
                        isActive={
                          pathname === "/operator-studio/memory" &&
                          (state === "promoted"
                            ? activeView === "promoted"
                            : activeStateFilter === state)
                        }
                        onClick={() =>
                          router.push(
                            state === "promoted"
                              ? `/operator-studio/memory?view=promoted`
                              : `/operator-studio/memory?state=${state}`
                          )
                        }
                      >
                        <Icon className="size-3 shrink-0" />
                        <span className="truncate">{label}</span>
                        {stateCounts[state] > 0 && (
                          <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
                            {stateCounts[state]}
                          </span>
                        )}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

        {/* By Source */}
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarGroup>
            <SidebarGroupLabel
              asChild
              className="group/label cursor-pointer text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <CollapsibleTrigger>
                <Brain className="mr-1 size-3.5" />
                By Source
                <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
              </CollapsibleTrigger>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenuSub>
                  {Array.from(sourceCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([source, count]) => (
                      <SidebarMenuSubItem key={source}>
                        <SidebarMenuSubButton
                          isActive={
                            pathname === "/operator-studio/memory" &&
                            activeSourceFilter === source
                          }
                          onClick={() =>
                            router.push(
                              `/operator-studio/memory?source=${source}`
                            )
                          }
                        >
                          <SourceAppToken
                            source={source}
                            variant="plain"
                            size="sm"
                            className="min-w-0 flex-1 text-sidebar-foreground"
                            labelClassName="truncate"
                          />
                          <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground/60">
                            {count}
                          </span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                </SidebarMenuSub>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 pb-1">
          <WayseerCta />
        </div>
        <SidebarSeparator className="my-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/operator-studio/admin"}
              onClick={() => router.push("/operator-studio/admin")}
            >
              <Settings className="size-4" />
              Admin
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/operator-studio/docs"}
              onClick={() => router.push("/operator-studio/docs")}
            >
              <HelpCircle className="size-4" />
              Help
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="flex-1">
                    <User className="size-4" />
                    <span className="truncate">
                      {reviewer || "Unknown operator"}
                    </span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="w-48"
                >
                  <DropdownMenuItem onClick={onChangeIdentity}>
                    <User className="mr-2 size-4" />
                    Change identity
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ModeSwitcher variant="ghost" className="shrink-0" />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

// ─── Session Plan group label ─────────────────────────────────────────────

/** Group label for the Today/Plan/Brief/Inbox/Pulse surface.
 *
 * Shows the active Session Plan title and flips into a dropdown that
 * lists pinned plans (one click to switch) plus "New plan" and
 * "See all". Fetches the plan list lazily on first open.
 */
function SessionPlanGroupLabel({
  title,
  pinned,
  state,
}: {
  title: string | null
  pinned: boolean
  state: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [plans, setPlans] = React.useState<
    Array<{
      id: string
      title: string
      pinned: boolean
      state: string
    }> | null
  >(null)
  const [loading, setLoading] = React.useState(false)

  async function loadPlans() {
    if (plans || loading) return
    if (SHOWCASE_MODE) {
      setPlans([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/operator-studio/plans")
      if (!res.ok) return
      const data = await res.json()
      setPlans(
        (data.plans ?? []).map(
          (p: {
            id: string
            title: string
            pinned: boolean
            state: string
          }) => ({
            id: p.id,
            title: p.title,
            pinned: p.pinned,
            state: p.state,
          })
        )
      )
    } finally {
      setLoading(false)
    }
  }

  // Lazy fetch the plan list when the dropdown opens.
  React.useEffect(() => {
    if (open) loadPlans()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The label now owns the full row (no inline "SESSION PLAN" eyebrow),
  // so we can let CSS truncation handle overflow instead of slicing.
  const label = title ?? "Untitled plan"
  const displayLabel = label

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarGroupLabel
          asChild
          className="cursor-pointer text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group/session-plan"
        >
          <button type="button" className="flex w-full min-w-0 items-center gap-1.5">
            <Trophy className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
              {displayLabel}
            </span>
            {pinned && (
              <Pin className="h-2.5 w-2.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/session-plan:rotate-90" />
          </button>
        </SidebarGroupLabel>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-72">
        <div className="px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            Active plan
          </p>
          <p className="mt-0.5 text-sm font-medium flex items-center gap-1.5">
            <Trophy className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            {label}
          </p>
          <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {state ?? "active"}
            {pinned ? " · pinned" : ""}
          </p>
        </div>
        <div className="border-t my-1" />
        <div className="px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">
            Pinned plans
          </p>
          {loading && (
            <p className="text-[12px] text-muted-foreground italic">Loading plans…</p>
          )}
          {!loading && plans && plans.filter((p) => p.pinned).length === 0 && (
            <p className="text-[12px] text-muted-foreground italic">
              No pinned plans yet.
            </p>
          )}
          {!loading &&
            plans
              ?.filter((p) => p.pinned)
              .slice(0, 6)
              .map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  className="text-[13px]"
                  onClick={() => {
                    // For now, "switching" just routes to the Plan page
                    // for that plan. Switching the active-plan-in-view
                    // across the whole surface lands with a cookie in a
                    // follow-up.
                    router.push("/operator-studio/plan")
                  }}
                >
                  <Pin className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  <span className="truncate">{p.title}</span>
                  <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {p.state}
                  </span>
                </DropdownMenuItem>
              ))}
        </div>
        <div className="border-t my-1" />
        <DropdownMenuItem
          className="text-[13px]"
          onClick={() => router.push("/operator-studio/plan")}
        >
          <Plus className="h-3.5 w-3.5" />
          New plan
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-[13px] text-muted-foreground"
          onClick={() => router.push("/operator-studio/plans")}
        >
          <Layers className="h-3.5 w-3.5" />
          See all plans
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
