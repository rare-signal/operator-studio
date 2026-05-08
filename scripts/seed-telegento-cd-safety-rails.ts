/**
 * Seed Telegento web-app CD safety-rails plan cards into the active dogfood plan.
 *
 * Captures the "what's beyond the App Runner auto-deploy pipe" question that
 * came up after the call-intelligence sqlite-binding 500 in prod (2026-05-05):
 * the deploy plumbing is real (push → build → rolling deploy → auto-rollback
 * on health check), but nothing in the pipe knows when *application* behaviour
 * is broken (e.g. the call detail page returning 200 but with the AI summary
 * panel silently absent). This card captures the option surfaces and tradeoffs
 * for adding real safety rails.
 *
 * Layout (sibling of step-C-pipeline, both parented to step-C):
 *   step-C-cd                       — CD safety rails over Telegento web app (parent)
 *     step-C-cd-tests               — Option A: PR-gated smoke tests (route 200 checks)
 *     step-C-cd-preview             — Option B: Preview / staging App Runner service
 *     step-C-cd-observability       — Option C: Sentry + synthetic checks on canonical URLs
 *     step-C-cd-migrations          — Option D: Migration safety (becomes load-bearing once
 *                                      call-intelligence ports off ephemeral sqlite)
 *
 * Idempotent: skips any step already present (id-prefix guard).
 *
 * Usage:
 *   pnpm tsx ./scripts/seed-telegento-cd-safety-rails.ts
 */

