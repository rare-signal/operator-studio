"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  Flame,
  Globe,
  Highlighter,
  Info,
  MessageSquare,
  Send,
  Shield,
  Sparkles,
  Star,
  Tag,
  Target,
  User,
  Loader2,
  MoreHorizontal,
  Pencil,
  GitFork,
  Trash2,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
} from "lucide-react"
import Link from "next/link"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/registry/new-york-v4/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/registry/new-york-v4/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/registry/new-york-v4/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/registry/new-york-v4/ui/tooltip"

import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadPassage,
  OperatorThreadSummary,
  OperatorChatSession,
  OperatorSession,
  OperatorPlanStep,
  PromotionKind,
  ContinuationPersona,
} from "@/lib/operator-studio/types"
import type { Workspace } from "@/lib/operator-studio/workspaces"
import { findSessionForTimestamp } from "@/lib/operator-studio/sessions"

// Mirrors `GLOBAL_WORKSPACE_ID` in `lib/operator-studio/workspaces.ts`. That
// module is server-only, so we inline the constant here for client use.
const GLOBAL_WORKSPACE_ID = "global"
import {
  REVIEW_STATE_COLORS,
  REVIEW_STATE_LABELS,
  SOURCE_APP_LABELS,
  PROMOTION_KIND_LABELS,
  PROMOTION_KIND_COLORS,
  PROMOTION_KIND_EMOJI,
  CONTINUATION_PERSONAS,
} from "@/lib/operator-studio/types"
import { MarkdownProse } from "./markdown-prose"
import { PassageHighlights } from "./passage-highlights"
import { PromoteMessageDialog } from "./promote-message-dialog"
import { SelectionActionBar } from "./selection-action-bar"
import { SourceDeepLinkButton } from "./source-deeplink-button"
import { ThreadMinimapGutter } from "./thread-minimap-gutter"
import { getThreadDeepLink } from "@/lib/operator-studio/source-deeplinks"
import { SourceAppToken } from "./source-apps"
import { useWayseer } from "./wayseer-context"
import { WayseerAnalysisPanel } from "./wayseer-analysis-panel"
import { ThreadRollupSection } from "./thread-rollup-section"

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  modelLabel?: string | null
  createdAt: string
  source: "transcript" | "continuation"
  promotedAt?: string | null
  promotedBy?: string | null
  promotionNote?: string | null
  promotionKind?: PromotionKind | null
  turnIndex?: number
  branchId?: string
  localIdx?: number
  /** Source-app metadata pass-through — read by getMessageDeepLink to
   *  derive per-turn deep links (Codex turn IDs, etc.). */
  metadataJson?: Record<string, unknown> | null
}

interface TimelineBranch {
  id: string
  parentBranchId: string | null
  forkAfterIndex: number
  messages: ChatMessage[]
  sessionId: string | null
}

interface ThreadDetailProps {
  thread: OperatorThread
  messages: OperatorThreadMessage[]
  summaries: OperatorThreadSummary[]
  sessions: OperatorChatSession[]
  /**
   * Session Spaces (time-bracketed) for this workspace. Used to offer
   * "Promote selection to step" on transcript messages — the message's
   * createdAt determines which session's plan is reachable.
   */
  planSessions: OperatorSession[]
  reviewer: string | null
  forks: OperatorThread[]
  parentMessages: OperatorThreadMessage[]
  activeWorkspace: Workspace
  /** Divergence info for threads that inherited turns from kickoff
   *  siblings or an explicit parent fork. When present AND
   *  inheritedCount > 0, the view collapses the inherited prefix and
   *  surfaces a button to reveal it. Null for lone threads. */
  forkContext?: ForkContext | null
}

/**
 * Shape of the divergence info passed in from the server. Mirrors
 * lib/operator-studio/fork-divergence.ts so we don't re-import the
 * server-only module here.
 */
export interface ForkContext {
  divergedAtTurnIndex: number
  inheritedCount: number
  isForkOrigin: boolean
  kind: "kickoff-siblings" | "explicit-parent" | "none"
  siblings: Array<{
    id: string
    title: string
    firstAt: string | null
    messageCount: number
  }>
}

