"use client"

import * as React from "react"
import {
  Send,
  Sparkles,
  Loader2,
  Pencil,
  GitFork,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"
import { Badge } from "@/registry/new-york-v4/ui/badge"
import { MarkdownProse } from "./markdown-prose"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  modelLabel?: string | null
  createdAt: string
}

/**
 * A branch in the conversation tree.
 *
 * - The root branch has parentBranchId=null and forkAfterIndex=-1.
 * - A fork created after message index N in parent branch P gets
 *   parentBranchId=P.id, forkAfterIndex=N.
 * - Each branch has its own sessionId for DB persistence.
 */
interface TimelineBranch {
  id: string
  parentBranchId: string | null
  forkAfterIndex: number
  messages: ChatMessage[]
  sessionId: string | null
}

interface GroundedChatProps {
  threadId: string
  threadTitle: string
  reviewer: string | null
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function GroundedChat({
  threadId,
  threadTitle,
  reviewer,
}: GroundedChatProps) {
  const [branches, setBranches] = React.useState<TimelineBranch[]>([
    { id: "root", parentBranchId: null, forkAfterIndex: -1, messages: [], sessionId: null },
  ])
  // At each fork point we track which child branch is selected
  // Key = `${parentBranchId}:${forkAfterIndex}`, value = child branch id
  const [selectedForks, setSelectedForks] = React.useState<Record<string, string>>({})

  const [input, setInput] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null)
  const [editText, setEditText] = React.useState("")
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const editRef = React.useRef<HTMLTextAreaElement>(null)

  /* ---------------------------------------------------------------- */
  /*  Derived: build the visible timeline from the branch tree        */
  /* ---------------------------------------------------------------- */

  const { visibleMessages, forkPoints, leafBranchId } = React.useMemo(() => {
    const msgs: Array<ChatMessage & { branchId: string; localIdx: number }> = []
    const forks: Array<{
      afterGlobalIdx: number
      parentBranchId: string
      forkAfterIndex: number
      childBranches: TimelineBranch[]
      selectedChildId: string
    }> = []
    let _leafBranchId = "root"

    // Walk the branch tree: start at root, at each fork point follow
    // the selected branch (or stay on "original" if none selected).
    function walkBranch(branch: TimelineBranch) {
      _leafBranchId = branch.id

      for (let i = 0; i < branch.messages.length; i++) {
        msgs.push({ ...branch.messages[i], branchId: branch.id, localIdx: i })
        const globalIdx = msgs.length - 1

        // Are there forks after this message?
        const children = branches.filter(
          (b) => b.parentBranchId === branch.id && b.forkAfterIndex === i
        )
        if (children.length > 0) {
          const forkKey = `${branch.id}:${i}`
          const selectedId = selectedForks[forkKey]
          const selected = selectedId ?? `__continue__${branch.id}`

          forks.push({
            afterGlobalIdx: globalIdx,
            parentBranchId: branch.id,
            forkAfterIndex: i,
            childBranches: children,
            selectedChildId: selected,
          })

          // If a child branch is selected, recurse into it and stop
          // walking the current branch (the rest is the "original" path).
          if (selectedId && !selectedId.startsWith("__continue__")) {
            const childBranch = children.find((c) => c.id === selectedId)
            if (childBranch) {
              walkBranch(childBranch)
              return // stop walking parent after switching
            }
          }
        }
      }
    }

    const root = branches.find((b) => b.id === "root")!
    walkBranch(root)

    return { visibleMessages: msgs, forkPoints: forks, leafBranchId: _leafBranchId }
  }, [branches, selectedForks])

  const leafBranch = branches.find((b) => b.id === leafBranchId)!

