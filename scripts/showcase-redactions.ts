/**
 * Redaction list applied to the static showcase snapshot.
 *
 * SAFETY: redactions only run on the in-memory copy of the snapshot
 * before it's written to `public/showcase-data/*.json`. The source
 * transcripts under `~/.claude/projects/` are never touched. The
 * Operator Studio database (Postgres / better-sqlite3) is never
 * touched. Editing this file is safe — re-run `pnpm showcase:build`
 * to regenerate the JSON snapshots with the new rules.
 *
 * Pattern + replacement pairs run in order — earlier rules see the
 * raw text, later rules see whatever earlier rules left behind. Order
 * matters when patterns overlap (e.g. full path before bare username).
 *
 * Pattern can be a literal string (replaced once) or a `RegExp` with
 * the `g` flag (replaced everywhere). Without `g`, only the first
 * occurrence per string is touched — usually you want `g`.
 */

export interface Redaction {
  pattern: string | RegExp
  replacement: string
  /** Optional human note shown in `pnpm showcase:audit` reports. */
  note?: string
}

// ── Local overrides ────────────────────────────────────────────────
// `scripts/showcase-redactions.local.ts` is gitignored. When present,
// its exports merge with the defaults below so each operator can
// scrub host-specific tokens (their username, codenames, customer
// names) without that data ever entering the public OSS file.
//
// Expected exports:
//   export const REDACTIONS: Redaction[]                  (optional)
//   export const DROP_THREAD_IF_MATCHES: Array<...>       (optional)
//   export const EARLIEST_THREAD_DATE: string | null      (optional, overrides default)
let _localRedactions: Redaction[] = []
let _localDrop: Array<string | RegExp> = []
let _localEarliestDate: string | null | undefined = undefined
try {
  // @ts-expect-error — file is intentionally optional, tsconfig won't see it.
  const local = await import("./showcase-redactions.local")
  if (Array.isArray(local.REDACTIONS)) _localRedactions = local.REDACTIONS
  if (Array.isArray(local.DROP_THREAD_IF_MATCHES))
    _localDrop = local.DROP_THREAD_IF_MATCHES
  if ("EARLIEST_THREAD_DATE" in local)
    _localEarliestDate = local.EARLIEST_THREAD_DATE
} catch {
  // No local overrides — fine, the defaults below are it.
}

/**
 * Earliest thread `lastActivityAt` to include in the snapshot. ISO
 * string, or `null` to disable. Threads whose last activity falls
 * before this point are excluded entirely — useful when the early
 * exploratory work shouldn't ship publicly.
 *
 * Uses `lastActivityAt` (not `createdAt`) so a thread that was
 * touched on or after the cutoff still ships even if it began
 * earlier.
 */
const _DEFAULT_EARLIEST_THREAD_DATE: string | null = "2026-04-24T00:00:00Z"
export const EARLIEST_THREAD_DATE: string | null =
  _localEarliestDate !== undefined
    ? _localEarliestDate
    : _DEFAULT_EARLIEST_THREAD_DATE

