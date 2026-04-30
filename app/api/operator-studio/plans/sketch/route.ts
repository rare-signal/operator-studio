import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { sketchPlanFromComposer } from "@/lib/operator-studio/llm/sketch-plan"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  composer: z.string().min(10).max(8000),
  title: z.string().trim().max(200).optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const result = await sketchPlanFromComposer(parsed.data.composer, {
    title: parsed.data.title,
  })

  if (!result) {
    return NextResponse.json(
      {
        error: "echo-mode",
        reason:
          "No LLM endpoint configured. Set WORKBOOK_CLUSTER_ENDPOINTS in .env.local and restart.",
      },
      { status: 422 }
    )
  }

  return NextResponse.json(result)
}
