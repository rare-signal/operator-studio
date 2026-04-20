import { cookies } from "next/headers"

/**
 * Minimal auth helper for the bundled dev gate.
 *
 * When you swap in a real auth provider (Auth.js, Clerk, WorkOS, etc), this
 * is the seam: replace the bodies of `isAuthenticated()` and `getDisplayName()`
 * with lookups against your provider's session. The rest of the app only
 * talks to these two functions.
 *
 * - `isAuthenticated()` — is this request allowed to hit protected API routes?
 * - `getDisplayName()` — what name should we attribute this operator's
 *   imports, promotions, and continuation chats to? Return `null` to let
 *   the client-side identity modal prompt for a self-chosen display name.
 *
 * The bundled implementation is a single shared password + a self-attested
 * display name cookie. It is a development convenience, not a security
 * boundary — do not deploy public-facing without swapping it.
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
