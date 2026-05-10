/**
 * pnpm os:cache — materialize the hot Operator Studio context bundle.
 *
 * This is intentionally a tiny local cache, not a product-native record.
 * Agents should still write durable facts/cards through Operator Studio,
 * but a fresh worker can now read one hot file instead of recomputing the
 * same context packet during startup.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, ".operator-studio", "cache")
const OUT_FILE = path.join(OUT_DIR, "latest-context.txt")
const STATE_FILE = path.join(OUT_DIR, "context-cache-state.json")
const SESSION_BOUNDARY = "3h-agentic-work-break"
const SESSION_BREAK_MS = 3 * 60 * 60 * 1000
const TSX_ARGS = [
  "--import",
  "tsx",
  "--import",
  "./scripts/tsx-loader-register.mjs",
  "--env-file-if-exists=.env.local",
  "--env-file-if-exists=.env",
]

interface CacheState {
  invocationCount: number
  lastGeneratedAt: string | null
  currentSessionId: string | null
  currentSessionStartedAt: string | null
  sessionBoundary?: string
  cacheInvocation?: number
  previousGeneratedAt?: string | null
  newSessionWindow?: boolean
}

interface CacheRunState extends CacheState {
  generatedAt: string
  previousGeneratedAt: string | null
  isNewSessionWindow: boolean
}

function readState(): CacheState {
  if (!existsSync(STATE_FILE)) {
    return {
      invocationCount: 0,
      lastGeneratedAt: null,
      currentSessionId: null,
      currentSessionStartedAt: null,
    }
  }

  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<CacheState>
    const invocationCount =
      typeof raw.invocationCount === "number"
        ? raw.invocationCount
        : typeof raw.cacheInvocation === "number"
          ? raw.cacheInvocation
          : 0
    return {
      invocationCount,
      lastGeneratedAt:
        typeof raw.lastGeneratedAt === "string" ? raw.lastGeneratedAt : null,
      currentSessionId:
        typeof raw.currentSessionId === "string" ? raw.currentSessionId : null,
      currentSessionStartedAt:
        typeof raw.currentSessionStartedAt === "string"
          ? raw.currentSessionStartedAt
          : null,
    }
  } catch {
    return {
      invocationCount: 0,
      lastGeneratedAt: null,
      currentSessionId: null,
      currentSessionStartedAt: null,
    }
  }
}

function buildRunState(generatedAt: string): CacheRunState {
  const previous = readState()
  const previousGeneratedAt = previous.lastGeneratedAt
  const previousTime = previousGeneratedAt
    ? new Date(previousGeneratedAt).getTime()
    : null
  const generatedTime = new Date(generatedAt).getTime()
  const isNewSessionWindow =
    !previousTime || generatedTime - previousTime >= SESSION_BREAK_MS
  const currentSessionStartedAt = isNewSessionWindow
    ? generatedAt
    : previous.currentSessionStartedAt ?? generatedAt
  const currentSessionId = isNewSessionWindow
    ? `local-cache-${generatedAt.replace(/[:.]/g, "-")}`
    : previous.currentSessionId ??
      `local-cache-${currentSessionStartedAt.replace(/[:.]/g, "-")}`

  return {
    generatedAt,
    previousGeneratedAt,
    invocationCount: previous.invocationCount + 1,
    lastGeneratedAt: generatedAt,
    currentSessionId,
    currentSessionStartedAt,
    isNewSessionWindow,
  }
}

function writeState(state: CacheRunState) {
  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        sessionBoundary: SESSION_BOUNDARY,
        cacheInvocation: state.invocationCount,
        invocationCount: state.invocationCount,
        previousGeneratedAt: state.previousGeneratedAt,
        lastGeneratedAt: state.lastGeneratedAt,
        currentSessionId: state.currentSessionId,
        currentSessionStartedAt: state.currentSessionStartedAt,
        newSessionWindow: state.isNewSessionWindow,
      } satisfies CacheState,
      null,
      2
    ) + "\n"
  )
}

async function runScript(script: string, args: string[] = []) {
  const r = await execFileAsync("node", [...TSX_ARGS, script, ...args], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 10,
  })
  return r.stdout.trimEnd()
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) return `HTTP ${res.status} ${res.statusText}`
  return JSON.stringify(await res.json(), null, 2)
}

function renderSessionContract(runState: CacheRunState): string {
  const previous = runState.previousGeneratedAt ?? "(none)"
  const compareAgainst = runState.previousGeneratedAt
    ? runState.previousGeneratedAt
    : "no previous invocation; establish this run as the baseline"
  return [
    `## Session Contract`,
    ``,
    `This is an agent start packet, not a morning report. Treat a new session as a break of 3+ hours in agentic work, then compare only against the previous cache invocation unless the user asks for a broader review.`,
    ``,
    `sessionBoundary=${SESSION_BOUNDARY}`,
    `cacheInvocation=${runState.invocationCount}`,
    `previousInvocationGeneratedAt=${previous}`,
    `compareCurrentRunAgainst=${compareAgainst}`,
    `currentSessionId=${runState.currentSessionId ?? "(unknown)"}`,
    `currentSessionStartedAt=${runState.currentSessionStartedAt ?? "(unknown)"}`,
    `newSessionWindow=${runState.isNewSessionWindow ? "yes" : "no"}`,
  ].join("\n")
}

function renderChangesSinceLastInvocation(runState: CacheRunState): string {
  if (!runState.previousGeneratedAt) {
    return [
      `## Changes Since Last Invocation`,
      ``,
      `No previous cache invocation yet. This run creates the comparison baseline; do not invent a changes-since-last-run summary.`,
    ].join("\n")
  }

  return [
    `## Changes Since Last Invocation`,
    ``,
    `Compare generatedAt=${runState.generatedAt} against previousGeneratedAt=${runState.previousGeneratedAt}. Use the sections below for the current snapshot and call out only material deltas you can verify from tools or durable Operator Studio records.`,
  ].join("\n")
}

async function main() {
  const generatedAt = new Date().toISOString()
  mkdirSync(OUT_DIR, { recursive: true })
  const runState = buildRunState(generatedAt)
  const sections: Array<[string, string]> = []

  sections.push(["os:context", await runScript("./scripts/operator-context.ts")])
  sections.push(["os:operations", await runScript("./scripts/operator-operations.ts")])
  sections.push(["os:ado-triage", await runScript("./scripts/ado-triage.ts")])
  sections.push([
    "thread-card-bindings",
    await fetchJson("http://127.0.0.1:4200/api/operator-studio/agents/thread-card-bindings"),
  ])

  const body = [
    `# Operator Studio Hot Context Cache`,
    `generatedAt=${generatedAt}`,
    `source=pnpm os:cache`,
    `sessionBoundary=${SESSION_BOUNDARY}`,
    `cacheInvocation=${runState.invocationCount}`,
    `previousGeneratedAt=${runState.previousGeneratedAt ?? "(first run)"}`,
    `currentSessionId=${runState.currentSessionId ?? "(unknown)"}`,
    `currentSessionStartedAt=${runState.currentSessionStartedAt ?? "(unknown)"}`,
    `newSessionWindow=${runState.isNewSessionWindow ? "yes" : "no"}`,
    ``,
    renderSessionContract(runState),
    ``,
    renderChangesSinceLastInvocation(runState),
    ``,
    ...sections.flatMap(([title, text]) => [
      `---`,
      `## ${title}`,
      ``,
      text || "(empty)",
      ``,
    ]),
  ].join("\n")

  writeFileSync(OUT_FILE, body)
  writeState(runState)
  console.log(OUT_FILE)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