export const REDACTIONS: Redaction[] = [
  // ── Filesystem paths ────────────────────────────────────────────
  // Add your own host-specific home-dir / username tokens here. Put
  // the full home-dir form before the bare username so the
  // "/Users/<name>" path collapses cleanly without leaving a stub.
  //
  // Examples (uncomment + adapt to your username):
  // { pattern: /\/Users\/alice\b/g, replacement: "/Users/dev", note: "Mac home directory" },
  // { pattern: /\balice\b/g, replacement: "dev", note: "Hostname / username token" },

  // ── Email addresses ─────────────────────────────────────────────
  // Catch-all so contacts / signatures / support inboxes never leak.
  // Operator name (e.g. "David Lin-Clark") is NOT scrubbed by default
  // since it's the public-facing author of the showcase. Add your own
  // rule below if you want to anonymise.
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[email]",
    note: "Any email address",
  },

  // ── Common API key / token shapes ───────────────────────────────
  // Each provider gets its own rule so the redacted form keeps its
  // origin obvious — useful when you're auditing what leaked.
  {
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replacement: "sk-ant-[redacted]",
    note: "Anthropic API key",
  },
  {
    pattern: /sk-proj-[A-Za-z0-9_-]{20,}/g,
    replacement: "sk-proj-[redacted]",
    note: "OpenAI project key",
  },
  {
    pattern: /\bsk-[A-Za-z0-9]{40,}\b/g,
    replacement: "sk-[redacted]",
    note: "Generic OpenAI-style secret key",
  },
  {
    pattern: /\bghp_[A-Za-z0-9]{30,}\b/g,
    replacement: "ghp_[redacted]",
    note: "GitHub personal access token",
  },
  {
    pattern: /\bgho_[A-Za-z0-9]{30,}\b/g,
    replacement: "gho_[redacted]",
    note: "GitHub OAuth token",
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,
    replacement: "github_pat_[redacted]",
    note: "GitHub fine-grained PAT",
  },
  {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    replacement: "xoxx-[redacted]",
    note: "Slack token (bot/user/app/refresh)",
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "AKIA[redacted]",
    note: "AWS access key id",
  },
  {
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    replacement: "[redacted-jwt]",
    note: "JWT (3-segment base64url)",
  },

  // ── ASCII connection strings ────────────────────────────────────
  {
    pattern: /\bpostgres(?:ql)?:\/\/[^\s'"]+/g,
    replacement: "postgres://[redacted]",
    note: "Postgres connection string",
  },
  {
    pattern: /\bmongodb(?:\+srv)?:\/\/[^\s'"]+/g,
    replacement: "mongodb://[redacted]",
    note: "MongoDB connection string",
  },

  // ── Add your own below ──────────────────────────────────────────
  // Examples (uncomment and edit):
  // { pattern: "ProjectCodename", replacement: "[project]", note: "Internal codename" },
  // { pattern: /\bACME-\d{4}\b/g, replacement: "[ticket]", note: "Internal ticket ids" },

  // Local overrides (host-specific) merged in below.
  ..._localRedactions,
]

/**
 * Drop the ENTIRE thread (title + every message) if any of these
 * patterns matches anywhere in the thread's text. Stronger than
 * redaction — a thread whose subject *is* the sensitive thing
 * shouldn't leak via context, structure, or message metadata that
 * a string-replace would miss.
 *
 * Pattern can be a string (case-sensitive substring) or a RegExp
 * (use the `i` flag for case-insensitive). Any match → whole thread
 * is excluded from the snapshot, never written to JSON.
 */
export const DROP_THREAD_IF_MATCHES: Array<string | RegExp> = [
  // Add patterns here for any internal codename, project name, or
  // customer name whose mere presence in a thread should exclude the
  // whole thing. Stronger than redaction — useful when the thread's
  // *subject* is the sensitive thing and a string-replace would leave
  // structural traces.
  //
  // Examples (uncomment + adapt):
  // /\bprojectcodename\b/i,
  // /\bacmecorp\b/i,

  // Local overrides (host-specific) merged in below.
  ..._localDrop,
]

/**
 * True when the given concatenated thread text triggers any drop
 * rule. The snapshot script calls this with `title + "\n" + every
 * message body` so a hit anywhere in the thread excludes the whole
 * thing.
 */
export function shouldDropThread(text: string): boolean {
  for (const p of DROP_THREAD_IF_MATCHES) {
    if (typeof p === "string") {
      if (text.includes(p)) return true
    } else if (p.test(text)) {
      return true
    }
  }
  return false
}

/**
 * Apply every redaction to a single string. Idempotent (running
 * twice produces the same output).
 */
export function applyRedactions(value: string): string {
  let out = value
  for (const r of REDACTIONS) {
    if (typeof r.pattern === "string") {
      out = out.split(r.pattern).join(r.replacement)
    } else {
      out = out.replace(r.pattern, r.replacement)
    }
  }
  return out
}

/**
 * Walk an arbitrary JSON-like value and apply redactions to every
 * string leaf. Object keys are NOT redacted (renaming a field can
 * silently break downstream consumers).
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") {
    return applyRedactions(value) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as unknown as T
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v)
    }
    return out as unknown as T
  }
  return value
}