function buildPathMessagesForBranch(
  branches: TimelineBranch[],
  targetBranchId: string
): Array<{
  role: "user" | "assistant"
  content: string
  createdAt: string
  branchId: string
}> {
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]))
  const chain: TimelineBranch[] = []
  let current = branchesById.get(targetBranchId) ?? null

  while (current) {
    chain.unshift(current)
    current = current.parentBranchId
      ? branchesById.get(current.parentBranchId) ?? null
      : null
  }

  if (chain.length === 0) return []

  const pathMessages: Array<{
    role: "user" | "assistant"
    content: string
    createdAt: string
    branchId: string
  }> = []

  for (let idx = 0; idx < chain.length; idx += 1) {
    const branch = chain[idx]
    const nextBranch = chain[idx + 1]
    const endExclusive = nextBranch
      ? Math.min(branch.messages.length, nextBranch.forkAfterIndex + 1)
      : branch.messages.length

    for (const message of branch.messages.slice(0, endExclusive)) {
      pathMessages.push({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        branchId: branch.id,
      })
    }
  }

  return pathMessages
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ThreadDetail({
  thread,
  messages,
  summaries,
  sessions,
  planSessions,
  reviewer,
  forks,
  parentMessages,
  activeWorkspace,
  forkContext,
}: ThreadDetailProps) {
  // Fork-sibling inheritance: collapsed by default when server detected
  // that this thread inherited turns from a kickoff sibling (or an
  // explicit parent fork we haven't already collapsed via
  // `showFrozenContext`). The reader lands at the fork point; a button
  // above reveals the inherited prefix.
  const hasInheritedPrefix =
    forkContext != null &&
    forkContext.kind !== "none" &&
    forkContext.inheritedCount > 0
  const [showInheritedPrefix, setShowInheritedPrefix] = React.useState(false)
  const { enabled: wayseerEnabled } = useWayseer()
  const router = useRouter()

  // Indexed map keyed by turn_index for O(1) citation hydration in the
  // rollup section. Cheap — runs once per messages array identity.
  const messagesByTurnIndex = React.useMemo(() => {
    const m = new Map<number, OperatorThreadMessage>()
    for (const msg of messages) m.set(msg.turnIndex, msg)
    return m
  }, [messages])
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const editRef = React.useRef<HTMLTextAreaElement>(null)

  // Deep-link anchor: when the thread is opened with `#msg-<id>` in
  // the URL (search results, copied references, plan-step jumps),
  // scroll the matching bubble into view after mount. Next's
  // client-side `<Link>` doesn't honor fragments the way a full
  // browser nav does, so we do it ourselves. We also listen for
  // hashchange so jumping between messages within the page works.
  React.useEffect(() => {
    function jumpToHash() {
      if (typeof window === "undefined") return
      const hash = window.location.hash
      if (!hash.startsWith("#msg-")) return
      const id = hash.slice("#msg-".length)
      // Defer one tick so the bubble is mounted under the new
      // ThreadDetail instance after a route change.
      requestAnimationFrame(() => {
        const el = document.getElementById(`msg-${id}`)
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
          // Brief outline pulse so the operator can visually
          // confirm which message was jumped to.
          el.classList.add("ring-2", "ring-primary/50")
          setTimeout(
            () => el.classList.remove("ring-2", "ring-primary/50"),
            1600
          )
        }
      })
    }
    jumpToHash()
    window.addEventListener("hashchange", jumpToHash)
    return () => window.removeEventListener("hashchange", jumpToHash)
  }, [thread.id])

  // Promoted passages for this thread. Loaded once, then mutated
  // optimistically as the operator promotes new spans via the
  // selection toolbar. Grouped by messageId so each message bubble
  // can render its own indicator + expandable list.
  const [passages, setPassages] = React.useState<OperatorThreadPassage[]>([])
  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/operator-studio/threads/${thread.id}/passages`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return
        const list = Array.isArray(data?.passages)
          ? (data.passages as OperatorThreadPassage[])
          : []
        setPassages(list)
      })
      .catch(() => {
        // Silent — passages are an enhancement, not a blocker for
        // reading the thread.
      })
    return () => {
      cancelled = true
    }
  }, [thread.id])
  const passagesByMessage = React.useMemo(() => {
    const map = new Map<string, OperatorThreadPassage[]>()
    for (const p of passages) {
      const arr = map.get(p.messageId) ?? []
      arr.push(p)
      map.set(p.messageId, arr)
    }
    return map
  }, [passages])
  const handlePassagePromoted = React.useCallback(
    (p: OperatorThreadPassage) => {
      setPassages((prev) => [p, ...prev])
    },
    []
  )
  const handlePassageDeleted = React.useCallback((id: string) => {
    setPassages((prev) => prev.filter((p) => p.id !== id))
  }, [])

  // The per-bubble Highlight button (replacing the old auto-popup
  // selection floater) dispatches a CustomEvent on the document
  // when a passage is created. We listen here so the parent's
  // passages array updates without having to thread an
  // `onPassagePromoted` prop through 6 separate <TimelineMessage>
  // call sites (transcript / continuation / fork / branch).
  React.useEffect(() => {
    function onCreated(e: Event) {
      const detail = (e as CustomEvent<OperatorThreadPassage>).detail
      if (!detail || detail.threadId !== thread.id) return
      handlePassagePromoted(detail)
    }
    document.addEventListener("os:passage-created", onCreated)
    return () =>
      document.removeEventListener("os:passage-created", onCreated)
  }, [thread.id, handlePassagePromoted])
  const [showMeta, setShowMeta] = React.useState(false)
  const [selectedPersona, setSelectedPersona] = React.useState<ContinuationPersona>(
    CONTINUATION_PERSONAS[0]
  )

  const title = thread.promotedTitle ?? thread.rawTitle ?? "Untitled thread"
  const isFork = !!thread.parentThreadId
  const isOriginal = !isFork
  const [forking, setForking] = React.useState(false)
  // Fork-delta rendering (P4): collapse the frozen pre-fork context
  // by default. The user landed here to see the divergent path, not
  // to re-read the parent's N hundred turns — one click expands if
  // they want the full history. Original threads ignore this flag.
  const [showFrozenContext, setShowFrozenContext] = React.useState(false)

  // ── Auto-sync against upstream source file ──────────────────────────────
  // If this thread was imported from a local file (sourceLocator set) we
  // re-sync against that file on mount + on focus. The sync endpoint runs
  // a content-aware diff and decides:
  //   • fast-forward → server appends the new tail in place; we refresh.
  //   • conflict     → server creates (or reuses) a fork; we surface it
  //                    via a banner so the operator can navigate over.
  //   • noop / shrunk / no-source / reparse-failed → silent.
  // Runaway forks are bounded by server-side dedup against existing forks
  // of this thread — one fork per distinct upstream snapshot, not one per
  // page focus.
  type SyncOutcome =
    | { kind: "fast-forward"; appended: number }
    | { kind: "forked-new"; forkId: string; divergeAt: number }
    | { kind: "forked-existing"; forkId: string; divergeAt: number }

  const [syncOutcome, setSyncOutcome] = React.useState<SyncOutcome | null>(
    null
  )

  React.useEffect(() => {
    if (!thread.sourceLocator) return
    let cancelled = false
    // Guard against double-fork: a fast focus-blur-focus could race two
    // sync calls and slip past server dedup if the first hadn't committed
    // yet. Block re-entry while one is in flight.
    let inFlight = false

    async function sync() {
      if (cancelled || inFlight) return
      if (document.visibilityState !== "visible") return
      inFlight = true
      try {
        const res = await fetch(
          `/api/operator-studio/threads/${thread.id}/sync`,
          { method: "POST" }
        )
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return

        if (data.kind === "fast-forward") {
          setSyncOutcome({ kind: "fast-forward", appended: data.appended })
          // Pull the new messages into the rendered thread.
          router.refresh()
        } else if (data.kind === "forked-new") {
          setSyncOutcome({
            kind: "forked-new",
            forkId: data.fork.id,
            divergeAt: data.divergeAt,
          })
        } else if (data.kind === "forked-existing") {
          setSyncOutcome({
            kind: "forked-existing",
            forkId: data.fork.id,
            divergeAt: data.divergeAt,
          })
        }
        // noop / shrunk / no-source / reparse-failed → leave outcome alone.
      } catch {
        // silent — sync is a soft enhancement, not a critical path
      } finally {
        inFlight = false
      }
    }

    sync()
    const onVisible = () => {
      if (document.visibilityState === "visible") sync()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", sync)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", sync)
    }
  }, [thread.id, thread.sourceLocator, router])

  // Fork-at-point: "I drifted off track at turn 42, let me fork back
  // from turn 30 and try a different direction." Copies only parent
  // messages with turnIndex <= the given index. Destructive vibe so we
  // prompt to confirm before navigating.
  const handleForkFromHere = async (turnIndex: number) => {
    const confirmed = window.confirm(
      `Fork from turn ${turnIndex + 1}?\n\nThis creates a new thread with only the first ${turnIndex + 1} turns of this thread — useful if you want to try a different direction from this point. The current thread stays intact.`
    )
    if (!confirmed) return
    setForking(true)
    try {
      const res = await fetch(`/api/operator-studio/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fork",
          forkedBy: reviewer ?? "operator",
          atTurnIndex: turnIndex,
        }),
      })
      const data = await res.json()
      if (data.fork?.id) {
        router.push(`/operator-studio/threads/${data.fork.id}`)
      } else {
        window.alert(`Fork failed: ${data.error ?? "unknown error"}`)
      }
    } catch (err) {
      window.alert(
        `Fork failed: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setForking(false)
    }
  }

  // Plain fork: copies the parent's stored messages into a new thread.
  // Used by the "Fork" button in the empty-chat placeholder.
  const handleForkThread = async () => {
    setForking(true)
    try {
      const res = await fetch(`/api/operator-studio/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fork",
          forkedBy: reviewer ?? "operator",
        }),
      })
      const data = await res.json()
      if (data.fork?.id) {
        router.push(`/operator-studio/threads/${data.fork.id}`)
      }
    } catch {
      // handle error
    } finally {
      setForking(false)
    }
  }

  const [confirmDeleteThread, setConfirmDeleteThread] = React.useState(false)
  const [deletingThread, setDeletingThread] = React.useState(false)

  // ── Done state (optimistic) ──
  // The thread row carries the persisted state; we shadow it locally
  // so the click → optimistic update → API patch → settle pattern
  // doesn't make the operator wait for a round trip to see the badge
  // toggle.
  const [doneState, setDoneState] = React.useState<{
    markedDoneAt: string | null
    markedDoneBy: string | null
    markedDoneSource: "phrase" | "manual" | null
  }>({
    markedDoneAt: thread.markedDoneAt,
    markedDoneBy: thread.markedDoneBy,
    markedDoneSource: thread.markedDoneSource,
  })
  const [doneBusy, setDoneBusy] = React.useState(false)
  const isDone = doneState.markedDoneAt !== null

  const handleToggleDone = async () => {
    setDoneBusy(true)
    const action = isDone ? "unmark-done" : "mark-done"
    // Optimistic — flip locally, roll back on error.
    const prev = doneState
    setDoneState(
      isDone
        ? { markedDoneAt: null, markedDoneBy: null, markedDoneSource: null }
        : {
            markedDoneAt: new Date().toISOString(),
            markedDoneBy: prev.markedDoneBy ?? "operator",
            markedDoneSource: "manual",
          }
    )
    try {
      const res = await fetch(`/api/operator-studio/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json().catch(() => ({}))
      if (action === "mark-done" && data.markedDoneAt) {
        setDoneState({
          markedDoneAt: data.markedDoneAt,
          markedDoneBy: data.markedDoneBy ?? null,
          markedDoneSource: data.markedDoneSource ?? "manual",
        })
      }
    } catch {
      setDoneState(prev)
    } finally {
      setDoneBusy(false)
    }
  }

  // ── Related threads (full-text similarity on search_tsv) ──
  const [relatedThreads, setRelatedThreads] = React.useState<
    Array<{
      id: string
      rawTitle: string | null
      promotedTitle: string | null
      reviewState: string
      sourceApp: string
      tags: string[]
      similarity: number
    }>
  >([])

  React.useEffect(() => {
    let cancelled = false
    async function loadRelated() {
      try {
        const res = await fetch(
          `/api/operator-studio/threads/${thread.id}/related?limit=5`
        )
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.related)) {
          setRelatedThreads(data.related)
        }
      } catch {
        // Silent: related threads are a nice-to-have.
      }
    }
    loadRelated()
    return () => {
      cancelled = true
    }
  }, [thread.id])

  const handleDeleteThread = async () => {
    setDeletingThread(true)
    try {
      await fetch(`/api/operator-studio/threads/${thread.id}`, {
        method: "DELETE",
      })
      router.push("/operator-studio/memory")
    } catch {
      setDeletingThread(false)
    }
  }

  // ── Branch state for continuation ──
  const [branches, setBranches] = React.useState<TimelineBranch[]>([
    { id: "root", parentBranchId: null, forkAfterIndex: -1, messages: [], sessionId: null },
  ])
  const [selectedForks, setSelectedForks] = React.useState<Record<string, string>>({})
  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null)
  const [editText, setEditText] = React.useState("")

  // ── Load existing chat sessions on mount ──
  React.useEffect(() => {
    if (sessions.length === 0) return

    async function loadSessions() {
      const loaded: TimelineBranch[] = [
        { id: "root", parentBranchId: null, forkAfterIndex: -1, messages: [], sessionId: null },
      ]

      for (const session of sessions) {
        try {
          const res = await fetch(`/api/operator-studio/chat?sessionId=${session.id}`)
          const data = await res.json()
          const msgs: ChatMessage[] = (data.messages ?? []).map(
            (m: { id: string; role: string; content: string; modelLabel?: string; createdAt: string; promotedAt?: string; promotedBy?: string; promotionNote?: string; promotionKind?: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              modelLabel: m.modelLabel,
              createdAt: m.createdAt,
              source: "continuation" as const,
              promotedAt: m.promotedAt ?? null,
              promotedBy: m.promotedBy ?? null,
              promotionNote: m.promotionNote ?? null,
              promotionKind: (m.promotionKind as PromotionKind) ?? null,
            })
          )
          if (msgs.length > 0) {
            // Put all loaded sessions on the root branch for now.
            // First session fills root, subsequent ones become child branches.
            if (loaded[0].messages.length === 0) {
              loaded[0] = { ...loaded[0], messages: msgs, sessionId: session.id }
            } else {
              loaded.push({
                id: `loaded-${session.id}`,
                parentBranchId: "root",
                forkAfterIndex: loaded[0].messages.length - 1,
                messages: msgs,
                sessionId: session.id,
              })
            }
          }
        } catch {
          // skip failed session loads
        }
      }

      if (loaded[0].messages.length > 0 || loaded.length > 1) {
        setBranches(loaded)
      }
    }

    loadSessions()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build unified timeline ──
  // Transcript messages first, then continuation messages from branch tree

  const transcriptMessages: ChatMessage[] = React.useMemo(
    () =>
      messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
          source: "transcript" as const,
          turnIndex: m.turnIndex,
          // Threaded through so the per-message deep-link button can
          // read source-app metadata (e.g., codex_turn_id) without
          // refetching.
          metadataJson: m.metadataJson ?? null,
          promotedAt: m.promotedAt,
          promotedBy: m.promotedBy,
          promotionNote: m.promotionNote,
          promotionKind: m.promotionKind,
        })),
    [messages]
  )

  // Walk continuation branch tree with sibling info for ChatGPT-style switching
  type VisibleMsg = ChatMessage & {
    branchId: string
    localIdx: number
    siblingInfo: { total: number; current: number; forkKey: string } | null
  }

  const { continuationMessages, leafBranchId } = React.useMemo(() => {
    const msgs: VisibleMsg[] = []
    let _leafBranchId = "root"

    function walkBranch(branch: TimelineBranch) {
      _leafBranchId = branch.id
      for (let i = 0; i < branch.messages.length; i++) {
        // For the first message of a child branch, check siblings
        let siblingInfo: VisibleMsg["siblingInfo"] = null
        if (i === 0 && branch.parentBranchId !== null) {
          // This is the first message of a forked branch.
          // Siblings = all branches forking from same parent at same point,
          // plus the parent's continuation (if parent has messages after the fork point).
          const parentBranch = branches.find((b) => b.id === branch.parentBranchId)
          const siblingBranches = branches.filter(
            (b) =>
              b.parentBranchId === branch.parentBranchId &&
              b.forkAfterIndex === branch.forkAfterIndex
          )
          // Does the parent have continuation messages after the fork?
          const parentHasContinuation =
            parentBranch && parentBranch.messages.length > branch.forkAfterIndex + 1
          const forkKey = `${branch.parentBranchId}:${branch.forkAfterIndex}`
          // Options: [parent-continue, ...child-branches] (same order as switchFork)
          const continueId = `__continue__${branch.parentBranchId}`
          const options = [
            ...(parentHasContinuation ? [continueId] : []),
            ...siblingBranches.map((b) => b.id),
          ]
          const selectedId = selectedForks[forkKey]
          const currentId = selectedId ?? (parentHasContinuation ? continueId : siblingBranches[0]?.id)
          // This branch is the selected one (otherwise we wouldn't be walking it)
          const currentIdx = options.indexOf(branch.id)
          if (options.length > 1) {
            siblingInfo = {
              total: options.length,
              current: currentIdx >= 0 ? currentIdx : 0,
              forkKey,
            }
          }
        }
        // For messages on the parent branch right after a fork point,
        // they also have siblings (the child branches' first messages).
        if (branch.parentBranchId === null || i > 0) {
          // Check: does this message position on this branch have fork children?
          // i.e., are there branches forking after the PREVIOUS message (i-1)?
          const prevIdx = i - 1
          if (prevIdx >= 0) {
            const children = branches.filter(
              (b) => b.parentBranchId === branch.id && b.forkAfterIndex === prevIdx
            )
            if (children.length > 0) {
              const forkKey = `${branch.id}:${prevIdx}`
              const continueId = `__continue__${branch.id}`
              const options = [continueId, ...children.map((b) => b.id)]
              const selectedId = selectedForks[forkKey] ?? continueId
              // We're showing the "continue" (parent) path — this message is from it
              if (selectedId === continueId || !selectedId) {
                const currentIdx = 0 // "continue" is always index 0
                siblingInfo = {
                  total: options.length,
                  current: currentIdx,
                  forkKey,
                }
              }
            }
          }
        }

        msgs.push({
          ...branch.messages[i],
          branchId: branch.id,
          localIdx: i,
          siblingInfo,
        })
        const globalIdx = msgs.length - 1

        // Check for fork after this message — decide whether to follow a child branch
        const children = branches.filter(
          (b) => b.parentBranchId === branch.id && b.forkAfterIndex === i
        )
        if (children.length > 0) {
          const forkKey = `${branch.id}:${i}`
          const selectedId = selectedForks[forkKey]
          if (selectedId && !selectedId.startsWith("__continue__")) {
            const childBranch = children.find((c) => c.id === selectedId)
            if (childBranch) {
              walkBranch(childBranch)
              return
            }
          }
          // Otherwise continue on this branch (the "original" path)
        }
      }
    }

    const root = branches.find((b) => b.id === "root")!
    walkBranch(root)
    return { continuationMessages: msgs, leafBranchId: _leafBranchId }
  }, [branches, selectedForks])

  const leafBranch = branches.find((b) => b.id === leafBranchId)!

  // Auto-scroll on new messages
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [continuationMessages.length])

  React.useEffect(() => {
    if (editingIdx !== null) editRef.current?.focus()
  }, [editingIdx])

  // ── Send / Fork / Edit ──

  const sendToEngine = async (
    text: string,
    targetBranchId: string,
    branchState = branches
  ) => {
    const branch = branchState.find((b) => b.id === targetBranchId)
    if (!branch) return
    setSending(true)
    const pathMessages = buildPathMessagesForBranch(branchState, targetBranchId)

    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      source: "continuation",
    }
    setBranches((prev) =>
      prev.map((b) =>
        b.id === targetBranchId ? { ...b, messages: [...b.messages, tempMsg] } : b
      )
    )

    try {
      const res = await fetch("/api/operator-studio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: branch.sessionId,
          threadId: thread.id,
          message: text,
          operatorName: reviewer ?? "operator",
          personaId: selectedPersona.id,
          targetBranchId,
          pathMessages,
        }),
      })
      const data = await res.json()
      setBranches((prev) =>
        prev.map((b) => {
          if (b.id !== targetBranchId) return b
          const updatedMessages = data.message
            ? [
                ...b.messages,
                {
                  ...data.message,
                  source: "continuation" as const,
                },
              ]
            : b.messages
          return { ...b, sessionId: data.sessionId ?? b.sessionId, messages: updatedMessages }
        })
      )
    } catch {
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "Failed to reach the continuation engine. Check that the local cluster is running.",
        createdAt: new Date().toISOString(),
        source: "continuation",
      }
      setBranches((prev) =>
        prev.map((b) =>
          b.id === targetBranchId ? { ...b, messages: [...b.messages, errMsg] } : b
        )
      )
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text || sending) return
    setInput("")
    sendToEngine(text, leafBranchId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFork = (globalIdx: number) => {
    const msg = continuationMessages[globalIdx]
    if (!msg) return
    const newBranchId = `branch-${Date.now()}`
    const newBranch: TimelineBranch = {
      id: newBranchId,
      parentBranchId: msg.branchId!,
      forkAfterIndex: msg.localIdx!,
      messages: [],
      sessionId: null,
    }
    setBranches((prev) => [...prev, newBranch])
    const forkKey = `${msg.branchId}:${msg.localIdx}`
    setSelectedForks((prev) => ({ ...prev, [forkKey]: newBranchId }))
    setInput("")
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleStartEdit = (globalIdx: number) => {
    const msg = continuationMessages[globalIdx]
    if (!msg || msg.role !== "user") return
    setEditingIdx(globalIdx)
    setEditText(msg.content)
  }

  const handleConfirmEdit = () => {
    if (editingIdx === null) return
    const text = editText.trim()
    if (!text) return
    const msg = continuationMessages[editingIdx]
    if (!msg) return
    const forkAfterGlobalIdx = editingIdx - 1

    if (forkAfterGlobalIdx < 0) {
      const newBranchId = `branch-${Date.now()}`
      const nextBranches = [
        ...branches,
        {
          id: newBranchId,
          parentBranchId: "root",
          forkAfterIndex: -1,
          messages: [],
          sessionId: null,
        },
      ]
      setBranches(nextBranches)
      setSelectedForks((prev) => ({ ...prev, ["root:-1"]: newBranchId }))
      setEditingIdx(null)
      setEditText("")
      sendToEngine(text, newBranchId, nextBranches)
    } else {
      const prevMsg = continuationMessages[forkAfterGlobalIdx]
      if (!prevMsg) return
      const newBranchId = `branch-${Date.now()}`
      const nextBranches = [
        ...branches,
        {
          id: newBranchId,
          parentBranchId: prevMsg.branchId!,
          forkAfterIndex: prevMsg.localIdx!,
          messages: [],
          sessionId: null,
        },
      ]
      setBranches(nextBranches)
      setSelectedForks((prev) => ({
        ...prev,
        [`${prevMsg.branchId}:${prevMsg.localIdx}`]: newBranchId,
      }))
      setEditingIdx(null)
      setEditText("")
      sendToEngine(text, newBranchId, nextBranches)
    }
  }

  const handleCancelEdit = () => {
    setEditingIdx(null)
    setEditText("")
  }

  const switchForkByKey = (forkKey: string, direction: "prev" | "next") => {
    const [parentBranchId, forkAfterIndexStr] = forkKey.split(":")
    const forkAfterIndex = parseInt(forkAfterIndexStr, 10)
    const parentBranch = branches.find((b) => b.id === parentBranchId)
    const children = branches.filter(
      (b) => b.parentBranchId === parentBranchId && b.forkAfterIndex === forkAfterIndex
    )
    const parentHasContinuation =
      parentBranch && parentBranch.messages.length > forkAfterIndex + 1
    const continueId = `__continue__${parentBranchId}`
    const options = [
      ...(parentHasContinuation ? [continueId] : []),
      ...children.map((c) => c.id),
    ]
    const current = selectedForks[forkKey] ?? (parentHasContinuation ? continueId : children[0]?.id)
    const currentIndex = options.indexOf(current!)
    const nextIndex =
      direction === "next"
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length
    setSelectedForks((prev) => ({ ...prev, [forkKey]: options[nextIndex] }))
  }

  // ── Message promotion ──

  const handlePromoteMessage = async (
    messageId: string,
    source: "transcript" | "continuation",
    promotionKind: PromotionKind,
    promotionNote: string
  ) => {
    await fetch("/api/operator-studio/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        action: "promote",
        source: source === "transcript" ? "thread" : "chat",
        promotedBy: reviewer ?? "operator",
        promotionKind,
        promotionNote: promotionNote || undefined,
      }),
    })
    router.refresh()
  }

  const handleUnpromoteMessage = async (messageId: string, source: "transcript" | "continuation") => {
    await fetch("/api/operator-studio/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        action: "unpromote",
        source: source === "transcript" ? "thread" : "chat",
      }),
    })
    router.refresh()
  }

  const handleEditMessageContent = async (messageId: string, content: string) => {
    await fetch("/api/operator-studio/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        action: "edit",
        source: "thread",
        content,
      }),
    })
    router.refresh()
  }

  const handleDeleteMessage = async (messageId: string) => {
    await fetch("/api/operator-studio/messages", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        source: "thread",
      }),
    })
    router.refresh()
  }

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      {/* Compact header */}
      <div className="border-b px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7"
            onClick={() => router.push("/operator-studio/memory")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <h1 className="text-sm font-semibold truncate">{title}</h1>
            <SourceAppToken source={thread.sourceApp} size="sm" />
            <Badge
              variant="secondary"
              className={`shrink-0 text-[10px] px-1.5 py-0 h-5 font-normal ${
                REVIEW_STATE_COLORS[thread.reviewState] ?? ""
              }`}
            >
              {REVIEW_STATE_LABELS[thread.reviewState] ?? thread.reviewState}
            </Badge>
            {isDone && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] px-1.5 py-0 h-5 font-normal bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                title={
                  doneState.markedDoneAt
                    ? `Marked done${doneState.markedDoneSource ? " (" + doneState.markedDoneSource + ")" : ""}${doneState.markedDoneBy ? " by " + doneState.markedDoneBy : ""} · ${new Date(doneState.markedDoneAt).toLocaleString()}`
                    : "Marked done"
                }
              >
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                Done
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {messages.length} turns
            </span>
            {thread.promotedFromId && (
              <Link
                href={`/operator-studio/threads/${thread.promotedFromId}`}
                className="hidden sm:inline-flex"
              >
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-5 font-normal hover:bg-muted"
                >
                  <ArrowUpRight className="h-2.5 w-2.5 mr-0.5" />
                  Promoted from workspace
                </Badge>
              </Link>
            )}
            {thread.pulledFromId && (
              <Link
                href={`/operator-studio/threads/${thread.pulledFromId}`}
                className="hidden sm:inline-flex"
              >
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 h-5 font-normal hover:bg-muted"
                >
                  <Globe className="h-2.5 w-2.5 mr-0.5" />
                  Pulled from global
                </Badge>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowMeta(!showMeta)}
            >
              <Info className="h-3 w-3 mr-1" />
              {showMeta ? "Hide" : "Info"}
            </Button>
            {/* Source deep link — open the thread back in the source
                app it was imported from. Supports both URL-scheme
                deep links (Codex, Cursor, ChatGPT) and clipboard-
                command links for CLI sources without a scheme
                (Claude Code). Renders nothing if the source can't be
                resolved. */}
            {(() => {
              const link = getThreadDeepLink(thread)
              return link ? <SourceDeepLinkButton link={link} /> : null
            })()}
            <Button
              variant={isDone ? "secondary" : "ghost"}
              size="sm"
              className={`h-7 px-2 text-xs ${
                isDone
                  ? "text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300"
                  : ""
              }`}
              onClick={handleToggleDone}
              disabled={doneBusy}
              title={
                isDone
                  ? "Reopen this thread (clears the done flag)"
                  : "Mark this thread as done"
              }
            >
              {doneBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              )}
              {isDone ? "Reopen" : "Done"}
            </Button>
            {thread.reviewState !== "promoted" && (
              <PromoteDialog threadId={thread.id} currentThread={thread} />
            )}
            {thread.reviewState === "imported" && (
              <ReviewButton threadId={thread.id} />
            )}
            <CopyThreadMenu
              thread={thread}
              activeWorkspace={activeWorkspace}
            />
            {confirmDeleteThread ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleDeleteThread}
                  disabled={deletingThread}
                >
                  {deletingThread ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setConfirmDeleteThread(false)}
                  disabled={deletingThread}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDeleteThread(true)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* AI-generated capture rationale — why this thread was worth
          keeping. Only shown when there IS one. The previous "no
          rationale on file" empty state fired on every thread when
          the LLM endpoint was unconfigured, training operators to
          ignore the entire banner row. The Echo-mode banner at the
          shell level already conveys the missing-LLM state. */}
      {thread.captureReason && (
        <div className="border-b bg-muted/20 px-4 py-2 shrink-0">
          <p className="flex items-start gap-2 text-xs italic text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{thread.captureReason}</span>
          </p>
        </div>
      )}

      {/* Auto-sync outcome banner. Fast-forward shows briefly; fork
          outcomes stick around until the operator clicks through. */}
      {syncOutcome?.kind === "fast-forward" && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-emerald-500/10 px-4 py-2 text-xs text-emerald-900 dark:text-emerald-100">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Synced {syncOutcome.appended} new message
            {syncOutcome.appended === 1 ? "" : "s"} from upstream.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setSyncOutcome(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
      {(syncOutcome?.kind === "forked-new" ||
        syncOutcome?.kind === "forked-existing") && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-sky-500/10 px-4 py-2 text-xs text-sky-900 dark:text-sky-100">
          <GitFork className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            <strong>
              Upstream diverged from this thread at turn{" "}
              {syncOutcome.divergeAt + 1}.
            </strong>{" "}
            {syncOutcome.kind === "forked-new"
              ? "Auto-forked to capture the new upstream — this thread stays as-is."
              : "An existing fork already captures the current upstream."}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={() =>
              router.push(`/operator-studio/threads/${syncOutcome.forkId}`)
            }
          >
            Open fork
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setSyncOutcome(null)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Collapsible metadata drawer */}
      {showMeta && (
        <div className="border-b bg-muted/30 px-4 py-3 shrink-0 max-h-60 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Provenance */}
            <div className="space-y-1">
              <p className="font-medium text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> Provenance
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Source</dt>
                <dd>{SOURCE_APP_LABELS[thread.sourceApp] ?? thread.sourceApp}</dd>
                <dt className="text-muted-foreground">Key</dt>
                <dd className="truncate">{thread.sourceThreadKey ?? "—"}</dd>
                <dt className="text-muted-foreground">Privacy</dt>
                <dd>{thread.privacyState}</dd>
                <dt className="text-muted-foreground">Imported by</dt>
                <dd>{thread.importedBy}</dd>
                <dt className="text-muted-foreground">Imported at</dt>
                <dd>{new Date(thread.importedAt).toLocaleDateString()}</dd>
              </dl>
              {thread.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {thread.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[9px] px-1 py-0 h-4">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {/* Promoted context + summaries */}
            <div className="space-y-1">
              {thread.promotedSummary && (
                <div>
                  <p className="font-medium text-muted-foreground flex items-center gap-1">
                    <Star className="h-3 w-3 text-emerald-500" /> Promoted Summary
                  </p>
                  <p className="text-xs leading-relaxed">{thread.promotedSummary}</p>
                </div>
              )}
              {thread.whyItMatters && (
                <div>
                  <p className="font-medium text-muted-foreground">Why It Matters</p>
                  <p className="text-xs">{thread.whyItMatters}</p>
                </div>
              )}
              {summaries.length > 0 && (
                <div>
                  <p className="font-medium text-muted-foreground">
                    {summaries.length} summar{summaries.length === 1 ? "y" : "ies"}
                  </p>
                  {summaries.slice(0, 2).map((s) => (
                    <p key={s.id} className="text-xs text-muted-foreground line-clamp-2">
                      [{s.summaryKind}] {s.content}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Selection action bar — debounced floater that appears when
          the operator selects ≥5 chars inside a transcript bubble.
          Two actions: Highlight (instant) + Promote… (opens the
          first-class PromoteMessageDialog seeded with the selection). */}
      <SelectionActionBar
        threadId={thread.id}
        containerRef={scrollRef}
      />

      {/* Timeline + minimap gutter. The minimap is a thin right-edge
          rail that marks promoted turns and turns with highlighted
          passages — Phase 2 stripped-down version of the full
          per-turn density minimap (Phase 3). */}
      <div className="flex flex-1 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-6 space-y-2.5 text-[15px] leading-relaxed">
          {/* Wayseer rollup — only renders when an LLM endpoint is
              configured. Lives at the top of the reader so the operator
              can see what happened before scrolling through 400 turns.
              The v1 single-pass analysis panel still ships as a route
              but is no longer mounted here; the v2 rollup is the
              canonical surface. */}
          {wayseerEnabled && (
            <div className="mb-4">
              <ThreadRollupSection
                threadId={thread.id}
                sourceApp={thread.sourceApp}
                messagesByTurnIndex={messagesByTurnIndex}
              />
            </div>
          )}
          {passages.length > 0 && (
            <ThreadPassagesPanel
              passages={passages}
              onJump={(messageId) => {
                const el = document.getElementById(`msg-${messageId}`)
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              }}
              onPassageDeleted={handlePassageDeleted}
            />
          )}

          {/* ── Fork view: show frozen context header + back link ── */}
          {/*
            Forks store their own copy of the parent's messages (see
            forkThread in queries.ts), so we render `transcriptMessages`
            here — same as original threads — rather than refetching
            parentMessages. That keeps the fork self-contained when the
            parent is in a different workspace or filtered out, which was
            the bug behind "316 turns but shown none".
            parentMessages is still fetched as a fallback for legacy
            forks that were created before we started copying messages.
          */}
          {isFork && (
            <>
              <div className="flex items-center gap-2 py-2">
                <button
                  onClick={() => router.push(`/operator-studio/threads/${thread.parentThreadId}`)}
                  className="text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <ArrowLeft className="h-2.5 w-2.5" />
                  View original thread
                </button>
              </div>
              {(transcriptMessages.length > 0 ||
                parentMessages.length > 0) && (
                <button
                  onClick={() => setShowFrozenContext((s) => !s)}
                  className="w-full rounded-md border border-dashed border-muted-foreground/30 py-2 text-[10px] text-muted-foreground/70 uppercase tracking-widest hover:bg-muted/40 transition-colors flex items-center justify-center gap-2"
                  aria-expanded={showFrozenContext}
                >
                  {showFrozenContext ? "Hide" : "Show"} frozen context
                  <span className="text-muted-foreground/50">
                    ({transcriptMessages.length || parentMessages.length}{" "}
                    turn
                    {(transcriptMessages.length || parentMessages.length) ===
                    1
                      ? ""
                      : "s"}
                    )
                  </span>
                </button>
              )}
            </>
          )}

          {/* ── Fork: render fork's own copied messages as frozen context ── */}
          {isFork &&
            showFrozenContext &&
            transcriptMessages.length > 0 &&
            transcriptMessages.map((msg) => (
              <TimelineMessage
                key={msg.id}
                msg={msg}
                reviewer={reviewer}
                onPromote={handlePromoteMessage}
                onUnpromote={handleUnpromoteMessage}
                onForkFromHere={handleForkFromHere}
                threadId={thread.id}
                threadTitle={title}
                thread={thread}
                planSessions={planSessions}
                passages={passagesByMessage.get(msg.id) ?? []}
                onPassageDeleted={handlePassageDeleted}
              />
            ))}

          {/* ── Fork fallback: legacy forks with no copied messages — fall back to parent ── */}
          {isFork &&
            showFrozenContext &&
            transcriptMessages.length === 0 &&
            parentMessages.length > 0 &&
            parentMessages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => (
                <TimelineMessage
                  key={`parent-${m.id}`}
                  msg={{
                    id: m.id,
                    role: m.role as "user" | "assistant",
                    content: m.content,
                    createdAt: m.createdAt,
                    source: "transcript",
                    turnIndex: m.turnIndex,
                    promotedAt: m.promotedAt,
                    promotedBy: m.promotedBy,
                    promotionNote: m.promotionNote,
                    promotionKind: m.promotionKind,
                  }}
                  reviewer={reviewer}
                  onPromote={handlePromoteMessage}
                  onUnpromote={handleUnpromoteMessage}
                  threadId={thread.parentThreadId ?? thread.id}
                  threadTitle={title}
                  thread={thread}
                  planSessions={planSessions}
                  passages={passagesByMessage.get(m.id) ?? []}
                  onPassageDeleted={handlePassageDeleted}
                />
              ))}

          {/* ── Fork: "Your continuation" divider before chat ── */}
          {isFork && (transcriptMessages.length > 0 || parentMessages.length > 0) && (
            <div className="relative py-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-dashed border-muted-foreground/25" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-3 text-[10px] text-muted-foreground/60 uppercase tracking-widest">
                  Your continuation
                </span>
              </div>
            </div>
          )}

          {/* ── Original thread view: show transcript messages ──
              When the server detected that this thread inherited turns
              from kickoff siblings (or an explicit parent fork), split
              the list at divergedAtTurnIndex:
                 [ inherited prefix ] — collapsed by default
                 [ Show N earlier inherited turns ] button
                 [ original work, starting at the fork point ]
              The button above the body lets readers jump back in
              context when they need it, without burying the thread's
              actual contribution.
          */}
          {isOriginal && hasInheritedPrefix && forkContext && (() => {
            const cut = forkContext.divergedAtTurnIndex
            const inherited = transcriptMessages.filter(
              (m) => (m.turnIndex ?? 0) < cut
            )
            const own = transcriptMessages.filter(
              (m) => (m.turnIndex ?? 0) >= cut
            )
            return (
              <>
                {/* Collapse toggle — always above any visible turns. */}
                <button
                  onClick={() => setShowInheritedPrefix((s) => !s)}
                  className="w-full rounded-md border border-dashed border-muted-foreground/30 py-2 text-[10px] text-muted-foreground/80 uppercase tracking-widest hover:bg-muted/40 transition-colors flex items-center justify-center gap-2 mb-3"
                  aria-expanded={showInheritedPrefix}
                >
                  <GitFork className="h-3 w-3" />
                  {showInheritedPrefix ? "Hide" : "Show"}{" "}
                  pre-fork history ·{" "}
                  <span className="text-muted-foreground/60 normal-case tracking-normal">
                    {forkContext.inheritedCount} turn
                    {forkContext.inheritedCount === 1 ? "" : "s"} inherited from{" "}
                    {forkContext.kind === "kickoff-siblings"
                      ? forkContext.siblings.length === 1
                        ? "a sibling thread"
                        : `${forkContext.siblings.length} sibling threads`
                      : "the parent thread"}
                  </span>
                </button>
                {showInheritedPrefix && inherited.map((msg) => (
                  <TimelineMessage
                    key={msg.id}
                    msg={msg}
                    reviewer={reviewer}
                    onPromote={handlePromoteMessage}
                    onUnpromote={handleUnpromoteMessage}
                    onEditContent={handleEditMessageContent}
                    onDeleteMessage={handleDeleteMessage}
                    onForkFromHere={handleForkFromHere}
                    threadId={thread.id}
                    threadTitle={title}
                    thread={thread}
                    planSessions={planSessions}
                    passages={passagesByMessage.get(msg.id) ?? []}
                    onPassageDeleted={handlePassageDeleted}
                  />
                ))}
                {showInheritedPrefix && inherited.length > 0 && own.length > 0 && (
                  <div className="relative py-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-dashed border-emerald-500/40" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-background px-3 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                        <GitFork className="h-3 w-3" />
                        Fork point · turn {cut + 1}
                      </span>
                    </div>
                  </div>
                )}
                {own.map((msg) => (
                  <TimelineMessage
                    key={msg.id}
                    msg={msg}
                    reviewer={reviewer}
                    onPromote={handlePromoteMessage}
                    onUnpromote={handleUnpromoteMessage}
                    onEditContent={handleEditMessageContent}
                    onDeleteMessage={handleDeleteMessage}
                    onForkFromHere={handleForkFromHere}
                    threadId={thread.id}
                    threadTitle={title}
                    thread={thread}
                    planSessions={planSessions}
                    passages={passagesByMessage.get(msg.id) ?? []}
                    onPassageDeleted={handlePassageDeleted}
                  />
                ))}
              </>
            )
          })()}
          {isOriginal && !hasInheritedPrefix && transcriptMessages.map((msg) => (
            <TimelineMessage
              key={msg.id}
              msg={msg}
              reviewer={reviewer}
              onPromote={handlePromoteMessage}
              onUnpromote={handleUnpromoteMessage}
              onEditContent={handleEditMessageContent}
              onDeleteMessage={handleDeleteMessage}
              onForkFromHere={handleForkFromHere}
              threadId={thread.id}
              threadTitle={title}
              thread={thread}
              planSessions={planSessions}
              passages={passagesByMessage.get(msg.id) ?? []}
              onPassageDeleted={handlePassageDeleted}
            />
          ))}

          {/* ── Original thread: fork-and-continue CTA + existing forks ── */}
          {isOriginal && transcriptMessages.length > 0 && (
            <>
              <div className="relative py-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-dashed border-muted-foreground/25" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background px-3 text-[10px] text-muted-foreground/60 uppercase tracking-widest">
                    End of imported thread
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center py-6 text-center">
                <GitFork className="h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground mb-1">
                  This thread is a frozen artifact.
                </p>
                {wayseerEnabled ? (
                  <>
                    <p className="text-xs text-muted-foreground/60 mb-4 max-w-md">
                      Fork it to start a continuation chat. Your fork gets the full context but the original stays untouched.
                    </p>
                    <Button onClick={handleForkThread} disabled={forking}>
                      {forking ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Forking…
                        </>
                      ) : (
                        <>
                          <GitFork className="mr-2 h-3.5 w-3.5" />
                          Fork & Continue
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground/60 max-w-md">
                    Continuation chat needs an LLM endpoint. Set <code className="rounded bg-muted px-1">WORKBOOK_CLUSTER_ENDPOINTS</code> in <code>.env.local</code> to enable forking.
                  </p>
                )}
              </div>

              {/* Existing forks */}
              {forks.length > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                    Existing forks
                  </p>
                  {forks.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => router.push(`/operator-studio/threads/${f.id}`)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-dashed hover:bg-accent/50 transition-colors text-left"
                    >
                      <GitFork className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {f.promotedTitle ?? f.rawTitle ?? "Untitled fork"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          by {f.ownerName ?? f.importedBy} · {new Date(f.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-[10px] px-1.5 py-0 h-5 font-normal ${
                          REVIEW_STATE_COLORS[f.reviewState] ?? ""
                        }`}
                      >
                        {REVIEW_STATE_LABELS[f.reviewState] ?? f.reviewState}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Fork view: persona selector + continuation chat ── */}
          {isFork && (
            <>
              {/* Persona selector bar — hidden when Wayseer is off; the
                  historical continuation messages below stay visible
                  (they're stored data) but we don't expose new-message
                  controls without a configured LLM endpoint. */}
              {wayseerEnabled && (
              <div className="flex items-center gap-1.5 py-2">
                <TooltipProvider delayDuration={200}>
                  {CONTINUATION_PERSONAS.map((persona) => (
                    <Tooltip key={persona.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setSelectedPersona(persona)}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold transition-all ${
                            persona.color
                          } ${
                            selectedPersona.id === persona.id
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-110"
                              : "opacity-60 hover:opacity-100"
                          }`}
                        >
                          {persona.initials}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-48">
                        <p className="font-medium text-xs">{persona.name}</p>
                        <p className="text-[10px] text-muted-foreground">{persona.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </TooltipProvider>
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {selectedPersona.name}
                </span>
              </div>
              )}

              {/* Continuation messages */}
              {continuationMessages.map((msg, globalIdx) => (
                <React.Fragment key={msg.id}>
                  {editingIdx === globalIdx ? (
                    <div className="flex flex-col gap-1.5 my-2">
                      <Textarea
                        ref={editRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault()
                            handleConfirmEdit()
                          }
                          if (e.key === "Escape") handleCancelEdit()
                        }}
                        rows={3}
                        className="text-sm resize-none"
                      />
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={handleCancelEdit}>
                          <X className="h-3 w-3 mr-1" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={handleConfirmEdit}
                          disabled={!editText.trim() || sending}
                        >
                          <Check className="h-3 w-3 mr-1" /> Resend as fork
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <TimelineMessage
                      msg={msg}
                      reviewer={reviewer}
                      onPromote={handlePromoteMessage}
                      onUnpromote={handleUnpromoteMessage}
                      onEdit={() => handleStartEdit(globalIdx)}
                      onFork={() => handleFork(globalIdx)}
                      showBranchActions={!sending && continuationMessages.length > 1}
                      siblingInfo={msg.siblingInfo}
                      onSwitchSibling={switchForkByKey}
                      threadId={thread.id}
                      threadTitle={title}
                      thread={thread}
                      planSessions={planSessions}
                      passages={passagesByMessage.get(msg.id) ?? []}
                      onPassageDeleted={handlePassageDeleted}
                    />
                  )}
                </React.Fragment>
              ))}

              {/* Sending indicator */}
              {sending && (
                <div className="flex justify-start py-2">
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}

              {/* Empty state */}
              {continuationMessages.length === 0 && (
                <div className="text-center py-3">
                  <p className="text-xs text-muted-foreground/50">
                    {wayseerEnabled
                      ? "Pick a persona above and continue the work."
                      : "Continuation chat is disabled — no LLM endpoint configured."}
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Related threads (tsvector similarity) ── */}
          {relatedThreads.length > 0 && (
            <div className="mt-8 pt-6 border-t">
              <div className="flex items-center gap-1.5 mb-3">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Related threads
                </p>
              </div>
              <div className="space-y-2">
                {relatedThreads.map((rel) => (
                  <button
                    key={rel.id}
                    onClick={() =>
                      router.push(`/operator-studio/threads/${rel.id}`)
                    }
                    className="w-full flex flex-col gap-1.5 px-3 py-2 rounded-lg border hover:bg-accent/50 transition-colors text-left"
                  >
                    <p className="text-sm font-medium truncate">
                      {rel.promotedTitle ?? rel.rawTitle ?? "Untitled thread"}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <SourceAppToken
                        source={rel.sourceApp}
                        size="sm"
                        shortLabel
                      />
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 h-5 font-normal ${
                          REVIEW_STATE_COLORS[
                            rel.reviewState as keyof typeof REVIEW_STATE_COLORS
                          ] ?? ""
                        }`}
                      >
                        {REVIEW_STATE_LABELS[
                          rel.reviewState as keyof typeof REVIEW_STATE_LABELS
                        ] ?? rel.reviewState}
                      </Badge>
                      {rel.tags.slice(0, 2).map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-[9px] px-1 py-0 h-4"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
        <ThreadMinimapGutter
          messages={transcriptMessages}
          passagesByMessage={passagesByMessage}
          scrollContainerRef={scrollRef}
          onJump={(messageId) => {
            const el = document.getElementById(`msg-${messageId}`)
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          }}
        />
      </div>

      {/* Input bar — only on forks, and only when Wayseer (LLM endpoint)
          is configured. Off ⇒ thread reads as a frozen artifact. */}
      {isFork && wayseerEnabled && (
        <div className="border-t px-4 py-3 shrink-0 bg-background">
          <div className="max-w-3xl mx-auto flex gap-2">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold self-end ${selectedPersona.color}`}>
              {selectedPersona.initials}
            </div>
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Continue with ${selectedPersona.name}…`}
              rows={2}
              className="min-h-[2.5rem] resize-none text-sm flex-1"
              disabled={sending}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="shrink-0 self-end"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground text-center">
            Shift+Enter for new line · Enter to send
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Full Content (no truncation) ──────────────────────────────────────────

function ExpandableContent({ content }: { content: string }) {
  return <MarkdownProse content={content} className="break-words" />
}

// ─── Thread passages panel ───────────────────────────────────────────────
//
// Top-of-thread strip that lists every promoted passage in the thread.
// Click a row to scroll the matching message into view. Collapsed by
// default — the thread is the primary content; this is a navigational
// affordance, not the headline.

function ThreadPassagesPanel({
  passages,
  onJump,
  onPassageDeleted,
}: {
  passages: OperatorThreadPassage[]
  onJump: (messageId: string) => void
  onPassageDeleted?: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function unpromote(id: string) {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await fetch(
        `/api/operator-studio/passages/${id}`,
        { method: "DELETE" }
      )
      if (res.ok) onPassageDeleted?.(id)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="rounded-md border mb-3"
      style={{
        background: "rgba(16,185,129,0.04)",
        borderColor: "rgba(16,185,129,0.25)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300"
      >
        <span>✦</span>
        <span>{passages.length} passage{passages.length === 1 ? "" : "s"} elevated in this thread</span>
        <span className="ml-auto opacity-60">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul className="border-t border-emerald-500/20 divide-y divide-emerald-500/10">
          {passages.map((p) => (
            <li
              key={p.id}
              className="px-3 py-2 hover:bg-emerald-500/5 group/row"
            >
              <button
                type="button"
                onClick={() => onJump(p.messageId)}
                className="w-full text-left"
              >
                <p className="text-[12.5px] leading-relaxed italic">
                  &ldquo;{truncate(p.textSnapshot, 200)}&rdquo;
                </p>
                <div className="mt-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  <span>by {p.promotedBy}</span>
                  <span>·</span>
                  <span>
                    {new Date(p.promotedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="ml-auto opacity-0 group-hover/row:opacity-100 transition-opacity text-emerald-700 dark:text-emerald-400">
                    Jump →
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  unpromote(p.id)
                }}
                disabled={busyId === p.id}
                className="mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30 opacity-0 group-hover/row:opacity-100 transition-opacity"
              >
                {busyId === p.id ? "…" : "Un-promote"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n).trimEnd() + "…"
}

// ─── Passage ribbon ──────────────────────────────────────────────────────
//
// Inline indicator pinned to the bottom of a message bubble that has at
// least one promoted passage. Collapsed: shows "✦ N passages elevated".
// Expanded: lists each passage as a quote block, with drift detection
// (snapshot text no longer present in the live content) and an
// un-promote control. This is the v0 visual indicator for "what was
// selected and elevated" — true inline `<mark>` highlighting can layer
// on top later without changing this surface.

function PassageRibbon({
  passages,
  messageContent,
  onPassageDeleted,
}: {
  passages: OperatorThreadPassage[]
  messageContent: string
  onPassageDeleted?: (id: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function unpromote(id: string) {
    if (busyId) return
    setBusyId(id)
    try {
      const res = await fetch(
        `/api/operator-studio/passages/${id}`,
        { method: "DELETE" }
      )
      if (res.ok) onPassageDeleted?.(id)
    } finally {
      setBusyId(null)
    }
  }

  const sorted = React.useMemo(
    () => [...passages].sort((a, b) => a.startOffset - b.startOffset),
    [passages]
  )

  return (
    <div className="mt-2 pt-1.5 border-t border-emerald-500/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-mono uppercase tracking-[0.18em]"
      >
        <span>✦ {passages.length} passage{passages.length === 1 ? "" : "s"} elevated</span>
        <span className="opacity-60">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <ul className="mt-1.5 space-y-1.5">
          {sorted.map((p) => {
            const drifted = !messageContent.includes(p.textSnapshot)
            return (
              <li
                key={p.id}
                className="text-[12.5px] leading-relaxed pl-2 border-l-2 border-emerald-500/40 group/passage"
                style={{ fontFamily: "inherit" }}
              >
                <span className="italic">&ldquo;{p.textSnapshot}&rdquo;</span>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  <span>by {p.promotedBy}</span>
                  <span>·</span>
                  <span>
                    {new Date(p.promotedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {drifted && (
                    <span className="text-amber-600 dark:text-amber-400">
                      · drifted
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => unpromote(p.id)}
                    disabled={busyId === p.id}
                    className="ml-auto opacity-0 group-hover/passage:opacity-100 transition-opacity hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30"
                  >
                    {busyId === p.id ? "…" : "Un-promote"}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Timeline Message ───────────────────────────────────────────────────────

function TimelineMessage({
  msg,
  reviewer,
  onPromote,
  onUnpromote,
  onEdit,
  onFork,
  onForkFromHere,
  onEditContent,
  onDeleteMessage,
  showBranchActions,
  siblingInfo,
  onSwitchSibling,
  threadId,
  threadTitle,
  thread,
  planSessions,
  passages,
  onPassageDeleted,
}: {
  msg: ChatMessage
  reviewer: string | null
  onPromote: (id: string, source: "transcript" | "continuation", kind: PromotionKind, note: string) => void
  onUnpromote: (id: string, source: "transcript" | "continuation") => void
  onEdit?: () => void
  onFork?: () => void
  /**
   * Fork-at-point: "copy this thread up through this turn, create a new
   * thread so I can try a different direction from here." Only
   * meaningful on transcript messages — continuation messages already
   * live in a branch structure. `turnIndex` is the 0-based index into
   * the source thread's turns.
   */
  onForkFromHere?: (turnIndex: number) => Promise<void>
  onEditContent?: (id: string, content: string) => Promise<void>
  onDeleteMessage?: (id: string) => Promise<void>
  showBranchActions?: boolean
  siblingInfo?: { total: number; current: number; forkKey: string } | null
  onSwitchSibling?: (forkKey: string, direction: "prev" | "next") => void
  threadId?: string
  threadTitle?: string
  /** Pass the thread through so the per-message hover toolbar can
   *  derive a source-app deep link (Codex turn link, Claude Code
   *  resume command, etc.). Optional so non-thread call sites still
   *  compile. */
  thread?: OperatorThread
  planSessions?: OperatorSession[]
  passages?: OperatorThreadPassage[]
  onPassageDeleted?: (id: string) => void
}) {
  const isUser = msg.role === "user"
  const isPromoted = !!msg.promotedAt
  const isTranscript = msg.source === "transcript"
  const bubbleRef = React.useRef<HTMLDivElement>(null)

  // First-class promote dialog state. Two callers open it:
  // (1) the hover toolbar's Promote button (whole-turn mode, no
  //     passageText), and
  // (2) externally via the SelectionActionBar dispatching a
  //     custom event with `passageText` payload.
  const [promoteOpen, setPromoteOpen] = React.useState(false)
  const [promotePassageText, setPromotePassageText] = React.useState<
    string | undefined
  >(undefined)
  React.useEffect(() => {
    function onOpenPromote(e: Event) {
      const detail = (e as CustomEvent<{
        messageId: string
        passageText?: string
      }>).detail
      if (!detail || detail.messageId !== msg.id) return
      setPromotePassageText(detail.passageText)
      setPromoteOpen(true)
    }
    document.addEventListener("os:promote-message", onOpenPromote)
    return () =>
      document.removeEventListener("os:promote-message", onOpenPromote)
  }, [msg.id])

  // Which session (if any) contains this message's createdAt? Only
  // transcript messages can be promoted to a plan step — continuation
  // chat messages live in a different table and aren't valid targets
  // for the fulfillment join.
  const candidateSession = React.useMemo(() => {
    if (!isTranscript || !planSessions || planSessions.length === 0) {
      return null
    }
    return findSessionForTimestamp(planSessions, msg.createdAt)
  }, [isTranscript, planSessions, msg.createdAt])

  // Inline edit state
  const [editing, setEditing] = React.useState(false)
  const [editContent, setEditContent] = React.useState(msg.content)
  const [saving, setSaving] = React.useState(false)

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  // Copy-reference state (promoted-message affordance)
  const [refCopied, setRefCopied] = React.useState(false)

  const handleCopyReference = async () => {
    if (!threadId) return
    const origin =
      typeof window !== "undefined" ? window.location.origin : ""
    const url = `${origin}/operator-studio/threads/${threadId}#msg-${msg.id}`
    const kindLabel = msg.promotionKind
      ? PROMOTION_KIND_LABELS[msg.promotionKind]
      : "Promoted"
    const actor = msg.promotedBy ?? "operator"
    const title = threadTitle ?? "thread"
    const snippet =
      msg.content.length > 200
        ? `${msg.content.slice(0, 200).trim()}…`
        : msg.content.trim()
    // Each line must start with "> " to stay inside the blockquote.
    const snippetBlock = snippet
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")
    const reference =
      `> **[Promoted insight]** ${kindLabel} from **${actor}** in [${title}](${url}):\n` +
      `>\n` +
      `${snippetBlock}`
    try {
      await navigator.clipboard.writeText(reference)
      setRefCopied(true)
      setTimeout(() => setRefCopied(false), 1500)
    } catch {
      // Clipboard unavailable; silently ignore.
    }
  }

  const handleSaveEdit = async () => {
    if (!onEditContent || editContent.trim() === msg.content) {
      setEditing(false)
      return
    }
    setSaving(true)
    await onEditContent(msg.id, editContent.trim())
    setSaving(false)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!onDeleteMessage) return
    setDeleting(true)
    await onDeleteMessage(msg.id)
    setDeleting(false)
    setConfirmDelete(false)
  }

  // Deliberate, click-driven highlight passage flow — replaces the
  // old auto-popup selection floater. The user picks text inside this
  // bubble, then clicks the Highlight button. We confirm the selection
  // is scoped to bubbleRef before posting; if the selection is empty
  // we surface a one-shot hint instead of failing silently.
  const [highlighting, setHighlighting] = React.useState(false)
  const [highlightHint, setHighlightHint] = React.useState<string | null>(
    null
  )
  const handleHighlightPassage = React.useCallback(async () => {
    if (!threadId) return
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ""
    if (!text || !sel || sel.rangeCount === 0) {
      setHighlightHint("Select text inside this message first.")
      setTimeout(() => setHighlightHint(null), 2500)
      return
    }
    // Scope check: the selection's common ancestor must live inside
    // this bubble. Otherwise a stray selection elsewhere on the page
    // would post against the wrong message.
    const range = sel.getRangeAt(0)
    if (
      !bubbleRef.current ||
      !bubbleRef.current.contains(range.commonAncestorContainer)
    ) {
      setHighlightHint("Selection isn’t inside this message.")
      setTimeout(() => setHighlightHint(null), 2500)
      return
    }
    setHighlighting(true)
    try {
      const res = await fetch(
        `/api/operator-studio/threads/${threadId}/passages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: msg.id, text }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setHighlightHint(
          body?.code === "stale_selection"
            ? "Text drifted — reselect and retry."
            : "Couldn’t save highlight."
        )
        setTimeout(() => setHighlightHint(null), 3000)
        return
      }
      const body = (await res.json()) as { passage: OperatorThreadPassage }
      // Bubble up to the parent's passages state via a custom event;
      // see the listener in ThreadDetail (search "os:passage-created").
      document.dispatchEvent(
        new CustomEvent<OperatorThreadPassage>("os:passage-created", {
          detail: body.passage,
        })
      )
      sel.removeAllRanges()
    } finally {
      setHighlighting(false)
    }
  }, [threadId, msg.id])

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group flex ${isUser ? "justify-end" : "justify-start"} py-1`}
    >
      <div className="flex flex-col gap-0.5 max-w-[85%]">
        {/* Role label for transcript messages */}
        {isTranscript && (
          <div className={`flex items-center gap-1.5 ${isUser ? "justify-end" : "justify-start"}`}>
            <span className="text-[10px] text-muted-foreground/50">
              {msg.role} · turn {msg.turnIndex}
            </span>
            {isPromoted && (
              <Badge
                variant="secondary"
                className={`text-[9px] px-1 py-0 h-4 ${
                  PROMOTION_KIND_COLORS[msg.promotionKind!] ?? ""
                }`}
              >
                {PROMOTION_KIND_EMOJI[msg.promotionKind!]}{" "}
                {PROMOTION_KIND_LABELS[msg.promotionKind!] ?? "Promoted"}
              </Badge>
            )}
          </div>
        )}

        {/* Sibling switcher — ChatGPT-style "< 1/3 >" */}
        {siblingInfo && siblingInfo.total > 1 && onSwitchSibling && (
          <div className={`flex items-center gap-0.5 ${isUser ? "justify-end" : "justify-start"}`}>
            <div className="flex items-center gap-0.5 bg-muted/60 rounded-full px-1.5 py-0.5">
              <button
                onClick={() => onSwitchSibling(siblingInfo.forkKey, "prev")}
                className="p-0.5 hover:bg-muted rounded transition-colors"
              >
                <ChevronLeft className="h-3 w-3 text-muted-foreground" />
              </button>
              <span className="text-[10px] text-muted-foreground px-0.5 select-none tabular-nums">
                {siblingInfo.current + 1}/{siblingInfo.total}
              </span>
              <button
                onClick={() => onSwitchSibling(siblingInfo.forkKey, "next")}
                className="p-0.5 hover:bg-muted rounded transition-colors"
              >
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          </div>
        )}

        {/* Message bubble */}
        {editing ? (
          <div className="rounded-lg border border-primary/40 bg-muted/30 p-2 space-y-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={Math.min(20, Math.max(3, editContent.split("\n").length + 1))}
              className="text-sm font-mono resize-y"
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setEditContent(msg.content)
                }}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEdit}
                disabled={saving || editContent.trim() === msg.content}
              >
                {saving ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Check className="h-3 w-3 mr-1" />
                )}
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div
            ref={bubbleRef}
            // The data attribute is preserved as a stable hook for the
            // per-bubble Highlight button (it scopes window.getSelection
            // to this message). The old auto-popup floater is gone; the
            // attribute now serves a deliberate, button-driven action.
            //
            // `relative` is required so PassageHighlights' absolute
            // overlay rectangles resolve to this bubble's coordinate
            // system instead of escaping to the viewport.
            data-passage-message-id={msg.id}
            className={`relative rounded-lg px-4 py-3 text-[15px] leading-relaxed ${
              isUser
                ? "border border-primary/20 bg-primary/8 text-foreground dark:bg-primary/10"
                : isTranscript
                  ? "bg-muted/40"
                  : "bg-muted/60"
            } ${isPromoted ? "ring-1 ring-amber-500/30" : ""} ${
              passages && passages.length > 0
                ? "ring-1 ring-emerald-500/40"
                : ""
            }`}
          >
            {/* Sticky role marker — only on tall messages where you'd
                otherwise lose track of who's speaking by the time you
                scroll past the top. The chip sticks to the top of the
                viewport while the bubble is in view, then releases. */}
            {msg.content.length > 1500 && (
              <div
                className={`sticky top-2 z-10 -mx-4 -mt-3 mb-2 flex items-center gap-2 border-b px-4 py-1 text-[10px] uppercase tracking-wider backdrop-blur-sm ${
                  isUser
                    ? "border-primary/15 bg-primary/8 text-foreground/70 dark:bg-primary/15"
                    : "border-border/40 bg-background/70 text-muted-foreground"
                }`}
              >
                <span>{isUser ? "user" : "assistant"}</span>
                {typeof msg.turnIndex === "number" && (
                  <span className="opacity-60">· turn {msg.turnIndex}</span>
                )}
              </div>
            )}
            <ExpandableContent content={msg.content} />
            {/* Inline passage highlights — overlay rectangles painted
                over the rendered text via Range.getClientRects(). The
                bubble's `relative` positioning anchors them; click any
                rect to open the rich popover with provenance + actions. */}
            {passages && passages.length > 0 && (
              <PassageHighlights
                bubbleRef={bubbleRef}
                passages={passages}
                onPassageDeleted={onPassageDeleted}
              />
            )}
            {msg.modelLabel && (
              <div className="mt-1 text-[10px] opacity-50">via {msg.modelLabel}</div>
            )}
            {isPromoted && msg.promotionNote && (
              <div className="mt-1.5 pt-1.5 border-t border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
                &ldquo;{msg.promotionNote}&rdquo; — {msg.promotedBy}
              </div>
            )}
            {passages && passages.length > 0 && (
              <PassageRibbon
                passages={passages}
                messageContent={msg.content}
                onPassageDeleted={onPassageDeleted}
              />
            )}
          </div>
        )}

        {/* Delete confirmation */}
        {confirmDelete && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground">Delete this message?</span>
            <Button
              variant="destructive"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, delete"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        )}

        {/* Continuation message label */}
        {!isTranscript && !isUser && msg.modelLabel && (
          <span className="text-[10px] text-muted-foreground/40">
            via {msg.modelLabel}
          </span>
        )}

        {/* Hover actions — kept tight on purpose. Promote and Open-in-
            source are the two primary actions that stay inline; the
            rest (Highlight, Quote→Step, Edit, Delete, Fork…) tuck
            behind a `⋯` overflow so the toolbar reads as 2-3 chips
            instead of 5-6. Reduces decision fatigue while reading and
            leaves the surface clean for the eye. */}
        {(() => {
          // Per-message "Open in source" was removed: none of our
          // supported source apps actually anchor at a specific turn,
          // so the link would just open the thread tail (same as the
          // thread-header link). Header link stays; per-message
          // doesn't need the menu entry.
          const showQuoteToStep = !!candidateSession
          const showCopyReference = !!(isPromoted && threadId)
          const showHighlight = !!(threadId && !isPromoted)
          const showEdit =
            (isTranscript && !!onEditContent && !editing) ||
            (showBranchActions && !isTranscript && isUser && !!onEdit)
          const showDelete = isTranscript && !!onDeleteMessage && !editing
          const showFork = !!(showBranchActions && !isTranscript && onFork)
          const showForkFromHere =
            !!onForkFromHere &&
            isTranscript &&
            typeof msg.turnIndex === "number"
          const hasOverflow =
            showHighlight ||
            showQuoteToStep ||
            showCopyReference ||
            showEdit ||
            showDelete ||
            showFork ||
            showForkFromHere

          return (
            <div
              className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                isUser ? "justify-end" : "justify-start"
              }`}
            >
              {/* Primary: Promote / Unpromote */}
              {isPromoted ? (
                <button
                  onClick={() => onUnpromote(msg.id, msg.source)}
                  className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  <Flame className="h-2.5 w-2.5" />
                  Unpromote
                </button>
              ) : (
                <button
                  onClick={() => setPromoteOpen(true)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  <Flame className="h-2.5 w-2.5" />
                  Promote
                </button>
              )}

              {/* Overflow — everything else, behind a ⋯ trigger so the
                  inline row stays calm. Promote stays inline because
                  it's the headline action; everything else (Open in
                  source, Highlight, Quote → step, Edit, Fork, Delete)
                  is one click away in the menu. */}
              {hasOverflow && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More message actions"
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align={isUser ? "end" : "start"}
                    className="w-52"
                  >
                    {showHighlight && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          // Capture the live selection BEFORE the
                          // menu closes — closing the menu can shift
                          // focus and collapse the selection.
                          e.preventDefault()
                          handleHighlightPassage()
                        }}
                        disabled={highlighting}
                      >
                        {highlighting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Highlighter className="h-3 w-3" />
                        )}
                        Highlight selection
                      </DropdownMenuItem>
                    )}
                    {/* Quote→Step keeps its own popover trigger — we
                        wrap it in the menu item so visual placement is
                        consistent. The popover opens above the menu. */}
                    {showQuoteToStep && candidateSession && (
                      <div className="px-1 py-0.5">
                        <QuoteToStepPopover
                          session={candidateSession}
                          messageId={msg.id}
                          messageContent={msg.content}
                          bubbleRef={bubbleRef}
                        />
                      </div>
                    )}
                    {showCopyReference && (
                      <DropdownMenuItem onClick={handleCopyReference}>
                        {refCopied ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy reference
                          </>
                        )}
                      </DropdownMenuItem>
                    )}
                    {(showEdit || showDelete) && (showHighlight || showQuoteToStep || showCopyReference) && (
                      <DropdownMenuSeparator />
                    )}
                    {showEdit && isTranscript && onEditContent && (
                      <DropdownMenuItem
                        onClick={() => {
                          setEditContent(msg.content)
                          setEditing(true)
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {showEdit && !isTranscript && onEdit && (
                      <DropdownMenuItem onClick={onEdit}>
                        <Pencil className="h-3 w-3" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {showFork && onFork && (
                      <DropdownMenuItem onClick={onFork}>
                        <GitFork className="h-3 w-3" />
                        Fork
                      </DropdownMenuItem>
                    )}
                    {showForkFromHere && onForkFromHere && (
                      <DropdownMenuItem
                        onClick={() => onForkFromHere(msg.turnIndex!)}
                      >
                        <GitFork className="h-3 w-3" />
                        Fork from here
                      </DropdownMenuItem>
                    )}
                    {showDelete && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setConfirmDelete(true)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        })()}

        {/* One-shot inline hint for the Highlight button — shown when
            the user clicks Highlight without an active text selection,
            or the selection drifted. Auto-clears on a short timer. */}
        {highlightHint && (
          <p
            className={`text-[10px] italic text-muted-foreground/80 ${
              isUser ? "text-right" : "text-left"
            }`}
          >
            {highlightHint}
          </p>
        )}
      </div>

      {/* First-class promote dialog. Mounted per-message so the dialog
          state is colocated with the message's identity — saves us
          having to thread `currentlyPromotingMessageId` through the
          parent timeline. */}
      {threadId && (
        <PromoteMessageDialog
          open={promoteOpen}
          onOpenChange={(o) => {
            setPromoteOpen(o)
            if (!o) setPromotePassageText(undefined)
          }}
          threadId={threadId}
          messageId={msg.id}
          source={msg.source}
          passageText={promotePassageText}
          onPromoteMessage={onPromote}
          onPassageCreated={(p) =>
            document.dispatchEvent(
              new CustomEvent<OperatorThreadPassage>(
                "os:passage-created",
                { detail: p }
              )
            )
          }
        />
      )}
    </div>
  )
}

// ─── Quote → Step Popover ───────────────────────────────────────────────────

/**
 * Promote a transcript message (or the currently-selected passage inside
 * it) to a plan step on the message's containing Session Space.
 *
 * Selection handling is best-effort: at click time, we check
 * `window.getSelection()`. If the selection is non-empty AND entirely
 * contained within this message's bubble, it's used as the promotion
 * note. Otherwise we fall back to the whole message content. Either way
 * the note is capped at 2048 chars (matches the API schema).
 */
function QuoteToStepPopover({
  session,
  messageId,
  messageContent,
  bubbleRef,
}: {
  session: OperatorSession
  messageId: string
  messageContent: string
  bubbleRef: React.RefObject<HTMLDivElement | null>
}) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)
  // Snapshot the selection at the moment the user clicks the trigger —
  // opening the popover itself tears down the browser selection, so we
  // can't read it later from inside the menu.
  const [pendingNote, setPendingNote] = React.useState<string | null>(null)

  // The session.planSteps jsonb is the legacy storage and is empty for
  // plans created via the new operator_plans / operator_plan_steps
  // schema. Fetch the workspace's active plan on open so we always
  // surface the real, current step list (and the right plan id to POST
  // the fulfillment against).
  const [activePlan, setActivePlan] = React.useState<{
    id: string
    steps: Array<{ id: string; title: string; order?: number }>
  } | null>(null)
  const [planLoading, setPlanLoading] = React.useState(false)
  const [planError, setPlanError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setPlanLoading(true)
    setPlanError(null)
    fetch("/api/operator-studio/plans/active")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return
        const plan = data?.plan
        if (!plan?.id) {
          setActivePlan(null)
          return
        }
        setActivePlan({
          id: plan.id,
          steps: Array.isArray(plan.steps)
            ? plan.steps.map((s: { id: string; title: string; order?: number }) => ({
                id: s.id,
                title: s.title,
                order: s.order,
              }))
            : [],
        })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setPlanError(e instanceof Error ? e.message : "Failed to load plan")
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function captureSelection(): string | null {
    if (typeof window === "undefined") return null
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
    const text = sel.toString().trim()
    if (!text) return null
    const bubble = bubbleRef.current
    if (!bubble) return null
    // Require the selection to be anchored inside this message's bubble.
    // Otherwise the user may have selected text in a sibling message and
    // we'd promote the wrong passage.
    const range = sel.getRangeAt(0)
    if (!bubble.contains(range.commonAncestorContainer)) return null
    return text
  }

  async function promote(stepId: string) {
    if (!activePlan) return
    setBusy(stepId)
    try {
      const selection = pendingNote
      const note = (selection ?? messageContent).slice(0, 2048)
      // Plan-scoped endpoint (resolves the active session server-side
      // and bypasses the legacy session.planSteps validation that
      // would reject steps from the new operator_plan_steps table).
      const res = await fetch(
        `/api/operator-studio/plans/${activePlan.id}/steps/${stepId}/fulfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType: "message",
            targetId: messageId,
            note,
          }),
        }
      )
      if (res.ok) {
        setDone(stepId)
        setTimeout(() => {
          setDone(null)
          setOpen(false)
        }, 900)
      } else {
        const data = await res.json().catch(() => ({}))
        window.alert(
          `Couldn't promote: ${data.error ?? `HTTP ${res.status}`}`
        )
      }
    } finally {
      setBusy(null)
    }
  }

  const planSteps = activePlan?.steps ?? []
  const hasSelection = !!pendingNote
  void session // session prop kept for parent-API stability; no longer read here

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setPendingNote(captureSelection())
        else {
          setPendingNote(null)
          setDone(null)
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
          title="Promote message (or selected text) to a plan step"
        >
          <Target className="h-2.5 w-2.5" />
          Quote → step
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" side="top" align="start">
        <div className="space-y-2">
          <div className="px-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Promote to plan step
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {session.label ?? "This session"}
            </p>
          </div>

          {hasSelection ? (
            <div className="rounded border bg-muted/40 px-2 py-1.5">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                Selected passage
              </p>
              <p className="text-[11px] line-clamp-3 whitespace-pre-wrap">
                {pendingNote}
              </p>
            </div>
          ) : (
            <div className="rounded border border-dashed px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">
                No text selected — the whole message will be quoted.
              </p>
            </div>
          )}

          {planLoading ? (
            <div className="px-1 py-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading plan…
            </div>
          ) : planError ? (
            <div className="px-1 py-2 text-[11px] text-rose-600 dark:text-rose-400">
              Couldn&apos;t load plan: {planError}
            </div>
          ) : !activePlan || planSteps.length === 0 ? (
            <div className="px-1 py-2 text-[11px] text-muted-foreground">
              No plan steps yet. Open the Plan page to sketch one,
              then come back to promote this passage.
            </div>
          ) : (
            <div className="space-y-0.5">
              {planSteps.map((step, i) => {
                const isDone = done === step.id
                const isBusy = busy === step.id
                return (
                  <button
                    key={step.id}
                    onClick={() => !isBusy && promote(step.id)}
                    disabled={!!busy}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <span className="text-[10px] font-mono text-muted-foreground w-4">
                      {i + 1}.
                    </span>
                    <span className="flex-1 truncate">
                      {step.title || "(untitled)"}
                    </span>
                    {isDone ? (
                      <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// (Replaced) PromoteMessagePopover — the per-message promote popover
// was anemic (single-line note input, kind chips on a tiny strip) and
// hid the affordance behind a 64-px chip. Replaced by the first-class
// <PromoteMessageDialog>; the hover-toolbar Promote button now drives
// that dialog instead.

// ─── Promote Thread Dialog ──────────────────────────────────────────────────

function PromoteDialog({
  threadId,
  currentThread,
}: {
  threadId: string
  currentThread: OperatorThread
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [promotedTitle, setPromotedTitle] = React.useState(
    currentThread.promotedTitle ?? currentThread.rawTitle ?? ""
  )
  const [promotedSummary, setPromotedSummary] = React.useState(
    currentThread.promotedSummary ?? ""
  )
  const [whyItMatters, setWhyItMatters] = React.useState(
    currentThread.whyItMatters ?? ""
  )
  const [tags, setTags] = React.useState(currentThread.tags.join(", "))
  const [projectSlug, setProjectSlug] = React.useState(
    currentThread.projectSlug ?? ""
  )

  const handlePromote = async () => {
    setSaving(true)
    try {
      await fetch(`/api/operator-studio/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promote",
          promotedTitle,
          promotedSummary,
          whyItMatters: whyItMatters || undefined,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          projectSlug: projectSlug || undefined,
        }),
      })
      setOpen(false)
      router.refresh()
    } catch {
      // handle error
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
          <Star className="mr-1 h-3 w-3" />
          Promote
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote Thread</DialogTitle>
          <DialogDescription>
            Create an org-safe promoted version of this thread.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Promoted Title</Label>
            <Input
              value={promotedTitle}
              onChange={(e) => setPromotedTitle(e.target.value)}
              placeholder="Clean, team-safe title"
            />
          </div>
          <div className="space-y-2">
            <Label>Promoted Summary</Label>
            <Textarea
              value={promotedSummary}
              onChange={(e) => setPromotedSummary(e.target.value)}
              placeholder="What this thread covers and why it matters"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Why It Matters</Label>
            <Input
              value={whyItMatters}
              onChange={(e) => setWhyItMatters(e.target.value)}
              placeholder="Strategic significance in one line"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tags (comma separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="strategy, product"
              />
            </div>
            <div className="space-y-2">
              <Label>Project</Label>
              <Input
                value={projectSlug}
                onChange={(e) => setProjectSlug(e.target.value)}
                placeholder="acme-app, auth-rewrite"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handlePromote}
            disabled={saving || !promotedTitle || !promotedSummary}
          >
            {saving ? "Promoting…" : "Promote to Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Review Button ──────────────────────────────────────────────────────────

function ReviewButton({ threadId }: { threadId: string }) {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)

  const handleReview = async () => {
    setLoading(true)
    try {
      await fetch(`/api/operator-studio/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewState: "in-review" }),
      })
      router.refresh()
    } catch {
      // handle error
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={handleReview}
      disabled={loading}
    >
      <Eye className="mr-1 h-3 w-3" />
      {loading ? "Opening…" : "Review"}
    </Button>
  )
}

// ─── Copy Thread Menu (cross-workspace Promote / Pull) ──────────────────────

type CopyAction = "promote" | "pull"

interface CopyResult {
  action: CopyAction
  newThreadId: string
  viewUrl: string
}

function CopyThreadMenu({
  thread,
  activeWorkspace,
}: {
  thread: OperatorThread
  activeWorkspace: Workspace
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<CopyAction | null>(
    null
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<CopyResult | null>(null)

  const threadInGlobal = thread.workspaceId === GLOBAL_WORKSPACE_ID
  const activeIsGlobal = activeWorkspace.id === GLOBAL_WORKSPACE_ID

  // Promote is only valid when the thread lives in a sub-workspace AND we're
  // viewing that sub-workspace. (The copy route resolves the source from the
  // active workspace cookie.)
  const canPromote = !threadInGlobal && thread.workspaceId === activeWorkspace.id
  // Pull is only valid when the thread is in global AND the active workspace
  // is a sub-workspace (the target).
  const canPull = threadInGlobal && !activeIsGlobal

  if (!canPromote && !canPull) return null

  const reset = () => {
    setPendingAction(null)
    setError(null)
    setResult(null)
  }

  const submit = async () => {
    if (!pendingAction) return
    setSubmitting(true)
    setError(null)
    try {
      const body =
        pendingAction === "promote"
          ? { action: "promote" }
          : { action: "pull", targetWorkspaceId: activeWorkspace.id }
      const res = await fetch(
        `/api/operator-studio/threads/${thread.id}/copy`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "Copy failed. Try again."
        )
        return
      }
      setResult({
        action: pendingAction,
        newThreadId: data.newThreadId,
        viewUrl: data.viewUrl,
      })
      router.refresh()
    } catch {
      setError("Network error. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const closeDialog = (nextOpen: boolean) => {
    if (submitting) return
    if (!nextOpen) reset()
    setOpen(nextOpen)
  }

  const activeLabel = activeWorkspace.label

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <Copy className="mr-1 h-3 w-3" />
            Copy…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs">
            Cross-workspace copy
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {canPromote && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setPendingAction("promote")
                setOpen(true)
              }}
              className="text-xs"
            >
              <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
              Promote to Global
            </DropdownMenuItem>
          )}
          {canPull && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setPendingAction("pull")
                setOpen(true)
              }}
              className="text-xs"
            >
              <Globe className="mr-2 h-3.5 w-3.5" />
              Pull into {activeLabel}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingAction === "promote"
                ? "Copy this thread to the global library?"
                : `Copy this thread into ${activeLabel}?`}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === "promote"
                ? "This creates an independent copy of the thread (and its messages and summaries) in the global library. The original stays in your workspace, untouched."
                : "This creates an independent copy of the thread (and its messages and summaries) in your active workspace. The original stays in global, untouched."}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">
              {result.action === "promote" ? "Promoted." : "Pulled."}{" "}
              <Link
                href={result.viewUrl}
                className="font-medium underline underline-offset-2"
              >
                {result.action === "promote"
                  ? "View in global"
                  : `View in ${activeLabel}`}
              </Link>
            </div>
          )}

          <DialogFooter>
            {result ? (
              <Button variant="outline" onClick={() => closeDialog(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => closeDialog(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button onClick={submit} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      {pendingAction === "promote"
                        ? "Promoting…"
                        : "Pulling…"}
                    </>
                  ) : pendingAction === "promote" ? (
                    "Promote to Global"
                  ) : (
                    `Pull into ${activeLabel}`
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
