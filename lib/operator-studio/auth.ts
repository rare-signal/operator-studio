import "server-only"

import { createHash } from "crypto"
import { cookies } from "next/headers"
import { and, eq, isNull, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { apiTokens } from "@/lib/server/db/schema"

/**
 * Auth seams.
 *
 * - `isAuthenticated()` — is this cookie-bearing request allowed to hit
 *   the in-app UI? Used by page loaders / SSR.
 * - `authorizeRequest(req)` — is this request allowed to hit a machine-
 *   facing API route? Returns a discriminated result carrying the
 *   resolved identity so the route can attribute imports / promotions /
 *   chats to the right person regardless of what the client claims.
 * - `isAdmin(auth)` — is the resolved identity allowed to hit the admin
 *   surface (token + webhook management)? The bundled implementation
 *   trusts every authenticated caller — swap this for a real RBAC check
 *   when deploying multi-user. See the README "Auth" section.
 * - `getDisplayName()` — cookie-stored self-attested name, for UI
 *   attribution when no bearer token is present.
 *
 * When you swap in a real auth provider, replace the bodies of these
 * four. The rest of the app only talks to them.
 */

// ─── Cookie-based UI auth (unchanged) ───────────────────────────────────────

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

// ─── Machine-facing auth ────────────────────────────────────────────────────

export type AuthResult =
  | { ok: false; reason: string }
  | {
      ok: true
      method: "open" | "cookie" | "bearer" | "legacy-token"
      // Identity to attribute actions to. For bearer tokens, this is the
      // token's `display_name`. For cookies, it's the cookie name. Null
      // means "no strong identity; attribute to whatever the caller claims
      // or fall back to 'operator'."
      identity: string | null
      tokenId: string | null
    }

/**
 * Resolve a request's auth. Accepts:
 *
 *   1. `Authorization: Bearer <token>` where `<token>` either matches a row
 *      in `api_tokens` (revoked_at IS NULL) OR matches the legacy
 *      `OPERATOR_STUDIO_INGEST_TOKEN` shared secret. Per-user tokens win
 *      over the legacy token.
 *   2. A valid `operator_studio_auth` session cookie (same as the UI gate).
 *   3. Fully open — neither password gate nor ingest token configured.
 */
export async function authorizeRequest(req: Request): Promise<AuthResult> {
  const passwordSet = !!process.env.OPERATOR_STUDIO_PASSWORD?.trim()
  const legacyTokenSet = !!process.env.OPERATOR_STUDIO_INGEST_TOKEN?.trim()

  // 1. Bearer path.
  const header = req.headers.get("authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  const presented = match?.[1]?.trim()

  if (presented) {
    // DB-backed per-user token?
    const hash = sha256(presented)
    const db = getDb()
    const rows = await db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
      .limit(1)
    if (rows.length > 0) {
      const row = rows[0]
      // Best-effort lastUsedAt touch + usage counter bump; swallow failures
      // so auth still works if the write is contended.
      await db
        .update(apiTokens)
        .set({
          lastUsedAt: new Date(),
          useCount: sql`${apiTokens.useCount} + 1`,
        })
        .where(eq(apiTokens.id, row.id))
        .catch(() => undefined)
      return {
        ok: true,
        method: "bearer",
        identity: row.displayName,
        tokenId: row.id,
      }
    }

    // Legacy shared secret?
    if (legacyTokenSet) {
      const expected = process.env.OPERATOR_STUDIO_INGEST_TOKEN!.trim()
      if (constantTimeEqual(presented, expected)) {
        return {
          ok: true,
          method: "legacy-token",
          identity: null,
          tokenId: null,
        }
      }
    }

    return { ok: false, reason: "Invalid bearer token" }
  }

  // 2. Cookie path.
  if (passwordSet) {
    const jar = await cookies()
    if (jar.get("operator_studio_auth")?.value === "ok") {
      const reviewer = jar.get("operator_studio_reviewer")?.value?.trim()
      return {
        ok: true,
        method: "cookie",
        identity: reviewer && reviewer.length > 0 ? reviewer : null,
        tokenId: null,
      }
    }
    return { ok: false, reason: "Not signed in" }
  }

  // 3. Open mode — password gate off, no bearer presented.
  // If an ingest token is configured but not passed, reject.
  if (legacyTokenSet) {
    return { ok: false, reason: "Bearer token required" }
  }

  // Truly open: local dev with neither gate set.
  const jar = await cookies()
  const reviewer = jar.get("operator_studio_reviewer")?.value?.trim()
  return {
    ok: true,
    method: "open",
    identity: reviewer && reviewer.length > 0 ? reviewer : null,
    tokenId: null,
  }
}

/** Back-compat boolean form. Prefer `authorizeRequest` for new code. */
export async function isApiAuthorized(req: Request): Promise<boolean> {
  const r = await authorizeRequest(req)
  return r.ok
}

/**
 * Is this caller allowed to hit the admin surface (mint/revoke API tokens,
 * manage webhook subscriptions)?
 *
 * The bundled implementation trusts every authenticated caller — intentional
 * for a self-hosted small-team posture. For multi-user deployments, swap
 * this to check a real role claim. Two common shapes:
 *
 *   // Hardcoded display-name allowlist (quick and dirty)
 *   const admins = (process.env.OPERATOR_STUDIO_ADMINS ?? "")
 *     .split(",").map(s => s.trim()).filter(Boolean)
 *   return auth.identity != null && admins.includes(auth.identity)
 *
 *   // SSO-backed (swap after wiring your provider in authorizeRequest)
 *   return auth.ok && auth.role === "admin"
 */
export async function isAdmin(auth: AuthResult): Promise<boolean> {
  if (!auth.ok) return false

  // Optional env allowlist of display names. Unset = everyone passes.
  const raw = process.env.OPERATOR_STUDIO_ADMINS?.trim()
  if (!raw) return true

  const admins = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (admins.length === 0) return true
  return auth.identity != null && admins.includes(auth.identity)
}

/**
 * Cookie-only variant of `isAdmin` for server components (page loaders),
 * where we don't have a `Request` handy for bearer inspection. Resolves
 * identity from the `operator_studio_reviewer` cookie and applies the
 * same admin allowlist logic.
 */
export async function isAdminFromCookie(): Promise<boolean> {
  if (!(await isAuthenticated())) return false

  const raw = process.env.OPERATOR_STUDIO_ADMINS?.trim()
  if (!raw) return true

  const admins = raw.split(",").map((s) => s.trim()).filter(Boolean)
  if (admins.length === 0) return true

  const identity = await getDisplayName()
  return identity != null && admins.includes(identity)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
