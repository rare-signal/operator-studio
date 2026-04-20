# Contributing

Thanks for the interest. Operator Studio is small, opinionated, and moves fast — a tight contributing flow keeps it that way.

## Setup

```bash
git clone https://github.com/rare-signal/operator-studio.git
cd operator-studio
cp .env.example .env.local
# edit DATABASE_URL — point at a local Postgres; create the DB first:
#   createdb operator_studio
nvm use            # uses .nvmrc → Node 20
pnpm install
pnpm db:migrate
pnpm db:seed:demo  # populates the showcase
pnpm dev           # http://localhost:4200
```

Run the full local check before pushing:

```bash
pnpm typecheck && pnpm build && pnpm test
```

## What to work on

Good first issues live in [GitHub Issues](https://github.com/rare-signal/operator-studio/issues). We label the ones that are well-scoped and actionable — those are the best places to start.

We especially welcome:

- **New source-app parsers** for the universal parser (`lib/operator-studio/importers/universal-parser.ts`). If an assistant you use has a niche response shape we don't recognize, add a case. Tests in `universal-parser.test.ts` show the pattern.
- **Auth provider adapters** under `examples/auth/<provider>/`. Drop-in Auth.js, Clerk, WorkOS, Stack Auth integrations are all fair game. See the README's "Going to production" section for the seam.
- **Webhook receivers** under `examples/webhooks/`. We ship Slack + Discord; PRs with Linear, Notion, PagerDuty, or your favorite tool are welcome.
- **IDE hooks** under `examples/ingest/`. Cursor, VS Code, Zed, aider, whatever — a working `SessionEnd` hook that pipes a conversation into `/ingest` is high-leverage.

## House style

- **TypeScript strict.** No `any` without a written justification comment.
- **Zod on every write route.** Validate the body; return `{error, issues?}` on failure.
- **No opacity modifiers on text colors.** Use `text-foreground`, `text-foreground/80`, or `text-muted-foreground`. If you need hierarchy, use size or weight.
- **No new UI dependencies** without discussion. We deliberately ship a small shadcn subset.
- **Migrations via `pnpm db:generate`** and committed. The hand-rolled `0001_search_tsv.sql` is the only SQL that isn't drizzle-kit-managed.
- **Workspace-scoped queries.** Any new query on threads / messages / summaries / sessions must take a `workspaceId` and filter on it.

## Pull request checklist

- [ ] Branch off `main`.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm build` clean.
- [ ] `pnpm test` clean.
- [ ] If you added a new API route, it uses `authorizeRequest(req)` (or `isAdmin(auth)` for admin-only routes) and Zod-validates input.
- [ ] If you added UI, you walked through it once locally with `pnpm db:seed:demo` as the data source.
- [ ] Docs updated — both the README and `/operator-studio/docs` (`docs-content.tsx`) if the change is user-visible.
- [ ] No secrets, no `.env.local`, no committed `.next` or `node_modules`.

## Commit style

Imperative subject line, ≤72 chars. A commit body is welcome when the change is non-obvious. Squash merges are fine.

## Licensing

Operator Studio is released under the [PolyForm Small Business License 1.0.0](./LICENSE). By contributing, you agree your contribution is licensed under the same terms. If that's a blocker for your org, [open an issue](https://github.com/rare-signal/operator-studio/issues) and we'll talk.
