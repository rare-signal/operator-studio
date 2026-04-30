import "server-only"

/**
 * In-memory sliding-window rate limiter for machine-facing routes.
 *
 * Keyed by token id (when bearer-authed) or client IP. The window is a rolling
 * 60 seconds. Limit is configurable via `OPERATOR_STUDIO_INGEST_RATE_LIMIT`
 * env var, default 60 requests/minute.
 *
 * Scope note: this is process-local. A multi-replica deployment should wrap
 * an external store (Redis, Postgres advisory locks, etc). For self-hosted
 * single-replica deployments, this is a meaningful DoS shield without a
 * Redis dependency.
 */

const WINDOW_MS = 60_000

function getLimit(): number {
  const raw = Number(process.env.OPERATOR_STUDIO_INGEST_RATE_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60
}

type Entry = { hits: number[] }
const buckets = new Map<string, Entry>()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetInMs: number
  limit: number
}

export function checkRateLimit(key: string): RateLimitResult {
  const limit = getLimit()
  const now = Date.now()
  const cutoff = now - WINDOW_MS

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { hits: [] }
    buckets.set(key, bucket)
  }

  // Drop expired hits.
  bucket.hits = bucket.hits.filter((t) => t > cutoff)

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0] ?? now
    return {
      ok: false,
      remaining: 0,
      resetInMs: Math.max(0, oldest + WINDOW_MS - now),
      limit,
    }
  }

  bucket.hits.push(now)

  return {
    ok: true,
    remaining: Math.max(0, limit - bucket.hits.length),
    resetInMs: WINDOW_MS,
    limit,
  }
}

/**
 * Resolve the rate-limit key for a request.
 *
 *   - If `tokenId` is provided (from authorizeRequest when method === "bearer"),
 *     key on it — that's the strongest identity we have.
 *   - Else fall back to the client IP via `x-forwarded-for` / `x-real-ip`.
 *   - Else a coarse bucket `unauthenticated:anonymous` so a misconfigured
 *     proxy doesn't defeat the limiter entirely.
 */
export function resolveRateLimitKey(
  req: Request,
  tokenId: string | null
): string {
  if (tokenId) return `token:${tokenId}`
  const forwardedFor = req.headers.get("x-forwarded-for")
  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip")
  if (ip) return `ip:${ip}`
  return "unauthenticated:anonymous"
}

/**
 * Bulk-reset for tests.
 */
export function __resetRateLimiter() {
  buckets.clear()
}
