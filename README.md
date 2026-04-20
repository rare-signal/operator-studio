# Operator Studio

A self-hostable workspace for reviewing, summarizing, and continuing agent coding sessions. Paste conversations from Claude Code, Codex, Cursor, Gemini, ChatGPT — or POST them from any script — and keep working with persistent, grounded context that doesn't evaporate when the tab closes.

Built as the chat-to-org-memory layer your team already needed: one place every AI conversation can be reviewed, promoted, shared, and replayed.

<!-- Screenshot here -->

## Features

### Capture
- **Import from anywhere** — `POST /api/operator-studio/ingest` accepts Gemini, OpenAI, Anthropic, ChatGPT share exports, our native shape, JSONL, labeled transcripts (`User: ... Assistant: ...`), markdown with headings, or any raw blob. The universal parser autodetects format; nothing ever rejects.
- **Local discovery** for Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`), with override paths.
- **Dedupe** on ingest by content hash or caller-supplied `dedupeKey`, so pasting the same conversation twice returns the original thread.

### Review
- **Message-level promotion** with five kinds: insight, decision, quotable, technical, fire. Each carries an optional note.
- **Thread-level promotion** with a clean title, executive summary, why-it-matters line, tags, and project slug.
- **Summary stack** per thread (auto, manual, promoted) so coverage grows as the thread gets referenced.
- **Full-text search** across threads and messages — Postgres `tsvector` with weighted fields, `ts_headline` snippets highlighted with `<mark>`, sidebar input with 400ms debounce.

### Continue
- **Grounded continuation chat** — routes through any OpenAI-compatible `/v1/chat/completions` endpoint (local llama.cpp / Ollama / vLLM / LM Studio, or any cloud). The prompt is grounded in the thread's messages, summaries, and your promoted highlights.
- **Streaming by default** — SSE delivers tokens as they arrive; the final saved assistant message carries a real DB id so mid-conversation promote/edit/delete keeps working.
- **Personas** — clarifier / strategist / devil's advocate / synthesizer / scribe, switchable mid-thread.
- **Forks** — branch a conversation without polluting the canonical thread; the fork carries the parent as frozen context.

### Share
- **Multi-workspace isolation** — each workspace is its own namespace; no implicit cross-workspace leaks. Personal scratch workspaces plus a shared `global` library.
- **Cross-workspace Promote / Pull** — copy a thread up to `global` or pull a global thread down, preserving provenance via `promoted_from_id` / `pulled_from_id`.
- **Outbound webhooks** — subscribe per-workspace to `thread.imported` / `thread.promoted` / etc, with HMAC-SHA256 signatures. Slack and Discord receiver templates in [`examples/webhooks/`](./examples/webhooks/).

### Operate
- **Per-user API tokens** — mint in the Admin UI; plaintext shown once; SHA-256 stored; each token carries a `display_name` so all attribution resolves server-side. Bots can't spoof humans.
- **Admin allowlist** — optional `OPERATOR_STUDIO_ADMINS` env var to gate the admin surface to specific display names.
- **Identity seam** — three functions (`isAuthenticated`, `authorizeRequest`, `isAdmin`) to swap for Auth.js / Clerk / WorkOS / your SSO.

## Quick start

```bash
cp .env.example .env.local
# edit DATABASE_URL
pnpm install
pnpm db:migrate
pnpm dev
```

Then visit `http://localhost:4200`.

Load a synthetic showcase (14 threads, 81 messages, promoted examples) so the dashboard isn't empty on first boot:

```bash
pnpm db:seed:demo
```

`pnpm db:seed` by itself creates just the `global` workspace and leaves the app empty — that's the right starting point when you want to capture real conversations from turn one.

## Ingest from anywhere

The `/ingest` endpoint is the point of the product. Send it anything:

```bash
# A plain transcript
curl -X POST "http://localhost:4200/api/operator-studio/ingest?title=debug-session" \
  -H "Content-Type: text/plain" \
  --data-binary $'User: why is the sidebar not re-rendering?\n\nAssistant: the layout is still resolving the cached fetch...'

# A Gemini generateContent response, piped directly
gemini generate "explain websockets" --format json \
  | curl -X POST "http://localhost:4200/api/operator-studio/ingest" \
         -H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN" \
         -H "Content-Type: application/json" \
         --data-binary @-

# Whatever is on the clipboard
pbpaste | curl -X POST "http://localhost:4200/api/operator-studio/ingest" \
               -H "Authorization: Bearer $OPERATOR_STUDIO_INGEST_TOKEN" \
               -H "Content-Type: text/plain" \
               --data-binary @-
```

Shell helpers, webhook receivers, and IDE hook patterns live in [`examples/`](./examples/). `source examples/ingest/opsctl.sh` in your `.zshrc` for `pbpaste | opsctl ingest --title "..."`.

## Auth

Operator Studio ships with **no authentication on by default**. Visit the app, pick a display name in the identity modal, and start reviewing. That's the right default for local dev, small teams on a private network, and ephemeral review sessions.

### Optional dev gate

Set `OPERATOR_STUDIO_PASSWORD` in your environment to any non-empty string to turn on a shared-password prompt:

