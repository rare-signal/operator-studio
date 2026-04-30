import { redirect } from "next/navigation"

import { isShowcase, listShowcaseThreads } from "@/lib/operator-studio/showcase-loader"

// Next.js requires `dynamic` to be a statically-parseable literal. Using
// "force-dynamic" unconditionally is correct for the runtime app; the
// showcase build emits a separate static page, so the env-conditional
// here was never the right knob.
export const dynamic = "force-dynamic"

export default function OperatorStudioIndexPage() {
  if (isShowcase()) {
    const threads = listShowcaseThreads()
    const first = threads[0]
    if (first) redirect(`/operator-studio/threads/${first.id}`)
    redirect("/operator-studio/plan")
  }
  redirect("/operator-studio/plan?tab=work")
}
