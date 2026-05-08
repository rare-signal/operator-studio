"use client"

import * as React from "react"

/**
 * Lightweight inline markdown renderer for Operator Studio.
 * Handles: # headings, **bold**, *italic*, `code`, --- rules,
 * > blockquotes, - list items, numbered lists, paragraph breaks,
 * GFM-style pipe tables. No external dependencies.
 */

function splitRow(row: string): string[] {
  // Strip leading/trailing pipes, then split on `|`. Whitespace around
  // each cell is trimmed.
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((c) => c.trim())
}

function isSeparatorRow(row: string): boolean {
  // |---|---| or | :---: | ---: | etc.
  if (!row.includes("|")) return false
  return splitRow(row).every((c) => /^:?-{3,}:?$/.test(c))
}

function highlightText(text: string, highlight = ""): React.ReactNode[] {
  const needle = highlight.trim()
  if (!needle) return [text]
  const lower = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < text.length) {
    const idx = lower.indexOf(lowerNeedle, cursor)
    if (idx < 0) {
      nodes.push(text.slice(cursor))
      break
    }
    if (idx > cursor) nodes.push(text.slice(cursor, idx))
    nodes.push(
      <mark
        key={`mark-${key++}`}
        className="rounded bg-amber-400/80 px-0.5 text-black"
      >
        {text.slice(idx, idx + needle.length)}
      </mark>
    )
    cursor = idx + needle.length
  }

  return nodes
}

// Trailing punctuation that should not be part of an autolinked URL —
// e.g. "see http://x.com." should not include the period.
function trimUrlTail(url: string): { url: string; tail: string } {
  let i = url.length
  while (i > 0 && /[.,;:!?)\]}'"]/.test(url[i - 1])) i--
  // Keep balanced trailing parens — if the URL contains '(' more than ')',
  // assume the closing ')' belongs to the URL (e.g. wikipedia).
  // Simpler: just strip trailing punctuation; the regex already disallows '('.
  return { url: url.slice(0, i), tail: url.slice(i) }
}

function renderLink(
  href: string,
  label: React.ReactNode,
  key: string | number
): React.ReactNode {
  const safe = /^(https?:)?\/\//i.test(href) || href.startsWith("/")
  return (
    <a
      key={key}
      href={safe ? href : `https://${href}`}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:opacity-80 break-words"
    >
      {label}
    </a>
  )
}

function parseInline(text: string, highlight = ""): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Order matters:
  //   1. markdown links [label](url) before raw URL autolink, so we don't
  //      double-wrap the url inside a markdown link.
  //   2. backtick code before bold/italic, so * inside code stays literal.
  //   3. **bold** before *italic*.
  //   4. raw URL last — http(s)://… autolinked. Trailing punctuation is
  //      trimmed in trimUrlTail. Stops at whitespace, <, or closing paren.
  const regex =
    /(\[([^\]]+)\]\(([^\s)]+)\)|`(.+?)`|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|(https?:\/\/[^\s<>()\[\]]+))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...highlightText(text.slice(lastIndex, match.index), highlight))
    }

    if (match[2] && match[3]) {
      // [label](url) markdown link
      nodes.push(
        renderLink(match[3], parseInline(match[2], highlight), match.index)
      )
    } else if (match[8]) {
      // raw URL — strip trailing punctuation back into surrounding text
      const { url, tail } = trimUrlTail(match[8])
      nodes.push(renderLink(url, url, match.index))
      if (tail) nodes.push(...highlightText(tail, highlight))
    } else if (match[4]) {
      // `code`
      nodes.push(
        <code
          key={match.index}
          className="rounded bg-current/15 px-1 py-0.5 text-[0.85em] font-mono"
        >
          {match[4]}
        </code>
      )
    } else if (match[5]) {
      // **bold** — recurse so inner `_italic_` / `code` get parsed too
      nodes.push(
        <strong key={match.index} className="font-semibold">
          {parseInline(match[5], highlight)}
        </strong>
      )
    } else if (match[6]) {
      // *italic* — recurse so inner **bold** / `code` get parsed too
      nodes.push(<em key={match.index}>{parseInline(match[6], highlight)}</em>)
    } else if (match[7]) {
      // _italic_ — recurse so inner **bold** / `code` get parsed too
      nodes.push(<em key={match.index}>{parseInline(match[7], highlight)}</em>)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(...highlightText(text.slice(lastIndex), highlight))
  }

  return nodes
}

export function MarkdownProse({
  content,
  className = "",
  highlight = "",
}: {
  content: string
  className?: string
  highlight?: string
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
          <p key={i}>{parseInline(line, highlight)}</p>
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
          {parseInline(text, highlight)}
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

    // GFM pipe table: header row, separator row, body rows.
    // Detect via lookahead — only treat the line as a table if the
    // next non-empty line is a separator like |---|---|.
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isSeparatorRow(lines[i + 1])
    ) {
      flushList()
      flushBlockquote()
      const headerCells = splitRow(trimmed)
      const bodyRows: string[][] = []
      let j = i + 2
      while (j < lines.length) {
        const next = lines[j].trim()
        if (!next.includes("|")) break
        bodyRows.push(splitRow(next))
        j++
      }
      elements.push(
        <div key={`tbl-${i}`} className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-muted-foreground/30">
                {headerCells.map((cell, ci) => (
                  <th
                    key={ci}
                    className="px-2 py-1 font-semibold align-top"
                  >
                    {parseInline(cell, highlight)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-muted-foreground/15 last:border-0"
                >
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1 align-top">
                      {parseInline(cell, highlight)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      i = j - 1
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
      listItems.push(<li key={`li-${i}`}>{parseInline(ulMatch[1], highlight)}</li>)
      continue
    }

    // Ordered list item: 1. or 1)
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)/)
    if (olMatch) {
      if (listItems.length > 0 && !listOrdered) flushList()
      listOrdered = true
      listItems.push(<li key={`li-${i}`}>{parseInline(olMatch[1], highlight)}</li>)
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
      <p key={`p-${i}`}>{parseInline(trimmed, highlight)}</p>
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
