import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

/**
 * Pulse merged into the combined Plan + Work surface at
 * /operator-studio/plan. This route lives on as a redirect so old
 * bookmarks / external links still land in the right place. Query
 * params (sessionId, fromSessionId, toSessionId, focus) are preserved
 * so deep links to a specific session or focused thread keep working.
 */
export default async function PulsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") usp.set(k, v)
    else if (Array.isArray(v) && v[0]) usp.set(k, v[0])
  }
  usp.set("tab", "work")
  redirect(`/operator-studio/plan?${usp.toString()}`)
}
