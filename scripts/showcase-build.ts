/**
 * Showcase build orchestrator.
 *
 * Runs the snapshot script, disables every route-entry file
 * (page.tsx / route.ts) outside the curated showcase route set,
 * runs `next build` with SHOWCASE=1 → produces a static `out/` dir,
 * and restores everything afterwards.
 *
 * Disable strategy: rename `page.tsx` → `page.tsx.showcase-disabled`
 * (and same for `route.ts`). Next.js only routes off exact filenames,
 * so the renamed files become invisible to the router but remain on
 * disk (and can be restored by reversing the rename).
 *
 * Pre/post are wrapped in try/finally — a failed build never leaves
 * the working tree in a renamed state.
 */

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const APP = path.join(ROOT, "app")

const DISABLE_SUFFIX = ".showcase-disabled"
const ORIG_BACKUP_SUFFIX = ".showcase-orig-backup"

// Routes that SHIP in the showcase with their real implementation.
// Anything else with a page.tsx / route.ts gets either disabled
// (the file is renamed away so Next can't see it) or stubbed (its
// contents are replaced with a `<ShowcaseStub />` page for the
// duration of the build, so sidebar links don't 404).
// Paths are relative to `app/`.
const SHIPPING_ROUTES = new Set<string>([
  "page.tsx", // root index → redirect to /operator-studio
  "(operator-studio)/operator-studio/page.tsx",
  "(operator-studio)/operator-studio/memory/page.tsx",
  "(operator-studio)/operator-studio/threads/[threadId]/page.tsx",
  "(operator-studio)/operator-studio/plan/page.tsx",
  "(operator-studio)/operator-studio/sessions/page.tsx",
])

// Operator-studio sub-pages that we keep navigable in the showcase
// by replacing their page.tsx contents with a stub. Sidebar links
// still resolve to a friendly "not in showcase" view instead of 404.
const STUB_ROUTES: Array<{ rel: string; title: string }> = [
  {
    rel: "(operator-studio)/operator-studio/activity/page.tsx",
    title: "Activity Log",
  },
  {
    rel: "(operator-studio)/operator-studio/metrics/page.tsx",
    title: "Metrics",
  },
  {
    rel: "(operator-studio)/operator-studio/admin/page.tsx",
    title: "Admin",
  },
  {
    rel: "(operator-studio)/operator-studio/docs/page.tsx",
    title: "Help",
  },
  {
    rel: "(operator-studio)/operator-studio/inbox/page.tsx",
    title: "Inbox",
  },
  {
    rel: "(operator-studio)/operator-studio/today/page.tsx",
    title: "Today",
  },
  {
    rel: "(operator-studio)/operator-studio/foundry/page.tsx",
    title: "Foundry",
  },
  {
    rel: "(operator-studio)/operator-studio/search/page.tsx",
    title: "Search",
  },
  {
    rel: "(operator-studio)/operator-studio/plans/page.tsx",
    title: "Plans",
  },
  {
    rel: "(operator-studio)/operator-studio/pulse/page.tsx",
    title: "Pulse",
  },
]

function stubPageContent(title: string): string {
  return `import { ShowcaseStub } from "@/app/(operator-studio)/operator-studio/_components/showcase-stub"

export const dynamic = "force-static"

export default function Page() {
  return <ShowcaseStub title="${title}" />
}
`
}

// `force-dynamic` conflicts with `output: "export"`. The shipping
// route files declare `dynamic = "force-dynamic"` for the live build;
// we substitute it to `"force-static"` here, then restore the file
// from the saved backup afterwards.
const DYNAMIC_PATCH_FROM = `export const dynamic = "force-dynamic"`
const DYNAMIC_PATCH_TO = `export const dynamic = "force-static"`

function log(msg: string): void {
  console.log(`[showcase-build] ${msg}`)
}

function listRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listRouteFiles(full, out)
    } else if (
      entry.isFile() &&
      (entry.name === "page.tsx" ||
        entry.name === "page.ts" ||
        entry.name === "route.ts" ||
        entry.name === "route.tsx")
    ) {
      out.push(full)
    }
  }
  return out
}

function disableRoutes(): string[] {
  const all = listRouteFiles(APP)
  const stubRels = new Set(STUB_ROUTES.map((r) => r.rel))
  const disabled: string[] = []
  for (const full of all) {
    const rel = path.relative(APP, full)
    if (SHIPPING_ROUTES.has(rel)) continue
    // Stub routes are handled by `stubRoutes()` below — leave them
    // alone here so they aren't double-disabled.
    if (stubRels.has(rel)) continue
    fs.renameSync(full, full + DISABLE_SUFFIX)
    disabled.push(full)
  }
  log(
    `disabled ${disabled.length} route files (kept ${SHIPPING_ROUTES.size}, stubbed ${stubRels.size})`
  )
  return disabled
}

