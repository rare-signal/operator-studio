# Operator Studio MCP server

A local [Model Context Protocol](https://modelcontextprotocol.io) server
that exposes Operator Studio's plans, sessions, and threads to CLI
agents — Claude Code, Codex, Cursor, anything that speaks MCP. The
agent gets a small, opinionated read API instead of the firehose; you
keep storing whatever you want in the database without worrying about
context windows.

The server runs as a separate stdio process and talks to the same
Postgres the web app uses. Reads are the default; writes are scoped
to plan steps and knowledge entries, where letting an agent mutate
state cleanly removes the old "drop a tsx seed script in `scripts/`
and ask the human to run it" workflow. Threads, sessions, and
recaps remain read-only — those are agent inputs, not edit targets.

Plan-step writes (`plan_step_upsert`, `plan_step_set_status`,
`plan_step_delete`, `plan_step_restore`) all soft-delete via the
`deleted_at` tombstone column added in migration 0022. Hard delete
is not exposed; use the trash view (or a future purge step) to
permanently remove rows.

---

## Quickstart

```bash
# 1. dependencies (already installed if you ran `pnpm install` recently)
pnpm install

# 2. point at your database — same DATABASE_URL the web app uses
echo 'DATABASE_URL=postgres://...' >> .env.local

# 3. smoke-test in-process — calls every tool, prints what an agent
#    would see
pnpm mcp:probe

# 4. run the real stdio server (this is what an MCP client spawns)
pnpm mcp:server
```

`mcp:server` writes the MCP protocol stream on stdout and logs to
stderr. It will sit idle waiting for JSON-RPC frames — that's correct.
Hit Ctrl-C to exit cleanly (the PG pool is closed on SIGINT/SIGTERM).

---

## Wiring it into Claude Code

Add an entry under `mcpServers` in your Claude Code config (typically
`~/.claude.json` or `~/.config/claude-code/config.json` depending on
your install):

```json
{
  "mcpServers": {
    "operator-studio": {
      "command": "pnpm",
      "args": ["mcp:server"],
      "cwd": "/path/to/operator-studio",
      "env": {
        "DATABASE_URL": "postgres://...",
        "OPERATOR_STUDIO_WORKSPACE": "global",
        "OPERATOR_STUDIO_REVIEWER": "claude-code"
      }
    }
  }
}
```

After restarting Claude Code, ask "what's on my plan?" and the model
will reach for `plan_outline`.

For Codex, Cursor, or any other client, use the same `command` + `args`
+ `cwd` + `env` shape — the spec is portable.

---

## The tools

### CALL THIS FIRST

| Tool | Required | Optional | What it does |
|---|---|---|---|
| `agent_startup_manifest` | — | `factoryId`, `workspaceId` | The contract a fresh agent reads before any other tool. Returns the factory context bundle (repo / product / audience), the tools-first rules of engagement, the first-moves checklist, and the live recency packet. Idempotent. Read-only. |

### Reads

| Tool | Required | Optional | What it does |
|---|---|---|---|
| `plan_outline` | — | `planId`, `maxDepth`, `workspaceId` | Active plan as a depth-limited tree of titles + status + step ids. |
| `plan_step` | `stepId` | `includeChildren`, `planId`, `workspaceId` | Full description + children of one step. |
| `plan_search` | `query` | `limit`, `workspaceId` | Substring scan across step titles + descriptions in the whole workspace. |
| `plans_list` | — | `workspaceId` | Every plan in the workspace, sidebar order. |
| `sessions_recent` | — | `limit`, `workspaceId` | Recent work sessions + the threads that touched them. |
| `thread_summary` | `threadId` | `workspaceId` | Pre-computed summary (auto / manual / promoted). Cheap. |
| `thread_context_pack` | — | `threadId`, `budgetTokens`, `workspaceId` | Pickup pack for a thread: metadata + all user turns when they fit, otherwise the most recent user turns with a truncation note. Omitting `threadId` uses the most recent visible thread. |
| `thread_passages` | `threadId`, `query` | `limit`, `workspaceId` | Substring scan within one thread, returns matching turns with surrounding context. |
| `progress_recap` | — | `window`, `since`, `until`, `compare`, `workspaceId` | "What got done in this window?" — sessions, promotions, plans shipped, steps newly evidenced, with delta vs prior window. |
| `knowledge_*` | varies | varies | Read & write KB entries + atomic claims. Use these instead of writing `.md` files for product-native records. |
| `work_context_*` | — | varies | Active workspace context — current factory, plan, in-motion cards, bound agents, recent reviews. The `pnpm os:context` projection. |
| `outbox_list` | — | `state`, `limit`, `workspaceId` | List staged outbound rows (default `awaiting_approval`) so an agent can see what is already pending operator approval. |

### Outbound staging (gated send)

Outbound communication NEVER goes out directly from a tool. The agent stages a row;
the operator opens the per-row preview page, enters a PIN, and clicks Approve.
The outbound writer's first line is `assertOutboundArmed()` — a per-row,
payload-hash-bound, time-bounded check. There is no bypass.

| Tool | Required | Optional | What it does |
|---|---|---|---|
| `outbox_stage_ado_comment` | `workItemId`, `text`, `rationale` | `audience`, `relatedPlanStepId`, `sourceInboxEventIds`, `factoryId`, `workspaceId` | Drafts a comment on an ADO work item. Persists state=`awaiting_approval` and surfaces the operator's preview URL in the response. Do NOT call `az boards` or any direct ADO API. |

### Plan-step writes

All deletes are soft (stamp `deleted_at`); recoverable via `plan_step_restore`.

| Tool | Required | Optional | What it does |
|---|---|---|---|
| `plan_step_upsert` | `title` | `id`, `description`, `status`, `parentStepId`, `stepOrder`, `planId`, `workspaceId` | Insert or update a plan step. Omit `id` for a fresh append; provide `id` to update an existing step or seed a known id. |
| `plan_step_set_status` | `stepId`, `status` | `planId`, `workspaceId` | Narrow shortcut for the most common edit (open / in-motion / covered / skipped). |
| `plan_step_delete` | `stepId` | `cascade` (default true), `planId`, `workspaceId` | Soft-delete a step. Cascades to active descendants by default. |
| `plan_step_restore` | `stepId` | `cascade` (default false), `planId`, `workspaceId` | Reverse of delete — clears `deleted_at`. |

`workspaceId` overrides the default workspace (set by env or CLI flag);
omit it and the configured default is used.

Tool names use underscores, not dots, because the MCP spec restricts
names to `^[a-zA-Z0-9_-]+$`.

---

## Walkthrough — what an agent actually sees

These are real outputs from running the server against the dev
database. The active workspace is `global` and the active plan is the
auto-created drafting plan (so it's empty — illustrative, not
representative).

### `tools/list`

```
plan_outline         required=[] optional=['planId', 'maxDepth', 'workspaceId']
plan_step            required=['stepId'] optional=['includeChildren', 'planId', 'workspaceId']
plan_search          required=['query'] optional=['limit', 'workspaceId']
plans_list           required=[] optional=['workspaceId']
sessions_recent      required=[] optional=['limit', 'workspaceId']
thread_summary       required=['threadId'] optional=['workspaceId']
thread_context_pack  required=[] optional=['threadId', 'budgetTokens', 'workspaceId']
thread_passages      required=['threadId', 'query'] optional=['limit', 'workspaceId']
progress_recap       required=[] optional=['window', 'since', 'until', 'compare', 'workspaceId']
```

### `plans_list`

```markdown
# Plans in workspace `global` (1)

- `plan-draft-global-1776926241051` **Untitled plan** _(drafting)_ — 0 steps
```

### `plan_outline`

```markdown
# Plan: Untitled plan
_drafting · id: plan-draft-global-1776926241051_

## Steps (0 total, max depth 2)

_No steps yet — plan is empty._
```

What this would look like with steps populated:

```markdown
# Plan: Ship the OSS treatment of Operator Studio
_active · pinned · owner: David · id: plan-abc123_

**Goal:** Make the repo welcoming to outside contributors without diluting…

## Steps (12 total, max depth 2)

- ◐ `step-001` 1. Wire up MCP server (3 children deeper)
  - ● `step-002` 1.1. Build read tools
  - ◐ `step-003` 1.2. Add token budget (2 children deeper)
  - ○ `step-004` 1.3. Document how to attach to Claude Code
- ○ `step-010` 2. Write contributor docs

_Glyphs: ○ open · ◐ in-motion · ● covered · ⊘ skipped. Use `plan.step` with the backtick id to fetch a step's full description and children._
```

### `sessions_recent` with `limit: 2`

```markdown
# Recent sessions (2)

## `session-global-2026-04-22T04-43` Apr 21 late night
_started 5d ago · 1 thread · plan plan-draft-global-1776926241051_
- `thread-907974d0-df10-40b5-a828-d3dbe3cf6860` Open-source treatment for Operator Studio · claude · 295 turns · imported

## `session-global-2026-04-21T19-14` Apr 21 afternoon
_started 6d ago · 4 threads · plan plan-draft-global-1776926241051_
- `thread-b7b647da-55ca-46d0-aef5-85e97a439073` Refocus conversation on coding tasks · claude · 12 turns · imported
- `thread-95298d63-fe1b-4dd1-b972-38a138375ece` Update meeting functionality business logic (fork) · claude · 56 turns · imported
- `thread-2d412214-e31c-429f-97c2-3cecd72f5680` Fix timeline editor frame reel issues · claude · 15 turns · imported
- `thread-fork-1776836383331-ocg9oi` Fix timeline editor frame reel issues · claude · 15 turns · in-review
```

### `progress_recap` with `window: "this-week"`

Window-scoped counts with delta-vs-prior. `compare: true` is the default for the presets, so you don't pass it. Real output from your dev DB:

```markdown
# Progress recap · this week (7d)
_window: 2026-04-20 → 2026-04-27 · with delta vs prior_

## Activity

- **4** sessions _(↓ 9, -69% vs prior)_
- **7** threads touched _(↓ 15, -68% vs prior)_
- **383** messages authored _(↓ 1122, -75% vs prior)_
- **7** threads newly imported _(↓ 13, -65% vs prior)_

## Wins (promotions + ships)

- **0** threads promoted _(↓ 2, -100% vs prior)_
- **1** message promoted _(↓ 1, -50% vs prior)_
- **0** plans shipped _(no change)_

## Steps newly evidenced
_first-ever fulfillment in window — proxy for "work landed against this step"_

- **0** steps _(no change)_
- **0** total fulfillments attached _(no change)_

## Active plan — point-in-time snapshot
_Untitled plan (`plan-draft-global-1776926241051`) — NOT windowed; current state of the tree_

- **0/0** covered (0%)
- 0 in-motion
- 0 open
```

Three things to know about this output:

- **Deltas are vs the prior window of equal duration.** "This week" compares to the 7 days before that.
- **"Steps newly evidenced" is a proxy.** There's no step-status audit log in the schema, so we can't strictly report "this week's covered steps." Instead we count steps whose first-ever fulfillment row landed in the window — close to "work showed up against this step" but not identical.
- **Active plan coverage is point-in-time, not windowed.** That footer is a snapshot of the tree right now, intentionally separated from the deltas above so the agent doesn't conflate them.

Custom windows skip the preset and pass ISO timestamps:

```
arguments: { "window": "custom", "since": "2026-04-15T00:00:00Z", "until": "2026-04-27T00:00:00Z", "compare": false }
```

`compare: false` skips the prior-window query (halves the cost) when you only want the absolute counts.

### `thread_passages` with `query: "sidebar", limit: 2`

```markdown
# Passage matches for "sidebar" in thread "Open-source treatment for Operator Studio" (2)
_thread id: thread-907974d0-df10-40b5-a828-d3dbe3cf6860 · claude_

## Turn 0 · user

…y to global) and Pull (copy from global down) have explicit copy semantics — no inheritance, no re-base. Mirror the shape in `/path/to/sibling-project/lib/workspaces.ts` and the companion `/api/workspaces/*` routes. The sidebar has a workspace switcher dropdown at the top (`app/components/workspace-switcher.tsx`).

5. **Schema discipline.**
   - Every content table takes a `workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`.
   - Provenance c…

## Turn 5 · assistant

Now let me read the existing route handlers, session API, current migration SQL, and sidebar structure so I know exactly what to modify.
```

---

## Driving it manually for debugging

The MCP protocol is line-delimited JSON-RPC over stdio. You can pipe
frames straight in:

```bash
{ printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sessions_recent","arguments":{"limit":3}}}'; \
  sleep 3; } | pnpm mcp:server 2>/dev/null | tail -1
```

The last line is a single JSON-RPC response. Pretty-print it with
`python3 -m json.tool` or extract the rendered markdown:

```bash
... | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['result']['content'][0]['text'])"
```

`pnpm mcp:probe` does the same thing more cleanly via an in-process
MCP client. Use it when iterating on tool descriptions or projection
markdown — no external client to restart.

---

## Configuration

| Source | Var / flag | Default | Effect |
|---|---|---|---|
| env | `DATABASE_URL` | (required) | Postgres connection. Same one the web app uses. |
| env | `OPERATOR_STUDIO_WORKSPACE` | `global` | Default workspace for tool calls that omit `workspaceId`. |
| env | `OPERATOR_STUDIO_REVIEWER` | `mcp-agent` | Name attributed to plans the server has to auto-create (rule 3 in `getActivePlan`). |
| CLI flag | `--workspace=<id>` | — | Same as `OPERATOR_STUDIO_WORKSPACE`. |
| CLI flag | `--reviewer=<name>` | — | Same as `OPERATOR_STUDIO_REVIEWER`. |

There is no auth on the stdio transport — whoever holds the pipe can
read everything. That's fine for local single-user setups; if you ever
expose this over HTTP/SSE, plumb auth headers before opening the port.

---

## How it's structured

```
lib/mcp-server/
├── server.ts                  # buildOperatorStudioMcpServer(ctx)
├── context.ts                 # workspace + reviewer resolution
├── budget.ts                  # token-budget rendering helpers
├── tools/
│   ├── plan.ts                # plan_outline, plan_step, plan_search, plans_list
│   ├── recap.ts               # progress_recap
│   ├── sessions.ts            # sessions_recent
│   └── threads.ts             # thread_summary, thread_passages
└── views/
    ├── plan-view.ts           # markdown projections for plan data
    ├── recap-view.ts          # markdown projection for progress_recap
    └── session-view.ts        # markdown projections for sessions + threads

scripts/
├── mcp-server.ts              # stdio entry point (pnpm mcp:server)
├── mcp-probe.ts               # in-process smoke test (pnpm mcp:probe)
├── tsx-loader-register.mjs    # registers the loader hook
├── tsx-loader.mjs             # aliases server-only/client-only
└── server-only-shim.mjs       # the no-op stub
```

### Three design choices worth knowing

**1. Projection over chunking.** Storage is unbounded; tool responses
are bounded. A plan with 500 steps stays in the database; `plan_outline`
returns the top two levels and tells the agent how many children are
deeper. The agent drills with `plan_step`. We never silently truncate;
overflow always emits a visible footer with a hint about narrowing.

**2. Markdown, not JSON.** Tool results are `text` content, not
`structuredContent`. Markdown reads cleaner to LLMs (header levels,
bullet indentation, glyphs map naturally to plan structure) and avoids
forcing the agent to do its own rendering pass. If a future client
wants typed access to the same data, expose a sibling tool that returns
JSON — don't dilute the human-readable path.

**3. Read-only.** No mutations. Writing back into plans / threads is a
separate design problem (agent drafts → operator approves) and lives
in a future iteration. The Inbox is the natural surface for it.

---

## Troubleshooting

### `Error: This module cannot be imported from a Client Component module`

The `server-only` package throws when imported outside Next's RSC
compiler. The MCP server scripts handle this via the loader registered
in `scripts/tsx-loader-register.mjs` — make sure you're invoking via
`pnpm mcp:server` / `pnpm mcp:probe` (which include the
`node --import` flags), not via plain `tsx`.

### `DATABASE_URL is not set — refusing to start.`

The MCP server intentionally won't start without a database URL.
Either add one to `.env.local` or pass it inline:

```bash
DATABASE_URL=postgres://... pnpm mcp:server
```

### Server starts but tool calls return `[ERROR]`

Check stderr — the server logs every error there. Common causes:
- DB connection refused (Postgres not running, firewall, wrong port).
- Workspace ID typo — try `pnpm mcp:probe` first; the probe lists
  recent sessions and prints the workspace it resolved.
- Missing tables — if the migrations haven't been run, the queries
  will fail. Run `pnpm db:migrate`.

### "I see `0 matches` but the body shows turns"

Fixed during initial smoke-test — `thread_passages` was building its
header from an empty array. If you still see this, you're on a stale
build; re-run `pnpm install`.

---

## Adding a new tool

1. Implement the query in `lib/operator-studio/queries.ts` if it
   doesn't already exist. **Do not** add a query function that returns
   gigabytes — every tool's job is to return a small projection.
2. Add a markdown projection helper to `lib/mcp-server/views/`.
3. Register the tool in `lib/mcp-server/tools/<group>.ts`. Use Zod for
   the input schema. Write a description that tells the agent **when**
   to use this tool versus another (descriptions are the only signal
   the model has).
4. Wire the registration into `lib/mcp-server/server.ts` if it's a new
   group.
5. Add a probe call in `scripts/mcp-probe.ts` so future contributors
   can see the rendered output.
6. `pnpm typecheck` + `pnpm mcp:probe` to confirm.

---

## Future work

- **Auth.** Required before the server is exposed over any non-local
  transport.
- **Mutation tools.** Agent-proposed plan edits / step status changes,
  surfaced as approvals in the Inbox.
- **Step summaries.** A `summary` column on `operator_plan_steps` would
  make `plan_outline` dramatically tighter when individual step
  descriptions run long.
- **Step-status audit log.** `progress_recap` currently uses
  first-fulfillment-in-window as a proxy for "newly covered." A real
  audit table (`operator_plan_step_transitions` with `from_status`,
  `to_status`, `at`) would let the recap report covered/in-motion/
  skipped flips honestly instead of approximating.
- **Resource exposure.** MCP also supports `resources/list` and
  `resources/read`. Could expose individual threads / sessions /
  steps as URIs (`operator-studio://thread/<id>`) so clients can
  cite them directly in conversations.
