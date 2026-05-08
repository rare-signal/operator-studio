/**
 * Beta phone-surface device-token CLI.
 *
 * Mints, lists, and revokes per-device bearer tokens for /api/beta/*.
 * Plaintext tokens are printed exactly once at mint and never stored —
 * only sha256(token) is persisted (see app/api/beta/_device-tokens.ts).
 *
 * Usage:
 *   pnpm beta:devices list
 *   pnpm beta:devices add --label="david's iphone"
 *   pnpm beta:devices add --label="laptop test" --ttl-days=30
 *   pnpm beta:devices revoke --id=bdt-...
 *   pnpm beta:devices log [--device=bdt-... | --limit=50]
 *
 * Flags:
 *   --label=STRING       device label (required for add)
 *   --note=STRING        optional free-text note
 *   --ttl-days=N         token expires after N days (default: no expiry)
 *   --id=STRING          device id (required for revoke)
 *   --device=STRING      filter log to one device id
 *   --limit=N            log/list cap (default 50)
 *   --json               raw JSON output
 */

import { randomBytes } from "node:crypto"

import { and, desc, eq } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import {
  betaAuthLog,
  betaDeviceTokens,
} from "../lib/server/db/schema"
import {
  hashOf,
  mintTokenPlaintext,
} from "../app/api/beta/_device-tokens"

type Cmd = "list" | "add" | "revoke" | "log"

interface CliOptions {
  cmd: Cmd
  label: string | null
  note: string | null
  ttlDays: number | null
  id: string | null
  device: string | null
  limit: number
  json: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const cmd = argv[0] as Cmd | undefined
  if (!cmd || !["list", "add", "revoke", "log"].includes(cmd)) {
    printUsageAndExit("first argument must be one of: list, add, revoke, log")
  }
  const opts: CliOptions = {
    cmd: cmd as Cmd,
    label: null,
    note: null,
    ttlDays: null,
    id: null,
    device: null,
    limit: 50,
    json: false,
  }
  for (const arg of argv.slice(1)) {
    if (arg === "--json") opts.json = true
    else if (arg.startsWith("--label=")) opts.label = arg.slice(8)
    else if (arg.startsWith("--note=")) opts.note = arg.slice(7)
    else if (arg.startsWith("--ttl-days=")) {
      const n = Number(arg.slice(11))
      if (!Number.isFinite(n) || n <= 0)
        printUsageAndExit("--ttl-days must be a positive number")
      opts.ttlDays = n
    } else if (arg.startsWith("--id=")) opts.id = arg.slice(5)
    else if (arg.startsWith("--device=")) opts.device = arg.slice(9)
    else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice(8))
      if (!Number.isFinite(n) || n <= 0)
        printUsageAndExit("--limit must be a positive number")
      opts.limit = Math.min(500, n)
    } else printUsageAndExit(`unknown flag: ${arg}`)
  }
  return opts
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`error: ${message}\n`)
  console.error(
    [
      "usage: pnpm beta:devices <command> [flags]",
      "",
      "commands:",
      "  list                              show all devices + status",
      "  add --label=NAME [--ttl-days=N]   mint a fresh token (printed once)",
      "  revoke --id=ID                    revoke a device token",
      "  log [--device=ID] [--limit=N]     recent auth attempts",
    ].join("\n")
  )
  process.exit(message ? 1 : 0)
}

function fmtTs(d: Date | null): string {
  if (!d) return "—"
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z"
}

function fmtAge(d: Date | null): string {
  if (!d) return ""
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

function statusOf(row: typeof betaDeviceTokens.$inferSelect): string {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired"
  return "active"
}

async function cmdList(opts: CliOptions) {
  const db = getDb()
  const rows = await db
    .select()
    .from(betaDeviceTokens)
    .orderBy(desc(betaDeviceTokens.createdAt))
    .limit(opts.limit)
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  if (rows.length === 0) {
    console.log("no device tokens. mint one: pnpm beta:devices add --label=NAME")
    return
  }
  console.log(`beta devices · ${rows.length}`)
  for (const r of rows) {
    const status = statusOf(r)
    const lastUsed = r.lastUsedAt
      ? `last-used ${fmtAge(r.lastUsedAt)} ago`
      : "never used"
    const expires = r.expiresAt ? `· expires ${fmtTs(r.expiresAt)}` : ""
    console.log(`  ${r.id}  [${status}]  ${r.deviceLabel}`)
    console.log(`    created ${fmtTs(r.createdAt)} · ${lastUsed} ${expires}`)
    if (r.note) console.log(`    note: ${r.note}`)
  }
}

async function cmdAdd(opts: CliOptions) {
  if (!opts.label) printUsageAndExit("--label is required for add")
  const db = getDb()
  const now = new Date()
  const plaintext = mintTokenPlaintext()
  const id = `bdt-${now.getTime()}-${randomBytes(4).toString("hex")}`
  const expiresAt = opts.ttlDays
    ? new Date(now.getTime() + opts.ttlDays * 86_400_000)
    : null
  await db.insert(betaDeviceTokens).values({
    id,
    tokenHash: hashOf(plaintext),
    deviceLabel: opts.label!,
    note: opts.note,
    createdAt: now,
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
  })
  if (opts.json) {
    console.log(
      JSON.stringify({ id, label: opts.label, token: plaintext, expiresAt }, null, 2)
    )
    return
  }
  console.log(`minted device token · ${id}`)
  console.log(`  label:    ${opts.label}`)
  console.log(`  expires:  ${expiresAt ? fmtTs(expiresAt) : "never"}`)
  console.log("")
  console.log("  paste this on the phone (shown ONCE — not recoverable):")
  console.log("")
  console.log(`    ${plaintext}`)
  console.log("")
}

async function cmdRevoke(opts: CliOptions) {
  if (!opts.id) printUsageAndExit("--id is required for revoke")
  const db = getDb()
  const now = new Date()
  const result = await db
    .update(betaDeviceTokens)
    .set({ revokedAt: now })
    .where(eq(betaDeviceTokens.id, opts.id!))
    .returning({ id: betaDeviceTokens.id, label: betaDeviceTokens.deviceLabel })
  if (result.length === 0) {
    console.error(`error: no device with id ${opts.id}`)
    process.exit(1)
  }
  console.log(`revoked ${result[0].id} (${result[0].label}) at ${fmtTs(now)}`)
}

async function cmdLog(opts: CliOptions) {
  const db = getDb()
  const where = opts.device ? eq(betaAuthLog.deviceId, opts.device) : undefined
  const rows = await db
    .select()
    .from(betaAuthLog)
    .where(where)
    .orderBy(desc(betaAuthLog.createdAt))
    .limit(opts.limit)
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }
  if (rows.length === 0) {
    console.log("no auth log entries.")
    return
  }
  console.log(`beta auth log · ${rows.length} (most recent first)`)
  for (const r of rows) {
    const ip = r.ip ?? "—"
    const dev = r.deviceId ?? "(no device)"
    console.log(
      `  ${fmtTs(r.createdAt)}  [${r.outcome}]  ${r.endpoint}  ${dev}  ${ip}`
    )
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  try {
    if (opts.cmd === "list") await cmdList(opts)
    else if (opts.cmd === "add") await cmdAdd(opts)
    else if (opts.cmd === "revoke") await cmdRevoke(opts)
    else if (opts.cmd === "log") await cmdLog(opts)
  } finally {
    await getPgPool().end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