```bash
# .env.local
OPERATOR_STUDIO_PASSWORD=something-only-our-team-knows
```

> **The bundled gate is a development convenience, not a security boundary.** It's a single shared password in a cookie — fine for "don't let randos poke at my demo" over the weekend, not fine as the only thing between the public internet and your data.

### Machine-facing auth

API routes accept `Authorization: Bearer <token>`. Two flavors:

- **Per-user tokens** — mint in `/operator-studio/admin`. Stored as SHA-256 hashes with a `display_name` that becomes the attribution when the token is used. Revoke any time.
- **Legacy shared token** — `OPERATOR_STUDIO_INGEST_TOKEN` env var. Useful for bootstrap scripts and CI before the admin UI is populated.

### Going to production

Replace the bundled session route with a real auth library before deploying anywhere public. The surface you'd swap is small — **four functions**:

- `app/api/operator-studio/session/route.ts` — issues the session cookie
- `lib/operator-studio/auth.ts`:
  - `isAuthenticated()` — cookie-bearing UI requests
  - `authorizeRequest(req)` — machine-facing API requests (bearer + cookie)
  - `isAdmin(auth)` — is this caller allowed to mint tokens / manage webhooks
- `app/(operator-studio)/operator-studio/components/password-gate.tsx` — client-side gate UI (drop when you have real login)
- `app/(operator-studio)/operator-studio/components/identity-modal.tsx` — display-name prompt (drop when your auth provider gives you `session.user.name`)

Reasonable drop-in options:

- **[Auth.js](https://authjs.dev/)** — the default in the Next.js ecosystem; providers for GitHub, Google, email, credentials.
- **[Clerk](https://clerk.com/)** — hosted, batteries included, free tier for small teams.
- **[WorkOS](https://workos.com/)** / **[Stack Auth](https://stack-auth.com/)** — SSO / SAML for business customers.
- **Your own** — JWT, proxy header, existing session store — whatever your infra already speaks.

PRs that add drop-in integrations under `examples/auth/<provider>/` are welcome.

## Workspaces

One workspace is always the `global` library; any others you create are sub-workspaces.

- Threads / messages / summaries / chat sessions are **hard-scoped** to the workspace they live in. No implicit inheritance.
- The switcher at the top of the sidebar changes workspaces; your active choice lives in a cookie.
- **Promote** copies a thread from a sub-workspace into `global`; **Pull** copies a global thread down. Both preserve provenance (`promoted_from_id`, `pulled_from_id`) and include messages + summaries. Continuation chat sessions are operator-scoped and aren't copied.

Use sub-workspaces however your team wants — per-project, per-reviewer, per-sprint — and keep `global` as the shared-good-stuff library.

## Grounded continuation chat

The chat feature routes through an OpenAI-compatible `/v1/chat/completions` endpoint:

- **Local** — [llama.cpp](https://github.com/ggerganov/llama.cpp), [Ollama](https://ollama.ai), [vLLM](https://github.com/vllm-project/vllm), [LM Studio](https://lmstudio.ai)
- **Cloud** — any OpenAI-compatible provider

Configure via `WORKBOOK_CLUSTER_ENDPOINTS` (comma-separated URLs) and `WORKBOOK_CLUSTER_MODEL`. Leave the endpoints blank to have chat run in echo mode — the UI still works, useful for exploring before wiring up a model. Streaming is on by default; pass `?stream=0` or use `Accept: application/json` for the non-streaming variant.

## Outbound webhooks

Subscribe receivers in `/operator-studio/admin` → Webhooks. Each delivery POSTs a signed JSON envelope:

```
X-OperatorStudio-Event: thread.promoted
X-OperatorStudio-Delivery: <uuid>
X-OperatorStudio-Timestamp: <iso>
X-OperatorStudio-Signature: sha256=<hex>   (when a secret is configured)
```

Events fire for `thread.imported`, `thread.promoted`, `thread.archived`, and `message.promoted`. Full delivery contract and HMAC verification snippets in [`examples/webhooks/`](./examples/webhooks/) alongside working Slack + Discord receiver templates.

A zero-DB global hatch — `OPERATOR_STUDIO_PROMOTION_WEBHOOK_URL` + `_SECRET` — fires on every event across every workspace without needing an admin-UI row.

## Tech stack

- Next.js 16, React 19
- Drizzle ORM + Postgres (tsvector for search)
- Tailwind CSS v4, shadcn UI
- Zod on every write path

Requires Node ≥20 and pnpm ≥9.

## License

Operator Studio is source-available under the [PolyForm Small Business License 1.0.0](./LICENSE).

- **Free** for personal use, hobby projects, research, nonprofits, and any small business (fewer than 100 total employees + contractors AND less than US$1M annual revenue in the prior tax year).
- **Commercial license required** for larger organizations. Email [me@davidlinclark.com](mailto:me@davidlinclark.com) — typical pricing is flat-rate annual per workspace; contact for a quote.

This license is not OSI-approved "open source" — it is deliberately source-available with a small-business carve-out. The license text is lawyer-drafted and taken verbatim from [polyformproject.org](https://polyformproject.org/licenses/small-business/1.0.0). If you're over the threshold and want to use Operator Studio, talk to us — we want to make it easy.
