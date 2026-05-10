# Cockpit "in-the-wings + cancel" affordance — field report — 2026-05-09

**Phase 1 sweep only — no writes performed. Awaiting David's go before Phase 2.**

Spawned by exec `claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6` against [step-cockpit-pending-spawn-affordance](https://example.invalid/plan-card).
Suggested KB id: `kb-2026-05-09-cockpit-in-the-wings-affordance`.

Sibling reports: `scripts/data/plan-cleanup-field-report-2026-05-09.md`, `scripts/data/cross-platform-integration-gap-field-report-2026-05-09.md`. Cross-platform overlap is called out at the bottom (`step-os-cross-platform-parity` interaction).

---

## TL;DR

The 30s "worker just popped in when it was already done" gap during the 2026-05-09 battle test has **two independent causes**, only one of which the plan-card description anticipated:

1. **The journal isn't written on the happy path.** [`createLaunchAttempt`](lib/operator-studio/launch-attempts.ts:125) is called by [app/api/operator-studio/agents/new-session/route.ts:153](app/api/operator-studio/agents/new-session/route.ts:153) and [app/api/operator-studio/agents/new-session/route.ts:208](app/api/operator-studio/agents/new-session/route.ts:208) **only when `createNewAppSessionAndSend` returns `ok:false`**. On a successful 30-second spawn the directory gets zero writes — there is nothing to "surface as pending" because nothing was recorded. The plan-card body says the data already exists; **it doesn't, on the happy path.**
2. **Even if a record existed, the cockpit couldn't find it.** `LaunchAttemptRecord` has no `spawnedByAgentId` field ([lib/operator-studio/launch-attempts.ts:72-98](lib/operator-studio/launch-attempts.ts:72)). The cockpit's spawned-by rail filters by `bindings.spawned_by_agent_id` ([app/api/operator-studio/cockpit/spawned-by/route.ts](app/api/operator-studio/cockpit/spawned-by/route.ts)); pending attempts have no binding yet *and* no exec attribution to filter by.
3. **The spawn scripts in `scripts/spawn-cockpit-*.ts` bypass the API route entirely.** They call `createNewAppSessionAndSend` directly and write the binding via `upsertThreadCardBinding` after reconcile. The journal is never touched, even on failure, because the failure-write only lives in the API route.

So the "in-the-wings" surface needs three things: a place to *write* pending state at the start of a spawn, an *attribution* field so the cockpit can scope to its exec lane, and a *cancel* path that closes the journal record + detaches any binding that snuck in.

The smallest slice that delivers visible value: **(a) add `spawnedByAgentId` to `LaunchAttemptRecord`, (b) write a `pending` record at the start of every cockpit spawn (script + API route both), (c) update its `stage` field as the pipeline advances, (d) extend `/cockpit/spawned-by` to return both resolved bindings and pending attempts, (e) render a pending row in the existing `WorkersList` with stage + age + cancel button.**

---

## Today's spawn pipeline — annotated timeline

Stages emitted by `createNewAppSessionAndSend`, in order, with what the cockpit sees:

| Stage | Source | Slow? | Observable today? | After Phase 2 |
|---|---|---|---|---|
| `hot-mode` arming check | new-session route preamble | <100ms | no | row appears: "queued" |
| `validate` (launcher inventory) | `resolveRequestedLauncher` | <100ms | no | "queued" |
| `activate` (focus target app) | AppleScript `activate` | 200–500ms (cold app: 2–5s) | no | "launching: focusing app" |
| `focus-after-activate` (verify frontmost) | osascript probe | <200ms | no | "launching: verifying focus" |
| `new-session-shortcut` (⌘N keystroke) | System Events | <200ms | no | "launching: opening new thread" |
| `focus-after-new-session` (re-verify) | osascript probe | <200ms | no | "launching: verifying focus" |
| `clipboard-stage` (`pbcopy` the prompt) | `exec.ts` spawn | <100ms | no | "launching: staging prompt" |
| `paste` (⌘V keystroke) | System Events | <200ms | no | "launching: pasting" |
| `submit` (Return keystroke) | System Events | <200ms | no | "launching: submitting" |
| `reconcile` (poll JSONL for new session) | `app-sessions.ts` mtime poll | **2–25s** (the bulk of the 30s) | no | "launching: waiting for thread to register" + age counter |
| binding write | `upsertThreadCardBinding` | <100ms | yes (rail row appears) | row promoted from pending → real worker |

**The reconcile poll is where the entire visible delay lives.** Everything else is sub-second. The fix isn't to speed it up; it's to render *something* during the 2–25s window, with a cancel that aborts the poll and detaches any partial binding.

---

## Proposed UX

### Pending row (renders inside the existing `WorkersList`, above resolved workers)

```
┌─────────────────────────────────────────────────────────────────┐
│ ◐ Spawning Claude worker · 12s · waiting for thread to register │
│                                                       [ Cancel ]│
│ Plan card: step-cockpit-pending-spawn-affordance                │
└─────────────────────────────────────────────────────────────────┘
```

- **Spinner glyph** matches the cockpit's existing in-flight idiom.
- **Stage copy** is human-readable (the table above), not the raw stage name.
- **Age** ticks every 1s on the client.
- **Plan card line** mirrors the resolved-worker row layout for visual continuity.
- **Cancel** button is always present, hovers red. Confirm-on-click is **not** needed — cancel is reversible (the prompt survives in the journal as `dismissed`, recoverable via `LaunchFallbackPanel`).

### Auto-promotion

When the binding write lands and `/cockpit/spawned-by` returns the new agent id, the pending row's `id === pendingAttemptId` is matched against the new binding's `launchAttemptId` (new field on `operator_thread_card_bindings`, see API surface below) and the row swaps in place — no flicker, no scroll jump.

### Failure state

If the pipeline fails partway through, the journal record's `status` stays `pending` and `errorRaw`/`message` populate. The pending row swaps to a red-bordered error variant:

```
┌─────────────────────────────────────────────────────────────────┐
│ ✕ Spawn failed at "paste" · 8s ago                              │
│ System Events isn't allowed to send Cmd+V…                      │
│                                       [ Retry ]  [ Dismiss ]    │
└─────────────────────────────────────────────────────────────────┘
```

`Retry` re-fires the same spawn script with the same `planStepId` + `prompt` (the journal already has both verbatim). `Dismiss` POSTs `status=dismissed` and the existing `LaunchFallbackPanel` picks up the prompt for manual recovery — no work lost.

### Cancel semantics

1. Client POSTs `DELETE /api/operator-studio/agents/launch-attempts/<id>` (already exists; aliases to `status=dismissed`).
2. Server marks the journal record `dismissed`.
3. **New**: if `evidence.bindingId` was written before cancel raced in, server calls `detachThreadCardBinding(bindingId)` (need to confirm this helper exists or add it to `lib/operator-studio/thread-card-bindings.ts` — *gap to confirm in Phase 2*).
4. **Open question for David**: should cancel try to abort the in-flight osascript? On macOS the only way to "abort" a paste-in-progress is to switch focus away — fragile. Recommendation: **no**, because by the time the user clicks cancel, the keystrokes have either already fired or the reconcile poll is the slow part (and that's a JS-side `setInterval` that's trivially abortable via an `AbortController` wired into `createNewAppSessionAndSend`'s reconcile loop).

---

## Proposed API surface

### Schema additions

**`LaunchAttemptRecord`** ([lib/operator-studio/launch-attempts.ts](lib/operator-studio/launch-attempts.ts)):

```ts
export interface LaunchAttemptRecord {
  // ... existing fields ...
  spawnedByAgentId: string | null   // NEW — exec attribution for cockpit scoping
  spawnOrigin: "cockpit" | "script" | "panel" | null   // NEW — provenance, for telemetry
  bindingId: string | null   // NEW — populated post-reconcile, lets cancel detach
}
```

**`createLaunchAttempt`** signature gains the same three optional fields. Old records on disk deserialize fine (defaulting to `null`).

### New library functions

```ts
// lib/operator-studio/launch-attempts.ts
export async function updateLaunchAttemptStage(
  id: string,
  patch: { stage: LaunchAttemptStage; message?: string; evidence?: Record<string, unknown> }
): Promise<LaunchAttemptRecord | null>

export async function attachBindingToLaunchAttempt(
  id: string,
  bindingId: string
): Promise<LaunchAttemptRecord | null>

export async function listLaunchAttemptsByExec(
  spawnedByAgentId: string,
  opts?: { status?: LaunchAttemptStatus | "all"; limit?: number }
): Promise<LaunchAttemptRecord[]>
```

### Route changes

- **Extend** `GET /api/operator-studio/cockpit/spawned-by?exec=<id>` to return `{ agentIds: string[], pendingAttempts: LaunchAttemptSummary[] }`. Backwards compatible: existing callers ignoring the new field keep working.
- **Reuse** the existing `DELETE /api/operator-studio/agents/launch-attempts/:id` for cancel — it already marks `dismissed`. Add the `detachThreadCardBinding` step inside the handler when `bindingId` is set.
- **No** new SSE/long-poll route for Phase 2's first commit. The existing 4s `/cockpit/spawned-by` poll cadence is fast enough for stage progress; if David wants sub-second granularity later, swap to SSE in a follow-up. Keeping the cadence avoids hitting his "dev server holds port 4200, can hang on extra requests" rule.

### Spawn script changes

Both `scripts/spawn-cockpit-worker.ts` and `scripts/spawn-cockpit-pending-affordance-worker.ts` (and the cross-platform sibling) need to:

1. Call `createLaunchAttempt({ status: "pending", spawnedByAgentId: EXEC_AGENT_ID, spawnOrigin: "cockpit", stage: "validate", … })` **before** `createNewAppSessionAndSend`.
2. Pass an `onStage` callback into `createNewAppSessionAndSend` (new optional param) that calls `updateLaunchAttemptStage(attempt.id, { stage })` for each stage transition.
3. After `upsertThreadCardBinding` succeeds, call `attachBindingToLaunchAttempt(attempt.id, binding.id)` and `resolveLaunchAttempt(attempt.id, { agentId: result.agentId, status: "resolved" })`.
4. On any thrown error, leave the record `pending` with the latest stage so the cockpit's pending row shows the error state and the operator can retry/dismiss.

The API route at `app/api/operator-studio/agents/new-session/route.ts` gets the same treatment so non-script spawns (Bento, future cockpit-driven spawn button) get the same affordance for free.

---

## Smallest implementation slice (Phase 2 first commit)

To deliver visible value with the fewest moving parts:

**Commit 1 — "Pending row appears within 1s, no cancel yet, no stage updates"**

1. Add `spawnedByAgentId`, `spawnOrigin`, `bindingId` to `LaunchAttemptRecord` (optional, default null).
2. Add `listLaunchAttemptsByExec` to `lib/operator-studio/launch-attempts.ts`.
3. Extend `/cockpit/spawned-by` to also return `pendingAttempts` for that exec.
4. Edit `scripts/spawn-cockpit-worker.ts` (only — leave siblings for commit 3) to write a pending record at start, mark it resolved at end.
5. Render a single pending row above `WorkersList` showing "Spawning Claude worker · {age}s". No cancel button yet. No stage updates yet.
6. `pnpm typecheck` gate.

This proves the data flow end-to-end: the row appears immediately on spawn, ages in real time, and disappears when reconcile lands. **Cancel and stage progress are deliberately deferred** so commit 1 stays small and reviewable.

**Commit 2 — "Cancel + stage progress"**

7. Add `updateLaunchAttemptStage` + `attachBindingToLaunchAttempt`.
8. Add `onStage` callback to `createNewAppSessionAndSend`; wire it into the spawn script.
9. Add cancel button to the pending row, calling `DELETE /api/.../launch-attempts/:id` + (new) detach-binding logic inside the handler.
10. Render the failure-state variant (red border + retry/dismiss).

**Commit 3 — "Parity"**

11. Update sibling spawn scripts (`spawn-cockpit-pending-affordance-worker.ts`, `spawn-cockpit-cross-platform-worker.ts`).
12. Update `app/api/operator-studio/agents/new-session/route.ts` to write the pending record on the happy path too (currently only writes on failure).
13. Optional: surface pending workers in `pnpm os:workers` CLI for parity with the cockpit UI (matches the plan-card item 2 in the kickoff prompt).

---

## Cross-cutting concerns

### `step-os-cross-platform-parity` (sibling worker's lane)

Cancel UX as proposed is platform-agnostic — it's a JSON file write + an HTTP DELETE + a `setInterval` clear in the cockpit client. **No new osascript, no new platform-locked surface.** The pipeline stages it surfaces are macOS-locked today (per sibling report), but the affordance itself doesn't add new lock-in. Safe to land before parity work.

One **small new dependency on the parity work**: the failure-state copy ("System Events isn't allowed to send Cmd+V…") comes from `copyForStage` in `lib/server/agent-bridge/launch-fallback.ts`, which the sibling report already flags as a "permissions-model leak" needing platform-aware copy. Phase 2 of *this* work doesn't need to fix that — the copy already renders on Mac correctly — but it inherits whatever the parity lane lands later.

### Doctrine compliance

- **Dogfood-first**: all work captured in `step-cockpit-pending-spawn-affordance`; this report lives in `scripts/data/` (matching sibling pattern), not as a stray markdown.
- **No browser/curl verification**: Phase 2 gate is `pnpm typecheck`. No preview, no curl smoke checks against port 4200.
- **No CLIs**: doesn't apply here — all spawning still goes through Desktop apps via the existing `createNewAppSessionAndSend` pipeline.
- **Terse plain English in user-facing summary**: the pending-row copy avoids stage names, schema field names, and plan-card IDs (uses "waiting for thread to register" not "stage: reconcile").

### What's *not* in scope

- Live SSE for sub-second stage updates (deferred until 4s poll proves insufficient).
- Aborting in-flight osascript keystrokes (recommended **out**: fragile, low value, the operator can just click into Claude and clear the thread).
- A general "spawn this from the cockpit" button (different feature; this is purely about *making existing spawns visible*).
- Parity in `LaunchFallbackPanel` (it already polls launch-attempts; pending records will start showing up there too once written, which may be desirable or noisy — deferrable decision).

---

## Open questions for David before Phase 2

1. **Cancel behavior on partial reconcile**: if reconcile *just* finished and the binding was written milliseconds before cancel arrives, do we (a) still detach the binding (treat user intent as final) or (b) refuse cancel with "this worker already exists, dismiss it the normal way"? Recommendation: **(a)** — matches the user's mental model.
2. **Should pending rows persist across cockpit refreshes?** The journal entry persists, so reload-then-render-pending works for free. But if the spawn script process died mid-spawn, we'd render a "pending" row that will never resolve. Recommendation: add a stale-after threshold (e.g. 5 minutes pending → auto-mark `dismissed` with `errorRaw: "spawn process did not report completion"`) in commit 2.
3. **Should `LaunchFallbackPanel` show pending records too?** Today it only shows pending = stuck-in-failure. Once we write pending = in-progress, the panel would flicker every spawn. Recommendation: filter the panel to `pending && stage !== "validate" && status !== "resolved"` *or* add a dedicated `inFlight` boolean. Cheap to defer.

---

task_done
