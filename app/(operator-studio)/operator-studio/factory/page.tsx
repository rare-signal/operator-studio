import type { Metadata } from "next"
import Link from "next/link"

import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { listFactories } from "@/lib/operator-studio/factories"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Software factories" }

export default async function FactoriesPage() {
  const workspaceId = await getActiveWorkspaceId()
  const factories = await listFactories(workspaceId)

  return (
    <div className="mx-auto max-w-4xl px-5 py-6">
      <header className="mb-5">
        <h1 className="text-[18px] font-medium tracking-tight">
          Software factories
        </h1>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Each factory binds plans + agents + KB to an org, a product, a
          set of comms substrates, and an audience. Outbound from any
          factory flows through the outbox + PIN gate.
        </p>
      </header>
      {factories.length === 0 ? (
        <div className="rounded-lg border bg-card px-5 py-8 text-center text-[13px] text-muted-foreground">
          No factories yet. Run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
            pnpm tsx scripts/seed-software-factories.ts
          </code>{" "}
          to seed the initial set.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {factories.map((f) => (
            <li key={f.id}>
              <Link
                href={`/operator-studio/factory/${f.id}`}
                className="block px-4 py-4 hover:bg-muted/40"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className="text-[14px] font-medium">{f.label}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {f.orgName} · {f.productName}
                      {f.productProdUrl && (
                        <>
                          {" · "}
                          <span className="text-muted-foreground">
                            {f.productProdUrl.replace(/^https?:\/\//, "")}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {f.id}
                  </span>
                </div>
                {f.audience.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Audience: {f.audience.map((a) => a.name).join(", ")}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