function stubRoutes(): string[] {
  const stubbed: string[] = []
  for (const { rel, title } of STUB_ROUTES) {
    const full = path.join(APP, rel)
    if (!fs.existsSync(full)) continue
    fs.copyFileSync(full, full + ORIG_BACKUP_SUFFIX)
    fs.writeFileSync(full, stubPageContent(title))
    stubbed.push(full)
  }
  log(`stubbed ${stubbed.length} sidebar-link routes`)
  return stubbed
}

function restoreStubs(stubbed: string[]): void {
  for (const full of stubbed) {
    const backup = full + ORIG_BACKUP_SUFFIX
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, full)
      fs.unlinkSync(backup)
    }
  }
  log(`restored ${stubbed.length} stubbed routes`)
}

function restoreRoutes(disabled: string[]): void {
  for (const full of disabled) {
    const stashed = full + DISABLE_SUFFIX
    if (fs.existsSync(stashed)) {
      fs.renameSync(stashed, full)
    }
  }
  log(`restored ${disabled.length} route files`)
}

function patchDynamic(): string[] {
  const patched: string[] = []
  for (const rel of SHIPPING_ROUTES) {
    const full = path.join(APP, rel)
    if (!fs.existsSync(full)) continue
    const orig = fs.readFileSync(full, "utf-8")
    if (!orig.includes(DYNAMIC_PATCH_FROM)) continue
    fs.writeFileSync(full + ORIG_BACKUP_SUFFIX, orig)
    fs.writeFileSync(full, orig.replace(DYNAMIC_PATCH_FROM, DYNAMIC_PATCH_TO))
    patched.push(full)
  }
  log(`patched dynamic export in ${patched.length} files`)
  return patched
}

function restoreDynamic(patched: string[]): void {
  for (const full of patched) {
    const backup = full + ORIG_BACKUP_SUFFIX
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, full)
      fs.unlinkSync(backup)
    }
  }
  log(`restored dynamic export in ${patched.length} files`)
}

function runSnapshot(): void {
  log("snapshotting transcripts → public/showcase-data/")
  const r = spawnSync("pnpm", ["tsx", "scripts/showcase-snapshot.ts"], {
    stdio: "inherit",
    cwd: ROOT,
  })
  if (r.status !== 0) throw new Error("snapshot failed")
}

function runBuild(): void {
  log("running `next build` with SHOWCASE=1 NEXT_PUBLIC_SHOWCASE=1")
  const r = spawnSync("pnpm", ["next", "build"], {
    stdio: "inherit",
    cwd: ROOT,
    env: {
      ...process.env,
      SHOWCASE: "1",
      NEXT_PUBLIC_SHOWCASE: "1",
      NEXT_DIST_DIR: ".next-showcase",
    },
  })
  if (r.status !== 0) throw new Error(`next build exited ${r.status}`)
}

function moveExportToOut(): void {
  const distDir = path.join(ROOT, ".next-showcase")
  const outDir = path.join(ROOT, "out")
  if (!fs.existsSync(distDir)) {
    log(`! expected export at ${distDir} but it doesn't exist`)
    return
  }
  // Wipe stale `out/` from a previous run.
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true })
  // Copy HTML/JS/static assets from the export dir to `out/`.
  // Skip Next.js internal artifacts (cache, server, BUILD_ID etc.) —
  // we only want browser-shippable files.
  fs.mkdirSync(outDir, { recursive: true })
  copyShippable(distDir, outDir)
  log(`assembled out/ from .next-showcase/`)
}

function copyShippable(src: string, dst: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Internal Next.js artifacts to skip — none of these belong in a
    // static-export deploy directory.
    if (
      entry.name === "cache" ||
      entry.name === "server" ||
      entry.name === "trace" ||
      entry.name === "BUILD_ID" ||
      entry.name === "build-manifest.json" ||
      entry.name === "app-build-manifest.json" ||
      entry.name === "app-path-routes-manifest.json" ||
      entry.name === "export-detail.json" ||
      entry.name === "export-marker.json" ||
      entry.name === "images-manifest.json" ||
      entry.name === "next-minimal-server.js.nft.json" ||
      entry.name === "next-server.js.nft.json" ||
      entry.name === "package.json" ||
      entry.name === "prerender-manifest.json" ||
      entry.name === "react-loadable-manifest.json" ||
      entry.name === "required-server-files.json" ||
      entry.name === "routes-manifest.json"
    ) {
      continue
    }
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      copyShippable(from, to)
    } else {
      fs.copyFileSync(from, to)
    }
  }
}

function main(): void {
  runSnapshot()
  const disabled = disableRoutes()
  const stubbed = stubRoutes()
  const patched = patchDynamic()
  let buildError: unknown = null
  try {
    runBuild()
  } catch (err) {
    buildError = err
  } finally {
    restoreDynamic(patched)
    restoreStubs(stubbed)
    restoreRoutes(disabled)
  }
  if (buildError) {
    log(`build failed: ${(buildError as Error).message}`)
    process.exit(1)
  }
  moveExportToOut()
  log(`✓ static export ready → ${path.join(ROOT, "out")}`)
  log(
    "Deploy: drop the `out/` directory on Vercel / Netlify / Cloudflare Pages / S3 / anywhere."
  )
}

main()
