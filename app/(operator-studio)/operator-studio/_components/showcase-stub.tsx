/**
 * Stub view used by every operator-studio sub-route that isn't
 * shipped with real data in the static showcase build. The
 * `scripts/showcase-build.ts` orchestrator swaps each excluded
 * page.tsx with a one-liner that renders this component. Keeps
 * sidebar links navigable instead of 404-ing.
 */

import Link from "next/link"
import { ArrowRight, Lock } from "lucide-react"

export function ShowcaseStub({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-20">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Lock className="size-3" />
        Not in this showcase
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-base text-muted-foreground leading-relaxed">
        {description ??
          `In the live Operator Studio this view is fully wired — it reads from
          the workspace database, accepts mutations, and integrates with the
          rest of the AAA loop. The static showcase only ships the “browse
          the chats” surfaces.`}
      </p>
      <div className="rounded-md border bg-card/50 p-4 text-sm leading-relaxed">
        <strong className="font-semibold">Want to see it for real?</strong>{" "}
        Clone the repo and run it locally:
        <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-3 text-xs font-mono">
          {`git clone https://github.com/rare-signal/operator-studio
cd operator-studio
pnpm install
pnpm db:migrate && pnpm db:seed:demo
pnpm dev`}
        </pre>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/operator-studio/memory"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-accent"
        >
          Browse threads <ArrowRight className="size-3.5" />
        </Link>
        <Link
          href="/operator-studio/plan"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-accent"
        >
          See the plan <ArrowRight className="size-3.5" />
        </Link>
        <a
          href="https://github.com/rare-signal/operator-studio"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-accent"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source on GitHub <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  )
}
