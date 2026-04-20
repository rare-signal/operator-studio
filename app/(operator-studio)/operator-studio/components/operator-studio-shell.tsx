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
  HelpCircle,
  LayoutDashboard,
  Search,
  Settings,
  Sparkles,
  Star,
  Terminal,
  User,
} from "lucide-react"

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
  SidebarTrigger,
} from "@/registry/new-york-v4/ui/sidebar"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { Input } from "@/registry/new-york-v4/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"

import type { OperatorThread } from "@/lib/operator-studio/types"
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
import { SourceAppToken } from "./source-apps"

// ─── Types ───────────────────────────────────────────────────────────────────

interface OperatorStudioShellProps {
  threads: OperatorThread[]
  activeWorkspace: WorkspaceSummary
  workspaces: WorkspaceSummary[]
  children: React.ReactNode
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function OperatorStudioShell({
  threads,
  activeWorkspace,
  workspaces,
  children,
}: OperatorStudioShellProps) {
  const [authed, setAuthed] = React.useState<boolean | null>(null)
  const [reviewer, setReviewer] = React.useState<string | null>(null)
  const [needsIdentity, setNeedsIdentity] = React.useState(false)
  const router = useRouter()

  React.useEffect(() => {
    fetch("/api/operator-studio/session")
      .then((r) => r.json())
      .then((data) => {
        setAuthed(data.authenticated)
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
    <SidebarProvider>
      <OperatorStudioSidebar
        threads={threads}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        reviewer={reviewer}
        onChangeIdentity={() => setNeedsIdentity(true)}
      />
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
        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

// ─── Sidebar search ──────────────────────────────────────────────────────────

function SidebarSearch() {
  const router = useRouter()
  const [value, setValue] = React.useState("")
  const debouncedRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigate = React.useCallback(
    (q: string) => {
      const trimmed = q.trim()
      if (trimmed.length < 2) return
      router.push(`/operator-studio/search?q=${encodeURIComponent(trimmed)}`)
    },
    [router]
  )

  React.useEffect(() => {
    if (debouncedRef.current) clearTimeout(debouncedRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) return
    debouncedRef.current = setTimeout(() => {
      navigate(trimmed)
    }, 400)
    return () => {
      if (debouncedRef.current) clearTimeout(debouncedRef.current)
    }
  }, [value, navigate])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (debouncedRef.current) clearTimeout(debouncedRef.current)
        navigate(value)
      }}
      className="relative"
    >
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search threads, messages…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 pl-7 text-xs"
        aria-label="Search Operator Studio"
      />
    </form>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function OperatorStudioSidebar({
  threads,
  activeWorkspace,
  workspaces,
  reviewer,
  onChangeIdentity,
}: {
  threads: OperatorThread[]
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
    fetch("/api/operator-studio/messages?promoted=true")
      .then((r) => r.json())
      .then((data) => setPromotedMsgCount(data.messages?.length ?? 0))
      .catch(() => {})
  }, [])

  const stateCounts = React.useMemo(() => {
    const counts = { promoted: 0, "in-review": 0, imported: 0, archived: 0 }
    for (const t of threads) {
      if (t.reviewState in counts) {
        counts[t.reviewState as keyof typeof counts]++
      }
    }
    // Combine promoted threads + promoted messages
    counts.promoted += promotedMsgCount
    return counts
  }, [threads, promotedMsgCount])

  const sourceCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of threads) {
      counts.set(t.sourceApp, (counts.get(t.sourceApp) || 0) + 1)
    }
    return counts
  }, [threads])

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
        {/* Main nav + sibling links */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/operator-studio"}
                  onClick={() => router.push("/operator-studio")}
                >
                  <LayoutDashboard className="size-4" />
                  Dashboard
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/operator-studio/activity"}
                  onClick={() => router.push("/operator-studio/activity")}
                >
                  <Activity className="size-4" />
                  Activity
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
                          pathname === "/operator-studio" &&
                          (state === "promoted"
                            ? activeView === "promoted"
                            : activeStateFilter === state)
                        }
                        onClick={() =>
                          router.push(
                            state === "promoted"
                              ? `/operator-studio?view=promoted`
                              : `/operator-studio?state=${state}`
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
                            pathname === "/operator-studio" &&
                            activeSourceFilter === source
                          }
                          onClick={() =>
                            router.push(
                              `/operator-studio?source=${source}`
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
