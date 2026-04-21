import { eq } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import {
  operatorChatMessages,
  operatorChatSessions,
  operatorImportRuns,
  operatorThreadMessages,
  operatorThreadSummaries,
  operatorThreads,
  workspaces,
} from "../lib/server/db/schema"

const GLOBAL_WORKSPACE_ID = "global"

type Role = "user" | "assistant"
type ReviewState = "imported" | "in-review" | "promoted"
type SourceApp = "claude" | "codex" | "manual"
type PromotionKind = "insight" | "decision" | "quotable" | "technical" | "fire"
type SummaryKind = "auto" | "manual" | "promoted"

type SeedMessage = {
  role: Role
  content: string
  /** If present, this message is marked promoted. */
  promotion?: {
    by: string
    kind: PromotionKind
    note: string
    /** Day offset after thread start for the promotion timestamp. */
    dayOffset?: number
  }
}

type SeedSummary = {
  kind: SummaryKind
  content: string
  by: string
  /** Day offset after thread start. Defaults to 1. */
  dayOffset?: number
}

type SeedChatTurn = {
  role: Role
  content: string
  modelLabel?: string | null
}

type SeedChatSession = {
  title: string
  operator: string
  turns: SeedChatTurn[]
  /** Day offset after thread start for session createdAt. */
  dayOffset?: number
}

type SeedThread = {
  rawTitle: string
  rawSummary: string
  sourceApp: SourceApp
  importedBy: string
  ownerName: string
  reviewState: ReviewState
  tags: string[]
  projectSlug: string
  /** Days ago (from reference "now") the thread was imported/created. */
  daysAgo: number
  promotedTitle?: string
  promotedSummary?: string
  whyItMatters?: string
  messages: SeedMessage[]
  summaries?: SeedSummary[]
  chatSessions?: SeedChatSession[]
}

const NAMES = ["alex", "sam", "jordan", "morgan", "casey", "riley"] as const

