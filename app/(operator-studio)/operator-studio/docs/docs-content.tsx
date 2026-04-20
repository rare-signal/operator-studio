"use client"

import * as React from "react"
import Link from "next/link"
import {
  Book,
  Copy,
  Globe,
  Keyboard,
  KeyRound,
  Layers,
  MessageSquare,
  Package,
  Rocket,
  Search,
  Settings,
  Terminal,
  Zap,
} from "lucide-react"

import { Separator } from "@/registry/new-york-v4/ui/separator"

interface Section {
  id: string
  title: string
  icon: React.ReactNode
  body: React.ReactNode
}

const SECTIONS: Section[] = [
  {
    id: "quick-start",
    title: "Quick start",
    icon: <Rocket className="h-4 w-4" />,
    body: (
      <>
        <p>
          A fresh checkout boots with no threads and an empty{" "}
          <code>global</code> workspace. From there you have three common
          first moves:
        </p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>
            Load the synthetic showcase to see the app with populated content:{" "}
            <code>pnpm db:seed:demo</code>
          </li>
          <li>
            Import real agent sessions from your local machine — open{" "}
            <strong>Dashboard</strong> → <strong>Import</strong> and point at
            Claude Code (<code>~/.claude/projects</code>) or Codex (
            <code>~/.codex/sessions</code>).
          </li>
          <li>
            Paste anything (Gemini, ChatGPT, a plain transcript — see below)
            into the Import dialog, or POST to the ingest endpoint from a
            shell / IDE hook.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "workspaces",
    title: "Workspaces",
    icon: <Layers className="h-4 w-4" />,
    body: (
      <>
        <p>
          Workspaces are isolated namespaces. Threads, messages, summaries,
          and chat sessions are scoped to the workspace they were created in
          — there is no implicit inheritance. One workspace is always the{" "}
          <code>global</code> library; any others are sub-workspaces you
          create (<em>Design sprint Q4</em>, <em>Post-mortem Nov</em>, etc.).
        </p>
        <p>
          The switcher lives at the top of the sidebar. Your active workspace
          is stored in a cookie (<code>operator_studio_workspace</code>) so
          it sticks across reloads.
        </p>
        <p>
          <strong>Promote</strong> copies a thread from a sub-workspace into{" "}
          <code>global</code>, preserving the original via{" "}
          <code>promoted_from_id</code>.{" "}
          <strong>Pull</strong> copies a global thread into the active
          sub-workspace via <code>pulled_from_id</code>. Both copy the
          thread's messages and summaries; continuation chat sessions are
          operator-scoped and are not copied.
        </p>
        <p>
          Both actions are surfaced on the thread detail page via the{" "}
          <strong>Copy…</strong> dropdown in the header. The copy is always
          additive — the original thread stays intact in its source
          workspace, and provenance chips on the copied thread link back to
          the source.
        </p>
      </>
    ),
  },
  {
    id: "cross-workspace",
    title: "Cross-workspace Promote and Pull",
    icon: <Copy className="h-4 w-4" />,
    body: (
      <>
        <p>
          Workspaces are isolated — but the <code>global</code> library is
          shared. Two actions on a thread detail page's <strong>Copy…</strong>{" "}
          dropdown let you move content across that boundary without losing
          the original.
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Promote to Global</strong> — visible when the thread
            lives in a sub-workspace and you are viewing it there. Creates a
            copy in <code>global</code> with <code>promoted_from_id</code>{" "}
            pointing at the original.
          </li>
          <li>
            <strong>Pull into <em>&lt;workspace&gt;</em></strong> — visible
            when viewing a global thread from a sub-workspace. Creates a copy
            in that sub-workspace with <code>pulled_from_id</code> pointing at
            the global original.
          </li>
        </ul>
        <p>
          Both actions are additive — the source thread is never modified.
          Copies include all messages and summaries; continuation chat
          sessions are not copied because they are operator-scoped.
        </p>
        <p>
          Provenance chips render in the thread detail header for copied
          threads and link back to the source. The page loader falls back to{" "}
          <code>global</code> for missing threads, so you can navigate to a
          global thread from a sub-workspace in order to pull it.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          API
        </h3>
        <p>
          <code>POST /api/operator-studio/threads/[id]/copy</code> with body{" "}
          <code>{'{action: "promote"}'}</code> or{" "}
          <code>{'{action: "pull", targetWorkspaceId}'}</code>.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Workflow
        </h3>
        <p>
          Treat your personal workspace as scratch. Promote to{" "}
          <code>global</code> once a thread is team-valuable, and pull global
          threads into a sub-workspace when you want to annotate or continue
          them inside a smaller scope.
        </p>
      </>
    ),
  },
  {
    id: "importing",
    title: "Importing threads",
    icon: <Package className="h-4 w-4" />,
    body: (
      <>
        <p>Four paths into the workspace, pick whichever suits the source:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Discovery</strong> — scans a known local path (Claude
            Code or Codex), shows you the candidate list, and lets you pick
            which sessions to import. Good when you have dozens of sessions
            on disk and only want a few.
          </li>
          <li>
            <strong>Bulk from source</strong> — imports every discoverable
            session in one shot. Good when you're migrating a whole project.
          </li>
          <li>
            <strong>Manual paste</strong> — use the <em>Paste</em> mode in
            the Import dialog and drop in anything. Gemini JSON, ChatGPT
            share exports, Claude conversations, OpenAI responses, plain{" "}
            <code>User:</code> / <code>Assistant:</code> transcripts,
            markdown with headings, JSONL — the server-side parser
            autodetects the format. If nothing matches, the blob still goes
            in as a single message so you never lose the paste.
          </li>
          <li>
            <strong>HTTP ingest</strong> — <code>POST</code> to{" "}
            <code>/api/operator-studio/ingest</code> from any script, IDE
            hook, or webhook. See the <em>Ingesting from anywhere</em>{" "}
            section below.
          </li>
        </ul>
        <p>
          On import, the app asks an LLM endpoint (if configured) to
          auto-generate a short title from the opening turns. Without an
          endpoint it falls back to truncating the first user message.
        </p>
      </>
    ),
  },
  {
    id: "search",
    title: "Search",
    icon: <Search className="h-4 w-4" />,
    body: (
      <>
        <p>
          The sidebar has a search input at the top. Type at least two
          characters and hit <kbd className="rounded border px-1 text-xs">Enter</kbd>,
          or wait for the 400ms debounce — either way you land at{" "}
          <code>/operator-studio/search?q=…</code>.
        </p>
        <p>
          The results page renders two ranked sections:{" "}
          <strong>Threads</strong> (title, summary, why-it-matters, and
          project slug all searched together) and{" "}
          <strong>Messages in threads</strong> (raw message content).
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How ranking works
        </h3>
        <p>
          Search is backed by a Postgres <code>tsvector</code> with weighted
          fields — title at weight <code>A</code>, summary at <code>B</code>,
          why-it-matters at <code>C</code>, project slug at <code>D</code>.
          Results are ordered by <code>ts_rank_cd</code>, and snippets come
          from <code>ts_headline</code> with matches wrapped in{" "}
          <code>&lt;mark&gt;</code> for highlighting.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Scope
        </h3>
        <p>
          Search is workspace-scoped — you only see hits inside your active
          workspace. Switch workspaces to search elsewhere. The minimum query
          length is two characters.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          API
        </h3>
        <p>
          <code>
            GET /api/operator-studio/search?q=&lt;term&gt;&amp;scope=threads|messages|all&amp;limit=30
          </code>
          . Bearer-token auth. Returns{" "}
          <code>{"{query, threads: [...], messages: [...]}"}</code>.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
          {`curl -sG "$OPERATOR_STUDIO_URL/api/operator-studio/search" \\
     -H "Authorization: Bearer $TOKEN" \\
     --data-urlencode "q=sidebar layout" \\
     --data-urlencode "scope=all" \\
     --data-urlencode "limit=30"`}
        </pre>
      </>
    ),
  },
  {
    id: "ingesting-anywhere",
    title: "Ingesting from anywhere",
    icon: <Globe className="h-4 w-4" />,
    body: (
      <>
        <p>
          Operator Studio is meant to sit alongside your IDE, shell, and
          chat apps as a persistent outboard memory. Every operator has a
          slightly different workflow — one person pipes Gemini CLI output,
          another pastes ChatGPT, a third triggers a GitHub Action after
          every PR review. The ingest endpoint accepts <strong>any</strong>{" "}
          of those shapes.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Endpoint
        </h3>
        <p>
          <code>POST /api/operator-studio/ingest</code>
          <br />
          Send JSON, plain text, or markdown in the body. The server runs it
          through a universal parser (see{" "}
          <code>lib/operator-studio/importers/universal-parser.ts</code>) and
          responds with:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
          {`{
  "ok": true,
  "threadId": "thread-...",
  "workspaceId": "global",
  "detectedFormat": "gemini-generate",
  "messageCount": 3,
  "title": "fix sidebar layout bug",
  "viewUrl": "/operator-studio/threads/thread-..."
}`}
        </pre>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Formats the parser recognizes
        </h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Gemini</strong> — both{" "}
            <code>{"{candidates: [...]}"}</code> (generateContent responses)
            and <code>{"{contents: [{role, parts}]}"}</code> (conversational
            history).
          </li>
          <li>
            <strong>OpenAI chat-completions</strong> — responses with{" "}
            <code>choices[].message</code> and/or prompt{" "}
            <code>messages</code>.
          </li>
          <li>
            <strong>Anthropic messages</strong> — array of{" "}
            <code>{"{role, content}"}</code> where content can be a string
            or a list of content-blocks with <code>{"{type, text}"}</code>.
          </li>
          <li>
            <strong>ChatGPT share exports</strong> — the{" "}
            <code>mapping</code> tree with nested{" "}
            <code>{"{author, content: {parts}}"}</code>.
          </li>
          <li>
            <strong>Our native shape</strong> —{" "}
            <code>{"{title?, messages: [{role, content, timestamp?}]}"}</code>
            .
          </li>
          <li>
            <strong>JSONL</strong> — one JSON message object per line.
          </li>
          <li>
            <strong>Labeled transcripts</strong> — lines that start with{" "}
            <code>User:</code> / <code>You:</code> / <code>Human:</code> /{" "}
            <code>Assistant:</code> / <code>AI:</code> / <code>Model:</code>{" "}
            / <code>Claude:</code> / <code>Gemini:</code> / <code>GPT:</code>
            , etc. Lines until the next label are treated as that turn's
            content.
          </li>
          <li>
            <strong>Markdown with headings</strong> — <code>#</code>,{" "}
            <code>##</code>, etc., are treated as turn boundaries.
          </li>
          <li>
            <strong>Anything else</strong> — ingested as one user message
            so the content is still reviewable.
          </li>
        </ul>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Auth
        </h3>
        <p>
          For scripts and IDE hooks, set{" "}
          <code>OPERATOR_STUDIO_INGEST_TOKEN</code> in{" "}
          <code>.env.local</code> (<code>openssl rand -hex 32</code> is a
          reasonable generator) and pass it as{" "}
          <code>Authorization: Bearer &lt;token&gt;</code>. The in-app Paste
          UI continues to use the session cookie. In fully-open local dev
          (no password gate, no ingest token) the endpoint accepts
          unauthenticated POSTs.
        </p>
        <p>
          For per-user tokens (preferred for teams), mint them from the{" "}
          <Link
            href="/operator-studio/admin"
            className="underline"
          >
            Admin page
          </Link>
          . Each token carries its own display name so imports are correctly
          attributed, and tokens can be scoped to a single workspace or
          left global. The plaintext is shown once on creation — copy it
          out of the reveal card and into your shell rc, IDE hook, or CI
          secret store.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recipes
        </h3>
        <p>
          Shell recipes with tested one-liners live in{" "}
          <code>examples/ingest/</code>:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>opsctl.sh</code> — <code>source</code> it in your shell
            rc, then <code>pbpaste | opsctl ingest --title "…"</code> or{" "}
            <code>opsctl ingest &lt; file</code>.
          </li>
          <li>
            <code>gemini.sh</code> — pipe a Gemini CLI response through{" "}
            <code>jq</code> to attach the prompt, then POST.
          </li>
          <li>
            <code>chatgpt-clipboard.sh</code> — grab{" "}
            <code>pbpaste</code> / <code>xclip</code> and forward as-is.
          </li>
          <li>
            <code>plain-transcript.sh</code> — send a labeled text file.
          </li>
          <li>
            <code>webhook.sh</code> — drop-in pattern for GitHub Actions,
            Slack slash-commands, or any webhook handler.
          </li>
        </ul>
        <p>
          Quickest smoke test from the terminal:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
          {`curl -X POST "http://localhost:4200/api/operator-studio/ingest?title=smoke" \\
     -H "Content-Type: text/plain" \\
     --data-binary $'User: hi\\n\\nAssistant: hello'`}
        </pre>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Query params
        </h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>title</code> — override the derived title
          </li>
          <li>
            <code>tags</code> — comma-separated list applied to the thread
          </li>
          <li>
            <code>projectSlug</code> — value for the thread's{" "}
            <code>project_slug</code> column
          </li>
          <li>
            <code>source</code> — one of <code>claude</code>,{" "}
            <code>codex</code>, <code>cursor</code>,{" "}
            <code>antigravity</code>, <code>void</code>,{" "}
            <code>manual</code> (defaults to <code>manual</code>)
          </li>
          <li>
            <code>importedBy</code> — display name for attribution (defaults
            to the cookie identity or <code>"api"</code>)
          </li>
          <li>
            <code>workspaceId</code> — target workspace (defaults to the
            active cookie, falling back to <code>global</code>)
          </li>
        </ul>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          IDE hook patterns
        </h3>
        <p>
          The idea is that an operator's IDE (Cursor, VS Code, aider, Zed,
          whatever) can fire an "after session" hook that dumps the current
          chat buffer into Operator Studio without you thinking about it.
          Some shapes that work:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Shell alias</strong> — bind{" "}
            <code>⌘⇧I</code> in your terminal multiplexer to run{" "}
            <code>pbpaste | opsctl ingest</code>.
          </li>
          <li>
            <strong>VS Code task</strong> — a{" "}
            <code>tasks.json</code> entry that runs{" "}
            <code>curl</code> against the ingest endpoint with the current
            selection on stdin.
          </li>
          <li>
            <strong>Cursor / Claude Code hook</strong> — a{" "}
            <code>SessionEnd</code> or <code>Stop</code> hook that writes
            the session log and POSTs it.
          </li>
          <li>
            <strong>GitHub Action</strong> — see{" "}
            <code>examples/ingest/webhook.sh</code>; wire it on{" "}
            <code>pull_request_review</code> to capture each review as a
            thread.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "promotion",
    title: "Promotion and review state",
    icon: <Book className="h-4 w-4" />,
    body: (
      <>
        <p>Two layers of promotion:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Thread-level</strong> — a thread moves through{" "}
            <code>imported</code> → <code>in-review</code> →{" "}
            <code>promoted</code>. Promoting prompts you for a clean title,
            summary, why-it-matters note, tags, and a project slug — this is
            what shows up on the dashboard as a curated entry.
          </li>
          <li>
            <strong>Message-level</strong> — individual assistant messages
            can be starred as an <em>insight</em>, <em>decision</em>,{" "}
            <em>quotable</em>, <em>technical</em>, or <em>fire</em>. The
            promoted-messages view surfaces these across all threads in the
            active workspace.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "chat",
    title: "Grounded continuation chat",
    icon: <MessageSquare className="h-4 w-4" />,
    body: (
      <>
        <p>
          Open any thread and use the chat panel to keep working. The prompt
          is grounded in that thread's messages and summaries (plus recent
          branch history if you're in a fork). You can flip between{" "}
          <em>personas</em> — clarifier, strategist, devil's advocate,
          synthesizer, scribe — to change the continuation style without
          leaving the thread.
        </p>
        <p>
          The chat routes to an OpenAI-compatible{" "}
          <code>/v1/chat/completions</code> endpoint. Configure one or more
          URLs via <code>WORKBOOK_CLUSTER_ENDPOINTS</code> and a model id via{" "}
          <code>WORKBOOK_CLUSTER_MODEL</code>. Leave{" "}
          <code>WORKBOOK_CLUSTER_ENDPOINTS</code> blank and the endpoint
          echoes your message back — useful for exploring the UI before
          wiring up a model backend. Local options:{" "}
          <a
            href="https://ollama.ai"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Ollama
          </a>
          ,{" "}
          <a
            href="https://github.com/ggerganov/llama.cpp"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            llama.cpp
          </a>
          ,{" "}
          <a
            href="https://github.com/vllm-project/vllm"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            vLLM
          </a>
          ,{" "}
          <a
            href="https://lmstudio.ai"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            LM Studio
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "streaming",
    title: "Continuation chat: streaming",
    icon: <Zap className="h-4 w-4" />,
    body: (
      <>
        <p>
          By default the chat endpoint streams. The UI shows tokens as they
          arrive with a pulsing cursor, so long replies feel responsive
          instead of hanging on a spinner.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          SSE frames
        </h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>event: start</code> — carries the session id and the
            context snapshot used for grounding.
          </li>
          <li>
            <code>event: delta</code> — content chunks as the model produces
            them.
          </li>
          <li>
            <code>event: done</code> — the saved assistant message, including
            its real DB id.
          </li>
        </ul>
        <p>
          The final message is persisted <strong>before</strong>{" "}
          <code>done</code> fires, so the id the client receives is real and
          message-level promotion, edit, and delete keep working mid-session.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Opting out
        </h3>
        <p>
          The JSON path is preserved. POST without <code>?stream=1</code> and
          without <code>Accept: text/event-stream</code> and the endpoint
          returns <code>{"{sessionId, message}"}</code> as before.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Echo mode
        </h3>
        <p>
          If <code>WORKBOOK_CLUSTER_ENDPOINTS</code> is unset, chat still
          works — the server emits <code>start</code> →{" "}
          <code>done</code> with a helpful fallback message, which is enough
          to drive the UI while you wire up a model backend.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          CLI
        </h3>
        <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs">
          {`curl -N -X POST "$OPERATOR_STUDIO_URL/api/operator-studio/chat?stream=1" \\
     -H "Authorization: Bearer $TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{"threadId":"thread-...","message":"continue"}'`}
        </pre>
      </>
    ),
  },
  {
    id: "auth",
    title: "Auth",
    icon: <KeyRound className="h-4 w-4" />,
    body: (
      <>
        <p>
          Operator Studio ships with <strong>no authentication on by
          default</strong>. Visit the app, pick a display name, and start
          reviewing. The bundled password gate is a dev convenience — not a
          security boundary.
        </p>
        <p>
          Set <code>OPERATOR_STUDIO_PASSWORD</code> to any non-empty string
          to turn on a shared-password prompt. Clear it to turn the gate
          back off.
        </p>
        <p>
          For public deployments, swap the session route for a real auth
          library. The surface is small —{" "}
          <code>app/api/operator-studio/session/route.ts</code> and{" "}
          <code>lib/operator-studio/auth.ts</code> (
          <code>isAuthenticated()</code> / <code>getDisplayName()</code>) are
          the seams. Auth.js, Clerk, WorkOS, or a reverse-proxy header all
          plug in cleanly.
        </p>
      </>
    ),
  },
  {
    id: "admin",
    title: "Admin: tokens and webhooks",
    icon: <Settings className="h-4 w-4" />,
    body: (
      <>
        <p>
          <Link
            href="/operator-studio/admin"
            className="underline"
          >
            /operator-studio/admin
          </Link>{" "}
          has two panels: <strong>API Tokens</strong> and{" "}
          <strong>Webhooks</strong>. This is where you mint bearer tokens for
          scripts and IDE hooks, and where you wire the workspace up to
          Slack, Discord, or any receiver that wants to react to promotion
          events.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Tokens
        </h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Per-user bearer tokens, stored as SHA-256 hashes. The plaintext
            is shown <strong>once</strong> at creation — the reveal card
            renders immediately after you submit the create form, and then
            it's gone; copy it out then.
          </li>
          <li>
            Each token carries a <code>display_name</code>. When a token is
            used, every attribution field (<code>imported_by</code>,{" "}
            <code>promoted_by</code>, etc.) resolves to that name regardless
            of what the caller claims in query params. Bots cannot spoof
            humans.
          </li>
          <li>
            Tokens can be <strong>workspace-scoped</strong> (pinned to one
            workspace) or <strong>global</strong> (usable in any workspace
            via cookie or <code>workspaceId</code> param).
          </li>
          <li>
            Revocation is soft — setting <code>revoked_at</code> makes the
            token return <code>401</code> immediately on next use.
          </li>
        </ul>
        <p>
          API: <code>GET /api/operator-studio/tokens</code>,{" "}
          <code>POST</code> with body{" "}
          <code>{"{label, displayName, workspaceId?}"}</code>, and{" "}
          <code>DELETE /api/operator-studio/tokens/[id]</code>.
        </p>
        <p>
          Legacy fallback: <code>OPERATOR_STUDIO_INGEST_TOKEN</code> remains
          as a single shared secret for bootstrap scripts. When both are
          configured, DB-backed tokens win.
        </p>

        <h3 className="mt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Webhooks
        </h3>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Per-workspace subscriptions. Events:{" "}
            <code>thread.imported</code>, <code>thread.promoted</code>,{" "}
            <code>thread.archived</code>, <code>message.promoted</code>.
          </li>
          <li>
            Configure a URL, an optional secret (used for HMAC-SHA256
            signing), and an optional comma-separated events filter.
          </li>
          <li>
            Delivery is fire-and-forget with a 10s timeout. Each delivery
            sends <code>X-OperatorStudio-Event</code>,{" "}
            <code>X-OperatorStudio-Delivery</code> (UUID for dedupe),{" "}
            <code>X-OperatorStudio-Timestamp</code>, and — when a secret is
            set — <code>X-OperatorStudio-Signature</code>.
          </li>
          <li>
            Pause and resume via <code>PATCH</code>; remove via{" "}
            <code>DELETE</code>.
          </li>
          <li>
            Zero-DB global hatch:{" "}
            <code>OPERATOR_STUDIO_PROMOTION_WEBHOOK_URL</code> plus{" "}
            <code>OPERATOR_STUDIO_PROMOTION_WEBHOOK_SECRET</code> fire on
            every event across every workspace, regardless of what's
            configured in the admin UI.
          </li>
        </ul>
        <p>
          Receiver templates with full HMAC verification live in{" "}
          <code>examples/webhooks/</code> — Slack and Discord are both
          included as starting points.
        </p>
      </>
    ),
  },
  {
    id: "commands",
    title: "CLI commands",
    icon: <Terminal className="h-4 w-4" />,
    body: (
      <>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <code>pnpm dev</code> — run the app at{" "}
            <code>http://localhost:4200</code>
          </li>
          <li>
            <code>pnpm build</code> / <code>pnpm start</code> — production
            build and serve
          </li>
          <li>
            <code>pnpm db:generate</code> — emit a new Drizzle migration
            after schema edits
          </li>
          <li>
            <code>pnpm db:migrate</code> — apply pending migrations
          </li>
          <li>
            <code>pnpm db:push</code> — push the schema directly (dev
            convenience; prefer <code>migrate</code> for anything that has
            data)
          </li>
          <li>
            <code>pnpm db:seed</code> — ensure the <code>global</code>{" "}
            workspace exists; nothing else
          </li>
          <li>
            <code>pnpm db:seed:demo</code> — load the synthetic showcase (14
            threads, 81 messages, 5 summaries, 2 chat sessions)
          </li>
          <li>
            <code>pnpm db:studio</code> — open Drizzle Studio against the
            configured database
          </li>
          <li>
            <code>pnpm typecheck</code> — <code>tsc --noEmit</code>
          </li>
        </ul>
        <p>
          Add <code>--reset</code> to either seed command to wipe
          workspace-scoped tables before re-seeding.
        </p>
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    icon: <Keyboard className="h-4 w-4" />,
    body: (
      <>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <kbd className="rounded border px-1 text-xs">Cmd/Ctrl + B</kbd> —
            toggle the sidebar
          </li>
          <li>
            <kbd className="rounded border px-1 text-xs">Cmd/Ctrl + Enter</kbd>{" "}
            — send a chat message from the continuation panel
          </li>
        </ul>
      </>
    ),
  },
]

export function DocsContent() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Help
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
        <p className="text-sm text-muted-foreground">
          A short tour of what's in Operator Studio and how to drive it. For
          the full README and production notes, see the{" "}
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            source repository
          </a>
          .
        </p>
      </header>

      <nav className="mb-10 rounded-lg border p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">
          On this page
        </p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <Link
                href={`#${section.id}`}
                className="flex items-center gap-2 text-foreground/80 hover:text-foreground"
              >
                <span className="text-muted-foreground">{section.icon}</span>
                {section.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-10">
        {SECTIONS.map((section, i) => (
          <section key={section.id} id={section.id} className="scroll-mt-20">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-muted-foreground">{section.icon}</span>
              <h2 className="text-xl font-semibold tracking-tight">
                {section.title}
              </h2>
            </div>
            <div className="space-y-3 text-sm text-foreground/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono">
              {section.body}
            </div>
            {i < SECTIONS.length - 1 && <Separator className="mt-10" />}
          </section>
        ))}
      </div>

      <footer className="mt-16 border-t pt-6 text-xs text-muted-foreground">
        Operator Studio is MIT-licensed. Contributions, integrations, and
        bug reports welcome.
      </footer>
    </div>
  )
}
