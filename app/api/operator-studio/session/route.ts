import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { z } from "zod"

export const dynamic = "force-dynamic"

const sessionPostSchema = z
  .object({
    password: z.string().max(256).optional(),
    reviewerName: z.string().trim().min(1).max(128).optional(),
  })
  .refine((v) => v.password !== undefined || v.reviewerName !== undefined, {
    message: "Provide password or reviewerName",
  })

// Auth model (intentionally minimal — see README "Auth" section).
//
// If OPERATOR_STUDIO_PASSWORD is unset or empty, the password gate is OFF and
// every visitor is treated as authenticated. They still pick a display name
// via the identity modal. This is the default for local dev and demos.
//
// If OPERATOR_STUDIO_PASSWORD is set to a non-empty string, visitors must
// submit that value via POST { password } before the app considers them
// authenticated. This is a development convenience, NOT a security boundary.
// For production, swap this route for Auth.js, Clerk, or your SSO of choice.

function getConfiguredPassword(): string | null {
  const value = process.env.OPERATOR_STUDIO_PASSWORD?.trim()
  return value && value.length > 0 ? value : null
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null)
  const parsed = sessionPostSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data

  const configuredPassword = getConfiguredPassword()

  if (body.password !== undefined) {
    if (!configuredPassword) {
      const jar = await cookies()
      jar.set("operator_studio_auth", "ok", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      })
      return NextResponse.json({ ok: true, gateDisabled: true })
    }

    if (body.password === configuredPassword) {
      const jar = await cookies()
      jar.set("operator_studio_auth", "ok", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json(
      { ok: false, error: "Invalid password" },
      { status: 401 }
    )
  }

  if (body.reviewerName) {
    const jar = await cookies()
    jar.set("operator_studio_reviewer", body.reviewerName, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    })
    return NextResponse.json({ ok: true, reviewer: body.reviewerName })
  }

  return NextResponse.json(
    { ok: false, error: "Provide password or reviewerName" },
    { status: 400 }
  )
}

export async function GET() {
  const jar = await cookies()
  const reviewer = jar.get("operator_studio_reviewer")?.value
  const configuredPassword = getConfiguredPassword()

  if (!configuredPassword) {
    return NextResponse.json({
      authenticated: true,
      gateEnabled: false,
      reviewer: reviewer || null,
    })
  }

  const auth = jar.get("operator_studio_auth")?.value
  return NextResponse.json({
    authenticated: auth === "ok",
    gateEnabled: true,
    reviewer: reviewer || null,
  })
}
