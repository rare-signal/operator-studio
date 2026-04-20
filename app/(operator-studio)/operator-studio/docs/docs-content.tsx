"use client"

import * as React from "react"
import Link from "next/link"
import {
  Book,
  Keyboard,
  KeyRound,
  Layers,
  MessageSquare,
  Package,
  Rocket,
  Terminal,
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
            Paste a JSON payload directly via the manual importer if your
            source is neither of those.
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
      </>
    ),
  },
  {
    id: "importing",
    title: "Importing threads",
    icon: <Package className="h-4 w-4" />,
    body: (
      <>
        <p>Three paths into the workspace:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Discovery</strong> — scans a known local path (Claude
            Code or Codex), shows you the candidate list, and lets you
            pick which sessions to import. Good when you have dozens of
            sessions and only want a few.
          </li>
          <li>
            <strong>Bulk from source</strong> — imports every discoverable
            session in one shot. Good when you're migrating a whole project.
          </li>
          <li>
            <strong>Manual payload</strong> — paste JSON (either a top-level
            array of <code>{"{role, content, timestamp}"}</code> messages, or
            a plain-text conversation that gets interpreted as alternating
            user/assistant turns). Good for one-offs or sources we don't yet
            parse natively.
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
