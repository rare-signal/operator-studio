"use client"

import * as React from "react"

/**
 * Lightweight inline markdown renderer for Operator Studio.
 * Handles: # headings, **bold**, *italic*, `code`, --- rules,
 * > blockquotes, - list items, numbered lists, paragraph breaks.
 * No external dependencies.
 */

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Order matters: **bold** before *italic*, and backtick code first to avoid
  // treating * inside code as bold/italic.
  const regex = /(`(.+?)`|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      // `code`
      nodes.push(
        <code
          key={match.index}
          className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono"
        >
          {match[2]}
        </code>
      )
    } else if (match[3]) {
      // **bold**
      nodes.push(
        <strong key={match.index} className="font-semibold">
          {match[3]}
        </strong>
      )
    } else if (match[4]) {
      // *italic*
      nodes.push(<em key={match.index}>{match[4]}</em>)
    } else if (match[5]) {
      // _italic_
      nodes.push(<em key={match.index}>{match[5]}</em>)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export function MarkdownProse({
  content,
  className = "",
}: {
  content: string
  className?: string
}) {
  const lines = content.split("\n")
  const elements: React.ReactNode[] = []
  let listItems: React.ReactNode[] = []
  let listOrdered = false
  let blockquoteLines: string[] = []
  let key = 0

  function flushList() {
    if (listItems.length === 0) return
    if (listOrdered) {
      elements.push(
        <ol key={key++} className="list-decimal pl-5 space-y-0.5">
          {listItems}
        </ol>
      )
    } else {
      elements.push(
        <ul key={key++} className="list-disc pl-5 space-y-0.5">
          {listItems}
        </ul>
      )
    }
    listItems = []
  }

  function flushBlockquote() {
    if (blockquoteLines.length === 0) return
    elements.push(
      <blockquote
        key={key++}
        className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground italic"
      >
        {blockquoteLines.map((line, i) => (
          <p key={i}>{parseInline(line)}</p>
        ))}
      </blockquote>
    )
    blockquoteLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Heading: # ## ### ####
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      flushList()
      flushBlockquote()
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const headingClasses: Record<number, string> = {
        1: "text-lg font-bold mt-3",
        2: "text-base font-bold mt-2",
        3: "text-sm font-semibold mt-2",
        4: "text-sm font-medium mt-1",
      }
      elements.push(
        <div key={`h-${i}`} className={headingClasses[level] ?? "font-semibold"}>
          {parseInline(text)}
        </div>
      )
      continue
    }

    // Horizontal rule: --- or *** or ___
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      flushList()
      flushBlockquote()
      elements.push(
        <hr key={`hr-${i}`} className="border-t border-muted-foreground/20 my-1" />
      )
      continue
    }

    // Blockquote: > text
    const bqMatch = trimmed.match(/^>\s*(.*)/)
    if (bqMatch) {
      flushList()
      blockquoteLines.push(bqMatch[1])
      continue
    }

    // If we were in a blockquote and hit a non-blockquote line, flush
    flushBlockquote()

    // Unordered list item: - or * (but not --- which was caught above)
    const ulMatch = trimmed.match(/^[-*]\s+(.+)/)
    if (ulMatch) {
      if (listItems.length > 0 && listOrdered) flushList()
      listOrdered = false
      listItems.push(<li key={`li-${i}`}>{parseInline(ulMatch[1])}</li>)
      continue
    }

    // Ordered list item: 1. or 1)
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)/)
    if (olMatch) {
      if (listItems.length > 0 && !listOrdered) flushList()
      listOrdered = true
      listItems.push(<li key={`li-${i}`}>{parseInline(olMatch[1])}</li>)
      continue
    }

    // Not a list item — flush any pending list
    flushList()

    // Empty line = paragraph break
    if (!trimmed) {
      continue
    }

    // Regular text line
    elements.push(
      <p key={`p-${i}`}>{parseInline(trimmed)}</p>
    )
  }

  flushList()
  flushBlockquote()

  return (
    <div className={`space-y-2 leading-relaxed ${className}`}>
      {elements}
    </div>
  )
}
