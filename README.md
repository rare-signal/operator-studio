# Operator Studio

A self-hostable workspace for reviewing, summarizing, and continuing agent coding sessions. Import threads from Claude Code (`~/.claude/projects`) or Codex (`~/.codex/sessions`), browse them with a rich detail view, promote the good parts (insights, decisions, quotables), and keep chatting — grounded in your own prior context.

<!-- Screenshot here -->

## Features

- Import agent coding sessions from Claude Code, Codex, or a manual JSON / JSONL paste
- Thread detail view with message-level promotion (insight / decision / quotable / technical / fire) and notes
- Summary layer (auto / manual / promoted) per thread
- Grounded continuation chat — pick up where the original thread left off, with your own summaries and promoted messages wired into the prompt
- Fork a thread into a new private branch and continue exploring in parallel
- Multi-workspace isolation — each workspace is a separate namespace for threads, messages, summaries, and chat sessions; promote threads up to a shared `global` library or pull them back down
- Self-attested operator identity on every promotion, comment, and chat turn
- Optional shared-password gate for local review sessions

## Quick start

```bash
cp .env.example .env.local
# edit DATABASE_URL
pnpm install
pnpm db:migrate
pnpm dev
```

Then visit `http://localhost:4200`.

To load a synthetic showcase of example threads (useful on a fresh clone so the dashboard isn't empty):

```bash
pnpm db:seed:demo
```

`pnpm db:seed` by itself creates just the `global` workspace and leaves the app empty — that's the right starting point for actual use.

## Auth

Operator Studio ships with **no authentication on by default**. Visit the app, pick a display name in the identity modal, and start reviewing. That's the right default for local dev, small teams on a private network, and ephemeral review sessions.

### Optional dev gate

Set `OPERATOR_STUDIO_PASSWORD` in your environment to any non-empty string to turn on a shared-password prompt. Anyone with the password can enter; anyone without it is stopped at the gate.

```bash
# .env.local
OPERATOR_STUDIO_PASSWORD=something-only-our-team-knows
```

Restart the dev server or redeploy to pick it up. Clear the env var (or leave it unset) to turn the gate back off.

> **The bundled gate is a development convenience, not a security boundary.** It's a single shared password in a cookie — fine for "don't let randos poke at my demo" over the weekend, not fine as the only thing between the public internet and your data.

### Going to production

Replace the bundled session route with a real auth library before deploying anywhere public. The surface you'd swap is small:

- `app/api/operator-studio/session/route.ts` — issues the session
- `lib/operator-studio/auth.ts` — `isAuthenticated()` and `getDisplayName()` helpers used by every protected API route
- `app/(operator-studio)/operator-studio/components/password-gate.tsx` — the client-side gate UI
- `app/(operator-studio)/operator-studio/components/identity-modal.tsx` — the display-name prompt (skip this when your auth provider already gives you `session.user.name`)

Reasonable options, from least to most opinionated:

- **[Auth.js](https://authjs.dev/)** (formerly NextAuth) — the default in the Next.js ecosystem. Drop-in providers for GitHub, Google, email magic links, credentials.
- **[Clerk](https://clerk.com/)** — hosted, batteries included, free tier suitable for small teams.
- **[WorkOS](https://workos.com/)** / **[Stack Auth](https://stack-auth.com/)** — if you need SSO or SAML for a business customer.
- **Your own** — swap `isAuthenticated()` for whatever your existing system already uses (session cookie, JWT, proxy header, etc).

PRs that add drop-in integrations under `examples/auth/<provider>/` are welcome.

## Workspaces

Operator Studio supports multiple workspaces. One is always the `global` library; any others you create are sub-workspaces.

- Threads / messages / summaries / chat sessions are **hard-scoped** to the workspace they live in. There is no implicit inheritance across workspaces.
- Use the **switcher at the top of the sidebar** to change workspaces. Your active workspace is stored in a cookie.
- Promoting a thread copies it to `global`; pulling copies it the other way. Both preserve provenance via `promoted_from_id` / `pulled_from_id` on the destination row.

Swap in whatever workspace layout suits your team — per-project, per-reviewer, per-sprint — and keep `global` as the shared-good-stuff library.

## Grounded continuation chat

The chat feature on a thread detail page routes through an OpenAI-compatible `/v1/chat/completions` endpoint. You can point it at anything that speaks that protocol:

- **Local** — [llama.cpp](https://github.com/ggerganov/llama.cpp), [Ollama](https://ollama.ai), [vLLM](https://github.com/vllm-project/llm), [LM Studio](https://lmstudio.ai)
- **Cloud** — any OpenAI-compatible provider

Configure via `WORKBOOK_CLUSTER_ENDPOINTS` (comma-separated URLs) and `WORKBOOK_CLUSTER_MODEL` in `.env.local`. Leave `WORKBOOK_CLUSTER_ENDPOINTS` blank to have the chat endpoint echo your message — useful for exploring the UI before wiring up a model backend.

## Tech stack

- Next.js 16
- React 19
- Drizzle ORM
- Postgres
- Tailwind CSS v4
- shadcn UI

## License

Operator Studio is source-available under the [PolyForm Small Business License 1.0.0](./LICENSE).

- **Free** for personal use, hobby projects, research, nonprofits, and any small business (fewer than 100 total employees + contractors AND less than US$1M annual revenue in the prior tax year).
- **Commercial license required** for larger organizations. Email `commercial@<your-domain>` — typical pricing is flat-rate annual per workspace; contact us for a quote.

This license is not OSI-approved "open source" — it is deliberately source-available with a small-business carve-out. The license text is lawyer-drafted and taken verbatim from [polyformproject.org](https://polyformproject.org/licenses/small-business/1.0.0). If you're over the threshold and want to use Operator Studio, talk to us — we want to make it easy.