// Hand-authored "why was this worth capturing?" rationales, keyed by the
// thread's rawTitle. Populates capture_reason on the seeded threads so the
// showcase always has content in that column — live ingests derive this
// via the LLM cluster (see lib/operator-studio/importers/generate-capture-reason.ts).
const CAPTURE_REASONS: Record<string, string> = {
  "Next.js 15 layout not re-rendering after router.refresh()":
    "Trace-through of why router.refresh() skips cached fetches in parent layouts — ends with the revalidatePath('…', 'layout') fix most teams miss.",
  "Drizzle migrations against an existing Postgres schema":
    "Decision path for introspect vs push when inheriting a live DB, plus the safe ordering for checking migrations into CI.",
  "GitHub Action caching node_modules correctly":
    "Shows the pnpm-store cache pattern that shaves ~90s off CI; the anti-pattern (caching node_modules) is explicitly called out.",
  "Memory leak in a long-running Node worker":
    "Debugging session ending in the closure-captured-context root cause; the heap-snapshot workflow is worth keeping as a reference.",
  "SSR-safe dark mode in a Tailwind app":
    "Reusable pattern for avoiding the initial-paint flash on SSR; the inline script approach is concretely specified.",
  "Flaky Playwright test fails only on CI":
    "Font-loading-timing root cause for a CI-only flake — a class of bug worth recognizing once before fighting for hours.",
  "Cloudflare Worker proxy with edge caching":
    "Working cache-key + origin-header pattern for a Workers proxy, including the specific mistake made on the first pass.",
  "fetch() in Server Component returning 401":
    "Explains why fetch-to-self fails in RSC and gives the 'share a server-side helper' fix — bites most teams once.",
  "Porting a CRA app to Vite":
    "Concrete migration checklist with the env-var rename trap and the SVG-import workaround that tripped up the port.",
  "Postgres trigger to enforce soft-delete invariant":
    "Reference SQL for an AFTER UPDATE trigger that blocks hard deletes when deleted_at is already set — drop-in pattern.",
  "Schema-first Zod validation in Express":
    "Middleware shape for Zod-validating body + query + params with a single helper; useful boilerplate to lift.",
  "Migrating from pnpm 8 to pnpm 10":
    "Lockfile-format and peer-dep-resolution changes to watch for, with the specific flags that unblocked the upgrade.",
  "Tailwind v4 arbitrary variants not working":
    "Docs-drift bug: the v3 arbitrary-variant syntax breaks in v4; this captures the new form before someone else wastes an hour.",
  "Debugging hydration mismatch on a date field":
    "Locale/timezone root cause for a hydration diff, plus the suppressHydrationWarning scope guidance — common gotcha.",
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function daysAgo(reference: Date, days: number, jitterHours = 0): Date {
  const date = new Date(reference.getTime())
  date.setDate(date.getDate() - days)
  if (jitterHours !== 0) {
    date.setHours(date.getHours() + jitterHours)
  }
  return date
}

// ---------------------------------------------------------------------------
// Showcase thread corpus. 14 synthetic, public-internet-tech debugging /
// implementation sessions. Content is illustrative only.
// ---------------------------------------------------------------------------

const THREADS: SeedThread[] = [
  {
    rawTitle: "Next.js 15 layout not re-rendering after router.refresh()",
    rawSummary:
      "Tracked down why a shared dashboard layout wasn't picking up fresh data after calling router.refresh() from a server action.",
    sourceApp: "claude",
    importedBy: "alex",
    ownerName: "alex",
    reviewState: "promoted",
    tags: ["nextjs", "app-router", "caching"],
    projectSlug: "acme-app",
    daysAgo: 2,
    promotedTitle: "router.refresh() doesn't bust fetch cache in parent layouts",
    promotedSummary:
      "If the parent layout uses fetch() with the default force-cache, router.refresh() won't repopulate it. Use revalidatePath or tag-based revalidate.",
    whyItMatters:
      "This one bites every team porting a pages-router app to app router. Worth keeping as a reference.",
    messages: [
      {
        role: "user",
        content:
          "Hitting a weird thing in Next 15 app router. I call router.refresh() after a server action but my layout.tsx still shows stale data. Only the page.tsx updates. What am I missing?",
      },
      {
        role: "assistant",
        content:
          "router.refresh() re-runs server components for the current route, including layouts, but it does NOT invalidate the Data Cache. If layout.tsx has a top-level `await fetch(url)` with the default cache: 'force-cache', that response is memoized and will be served again.",
      },
      {
        role: "user",
        content: "Ah. So the RSC re-renders but fetch returns the cached body. How do I punch through that?",
      },
      {
        role: "assistant",
        content:
          "Two options. In the server action, call revalidatePath('/dashboard', 'layout') — the 'layout' second arg is what forces the layout segment to re-fetch, not just the page. Or tag the fetch: fetch(url, { next: { tags: ['dashboard'] } }) and then revalidateTag('dashboard') from the action.",
        promotion: {
          by: "alex",
          kind: "technical",
          note: "This is the actual answer — save it.",
          dayOffset: 0,
        },
      },
      {
        role: "user",
        content: "Tried revalidatePath('/dashboard', 'layout') and it worked. Thanks.",
      },
      {
        role: "assistant",
        content:
          "Worth knowing: the second argument defaults to 'page'. That's why most people assume revalidatePath is 'broken' against layouts.",
      },
    ],
    summaries: [
      {
        kind: "promoted",
        content:
          "Next 15 router.refresh() re-runs server components but does not invalidate fetch's Data Cache. Use revalidatePath(path, 'layout') or tagged fetches with revalidateTag to refresh parent layouts.",
        by: "alex",
        dayOffset: 1,
      },
    ],
    chatSessions: [
      {
        title: "Follow-up: does this apply to loading.tsx too?",
        operator: "alex",
        dayOffset: 1,
        turns: [
          {
            role: "user",
            content:
              "Quick follow-up on the router.refresh thing. Does the same caching gotcha apply to loading.tsx, or is that a non-issue?",
          },
          {
            role: "assistant",
            content:
              "loading.tsx doesn't fetch data — it's just a Suspense fallback. So there's nothing to cache at that boundary. The cached fetch lives in whichever server component actually awaits it.",
            modelLabel: "local-8b",
          },
          {
            role: "user",
            content: "Got it. And if I use unstable_cache inside the layout?",
          },
          {
            role: "assistant",
            content:
              "unstable_cache respects its own tags and revalidate settings. revalidatePath won't touch it unless you also give the cache a matching tag and revalidateTag it.",
            modelLabel: "local-8b",
          },
        ],
      },
    ],
  },
  {
    rawTitle: "Drizzle migrations against an existing Postgres schema",
    rawSummary:
      "Setting up drizzle-kit on a project where the Postgres schema already exists and can't be dropped.",
    sourceApp: "claude",
    importedBy: "sam",
    ownerName: "sam",
    reviewState: "promoted",
    tags: ["drizzle", "postgres", "migrations"],
    projectSlug: "widgets-api",
    daysAgo: 5,
    promotedTitle: "drizzle-kit introspect vs push on a live schema",
    promotedSummary:
      "Use `drizzle-kit introspect` first to generate the schema file from the live DB, then switch to migrations. Never run `drizzle-kit push` against a production DB you don't own.",
    whyItMatters: "New projects often inherit a DB. This is the safe path.",
    messages: [
      {
        role: "user",
        content:
          "I have a Postgres DB with ~40 tables already in production. I want to adopt Drizzle without nuking anything. Best path?",
      },
      {
        role: "assistant",
        content:
          "Run `drizzle-kit introspect` against the DATABASE_URL. It produces a schema.ts matching the live tables, plus a meta snapshot. You can then hand-edit the schema to use better column names or relations, but start from that autogenerated baseline.",
      },
      {
        role: "user",
        content: "And after that, do I use push or migrate?",
      },
      {
        role: "assistant",
        content:
          "For a shared DB, always `generate` + `migrate`. `push` compares schema.ts to the live DB and will happily drop columns it doesn't recognize. Fine for a scratch dev DB, not fine for prod.",
        promotion: {
          by: "sam",
          kind: "decision",
          note: "Team convention: push is dev-only.",
          dayOffset: 0,
        },
      },
      {
        role: "user",
        content: "Can I keep two drizzle configs — one for push against local, one for migrate against staging/prod?",
      },
      {
        role: "assistant",
        content:
          "Yes. Two drizzle.config.ts files (e.g. drizzle.local.config.ts) and pass --config to drizzle-kit. Most teams just gate by NODE_ENV in one config though.",
      },
      {
        role: "user",
        content:
          "Last thing: introspect named some columns camelCase and some snake_case. How do I normalize?",
      },
      {
        role: "assistant",
        content:
          "Drizzle's TS column name is the first arg to e.g. text(); the DB column is the string inside text(). Rename the TS identifier freely — introspect just picks one. Keep the second-arg string matching the actual DB column.",
      },
    ],
    summaries: [
      {
        kind: "manual",
        content:
          "Adopted Drizzle on existing Postgres. introspect to bootstrap schema.ts, generate+migrate for all non-dev environments, never push to prod.",
        by: "sam",
        dayOffset: 2,
      },
    ],
    chatSessions: [
      {
        title: "Continuing: rolling out the first migration",
        operator: "sam",
        dayOffset: 3,
        turns: [
          {
            role: "user",
            content:
              "Picking this back up. I want to add a `soft_deleted_at` column to the users table as the first real migration. Anything special?",
          },
          {
            role: "assistant",
            content:
              "Add the column in schema.ts as timestamp('soft_deleted_at', { withTimezone: true }), run drizzle-kit generate, inspect the SQL diff, then migrate. Postgres will add the column nullable by default so no table rewrite.",
            modelLabel: "local-8b",
          },
          {
            role: "user",
            content: "Do I need a partial index for queries filtering WHERE soft_deleted_at IS NULL?",
          },
          {
            role: "assistant",
            content:
              "If most rows are live and reads dominate, yes: CREATE INDEX users_live_idx ON users (id) WHERE soft_deleted_at IS NULL. Drizzle supports this via index().where().",
            modelLabel: "local-8b",
          },
          {
            role: "user",
            content: "Perfect, thanks.",
          },
        ],
      },
    ],
  },
  {
    rawTitle: "GitHub Action caching node_modules correctly",
    rawSummary:
      "CI was reinstalling deps on every run. Fixed by switching to pnpm store cache instead of node_modules cache.",
    sourceApp: "codex",
    importedBy: "jordan",
    ownerName: "jordan",
    reviewState: "promoted",
    tags: ["github-actions", "pnpm", "ci"],
    projectSlug: "acme-app",
    daysAgo: 8,
    promotedTitle: "Cache pnpm store, not node_modules",
    promotedSummary:
      "node_modules is a symlink farm keyed to an absolute store path. Cache the pnpm store dir and re-run `pnpm install --offline` instead.",
    whyItMatters: "Shaves ~90s off every PR CI run. Applies to every pnpm repo.",
    messages: [
      {
        role: "user",
        content:
          "My GH Action is taking 2+ min on pnpm install even with actions/cache pointing at node_modules. Cache says hit but install still runs.",
      },
      {
        role: "assistant",
        content:
          "node_modules under pnpm is full of symlinks into ~/.local/share/pnpm/store. When actions/cache restores node_modules on a fresh runner, the symlink targets don't exist, so pnpm re-resolves everything.",
      },
      {
        role: "user",
        content: "So what do I cache?",
      },
      {
        role: "assistant",
        content:
          "Run `pnpm store path` to find the store dir, cache THAT, then run `pnpm install --frozen-lockfile`. If the store is warm, install is nearly instant because it just relinks.",
        promotion: {
          by: "jordan",
          kind: "fire",
          note: "90s saved per run. Rolling this out to every repo.",
          dayOffset: 0,
        },
      },
      {
        role: "user",
        content: "pnpm/action-setup already does this, right?",
      },
      {
        role: "assistant",
        content:
          "Yes, pnpm/action-setup@v4 with cache: true wires up actions/cache on the store dir automatically. Use that unless you need custom cache keying.",
      },
    ],
    summaries: [
      {
        kind: "auto",
        content:
          "CI install slow under pnpm despite node_modules cache hits. Fixed by caching the pnpm store directory instead. pnpm/action-setup@v4 with cache:true handles it.",
        by: "jordan",
        dayOffset: 1,
      },
    ],
  },
  {
    rawTitle: "Memory leak in a long-running Node worker",
    rawSummary:
      "Heap grew unbounded on a BullMQ worker. Turned out to be an accidental closure over job payloads.",
    sourceApp: "claude",
    importedBy: "morgan",
    ownerName: "morgan",
    reviewState: "in-review",
    tags: ["node", "bullmq", "memory"],
    projectSlug: "workers-proxy",
    daysAgo: 10,
    messages: [
      {
        role: "user",
        content:
          "Node worker RSS climbs to 2GB over ~6h and then OOMs. Heap dump shows a giant array of job objects. I don't store them anywhere explicitly.",
      },
      {
        role: "assistant",
        content:
          "Classic closure leak. Check whether your worker handler references a module-scope array or map. In BullMQ, a common pattern is something like `recentJobs.push(job)` for debugging and forgetting it.",
      },
      {
        role: "user",
        content:
          "Hmm. I have `const metrics = []` at module scope and each job pushes { id, startedAt, durationMs }. That's tiny though, not whole jobs.",
      },
      {
        role: "assistant",
        content:
          "Capture a heap snapshot with --inspect and open it in Chrome DevTools. Look at Retainers for one of those metric objects. If `startedAt` is actually `new Date(job.timestamp)` you might be holding Date refs, but if job itself is closed over, even indirectly, the whole payload stays alive.",
      },
      {
        role: "user",
        content:
          "Found it. My durationMs computation was `() => Date.now() - job.timestamp` and I was storing the function, not the number.",
      },
      {
        role: "assistant",
        content:
          "There it is. The arrow function captured job, so every metric entry retained its entire job payload. Compute the number eagerly and store that.",
        promotion: {
          by: "morgan",
          kind: "insight",
          note: "Good example of a closure leak caught via retainers view.",
          dayOffset: 1,
        },
      },
      {
        role: "user",
        content: "Also switching metrics to a bounded ring buffer, 1000 entries max.",
      },
      {
        role: "assistant",
        content:
          "Good. For long-running workers, any unbounded collection eventually becomes the bug.",
      },
    ],
    summaries: [
      {
        kind: "manual",
        content:
          "Worker leak was an arrow function stored in a metrics array closing over the full job payload. Fix: compute derived numbers eagerly; cap collections.",
        by: "morgan",
        dayOffset: 2,
      },
    ],
  },
  {
    rawTitle: "SSR-safe dark mode in a Tailwind app",
    rawSummary: "Fixed the flash-of-wrong-theme on first paint.",
    sourceApp: "claude",
    importedBy: "casey",
    ownerName: "casey",
    reviewState: "imported",
    tags: ["tailwind", "dark-mode", "ssr"],
    projectSlug: "dashboard",
    daysAgo: 12,
    messages: [
      {
        role: "user",
        content:
          "Using next-themes, dark mode works but there's a flash on hard reload — white flash, then flips dark. How do I kill it?",
      },
      {
        role: "assistant",
        content:
          "You need a blocking inline script in <head> that reads localStorage and sets the `class` on <html> before first paint. next-themes' <ThemeProvider> renders this automatically if you set attribute='class' and disableTransitionOnChange.",
      },
      {
        role: "user",
        content:
          "I have attribute='class' already. Still flashing.",
      },
      {
        role: "assistant",
        content:
          "Check that your <html> element doesn't have `className='light'` hardcoded from layout.tsx. next-themes wants to own that class. Also make sure suppressHydrationWarning is on <html> so the class mismatch doesn't trigger a re-render.",
      },
      {
        role: "user",
        content: "That was it — I had className='light' on <html>. Removed and added suppressHydrationWarning. Clean.",
      },
    ],
  },
  {
    rawTitle: "Flaky Playwright test fails only on CI",
    rawSummary:
      "Test passed 100% locally, failed ~30% on CI. Root cause was font loading timing.",
    sourceApp: "codex",
    importedBy: "riley",
    ownerName: "riley",
    reviewState: "in-review",
    tags: ["playwright", "ci", "flaky-tests"],
    projectSlug: "dashboard",
    daysAgo: 14,
    messages: [
      {
        role: "user",
        content:
          "Playwright test that clicks a button and asserts a toast shows up passes locally every time. On CI it fails maybe 1 in 3 with 'locator.click: element is not stable'.",
      },
      {
        role: "assistant",
        content:
          "`element is not stable` means the button's bounding box is still moving when Playwright tries to click. On CI this often correlates with fonts loading late, which reflows the layout.",
      },
      {
        role: "user",
        content: "How do I pin that down?",
      },
      {
        role: "assistant",
        content:
          "Before the click, await page.evaluate(() => document.fonts.ready). Or set your test base URL to serve with fonts preloaded, or use system fonts in CI via an env flag.",
      },
      {
        role: "user",
        content: "Adding document.fonts.ready fixed it. 100/100 now.",
      },
      {
        role: "assistant",
        content:
          "Good. As a general rule: any 'not stable' flake is about layout settling, not about the element itself.",
        promotion: {
          by: "riley",
          kind: "quotable",
          note: "Nice one-liner to remember.",
          dayOffset: 0,
        },
      },
    ],
    summaries: [
      {
        kind: "auto",
        content:
          "Playwright 'not stable' flake on CI caused by late web font load reflowing the layout. Fix: await document.fonts.ready before clicks in layout-sensitive tests.",
        by: "riley",
        dayOffset: 1,
      },
    ],
  },
  {
    rawTitle: "Cloudflare Worker proxy with edge caching",
    rawSummary:
      "Built a Worker that fronts an origin API and caches GETs at the edge for 60s.",
    sourceApp: "claude",
    importedBy: "alex",
    ownerName: "alex",
    reviewState: "imported",
    tags: ["cloudflare", "workers", "edge-caching"],
    projectSlug: "workers-proxy",
    daysAgo: 16,
    messages: [
      {
        role: "user",
        content: "I want a Cloudflare Worker that proxies /api/* to origin.example.com and caches GETs for 60s.",
      },
      {
        role: "assistant",
        content:
          "Use the Cache API: const cache = caches.default; const hit = await cache.match(request); if hit, return it. Otherwise fetch origin, then cache.put(request, response.clone()) if method is GET and status is 200.",
      },
      {
        role: "user",
        content: "Do I need to set Cache-Control on the origin response for cache.put to work?",
      },
      {
        role: "assistant",
        content:
          "Yes — caches.default respects Cache-Control. If origin returns no-store, cache.put is a no-op. Easiest path: in the Worker, clone the response and overwrite headers with 'Cache-Control: public, max-age=60' before cache.put.",
        promotion: {
          by: "alex",
          kind: "technical",
          note: "Non-obvious — the Cache API respects response headers even in Workers.",
          dayOffset: 1,
        },
      },
      {
        role: "user",
        content: "Cool. What about vary on Authorization?",
      },
      {
        role: "assistant",
        content:
          "If requests are authed, either skip the cache entirely for authed requests or include the Authorization header in the cache key via a custom Request. caches.default uses the URL + method + Vary by default.",
      },
    ],
  },
  {
    rawTitle: "fetch() in Server Component returning 401",
    rawSummary: "Forgot that cookies aren't forwarded automatically from RSC fetches.",
    sourceApp: "claude",
    importedBy: "sam",
    ownerName: "sam",
    reviewState: "imported",
    tags: ["nextjs", "auth", "rsc"],
    projectSlug: "acme-app",
    daysAgo: 18,
    messages: [
      {
        role: "user",
        content:
          "In a server component I call `await fetch('/api/me')` on my own app and it returns 401. Browser dev tools show the cookie is set. What's going on?",
      },
      {
        role: "assistant",
        content:
          "Server-side fetch doesn't carry browser cookies. You need to forward them explicitly. Import cookies() from next/headers, grab the cookie string, and pass it as a header.",
      },
      {
        role: "user",
        content: "Show me?",
      },
      {
        role: "assistant",
        content:
          "const cookieHeader = (await cookies()).toString(); const res = await fetch(url, { headers: { cookie: cookieHeader } }). That will send the same cookies the incoming request had.",
      },
      {
        role: "user",
        content: "Works. Though — should I even be fetching my own API from a server component?",
      },
      {
        role: "assistant",
        content:
          "Usually no. You can call the same query function directly and skip the HTTP hop. fetch-to-self is a pattern from pages router; in app router, share a server-side function between the route handler and the RSC.",
      },
    ],
  },
  {
    rawTitle: "Porting a CRA app to Vite",
    rawSummary: "Migrated ~60 files, hit a couple of env var gotchas.",
    sourceApp: "codex",
    importedBy: "jordan",
    ownerName: "jordan",
    reviewState: "imported",
    tags: ["vite", "migration", "cra"],
    projectSlug: "widgets-api",
    daysAgo: 20,
    messages: [
      {
        role: "user",
        content: "Porting a Create React App project to Vite. What's the dumbest thing I'll trip on first?",
      },
      {
        role: "assistant",
        content:
          "Environment variables. CRA uses process.env.REACT_APP_*. Vite uses import.meta.env.VITE_*. Rename the prefixes and swap the access pattern.",
      },
      {
        role: "user",
        content: "Anything for absolute imports from src?",
      },
      {
        role: "assistant",
        content:
          "In vite.config.ts add resolve.alias['@'] = path.resolve(__dirname, 'src') and set the same in tsconfig.json paths. CRA's baseUrl:'src' trick doesn't map cleanly.",
      },
      {
        role: "user",
        content: "SVG-as-component imports?",
      },
      {
        role: "assistant",
        content:
          "CRA exposes `import { ReactComponent as Icon } from './foo.svg'`. In Vite, use vite-plugin-svgr and `import Icon from './foo.svg?react'`.",
      },
    ],
  },
  {
    rawTitle: "Postgres trigger to enforce soft-delete invariant",
    rawSummary:
      "Wrote a trigger that blocks inserts of child rows referencing soft-deleted parents.",
    sourceApp: "claude",
    importedBy: "morgan",
    ownerName: "morgan",
    reviewState: "imported",
    tags: ["postgres", "triggers", "soft-delete"],
    projectSlug: "widgets-api",
    daysAgo: 22,
    messages: [
      {
        role: "user",
        content:
          "I have users.soft_deleted_at and orders.user_id. I want to prevent new orders referencing a soft-deleted user. FK alone doesn't help. Trigger?",
      },
      {
        role: "assistant",
        content:
          "Yes, a BEFORE INSERT OR UPDATE trigger on orders. In the function: SELECT soft_deleted_at FROM users WHERE id = NEW.user_id; IF FOUND AND soft_deleted_at IS NOT NULL THEN RAISE EXCEPTION 'user is soft-deleted'. END IF; RETURN NEW.",
      },
      {
        role: "user",
        content: "Can you write it out fully?",
      },
      {
        role: "assistant",
        content:
          "CREATE FUNCTION orders_block_deleted_user() RETURNS trigger LANGUAGE plpgsql AS $$\nDECLARE d timestamptz;\nBEGIN\n  SELECT soft_deleted_at INTO d FROM users WHERE id = NEW.user_id;\n  IF d IS NOT NULL THEN\n    RAISE EXCEPTION 'cannot insert order for soft-deleted user %', NEW.user_id;\n  END IF;\n  RETURN NEW;\nEND;$$;\nCREATE TRIGGER orders_block_deleted_user_trg BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION orders_block_deleted_user();",
      },
      {
        role: "user",
        content: "And I probably want to add a partial index on users(id) WHERE soft_deleted_at IS NULL for the lookup?",
      },
      {
        role: "assistant",
        content:
          "The lookup is already a PK hit on users.id, so the index doesn't help that path. The partial index matters for application queries like WHERE soft_deleted_at IS NULL, not for the trigger.",
      },
    ],
  },
  {
    rawTitle: "Schema-first Zod validation in Express",
    rawSummary: "Wired a generic middleware that validates req.body, req.query, req.params.",
    sourceApp: "claude",
    importedBy: "casey",
    ownerName: "casey",
    reviewState: "imported",
    tags: ["zod", "express", "validation"],
    projectSlug: "widgets-api",
    daysAgo: 24,
    messages: [
      {
        role: "user",
        content: "Want a single Zod-based validator for Express. body/query/params in one shot. Idiomatic pattern?",
      },
      {
        role: "assistant",
        content:
          "Define a function validate(schema: { body?, query?, params? }) that returns a middleware. Inside, call schema.body?.safeParse(req.body) etc., collect issues, and either next(err) with a 400 or attach the parsed values to req.validated.",
      },
      {
        role: "user",
        content: "Do I mutate req.body with the parsed result or keep it separate?",
      },
      {
        role: "assistant",
        content:
          "Keep it separate. Zod's .transform() can reshape the value (e.g. trim strings), so req.body and the validated value can diverge. Attach as req.validated.body and treat the original as untrusted.",
      },
      {
        role: "user",
        content: "Typing? req.validated ends up as any.",
      },
      {
        role: "assistant",
        content:
          "Use a generic: validate<T extends ValidatorSchemas>(schema: T): RequestHandler<..., z.infer<T['body']>...>. Or augment Express's Request via module augmentation with a Validated<T> helper.",
      },
    ],
  },
  {
    rawTitle: "Migrating from pnpm 8 to pnpm 10",
    rawSummary: "Hit a peer dependency strictness change and a lockfile format bump.",
    sourceApp: "codex",
    importedBy: "riley",
    ownerName: "riley",
    reviewState: "imported",
    tags: ["pnpm", "dependencies"],
    projectSlug: "acme-app",
    daysAgo: 26,
    messages: [
      {
        role: "user",
        content: "Bumped pnpm from 8 to 10 via corepack. Install now errors with a bunch of ERR_PNPM_PEER_DEP_ISSUES.",
      },
      {
        role: "assistant",
        content:
          "pnpm 10 defaults auto-install-peers to true and treats unmet peers more strictly. Add a packageManager field in package.json pinning pnpm@10.x, then either install the missing peers or set strict-peer-dependencies=false in .npmrc as a temporary escape hatch.",
      },
      {
        role: "user",
        content: "Lockfile also got regenerated. Safe to commit?",
      },
      {
        role: "assistant",
        content:
          "Yes — pnpm 10's lockfile is version 9.0 and not readable by pnpm 8. Commit it and make sure CI uses the same pnpm version (packageManager field + corepack enable in the workflow).",
      },
    ],
  },
  {
    rawTitle: "Tailwind v4 arbitrary variants not working",
    rawSummary: "Arbitrary variant syntax changed between v3 and v4.",
    sourceApp: "manual",
    importedBy: "alex",
    ownerName: "alex",
    reviewState: "imported",
    tags: ["tailwind", "v4"],
    projectSlug: "dashboard",
    daysAgo: 27,
    messages: [
      {
        role: "user",
        content:
          "Upgraded to Tailwind v4. My `[&>li]:mt-2` selectors don't apply anymore.",
      },
      {
        role: "assistant",
        content:
          "v4 still supports arbitrary variants but parses them more strictly. If the class is generated dynamically, the CSS-based config might not see it. Add @source inline in your CSS to cover the file that generates those classes.",
      },
      {
        role: "user",
        content: "That did it. Also the config file moved from JS to CSS?",
      },
      {
        role: "assistant",
        content:
          "Right — v4 uses @theme { ... } in CSS. tailwind.config.ts is optional and only needed for plugins. Simpler projects can drop it entirely.",
      },
    ],
  },
  {
    rawTitle: "Debugging hydration mismatch on a date field",
    rawSummary:
      "Server rendered one timezone, client another. Classic.",
    sourceApp: "manual",
    importedBy: "jordan",
    ownerName: "jordan",
    reviewState: "imported",
    tags: ["react", "hydration", "dates"],
    projectSlug: "dashboard",
    daysAgo: 29,
    messages: [
      {
        role: "user",
        content:
          "React hydration mismatch warning: server renders 'Apr 19, 2026' and client renders 'Apr 20, 2026'. Both are toLocaleDateString on the same ISO string.",
      },
      {
        role: "assistant",
        content:
          "toLocaleDateString uses the runtime's timezone. The server is probably UTC and the client is wherever the user is. Pass { timeZone: 'UTC' } or pre-format on the server and ship the string as a prop.",
      },
      {
        role: "user",
        content: "Right. For user-visible dates I actually want the viewer's timezone though.",
      },
      {
        role: "assistant",
        content:
          "Then render the raw ISO string from the server and format it in a client component via useEffect (or just mark that leaf 'use client' and format at render time). Accept the one-frame flicker in exchange for correct local time.",
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Seed logic.
//
// Default:  `pnpm db:seed`        -> ensure global workspace. Empty otherwise.
// Showcase: `pnpm db:seed:demo`   -> also load the synthetic thread corpus.
// Reset:    `--reset`             -> wipe all workspace-scoped data first.
//
// Combine as needed:
//   pnpm db:seed -- --reset
//   pnpm db:seed:demo -- --reset
// ---------------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2))
  const reset = args.has("--reset")
  const loadDemo = args.has("--demo")

  const db = getDb()
  const now = new Date()

  if (reset) {
    await db.delete(operatorChatMessages)
    await db.delete(operatorChatSessions)
    await db.delete(operatorThreadSummaries)
    await db.delete(operatorThreadMessages)
    await db.delete(operatorImportRuns)
    await db.delete(operatorThreads)
    await db.delete(workspaces)
    console.log(
      "Reset: truncated chat messages, chat sessions, summaries, thread messages, import runs, threads, workspaces."
    )
  }

  // Global workspace is always present.
  const existingGlobal = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, GLOBAL_WORKSPACE_ID))

  if (existingGlobal.length === 0) {
    await db.insert(workspaces).values({
      id: GLOBAL_WORKSPACE_ID,
      label: "Global library",
      isGlobal: 1,
      createdAt: now,
      updatedAt: now,
    })
    console.log("Seeded global workspace.")
  } else {
    console.log("Global workspace already present.")
  }

  if (!loadDemo) {
    console.log("Done. Studio is empty — run the app and import threads, or start fresh.")
    console.log("To load the synthetic showcase, rerun with: pnpm db:seed:demo")
    await getPgPool().end()
    return
  }

  // Demo mode: bail if threads already present, unless --reset was passed.
  const existingThreads = await db
    .select({ id: operatorThreads.id })
    .from(operatorThreads)
    .limit(1)
  if (existingThreads.length > 0 && !reset) {
    console.log("Skipping demo seed: threads already present.")
    console.log("Rerun with --reset to wipe and re-seed the showcase.")
    await getPgPool().end()
    return
  }

  let threadsInserted = 0
  let messagesInserted = 0
  let summariesInserted = 0
  let sessionsInserted = 0
  let chatMessagesInserted = 0

  for (let i = 0; i < THREADS.length; i++) {
    const spec = THREADS[i]
    const threadIndex = i + 1
    const threadId = `thread-seed-${pad2(threadIndex)}`

    // Stagger thread start within the day.
    const jitterHours = (i % 7) - 3
    const importedAt = daysAgo(now, spec.daysAgo, jitterHours)
    const createdAt = importedAt
    const updatedAt = new Date(importedAt.getTime() + 1000 * 60 * 60 * 2)

    await db.insert(operatorThreads).values({
      id: threadId,
      workspaceId: GLOBAL_WORKSPACE_ID,
      sourceApp: spec.sourceApp,
      sourceThreadKey: `${spec.sourceApp}-${threadId}`,
      sourceLocator: null,
      importedBy: spec.importedBy,
      importedAt,
      importRunId: null,
      rawTitle: spec.rawTitle,
      rawSummary: spec.rawSummary,
      promotedTitle: spec.promotedTitle ?? null,
      promotedSummary: spec.promotedSummary ?? null,
      privacyState: "private",
      reviewState: spec.reviewState,
      tags: spec.tags,
      projectSlug: spec.projectSlug,
      ownerName: spec.ownerName,
      whyItMatters: spec.whyItMatters ?? null,
      captureReason: CAPTURE_REASONS[spec.rawTitle] ?? null,
      sourcePayloadJson: null,
      parentThreadId: null,
      promotedFromId: null,
      pulledFromId: null,
      visibleInStudio: 1,
      messageCount: spec.messages.length,
      archivedAt: null,
      createdAt,
      updatedAt,
    })
    threadsInserted += 1

    // Messages. Space turns out across the thread lifespan.
    for (let m = 0; m < spec.messages.length; m++) {
      const msg = spec.messages[m]
      const messageId = `msg-${threadId}-${pad2(m)}`
      const messageCreatedAt = new Date(importedAt.getTime() + m * 1000 * 60 * 4)

      let promotedAt: Date | null = null
      let promotedBy: string | null = null
      let promotionNote: string | null = null
      let promotionKind: string | null = null
      if (msg.promotion) {
        promotedAt = new Date(
          messageCreatedAt.getTime() + (msg.promotion.dayOffset ?? 0) * 1000 * 60 * 60 * 24
        )
        promotedBy = msg.promotion.by
        promotionNote = msg.promotion.note
        promotionKind = msg.promotion.kind
      }

      await db.insert(operatorThreadMessages).values({
        id: messageId,
        workspaceId: GLOBAL_WORKSPACE_ID,
        threadId,
        role: msg.role,
        content: msg.content,
        turnIndex: m,
        metadataJson: null,
        promotedAt,
        promotedBy,
        promotionNote,
        promotionKind,
        createdAt: messageCreatedAt,
      })
      messagesInserted += 1
    }

    // Summaries.
    if (spec.summaries) {
      for (let s = 0; s < spec.summaries.length; s++) {
        const sum = spec.summaries[s]
        const summaryId = `sum-${threadId}-${pad2(s)}`
        const summaryCreatedAt = new Date(
          importedAt.getTime() + (sum.dayOffset ?? 1) * 1000 * 60 * 60 * 24
        )
        await db.insert(operatorThreadSummaries).values({
          id: summaryId,
          workspaceId: GLOBAL_WORKSPACE_ID,
          threadId,
          summaryKind: sum.kind,
          content: sum.content,
          createdBy: sum.by,
          createdAt: summaryCreatedAt,
        })
        summariesInserted += 1
      }
    }

    // Continuation chat sessions.
    if (spec.chatSessions) {
      for (let c = 0; c < spec.chatSessions.length; c++) {
        const sess = spec.chatSessions[c]
        const sessionId = `session-${threadId}-${pad2(c)}`
        const sessionCreatedAt = new Date(
          importedAt.getTime() + (sess.dayOffset ?? 1) * 1000 * 60 * 60 * 24
        )
        const sessionUpdatedAt = new Date(
          sessionCreatedAt.getTime() + 1000 * 60 * 30
        )
        await db.insert(operatorChatSessions).values({
          id: sessionId,
          workspaceId: GLOBAL_WORKSPACE_ID,
          threadId,
          sessionTitle: sess.title,
          operatorName: sess.operator,
          contextSnapshotJson: {
            seededFromThreadId: threadId,
            threadTitle: spec.promotedTitle ?? spec.rawTitle,
          },
          createdAt: sessionCreatedAt,
          updatedAt: sessionUpdatedAt,
        })
        sessionsInserted += 1

        for (let t = 0; t < sess.turns.length; t++) {
          const turn = sess.turns[t]
          const chatMsgId = `cmsg-${threadId}-${pad2(c)}-${pad2(t)}`
          const chatMsgCreatedAt = new Date(
            sessionCreatedAt.getTime() + t * 1000 * 60 * 3
          )
          await db.insert(operatorChatMessages).values({
            id: chatMsgId,
            workspaceId: GLOBAL_WORKSPACE_ID,
            sessionId,
            role: turn.role,
            content: turn.content,
            modelLabel: turn.modelLabel ?? null,
            contextSnapshotJson: null,
            promotedAt: null,
            promotedBy: null,
            promotionNote: null,
            promotionKind: null,
            createdAt: chatMsgCreatedAt,
          })
          chatMessagesInserted += 1
        }
      }
    }
  }

  console.log(
    `Seeded ${threadsInserted} thread(s), ${messagesInserted} message(s), ${summariesInserted} summary row(s), ${sessionsInserted} chat session(s), ${chatMessagesInserted} chat message(s) into global workspace.`
  )
  // Silence unused-warning for NAMES while keeping it as reference.
  void NAMES

  await getPgPool().end()
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
