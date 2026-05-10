/**
 * Acceptance gate for the push-notification implementation.
 *
 *   pnpm tsx scripts/push-notification-impl-acceptance.ts
 *
 * Runs entirely in test mode (`OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE=1`)
 * so no real ntfy POST is issued. Synthetic data only — David's phone
 * stays silent.
 *
 * Exit codes: 0 green · 1 contract assertion failed · 2 transport/args.
 */

import { createRequire } from "node:module"
const requireFromHere = createRequire(import.meta.url)
const serverOnlyId = requireFromHere.resolve("server-only")
requireFromHere.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

// Force test mode BEFORE importing the module so the env flag is hot.
process.env.OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE = "1"
delete process.env.OPERATOR_STUDIO_NOTIFICATIONS_ENABLED

const mod = await import("../lib/operator-studio/notifier")
const {
  notify,
  maybeNotifyOnReadyTransition,
  isReadyTier,
  __resetNotifierForTest,
  __getCapturedNotificationsForTest,
} = mod

const failures: string[] = []
function assert(cond: unknown, msg: string) {
  if (!cond) failures.push(msg)
}

// ── 1. signature ────────────────────────────────────────────────────
assert(typeof notify === "function", "notify is not a function")
assert(
  typeof maybeNotifyOnReadyTransition === "function",
  "maybeNotifyOnReadyTransition is not a function"
)

// ── 2. basic notify in test mode captures rather than wire-calls ────
__resetNotifierForTest()
{
  const r = await notify({
    title: "synthetic test title",
    body: "synthetic test body",
    url: "http://localhost:4200/operator-studio/cockpit",
  })
  assert(r.ok === true, `notify result not ok: ${JSON.stringify(r)}`)
  assert(r.status === "captured", `notify status not 'captured': ${r.status}`)
  const cap = __getCapturedNotificationsForTest()
  assert(cap.length === 1, `expected 1 captured, got ${cap.length}`)
  assert(cap[0]?.title === "synthetic test title", "captured title mismatch")
}

// ── 3. disabled env-gate path ───────────────────────────────────────
__resetNotifierForTest()
process.env.OPERATOR_STUDIO_NOTIFICATIONS_ENABLED = "0"
{
  const r = await notify({ title: "muted", body: "muted" })
  assert(r.status === "disabled", `expected 'disabled', got ${r.status}`)
  assert(
    __getCapturedNotificationsForTest().length === 0,
    "should not capture when disabled"
  )
}
process.env.OPERATOR_STUDIO_NOTIFICATIONS_ENABLED = "1"

// ── 4. ready-tier classifier ────────────────────────────────────────
assert(isReadyTier("candidate-self-believed") === true, "candidate should be ready")
assert(isReadyTier("awaiting-berthier-check") === true, "awaiting should be ready")
assert(isReadyTier("berthier-reviewed") === true, "berthier-reviewed should be ready")
assert(isReadyTier("live") === false, "live should NOT be ready")
assert(isReadyTier("idle") === false, "idle should NOT be ready")
assert(isReadyTier("human-approved") === false, "human-approved should NOT be ready")

// ── 5. transition detector: same state on consecutive polls → no fire
__resetNotifierForTest()
{
  const r1 = await maybeNotifyOnReadyTransition("claude:agent-a", "live", {
    title: "T",
    body: "B",
  })
  assert(r1.transitioned === false, "first sight of 'live' must not transition")
  const r2 = await maybeNotifyOnReadyTransition("claude:agent-a", "live", {
    title: "T",
    body: "B",
  })
  assert(r2.transitioned === false, "same-state repoll must not transition")
  assert(
    __getCapturedNotificationsForTest().length === 0,
    "no captures on same-state polls"
  )
}

// ── 6. transition detector: live → candidate-self-believed fires once
__resetNotifierForTest()
{
  await maybeNotifyOnReadyTransition("claude:agent-b", "live", {
    title: "x",
    body: "x",
  })
  const fire = await maybeNotifyOnReadyTransition(
    "claude:agent-b",
    "candidate-self-believed",
    { title: "Worker 3 ready", body: "claude:agent-b finished step", url: "http://x" }
  )
  assert(fire.transitioned === true, "live→candidate must transition")
  assert(fire.notified?.status === "captured", "must capture notify on transition")
  const repoll = await maybeNotifyOnReadyTransition(
    "claude:agent-b",
    "candidate-self-believed",
    { title: "Worker 3 ready", body: "again", url: "http://x" }
  )
  assert(repoll.transitioned === false, "repoll in same ready tier must NOT re-fire")
  const cap = __getCapturedNotificationsForTest()
  assert(cap.length === 1, `expected exactly 1 captured alert, got ${cap.length}`)
  assert(cap[0]?.title === "Worker 3 ready", "captured title mismatch")
  assert(cap[0]?.url === "http://x", "captured url mismatch")
}

// ── 7. ready-tier → stronger ready-tier does NOT re-fire ────────────
__resetNotifierForTest()
{
  await maybeNotifyOnReadyTransition("claude:agent-c", "live", { title: "x", body: "x" })
  const a = await maybeNotifyOnReadyTransition(
    "claude:agent-c",
    "candidate-self-believed",
    { title: "first", body: "b" }
  )
  assert(a.transitioned === true, "live→candidate fires")
  const b = await maybeNotifyOnReadyTransition(
    "claude:agent-c",
    "awaiting-berthier-check",
    { title: "second", body: "b" }
  )
  assert(
    b.transitioned === false,
    "ready→ready (escalation) must NOT re-fire — David already alerted"
  )
  const c = await maybeNotifyOnReadyTransition(
    "claude:agent-c",
    "berthier-reviewed",
    { title: "third", body: "b" }
  )
  assert(c.transitioned === false, "ready→berthier-reviewed must NOT re-fire")
  assert(
    __getCapturedNotificationsForTest().length === 1,
    "exactly one capture across the ready-tier escalation chain"
  )
}

// ── 8. human-approved is terminal — never fires ─────────────────────
__resetNotifierForTest()
{
  const r = await maybeNotifyOnReadyTransition("claude:agent-d", "human-approved", {
    title: "x",
    body: "y",
  })
  assert(r.transitioned === false, "human-approved must never fire")
  assert(
    __getCapturedNotificationsForTest().length === 0,
    "no captures for human-approved"
  )
}

// ── 9. unconfigured path (no NTFY_TOPIC, test mode off) — no-op ─────
{
  const savedTopic = process.env.NTFY_TOPIC
  const savedTest = process.env.OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE
  delete process.env.NTFY_TOPIC
  process.env.OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE = "0"
  __resetNotifierForTest()
  const r = await notify({ title: "x", body: "y" })
  assert(
    r.status === "unconfigured",
    `expected 'unconfigured' without NTFY_TOPIC, got ${r.status}`
  )
  if (savedTopic !== undefined) process.env.NTFY_TOPIC = savedTopic
  if (savedTest !== undefined) {
    process.env.OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE = savedTest
  }
}

// ── report ─────────────────────────────────────────────────────────
if (failures.length === 0) {
  console.log("✓ push-notification-impl-acceptance: all assertions passed")
  process.exit(0)
} else {
  console.error(`✗ ${failures.length} assertion(s) failed:`)
  for (const f of failures) console.error("  - " + f)
  process.exit(1)
}
