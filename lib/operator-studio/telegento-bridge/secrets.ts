/**
 * Resolve the Telegento INTERNAL_API_TOKEN used to call Telegento's
 * internal endpoints (e.g. /api/telegento/known-issues/feedback/pending).
 *
 * Order of preference:
 *   1. process.env.TELEGENTO_INTERNAL_API_TOKEN  (set in .env.local)
 *   2. AWS Secrets Manager  telegento-prod/internal-api-token
 *      via the DataAdministrator-694973467292 SSO profile.
 *   3. Throw with a usage hint.
 *
 * The Secrets Manager fallback shells out to `aws secretsmanager
 * get-secret-value` so we don't pull in `@aws-sdk/client-secrets-manager`
 * just for one read. If the caller has already run
 *   eval "$(./scripts/tg-aws.sh)"
 * the shell environment is already pointed at account 694973467292.
 */

import { spawn } from "node:child_process"

const SECRET_NAME = "telegento-prod/internal-api-token"
const FALLBACK_PROFILE = "DataAdministrator-694973467292"
const FALLBACK_REGION = "us-east-1"

let cached: { token: string; loadedAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getTelegentoInternalApiToken(): Promise<string> {
  const envToken = process.env.TELEGENTO_INTERNAL_API_TOKEN?.trim()
  if (envToken) return envToken

  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.token
  }

  const fromAws = await readSecretViaAwsCli().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(
      [
        `getTelegentoInternalApiToken: could not resolve token.`,
        ``,
        `  • TELEGENTO_INTERNAL_API_TOKEN is not set in env (.env.local).`,
        `  • AWS Secrets Manager read failed: ${message}`,
        ``,
        `Fix one of:`,
        `  (a) Add TELEGENTO_INTERNAL_API_TOKEN=... to .env.local, or`,
        `  (b) Switch to the Telegento AWS account first:`,
        `        eval "$(./scripts/tg-aws.sh)"`,
        `      then re-run.`,
      ].join("\n")
    )
  })

  cached = { token: fromAws, loadedAt: Date.now() }
  return fromAws
}

async function readSecretViaAwsCli(): Promise<string> {
  const args = [
    "secretsmanager",
    "get-secret-value",
    "--secret-id",
    SECRET_NAME,
    "--query",
    "SecretString",
    "--output",
    "text",
  ]

  const env = { ...process.env }
  if (!env.AWS_PROFILE) env.AWS_PROFILE = FALLBACK_PROFILE
  if (!env.AWS_REGION) env.AWS_REGION = FALLBACK_REGION

  const { stdout, stderr, code } = await runCommand("aws", args, env)
  if (code !== 0) {
    throw new Error(
      `aws secretsmanager get-secret-value exit=${code}: ${stderr.trim() || "(no stderr)"}`
    )
  }

  const raw = stdout.trim()
  if (!raw) throw new Error("empty SecretString from aws cli")

  // The secret may be a plain string or a JSON blob with `{ token: ... }`.
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const candidates = ["token", "value", "INTERNAL_API_TOKEN", "apiToken"]
      for (const key of candidates) {
        const v = parsed[key]
        if (typeof v === "string" && v.trim()) return v.trim()
      }
      throw new Error(
        `secret JSON has no recognized key — looked for: ${candidates.join(", ")}`
      )
    } catch (err) {
      if (err instanceof SyntaxError) {
        // It happened to start with `{` but isn't JSON — treat as plain.
        return raw
      }
      throw err
    }
  }
  return raw
}

function runCommand(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()))
    child.on("error", reject)
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 })
    })
  })
}
