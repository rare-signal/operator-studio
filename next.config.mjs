const SHOWCASE = process.env.SHOWCASE === "1"

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output directory is configurable via NEXT_DIST_DIR so a parallel
  // prod server can build/serve from .next-prod while `pnpm dev` keeps
  // using the default .next. See package.json `build:prod`/`start:prod`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg"],
  typescript: {
    // Showcase build disables routes by renaming files; the leftover
    // type validator in `.next-prod/` then references nonexistent
    // modules. Skip the typecheck for showcase exports — we still
    // type-check the live build via `pnpm typecheck`.
    ignoreBuildErrors: SHOWCASE,
  },
  // SHOWCASE=1 → fully static export to `out/`. No Node runtime, no API
  // routes, no DB — every page pre-rendered to HTML. The `next.config`
  // is the only place that flips into export mode; everything else
  // (page-level `dynamic`, `generateStaticParams`, client `fetch`)
  // reads `process.env.SHOWCASE` directly.
  ...(SHOWCASE
    ? {
        output: "export",
        // Static export can't run the image optimizer.
        images: { unoptimized: true },
        // Trailing slashes simplify hosting on plain object stores
        // (Vercel handles either, but anywhere-deployable is the goal).
        trailingSlash: true,
      }
    : {
        images: {
          unoptimized: process.env.NODE_ENV !== "production",
        },
      }),
  experimental: {
    optimizePackageImports: ["lucide-react", "radix-ui"],
  },
}

export default nextConfig
