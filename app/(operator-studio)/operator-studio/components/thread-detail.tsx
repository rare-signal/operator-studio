"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  Flame,
  Globe,
  Info,
  MessageSquare,
  Send,
  Shield,
  Sparkles,
  Star,
  Tag,
  User,
  Loader2,
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
  OperatorThreadSummary,
  OperatorChatSession,
  PromotionKind,
  ContinuationPersona,
} from "@/lib/operator-studio/types"
import type { Workspace } from "@/lib/operator-studio/workspaces"

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
import { SourceAppToken } from "./source-apps"

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
  reviewer: string | null
  forks: OperatorThread[]
  parentMessages: OperatorThreadMessage[]
  activeWorkspace: Workspace
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
  reviewer,
  forks,
  parentMessages,
  activeWorkspace,
}: ThreadDetailProps) {
  const router = useRouter()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const editRef = React.useRef<HTMLTextAreaElement>(null)
  const [showMeta, setShowMeta] = React.useState(false)
  const [selectedPersona, setSelectedPersona] = React.useState<ContinuationPersona>(
    CONTINUATION_PERSONAS[0]
  )

  const title = thread.promotedTitle ?? thread.rawTitle ?? "Untitled thread"
  const isFork = !!thread.parentThreadId
  const isOriginal = !isFork
  const [forking, setForking] = React.useState(false)

  // ── Upstream staleness check ─────────────────────────────────────────────
  // If this thread was imported from a local file (sourceLocator set) we can
  // re-parse that file on mount + on window-focus and offer the operator an
  // explicit "fork with updates" action when the upstream has grown. We
  // NEVER silently rewrite the rendered thread or touch promoted metadata.
  const [upstreamDelta, setUpstreamDelta] = React.useState<number>(0)

  React.useEffect(() => {
    if (!thread.sourceLocator) return
    let cancelled = false

    async function check() {
      if (cancelled) return
      if (document.visibilityState !== "visible") return
      try {
        const res = await fetch("/api/operator-studio/discover", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: thread.sourceApp,
            filePath: thread.sourceLocator,
          }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const delta =
          typeof data.messageCount === "number"
            ? data.messageCount - thread.messageCount
            : 0
        setUpstreamDelta(delta > 0 ? delta : 0)
      } catch {
        // silent — staleness is a soft signal
      }
    }

    check()
    const onVisible = () => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", check)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", check)
    }
  }, [thread.sourceLocator, thread.sourceApp, thread.messageCount])

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
      router.push("/operator-studio")
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
            onClick={() => router.push("/operator-studio")}
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

      {/* AI-generated capture rationale — why this thread was worth keeping. */}
      {thread.captureReason ? (
        <div className="border-b bg-muted/20 px-4 py-2 shrink-0">
          <p className="flex items-start gap-2 text-xs italic text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{thread.captureReason}</span>
          </p>
        </div>
      ) : (
        <div className="border-b bg-muted/10 px-4 py-2 shrink-0">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              No capture rationale on file. Configure{" "}
              <code className="rounded bg-muted px-1 text-[10px]">
                WORKBOOK_CLUSTER_ENDPOINTS
              </code>{" "}
              to have future imports auto-generate one.
            </span>
          </p>
        </div>
      )}

      {/* Upstream staleness signal — soft, explicit, never auto-applies. */}
      {upstreamDelta > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b bg-sky-500/10 px-4 py-2 text-xs text-sky-900 dark:text-sky-100">
          <GitFork className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            <strong>Upstream session grew by {upstreamDelta} message
            {upstreamDelta === 1 ? "" : "s"}.</strong> Fork this thread to
            capture the new turns — your existing thread stays as-is,
            preserving any edits.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            onClick={handleForkThread}
            disabled={forking}
          >
            {forking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Fork with updates"
            )}
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

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-1">

          {/* ── Fork view: show parent's frozen context first ── */}
          {isFork && parentMessages.length > 0 && (
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
              <div className="relative py-3">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-muted-foreground/15" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background px-3 text-[10px] text-muted-foreground/40 uppercase tracking-widest">
                    Frozen context from original thread
                  </span>
                </div>
              </div>
              {parentMessages
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
                  />
                ))}
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
            </>
          )}

          {/* ── Original thread view: show transcript messages ── */}
          {isOriginal && transcriptMessages.map((msg) => (
            <TimelineMessage
              key={msg.id}
              msg={msg}
              reviewer={reviewer}
              onPromote={handlePromoteMessage}
              onUnpromote={handleUnpromoteMessage}
              onEditContent={handleEditMessageContent}
              onDeleteMessage={handleDeleteMessage}
              threadId={thread.id}
              threadTitle={title}
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
              {/* Persona selector bar */}
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
                    Pick a persona above and continue the work.
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

      {/* Input bar — only on forks */}
      {isFork && (
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

// ─── Timeline Message ───────────────────────────────────────────────────────

function TimelineMessage({
  msg,
  reviewer,
  onPromote,
  onUnpromote,
  onEdit,
  onFork,
  onEditContent,
  onDeleteMessage,
  showBranchActions,
  siblingInfo,
  onSwitchSibling,
  threadId,
  threadTitle,
}: {
  msg: ChatMessage
  reviewer: string | null
  onPromote: (id: string, source: "transcript" | "continuation", kind: PromotionKind, note: string) => void
  onUnpromote: (id: string, source: "transcript" | "continuation") => void
  onEdit?: () => void
  onFork?: () => void
  onEditContent?: (id: string, content: string) => Promise<void>
  onDeleteMessage?: (id: string) => Promise<void>
  showBranchActions?: boolean
  siblingInfo?: { total: number; current: number; forkKey: string } | null
  onSwitchSibling?: (forkKey: string, direction: "prev" | "next") => void
  threadId?: string
  threadTitle?: string
}) {
  const isUser = msg.role === "user"
  const isPromoted = !!msg.promotedAt
  const isTranscript = msg.source === "transcript"

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
            className={`rounded-lg px-3 py-2 text-sm ${
              isUser
                ? "bg-primary text-primary-foreground"
                : isTranscript
                  ? "bg-muted/60"
                  : "bg-muted"
            } ${isPromoted ? "ring-1 ring-amber-500/30" : ""}`}
          >
            <ExpandableContent content={msg.content} />
            {msg.modelLabel && (
              <div className="mt-1 text-[10px] opacity-50">via {msg.modelLabel}</div>
            )}
            {isPromoted && msg.promotionNote && (
              <div className="mt-1.5 pt-1.5 border-t border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400">
                &ldquo;{msg.promotionNote}&rdquo; — {msg.promotedBy}
              </div>
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

        {/* Hover actions */}
        <div
          className={`flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            isUser ? "justify-end" : "justify-start"
          }`}
        >
          {/* Promote / Unpromote */}
          {isPromoted ? (
            <button
              onClick={() => onUnpromote(msg.id, msg.source)}
              className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
            >
              <Flame className="h-2.5 w-2.5" />
              Unpromote
            </button>
          ) : (
            <PromoteMessagePopover
              messageId={msg.id}
              source={msg.source}
              onPromote={onPromote}
            />
          )}

          {/* Copy reference — only for promoted messages */}
          {isPromoted && threadId && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopyReference}
              className="h-auto gap-1 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground hover:text-foreground"
            >
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
            </Button>
          )}

          {/* Inline edit / delete for transcript messages */}
          {isTranscript && onEditContent && !editing && (
            <button
              onClick={() => {
                setEditContent(msg.content)
                setEditing(true)
              }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
            >
              <Pencil className="h-2.5 w-2.5" />
              Edit
            </button>
          )}
          {isTranscript && onDeleteMessage && !editing && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
            >
              <Trash2 className="h-2.5 w-2.5" />
              Delete
            </button>
          )}

          {/* Branch actions for continuation messages */}
          {showBranchActions && !isTranscript && (
            <>
              {isUser && onEdit && (
                <button
                  onClick={onEdit}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  <Pencil className="h-2.5 w-2.5" />
                  Edit
                </button>
              )}
              {onFork && (
                <button
                  onClick={onFork}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                >
                  <GitFork className="h-2.5 w-2.5" />
                  Fork
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Promote Message Popover ────────────────────────────────────────────────

function PromoteMessagePopover({
  messageId,
  source,
  onPromote,
}: {
  messageId: string
  source: "transcript" | "continuation"
  onPromote: (id: string, source: "transcript" | "continuation", kind: PromotionKind, note: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<PromotionKind>("fire")
  const [note, setNote] = React.useState("")

  const handleSubmit = () => {
    onPromote(messageId, source, kind, note)
    setOpen(false)
    setNote("")
    setKind("fire")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted">
          <Flame className="h-2.5 w-2.5" />
          Promote
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="top" align="start">
        <div className="space-y-2">
          <p className="text-xs font-medium">Promote this message</p>
          {/* Kind selector */}
          <div className="flex flex-wrap gap-1">
            {(Object.keys(PROMOTION_KIND_LABELS) as PromotionKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  kind === k
                    ? PROMOTION_KIND_COLORS[k]
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {PROMOTION_KIND_EMOJI[k]} {PROMOTION_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          {/* Note */}
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this fire? (optional)"
            className="text-xs h-7"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <Button size="sm" className="w-full h-7 text-xs" onClick={handleSubmit}>
            {PROMOTION_KIND_EMOJI[kind]} Promote as {PROMOTION_KIND_LABELS[kind]}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

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
      {loading ? "…" : "Review"}
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