  // Auto-scroll on new messages
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visibleMessages.length])

  React.useEffect(() => {
    if (editingIdx !== null) editRef.current?.focus()
  }, [editingIdx])

  /* ---------------------------------------------------------------- */
  /*  Send / Fork / Edit                                               */
  /* ---------------------------------------------------------------- */

  const sendToEngine = async (
    text: string,
    targetBranchId: string
  ) => {
    const branch = branches.find((b) => b.id === targetBranchId)
    if (!branch) return

    setSending(true)

    // Optimistic user message
    const tempMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    }
    setBranches((prev) =>
      prev.map((b) =>
        b.id === targetBranchId
          ? { ...b, messages: [...b.messages, tempMsg] }
          : b
      )
    )

    try {
      const res = await fetch("/api/operator-studio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: branch.sessionId,
          threadId,
          message: text,
          operatorName: reviewer ?? "operator",
        }),
      })
      const data = await res.json()

      setBranches((prev) =>
        prev.map((b) => {
          if (b.id !== targetBranchId) return b
          const updatedMessages = data.message
            ? [...b.messages, data.message]
            : b.messages
          return {
            ...b,
            sessionId: data.sessionId ?? b.sessionId,
            messages: updatedMessages,
          }
        })
      )
    } catch {
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content:
          "Failed to reach the continuation engine. Check that the local cluster is running.",
        createdAt: new Date().toISOString(),
      }
      setBranches((prev) =>
        prev.map((b) =>
          b.id === targetBranchId
            ? { ...b, messages: [...b.messages, errMsg] }
            : b
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

  // Fork: create a new branch after the given message
  const handleFork = (globalIdx: number) => {
    const msg = visibleMessages[globalIdx]
    if (!msg) return

    const newBranchId = `branch-${Date.now()}`
    const newBranch: TimelineBranch = {
      id: newBranchId,
      parentBranchId: msg.branchId,
      forkAfterIndex: msg.localIdx,
      messages: [],
      sessionId: null,
    }

    setBranches((prev) => [...prev, newBranch])

    // Select the new branch at this fork point
    const forkKey = `${msg.branchId}:${msg.localIdx}`
    setSelectedForks((prev) => ({ ...prev, [forkKey]: newBranchId }))


    setInput("")
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // Edit: fork from the message BEFORE this user message, with new text
  const handleStartEdit = (globalIdx: number) => {
    const msg = visibleMessages[globalIdx]
    if (!msg || msg.role !== "user") return
    setEditingIdx(globalIdx)
    setEditText(msg.content)
  }

  const handleConfirmEdit = () => {
    if (editingIdx === null) return
    const text = editText.trim()
    if (!text) return

    const msg = visibleMessages[editingIdx]
    if (!msg) return

    // Fork from the message before this one
    const forkAfterGlobalIdx = editingIdx - 1

    if (forkAfterGlobalIdx < 0) {
      // Editing the very first message — fork from root with empty prefix
      const newBranchId = `branch-${Date.now()}`
      const newBranch: TimelineBranch = {
        id: newBranchId,
        parentBranchId: "root",
        forkAfterIndex: -1,
        messages: [],
        sessionId: null,
      }
      setBranches((prev) => [...prev, newBranch])
      const forkKey = "root:-1"
      setSelectedForks((prev) => ({ ...prev, [forkKey]: newBranchId }))
  
      setEditingIdx(null)
      setEditText("")
      sendToEngine(text, newBranchId)
    } else {
      const prevMsg = visibleMessages[forkAfterGlobalIdx]
      if (!prevMsg) return

      const newBranchId = `branch-${Date.now()}`
      const newBranch: TimelineBranch = {
        id: newBranchId,
        parentBranchId: prevMsg.branchId,
        forkAfterIndex: prevMsg.localIdx,
        messages: [],
        sessionId: null,
      }
      setBranches((prev) => [...prev, newBranch])
      const forkKey = `${prevMsg.branchId}:${prevMsg.localIdx}`
      setSelectedForks((prev) => ({ ...prev, [forkKey]: newBranchId }))
  
      setEditingIdx(null)
      setEditText("")
      sendToEngine(text, newBranchId)
    }
  }

  const handleCancelEdit = () => {
    setEditingIdx(null)
    setEditText("")
  }

  // Switch between branches at a fork point
  const switchFork = (
    parentBranchId: string,
    forkAfterIndex: number,
    direction: "prev" | "next"
  ) => {
    const forkKey = `${parentBranchId}:${forkAfterIndex}`
    const children = branches.filter(
      (b) => b.parentBranchId === parentBranchId && b.forkAfterIndex === forkAfterIndex
    )
    const continueId = `__continue__${parentBranchId}`
    const options = [continueId, ...children.map((c) => c.id)]
    const current = selectedForks[forkKey] ?? continueId
    const currentIndex = options.indexOf(current)
    const nextIndex =
      direction === "next"
        ? (currentIndex + 1) % options.length
        : (currentIndex - 1 + options.length) % options.length

    setSelectedForks((prev) => ({ ...prev, [forkKey]: options[nextIndex] }))
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Grounded Continuation</span>
        <Badge
          variant="outline"
          className="ml-auto text-[9px] px-1.5 py-0 h-4"
        >
          {leafBranch.sessionId ? "Active Session" : "New Session"}
        </Badge>
      </div>

      {/* Context banner */}
      <div className="px-4 py-2 bg-primary/5 border-b text-xs text-muted-foreground">
        Grounded on: <strong>{threadTitle}</strong>
        <span className="ml-2 text-[10px] opacity-60">
          — responses are derived, not from the original model
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {visibleMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">
              Start a grounded continuation. The assistant has access to the
              promoted thread context.
            </p>
          </div>
        )}

        {visibleMessages.map((msg, globalIdx) => {
          // Check if there's a fork point after this message
          const fork = forkPoints.find((f) => f.afterGlobalIdx === globalIdx)
          const childCount = fork ? fork.childBranches.length + 1 : 0
          const forkKey = fork
            ? `${fork.parentBranchId}:${fork.forkAfterIndex}`
            : null
          const selectedId = forkKey ? (selectedForks[forkKey] ?? `__continue__${fork!.parentBranchId}`) : null
          const allOptions = fork
            ? [`__continue__${fork.parentBranchId}`, ...fork.childBranches.map((c) => c.id)]
            : []
          const selectedOptionIdx = selectedId ? allOptions.indexOf(selectedId) : -1

          return (
            <React.Fragment key={msg.id}>
              <div
                className={`group flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="flex flex-col gap-1 max-w-[85%]">
                  {/* Edit mode */}
                  {editingIdx === globalIdx ? (
                    <div className="flex flex-col gap-1.5">
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={handleCancelEdit}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={handleConfirmEdit}
                          disabled={!editText.trim() || sending}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Resend as fork
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`rounded-lg px-3 py-2 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <MarkdownProse
                          content={msg.content}
                          className="break-words"
                        />
                        {msg.modelLabel && (
                          <div className="mt-1 text-[10px] opacity-50">
                            via {msg.modelLabel}
                          </div>
                        )}
                      </div>

                      {/* Edit / Fork hover actions */}
                      {!sending && visibleMessages.length > 1 && (
                        <div
                          className={`flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${
                            msg.role === "user" ? "justify-end" : "justify-start"
                          }`}
                        >
                          {msg.role === "user" && (
                            <button
                              onClick={() => handleStartEdit(globalIdx)}
                              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                            >
                              <Pencil className="h-2.5 w-2.5" />
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() => handleFork(globalIdx)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                          >
                            <GitFork className="h-2.5 w-2.5" />
                            Fork here
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Fork point indicator — branch switcher */}
              {fork && childCount > 1 && (
                <div className="flex items-center justify-center gap-1 py-1">
                  <div className="flex items-center gap-0.5 bg-muted/60 rounded-full px-2 py-0.5">
                    <button
                      onClick={() =>
                        switchFork(fork.parentBranchId, fork.forkAfterIndex, "prev")
                      }
                      className="p-0.5 hover:bg-muted rounded transition-colors"
                    >
                      <ChevronLeft className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <span className="text-[10px] text-muted-foreground px-1 select-none">
                      <GitFork className="h-2.5 w-2.5 inline mr-0.5 -mt-px" />
                      {selectedOptionIdx + 1}/{childCount}
                    </span>
                    <button
                      onClick={() =>
                        switchFork(fork.parentBranchId, fork.forkAfterIndex, "next")
                      }
                      className="p-0.5 hover:bg-muted rounded transition-colors"
                    >
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Continue the work…"
            rows={2}
            className="min-h-[2.5rem] resize-none text-sm"
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
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Shift+Enter for new line · Enter to send
        </p>
      </div>
    </div>
  )
}
