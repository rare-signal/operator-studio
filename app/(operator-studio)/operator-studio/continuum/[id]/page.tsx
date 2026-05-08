import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { getContinuumById } from "@/lib/operator-studio/continuum"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

import { ContinuumView } from "./continuum-view"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const continuum = await getContinuumById(workspaceId, id).catch(() => null)
  return {
    title: continuum
      ? `Continuum — ${continuum.digest.source.title}`
      : "Continuum",
  }
}

export default async function ContinuumPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const continuum = await getContinuumById(workspaceId, id)
  if (!continuum) notFound()

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Continuum
        </div>
        <h1 className="text-2xl font-semibold leading-tight">
          {continuum.digest.source.title}
        </h1>
        <div className="mt-2 text-xs text-muted-foreground">
          {continuum.digest.source.sourceApp} ·{" "}
          {continuum.digest.source.turnCount} turn
          {continuum.digest.source.turnCount === 1 ? "" : "s"} · minted{" "}
          {new Date(continuum.createdAt).toLocaleString()}
        </div>
      </div>

      <ContinuumView continuum={continuum} />

      <div className="mt-8 border-t pt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <Link
          href={continuum.digest.breakGlassUrl}
          className="hover:text-foreground"
        >
          Open source thread →
        </Link>
        <span>·</span>
        <span>
          break-glass when the digest above isn&apos;t enough.
        </span>
      </div>
    </div>
  )
}
