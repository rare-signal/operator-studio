import "server-only"

import { pollAdoForFactory } from "./ado-poller"

/**
 * Background ADO poller — fires `pollAdoForFactory()` on a fixed
 * interval so the inbox populates without the operator clicking
 * "Poll ADO now."
 *
 * Design:
 * - Process-memory state via globalThis singleton (mirrors the
 *   hot-mode + outbound-mode pattern). Server restart → re-arms.
 * - Disabled by default. Set `OPERATOR_STUDIO_ADO_AUTOPOLL=true` in
 *   the environment to enable. Interval is configurable via
 *   `OPERATOR_STUDIO_ADO_AUTOPOLL_MS` (default 300000 = 5 min).
 * - Hardcoded factory id for v1 (`factory-clarifying-telegento`) +
 *   workspace `global`. Multi-factory polling is a follow-up.
 * - Errors are logged to console but never crash the server. Each
 *   tick is best-effort — a `az` CLI failure (auth expired, network
 *   blip) just shows up in the next manual poll's error display.
 *
 * Idempotent: starting twice (e.g. dev HMR re-execution of
 * instrumentation.ts) is a no-op — the singleton check returns the
 * existing handle.
 */

const FACTORY_ID = "factory-clarifying-telegento"
const WORKSPACE_ID = "global"

interface AdoSchedulerRuntime {
  intervalHandle: ReturnType<typeof setInterval> | null
  intervalMs: number
  startedAtMs: number
  lastTickStartedAtMs: number | null
  lastTickFinishedAtMs: number | null
  lastTickResult: {
    itemsSeen: number
    rowsIngested: number
    rowsSkippedDuplicate: number
    commentsIngested: number
    commentsSkippedDuplicate: number
    errors: string[]
  } | null
  ticks: number
}

const GLOBAL_KEY = "__operatorStudioAdoScheduler_v1__" as const
type GlobalWithScheduler = typeof globalThis & {
  [GLOBAL_KEY]?: AdoSchedulerRuntime
}

function runtime(): AdoSchedulerRuntime {
  const g = globalThis as GlobalWithScheduler
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      intervalHandle: null,
      intervalMs: 0,
      startedAtMs: 0,
      lastTickStartedAtMs: null,
      lastTickFinishedAtMs: null,
      lastTickResult: null,
      ticks: 0,
    }
  }
  return g[GLOBAL_KEY]!
}

function isAutopollEnabled(): boolean {
  const flag = process.env.OPERATOR_STUDIO_ADO_AUTOPOLL?.trim().toLowerCase()
  return flag === "true" || flag === "1" || flag === "yes"
}

function getIntervalMs(): number {
  const raw = process.env.OPERATOR_STUDIO_ADO_AUTOPOLL_MS?.trim()
  if (!raw) return 5 * 60_000
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 30_000) return 5 * 60_000
  return n
}

export interface AdoSchedulerStatus {
  enabled: boolean
  running: boolean
  intervalMs: number
  startedAt: string | null
  lastTickStartedAt: string | null
  lastTickFinishedAt: string | null
  lastTickResult: AdoSchedulerRuntime["lastTickResult"]
  ticks: number
}

export function getAdoSchedulerStatus(): AdoSchedulerStatus {
  const r = runtime()
  return {
    enabled: isAutopollEnabled(),
    running: r.intervalHandle !== null,
    intervalMs: r.intervalMs,
    startedAt: r.startedAtMs ? new Date(r.startedAtMs).toISOString() : null,
    lastTickStartedAt: r.lastTickStartedAtMs
      ? new Date(r.lastTickStartedAtMs).toISOString()
      : null,
    lastTickFinishedAt: r.lastTickFinishedAtMs
      ? new Date(r.lastTickFinishedAtMs).toISOString()
      : null,
    lastTickResult: r.lastTickResult,
    ticks: r.ticks,
  }
}

async function tick(): Promise<void> {
  const r = runtime()
  r.lastTickStartedAtMs = Date.now()
  try {
    const result = await pollAdoForFactory(WORKSPACE_ID, FACTORY_ID)
    r.lastTickResult = {
      itemsSeen: result.itemsSeen,
      rowsIngested: result.rowsIngested,
      rowsSkippedDuplicate: result.rowsSkippedDuplicate,
      commentsIngested: result.commentsIngested,
      commentsSkippedDuplicate: result.commentsSkippedDuplicate,
      errors: result.errors,
    }
    if (
      result.rowsIngested > 0 ||
      result.commentsIngested > 0 ||
      result.errors.length > 0
    ) {
      // eslint-disable-next-line no-console
      console.log(
        `[ado-scheduler] ${FACTORY_ID} · seen=${result.itemsSeen} new=${result.rowsIngested} dedup=${result.rowsSkippedDuplicate} comments_new=${result.commentsIngested} comments_dedup=${result.commentsSkippedDuplicate} errors=${result.errors.length}`
      )
    }
  } catch (err) {
    r.lastTickResult = {
      itemsSeen: 0,
      rowsIngested: 0,
      rowsSkippedDuplicate: 0,
      commentsIngested: 0,
      commentsSkippedDuplicate: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    }
    // eslint-disable-next-line no-console
    console.error(`[ado-scheduler] ${FACTORY_ID} tick threw:`, err)
  } finally {
    r.lastTickFinishedAtMs = Date.now()
    r.ticks += 1
  }
}

/**
 * Idempotent. Safe to call multiple times — subsequent calls are
 * no-ops while the scheduler is already running.
 */
export function startAdoBackgroundPoller(): AdoSchedulerStatus {
  const r = runtime()
  if (!isAutopollEnabled()) {
    return getAdoSchedulerStatus()
  }
  if (r.intervalHandle) {
    return getAdoSchedulerStatus()
  }
  const intervalMs = getIntervalMs()
  r.intervalMs = intervalMs
  r.startedAtMs = Date.now()
  // Fire immediately on start so the operator sees activity without
  // waiting a full interval. Then cadence.
  void tick()
  r.intervalHandle = setInterval(() => {
    void tick()
  }, intervalMs)
  // Don't keep the Node process alive just for this timer — if the
  // server is otherwise idle, let it exit.
  if (
    typeof (r.intervalHandle as unknown as { unref?: () => void }).unref ===
    "function"
  ) {
    ;(r.intervalHandle as unknown as { unref: () => void }).unref()
  }
  // eslint-disable-next-line no-console
  console.log(
    `[ado-scheduler] started · factory=${FACTORY_ID} interval=${intervalMs}ms`
  )
  return getAdoSchedulerStatus()
}

export function stopAdoBackgroundPoller(): void {
  const r = runtime()
  if (r.intervalHandle) {
    clearInterval(r.intervalHandle)
    r.intervalHandle = null
  }
}
