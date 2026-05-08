/**
 * 2026-05-04 night — capture the three build-speedup wins identified during
 * tonight's iterative App Runner deploys. Each one targets the Mac-host
 * docker build (apps/v4/Dockerfile, ~18 min/iteration) which is the
 * pacing bottleneck for tightening the deploy loop.
 *
 *   - step-C-pipeline-E-build-native-amd64
 *   - step-C-pipeline-E-build-cache-mounts
 *   - step-C-pipeline-E-build-trim-demo-routes
 *
 * Idempotent.
 */

import { and, eq, like, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"

type SeedStatus = "open" | "in-motion" | "covered" | "skipped"

interface SeedStep {
  id: string
  parentStepId: string
  title: string
  description: string
  status: SeedStatus
}

const NEW_STEPS: SeedStep[] = [
  {
    id: "step-C-pipeline-E-build-native-amd64",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Build images on native linux/amd64 (kill the QEMU tax) — biggest win, ~4×",
    description: [
      "TODAY: docker build runs on M-series Mac with --platform linux/amd64,",
      "which means QEMU translates every instruction. Builds take ~18 min",
      "for the apps/v4 Next.js prod build. Native amd64 hosts do the same",
      "build in ~4 min.",
      "",
      "Cheapest wins:",
      "  - GitHub Actions ubuntu-latest (free tier on private repos = 2000",
      "    min/month). Workflow: push to a 'deploy/*' branch → docker build",
      "    + push to ECR + aws apprunner start-deployment. Auth via OIDC,",
      "    no long-lived AWS keys.",
      "  - AWS CodeBuild (Linux amd64 small instance, ~$0.005/build minute,",
      "    so a 4-min build is ~$0.02). Triggered from CodePipeline on tag",
      "    push or via aws codebuild start-build.",
      "",
      "Either approach also unblocks Justin Searcy / partner-side iteration",
      "later — they don't need a Mac to ship to Telegento.",
      "",
      "Estimate: 1-2 hours to wire either CI surface up and verify the first",
      "successful deploy from it. Once running, manual local builds become",
      "the exception, not the norm.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-E-build-cache-mounts",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "BuildKit cache mounts on pnpm install + next build — ~3× on warm rebuilds",
    description: [
      "TODAY: every docker build does a fresh pnpm install + fresh next",
      "build, even when only one TS file changed. The 1.5GB node_modules",
      "and Next.js .next cache get rebuilt from scratch.",
      "",
      "BuildKit cache mounts:",
      "  RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile=false",
      "  RUN --mount=type=cache,target=/workspace/apps/v4/.next/cache pnpm --filter=v4 build",
      "",
      "First build after a cache miss = same speed as today. Subsequent",
      "builds (where lockfile + most source unchanged) drop to ~5-7 min on",
      "the same Mac, and ~2 min on native amd64.",
      "",
      "Combine with native amd64 (sibling card) and a 1-line code change",
      "ships in ~3 min end-to-end, not 23.",
      "",
      "Estimate: 30-60 min — Dockerfile edits + verify cache hit on second",
      "build. Caveat: cache mounts persist on the build host (Docker daemon",
      "or BuildKit cache). Need a CI runner that preserves cache between",
      "runs (GitHub Actions: actions/cache + buildx; CodeBuild: enable",
      "local Docker layer caching).",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-E-build-trim-demo-routes",
    parentStepId: "step-C-pipeline-E",
    status: "open",
    title: "Trim 41 telegento-homepage-demo-* routes from prod build — ~30% compile time",
    description: [
      "TODAY: apps/v4 ships 41 'telegento-homepage-demo-NN' routes plus",
      "telegento-homepage-17, telegento-rocketer-briefing, telegento-logo-",
      "lockups, etc. These are landing-page exploration sketches kept in",
      "the repo for design iteration; they don't need to be in the",
      "production bundle.",
      "",
      "Most direct fix: env-gate them in next.config.mjs. Conditionally",
      "exclude under (app)/* by setting `pageExtensions` or a custom",
      "rewrites rule when NEXT_PROD_BUILD=1, so they don't enter the route",
      "tree during App Runner's image build. Keeps them available in dev",
      "and on dev:container.",
      "",
      "Alternative: physically move them to apps/v4/registry/landing-",
      "experiments/* (already a registry pattern in the repo) so they're",
      "no longer Next.js routes at all.",
      "",
      "Speedup: build log shows the route-tree printout took meaningful",
      "wall time, and Next.js's static-generation phase scales with route",
      "count. Estimate ~30% off compile time. Stacking effect with cache",
      "mounts is multiplicative.",
      "",
      "Estimate: 1-2 hours including the rename / route-table audit.",
      "Lowest priority of the three speedups; other two cover most of the",
      "pain.",
    ].join("\n"),
  },
]

async function main() {
  const db = getDb()

  const planRows = await db
    .select({ id: operatorPlans.id, updatedAt: operatorPlans.updatedAt, pinned: operatorPlans.pinned })
    .from(operatorPlans)
    .where(and(eq(operatorPlans.workspaceId, WORKSPACE_ID), eq(operatorPlans.state, "active")))
  const targetPlan =
    planRows.filter((r) => r.pinned === 1).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
    planRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  if (!targetPlan) throw new Error("No active plan")
  const planId = targetPlan.id
  console.log(`Target plan: ${planId}`)

  const now = new Date()

  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(like(operatorPlanSteps.id, "step-C-pipeline-%"))
  const existingIds = new Set(existing.map((r) => r.id))

  let nextOrder =
    ((
      await db
        .select({ max: max(operatorPlanSteps.stepOrder) })
        .from(operatorPlanSteps)
        .where(eq(operatorPlanSteps.planId, planId))
    )[0]?.max ?? -1) + 1

  for (const s of NEW_STEPS) {
    if (existingIds.has(s.id)) {
      await db
        .update(operatorPlanSteps)
        .set({
          title: s.title,
          description: s.description,
          status: s.status,
          parentStepId: s.parentStepId,
          updatedAt: now,
        })
        .where(eq(operatorPlanSteps.id, s.id))
      console.log(`Refreshed ${s.id}`)
    } else {
      await db.insert(operatorPlanSteps).values({
        id: s.id,
        planId,
        workspaceId: WORKSPACE_ID,
        title: s.title,
        description: s.description,
        stepOrder: nextOrder++,
        status: s.status,
        parentStepId: s.parentStepId,
        createdAt: now,
        updatedAt: now,
      })
      console.log(`Inserted ${s.id} [${s.status}]`)
    }
  }
  await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, planId))
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