import { and, eq, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

interface CliOptions {
  workspaceId: string
  planId: string | null
}

function parseArgs(argv: string[]): CliOptions {
  let workspaceId = "global"
  let planId: string | null = null
  for (const arg of argv) {
    if (arg.startsWith("--workspace=")) workspaceId = arg.slice("--workspace=".length)
    else if (arg.startsWith("--plan-id=")) planId = arg.slice("--plan-id=".length)
  }
  return { workspaceId, planId }
}

type SeedStatus = "open" | "in-motion" | "covered" | "skipped"

interface SeedStep {
  id: string
  parentStepId: string | null
  title: string
  description: string
  status: SeedStatus
}

const STEPS: SeedStep[] = [
  {
    id: "step-C-cd",
    parentStepId: "step-C",
    status: "open",
    title: "CD safety rails over Telegento web app",
    description:
      "Context (2026-05-05): Telegento ships via App Runner auto-deploy on push to main. The pipe itself is solid — image build → rolling task replacement → automatic rollback on container health-check failure. What's missing is anything that knows when *application* behaviour regresses while the container itself stays alive.\n\nLive example that prompted this card: the /telegento/calls/[callId] route 500'd in prod for hours because better-sqlite3's native binding was never compiled (Dockerfile installs deps with --ignore-scripts). The container was healthy. App Runner had no reason to roll back. The page just silently returned a JSON error blob to every user who opened a call.\n\nFour candidate safety rails below (A–D), in roughly increasing cost / decreasing per-dollar value. A and C are the cheapest single upgrades. B is the biggest behavior change. D is dormant until call-intelligence ports off ephemeral sqlite onto the real Postgres layer.\n\nNo immediate decision needed — these are option surfaces to pick from, not a prescribed sequence.",
  },
  {
    id: "step-C-cd-tests",
    parentStepId: "step-C-cd",
    status: "open",
    title: "Option A — PR-gated smoke tests (curl the canonical routes after build)",
    description:
      "Cheapest, highest-leverage rail. Add a CI step that builds the Docker image (already done locally as part of demo:up) and runs a small set of curl-based assertions against the running container before the image is allowed to promote to App Runner.\n\nMinimum viable check list:\n  curl -fsS http://localhost:4000/                                  → 200, contains expected hero copy\n  curl -fsS http://localhost:4000/view/new-york-v4/dashboard-01     → 200, contains 'AIDA Workbooks'\n  curl -fsS http://localhost:4000/telegento/calls/<seeded-id>       → 200, contains transcript markup\n  curl -fsS http://localhost:4000/api/telegento/call-intelligence?id=<seeded-id> → 200 with { result } shape\n\nWhat it catches: the exact failure mode we just shipped. Anything that returns 500/4xx on a canonical route. Won't catch visual regressions or silent data-shape drift.\n\nCost: 1–2 hours to wire into GitHub Actions; ~30 sec added to PR CI; near-zero ongoing maintenance.\nTradeoff: needs a seeded test call in the demo bundle so curl has a real id to hit. Easy.\nRisk if skipped: same regression, again, the next time someone touches a route handler.",
  },
  {
    id: "step-C-cd-preview",
    parentStepId: "step-C-cd",
    status: "open",
    title: "Option B — Preview / staging App Runner service in front of prod",
    description:
      "Stand up a second App Runner service (e.g. preview.telegento.com or a separate subdomain) that auto-deploys from main, with prod gated behind a manual promote or a tag push. Gives every PR-merged image a soak window where someone can click around before real users see it.\n\nWhat it catches: the class of bugs that show up on real cloud infra but not in local Docker — missing env vars, missing IAM, missing native bindings (exactly our case), App Runner-specific behavior, custom domain / DNS gotchas.\n\nCost: low one-time AWS setup (clone the existing service config, point at same image registry, separate domain). ~$25/mo per running service if always-on, or pennies if scale-to-zero is acceptable. Adds a 2–10 min soak step to the deploy ritual that's currently 'push and forget'.\nTradeoff: doubles infra surface area to keep configured. Promotion gate needs a clear owner — without one, people just push to prod anyway and the staging environment rots.\nNot necessarily worth it yet at current team size / traffic, but becomes load-bearing once Telegento has real users whose sessions you can break.",
  },
  {
    id: "step-C-cd-observability",
    parentStepId: "step-C-cd",
    status: "open",
    title: "Option C — Sentry + synthetic checks on the canonical URLs",
    description:
      "Two complementary subrails:\n\n  C1. Sentry (or equivalent) on the Next.js server + client. Catches the 500s and unhandled errors after they happen, with stack traces and request context. Already a 30-min hookup on Next.js (next.config integration + DSN env var). ~free tier covers a demo-stage product. This would have surfaced the call-intelligence sqlite error as a discrete alert with the binding-not-found stack the moment the first user hit it, instead of waiting for someone to notice the 500 manually.\n\n  C2. Synthetic uptime checks against canonical routes (Better Uptime, Checkly, UptimeRobot, or a simple Lambda + EventBridge cron). Hit the same URL list as Option A, every minute or five, against the live deployed app. Page someone (or post to Slack) on regression.\n\nWhat it catches: the gap between 'deploy succeeded' and 'feature still works'. Sentry catches errors users hit. Synthetics catch regressions that don't even need a user to reproduce.\n\nCost: <2 hours setup for C1, ~1 hour for C2. ~$0–20/mo depending on tool choice and check frequency.\nTradeoff: alert fatigue if thresholds aren't tuned (false positives during legitimate brief deploys). Solvable with a deploy-window suppression. Otherwise low downside.\nThis is the 'know about regressions before users tell you' rail. Cheap. Probably the next thing to do after Option A.",
  },
  {
    id: "step-C-cd-migrations",
    parentStepId: "step-C-cd",
    status: "open",
    title: "Option D — Migration safety (dormant until call-intelligence ports off sqlite)",
    description:
      "Currently not load-bearing because Telegento's data path is mostly demo bundles + in-memory state. Operator Studio's own data lives in its own Postgres (this DB), not the Telegento app's. So there's no 'app deploy must coordinate with schema migration' problem yet.\n\nBecomes load-bearing the moment call-intelligence (or anything else) ports off ephemeral sqlite onto the real Postgres + Drizzle stack the rest of the app uses. At that point the deploy ritual needs to enforce: forward-only migrations, migration runs *before* the new app image rolls out, and the new image must remain compatible with the old schema for one deploy cycle (so rollback doesn't break against an already-migrated DB).\n\nStandard pattern (expand-then-contract):\n  Deploy N:   migration adds new columns/tables, app code reads BOTH old and new shapes\n  Deploy N+1: app code writes only new shape; migration backfills old → new\n  Deploy N+2: migration drops old columns; app code drops dual-read branch\n\nWhat it catches: deploy/rollback breaks against schema drift, which is the single most common way 'CD just works' becomes 'CD just bricked prod and we can't roll back'.\nCost: zero today. Real cost shows up once we have multiple migrations landing in flight.\nTradeoff: until then, this card is a placeholder so we don't forget the constraint exists. Promote to in-motion the moment the first Postgres-backed call-intelligence migration lands.",
  },
]

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const db = getDb()

  let targetPlanId = opts.planId
  if (!targetPlanId) {
    const rows = await db
      .select({
        id: operatorPlans.id,
        title: operatorPlans.title,
        pinned: operatorPlans.pinned,
        state: operatorPlans.state,
        updatedAt: operatorPlans.updatedAt,
      })
      .from(operatorPlans)
      .where(
        and(
          eq(operatorPlans.workspaceId, opts.workspaceId),
          eq(operatorPlans.state, "active")
        )
      )
    const pinned = rows.filter((r) => r.pinned === 1)
    const candidate =
      pinned.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
      rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    if (!candidate) {
      console.error(
        `No active plan found in workspace "${opts.workspaceId}". Pass --plan-id=<id> to target one explicitly.`
      )
      process.exit(1)
    }
    targetPlanId = candidate.id
    console.log(`Target plan: ${candidate.id} — "${candidate.title}"`)
  }

  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.planId, targetPlanId),
        like(operatorPlanSteps.id, "step-C-cd%")
      )
    )
  const existingIds = new Set(existing.map((r) => r.id))
  const toInsert = STEPS.filter((s) => !existingIds.has(s.id))

  if (toInsert.length === 0) {
    console.log(
      `All ${STEPS.length} CD safety-rails steps already present. Nothing to do.`
    )
    return
  }

  const maxOrderRow = await db
    .select({ max: max(operatorPlanSteps.stepOrder) })
    .from(operatorPlanSteps)
    .where(eq(operatorPlanSteps.planId, targetPlanId))
  const baseOrder = (maxOrderRow[0]?.max ?? -1) + 1

  const now = new Date()
  await db.insert(operatorPlanSteps).values(
    toInsert.map((s, i) => ({
      id: s.id,
      planId: targetPlanId!,
      workspaceId: opts.workspaceId,
      title: s.title,
      description: s.description,
      stepOrder: baseOrder + i,
      status: s.status,
      parentStepId: s.parentStepId,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, targetPlanId))

  console.log(
    `Seeded ${toInsert.length} new CD safety-rails step(s) into plan ${targetPlanId} (orders ${baseOrder}–${baseOrder + toInsert.length - 1}). ${existingIds.size} already present.`
  )
  for (const s of toInsert) console.log(`  ${s.id}  [${s.status}]  ${s.title}`)
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
