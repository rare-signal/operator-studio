import { cookies } from "next/headers"

/**
 * Minimal auth helpers for the bundled dev gate.
 *
 * When you swap in a real auth provider (Auth.js, Clerk, WorkOS, etc), these
 * are the seams: replace the bodies with lookups against your provider's
 * session. The rest of the app only talks to these three functions.
 *
 * - `isAuthenticated()` — is this cookie-bearing request allowed to hit
 *   protected UI-side API routes? Used by the in-app dashboard, chat, etc.
 * - `isApiAuthorized(req)` — is this request allowed to hit machine-facing
 *   endpoints (the `/ingest` pipeline)? Accepts either a valid session
 *   cookie OR a bearer token matching `OPERATOR_STUDIO_INGEST_TOKEN`. This
 *   is the seam for IDE / CLI / automation callers who don't have cookies.
 * - `getDisplayName()` — what name should we attribute an operator's
 *   imports, promotions, and continuation chats to? Returns `null` to let
 *   the client-side identity modal prompt for a self-chosen display name.
 *
 * The bundled implementation is a single shared password + a self-attested
 * display name cookie + an optional static bearer token. It is a development
 * convenience, not a security boundary — do not deploy public-facing without
 * swapping it.
 */
export async function isAuthenticated(): Promise<boolean> {
  const configured = process.env.OPERATOR_STUDIO_PASSWORD?.trim()
  if (!configured) return true

  const jar = await cookies()
  return jar.get("operator_studio_auth")?.value === "ok"
}

export async function getDisplayName(): Promise<string | null> {
  const jar = await cookies()
  const value = jar.get("operator_studio_reviewer")?.value?.trim()
  return value && value.length > 0 ? value : null
}

/**
 * Authorize a machine-facing request.
 *
 * Accepts one of:
 *   1. A valid `operator_studio_auth` session cookie (same gate as the UI).
 *   2. A `Authorization: Bearer <token>` header matching
 *      `OPERATOR_STUDIO_INGEST_TOKEN` (constant-time compared).
 *   3. No auth at all, when BOTH the password gate is off AND no ingest
 *      token is configured — the "open local dev" default.
 */
export async function isApiAuthorized(req: Request): Promise<boolean> {
  const passwordSet = !!process.env.OPERATOR_STUDIO_PASSWORD?.trim()
  const tokenSet = !!process.env.OPERATOR_STUDIO_INGEST_TOKEN?.trim()

  // Fully open: no password, no ingest token. Local dev default.
  if (!passwordSet && !tokenSet) return true

  // Bearer token path.
  if (tokenSet) {
    const header = req.headers.get("authorization") ?? ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    const presented = match?.[1]?.trim()
    const expected = process.env.OPERATOR_STUDIO_INGEST_TOKEN!.trim()
    if (presented && constantTimeEqual(presented, expected)) return true
  }

  // Session cookie path.
  if (passwordSet) {
    const jar = await cookies()
    if (jar.get("operator_studio_auth")?.value === "ok") return true
  }

  return false
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
