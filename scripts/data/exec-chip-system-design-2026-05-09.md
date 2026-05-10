# Exec chip system — design brief — 2026-05-09

**Phase 1 sketch by Berthier (`claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6`). No production wiring yet — just the spec, the action registry, and a parser stub. Worker 4 implements Phase 2 once David greenlights the design.**

Carded as `step-exec-chip-system`.

---

## TL;DR

Executive (and worker) agents whisper to the cockpit UI by emitting **chip sentinels** in their assistant messages. Each chip becomes a tappable pill rendered inline under the message that emitted it. 1–3 chips per message; one tap maps to a registered handler; no free-form action surface.

Syntax: a single, minimal JSON sentinel — easy regex, easy LLM emission, easy to dismiss visually.

```
<<chip:{"action":"approve-phase-2","label":"Approve Phase 2","params":{"planStepId":"step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup","agentId":"claude:cdd73e96-..."}}>>
```

The chip parser is a second pass over assistant messages, complementary to the existing `power-strings.ts` single-token detector. Storage is **derived, not persisted** — chips are re-extracted from message text on render, so editing/redacting the message edits/redacts the chip.

The action universe is a registry (`lib/operator-studio/chip-actions.ts`), aligning with the registry-over-hardcoded-lists rule. Initial registry: 8 actions, each typed, each with a stubbed handler.

---

## Three forks resolved

### 1. Syntax: power-string-style JSON sentinel

```
<<chip:{"action":"<id>","label":"<display>","params":{...optional...}}>>
```

**Why:** Single regex match (`/<<chip:(\{.*?\})>>/g`), JSON.parse the captured group. Robust to multiline (use `.*?` with `s` flag if we ever need wrapping). Visually distinct from prose. LLMs produce it reliably with one example. Doesn't disrupt markdown rendering.

**Considered + rejected:**
- Fenced codeblock (```chip ... ```) — too verbose; renders as a code block.
- XML-ish (`<chip id="..."/>`) — sanitization landmines in Markdown; React XSS surface.
- Markdown convention (lines starting with `→`) — too easy to false-positive on prose.

### 2. Action universe: registry, not free-form

A typed registry of allowed actions, each with a stable id, default label, params schema, and handler. LLMs pick from the registry; unknown actions silently drop (visible in dev tools; not rendered as chips).

**Why:**
- `feedback_registry_over_hardcoded_lists.md` rule: enumerate from a registry, not a hardcoded list. The registry IS the enumeration; the hardcoded list it replaces is the LLM's free-form action ids.
- OSS shippability: a free-form chip system means any prompt-injected message can fire arbitrary handler names. The registry is the allowlist.
- Type safety: `ChipActionId` union enables exhaustive switching in handlers + UI.

**Initial registry (8 actions):** see `lib/operator-studio/chip-actions.ts` stub.

### 3. Render: inline under the emitting message

Chips render as a horizontal flex row of pill buttons immediately under the assistant message that contained the sentinel(s). The sentinel itself is hidden from the rendered message body (replaced with empty string before markdown render).

**Why:** Provenance stays with the message ("Berthier suggested I do this *here*, in this context"). Dismissal is implicit — scroll past, the chip is gone (no global-bar nag). The "whisper to the UI" framing maps cleanly to "the speaker also whispered the affordance."

**Considered + rejected:**
- Fixed bottom suggestion bar — global UI nag; loses message context; harder to attribute "why is this suggestion here?"
- Per-worker side rail — confuses "exec suggesting" vs "worker suggesting" attribution.

---

## Action registry (initial 8)

| Action id | What it does | Params | Notes |
| --- | --- | --- | --- |
| `approve-phase-2` | Re-spawns a worker against the same plan step with a Phase-2 mandate. | `{ planStepId, originatingAgentId? }` | The dogfood path for "go" decisions on field reports. |
| `view-deliverable` | Opens a file (markdown report, KB entry) in the cockpit viewer. | `{ path }` or `{ kbId }` | Primary use: tap "Read field report" → file opens in a side panel. |
| `mark-step-covered` | Flips a plan step to `covered`. Asks for confirmation if the step has open children. | `{ planStepId, planId? }` | Sibling: `mark-step-skipped`. |
| `mark-step-skipped` | Flips a plan step to `skipped`. | `{ planStepId, planId?, reason? }` | |
| `spawn-worker` | Kicks off a new worker against a given plan step with a kickoff prompt. | `{ planStepId, prompt, appKind? }` | Wraps `createNewAppSessionAndSend` + `upsertThreadCardBinding`. |
| `send-to-agent` | Delivers a message to a specific agent. | `{ agentId, text }` | Wraps the existing `cockpit-send-smoke.ts` path (`focusByDeepLink` + `sendToApp`). |
| `navigate-to-card` | Opens a plan card detail view. | `{ planStepId, planId? }` | Pure UI navigation, no server mutation. |
| `mark-worker-done` | Detaches a worker binding (the `pnpm os:worker-done` path). | `{ agentId, reason? }` | Lets David tap "Mark Worker 1 done" without typing the CLI. |

Adding a new action = append a registry entry + write a handler. No core changes.

---

## Where chips live in the schema

**Storage decision: derived on read, not persisted.**

- The chip sentinels live inside the existing message body (Claude/Codex JSONL line for the assistant turn).
- On render, the cockpit (or any other surface that renders messages) calls `parseChipsFromMessage(content)` to extract the chip list.
- The sentinel is stripped from the rendered message body via `stripChipSentinels(content)`.

**Why derived:**
- No new table, no new migration. Ships in one PR.
- Editing/redacting/regenerating the message edits/redacts the chip — no orphaned chips referring to a message that no longer says what they imply.
- Re-rendering on UI updates is cheap (pure function over text).
- LLM emissions stay reproducible and auditable in the JSONL log.

**Trade-off:** chip "tap state" (clicked vs not, dismissed vs not) needs its own ephemeral storage if we want to suppress already-tapped chips. Recommend `localStorage` keyed by message id + chip index; refresh the cockpit and your tap history is preserved per-browser. **Carded as a Phase 2 sub-decision; defaultable to "always re-render every chip every time, no tap memory" for MVP.**

---

## Tap → action flow

```
[chip tap in cockpit]
        │
        ▼
[POST /api/operator-studio/chips/dispatch
  { action: "approve-phase-2", params: {...} }]
        │
        ▼
[chip-actions.ts: dispatchChipAction(action, params)]
        │
        ▼
[registry[action].handler(params)]
        │
        ▼
[handler returns { ok, message?, navigate?, refetch? }]
        │
        ▼
[cockpit shows toast, navigates, or refetches the affected pane]
```

**Auth:** the dispatch route runs through `authorizeRequest` like every other operator-studio route. Chip handlers run in David's auth context, NOT the agent's — taps are user actions, not agent actions.

**Idempotency:** handlers should be idempotent where possible (mark-covered on an already-covered step is a no-op; approve-phase-2 on a step already in flight surfaces the existing worker instead of double-spawning).

---

## Context-awareness — how the LLM picks 1–3 chips

The LLM (exec or worker) is responsible for picking which chips to emit, given:

- The active plan + active step (from `getActiveWorkContext`)
- The currently-bound agents (from `getActiveBindingsSpawnedBy`)
- Recent operations payload (from `buildOperationsPayload`)
- Whatever the user just asked for / what the LLM just delivered

A short addition to the **system prompt** for cockpit-spawned agents:

> When you finish a substantive turn (a deliverable, a status, a decision point), end with up to three `<<chip:{...}>>` sentinels that represent the most likely next actions David would want — drawn from the action registry below: [registry rendered inline]. Pick chips that map cleanly to David's current plan-card focus and the workers presently active. If no chip is appropriate, omit them; chips are optional.

That prompt update is part of Phase 2.

---

## Phase 2 implementation slice (Worker 4 scope)

**The smallest implementable cut that delivers visible chips in the cockpit:**

1. **Wire the parser** (already stubbed in `lib/operator-studio/chip-actions.ts`):
   - Implement `parseChipsFromMessage(content)` and `stripChipSentinels(content)`.
   - Add unit tests covering: zero chips, one chip, three chips, malformed JSON (silently dropped), unknown action id (silently dropped), nested braces in label.

2. **Implement the 4 highest-leverage handlers** (defer the other 4 to the second pass):
   - `mark-step-covered`, `mark-step-skipped`, `mark-worker-done`, `view-deliverable`.
   - These are pure server-side mutations or pure UI navigation; no spawn complexity.

3. **Add the dispatch route**: `app/api/operator-studio/chips/dispatch/route.ts` — POST `{ action, params }` → calls `dispatchChipAction` → returns `{ ok, message?, navigate?, refetch? }`.

4. **Render chips in the cockpit message list**:
   - Find where messages are rendered in `cockpit-client.tsx` (or its child components).
   - Insert a chip row under each assistant message whose body contained chip sentinels.
   - Strip sentinels from the displayed body before markdown render.
   - Tap → POST → toast/refetch.

5. **System-prompt addendum** for the spawn scripts: append the chip-emission contract + the rendered registry to every kickoff prompt so workers know how to emit.

**Out of scope for Worker 4 (separate cards):**
- The 4 spawn-flavored handlers (`approve-phase-2`, `spawn-worker`, `send-to-agent`, `navigate-to-card`) — depend on the in-the-wings affordance landing first (Worker 3's deliverable) so taps don't feel silent.
- Tap-state persistence (localStorage; "already-tapped" suppression).
- Chip emission from non-cockpit surfaces (operations desk, plan card detail).

---

## Open questions for David

1. **Chip dismissal:** want a per-chip "✕" affordance, or relies on scrolling past?
2. **Multi-action chips:** can one chip trigger a chained sequence (e.g. "Mark covered AND spawn next worker"), or is one chip = one action?
3. **Worker emission:** opt-in or opt-out for spawned workers to emit chips? (Default in this brief: opt-in; chip contract added to spawn prompt by default.)
4. **Confirmation dialogs:** should `mark-step-covered` on a step with open children require a confirm tap, or just proceed and toast "marked covered (3 children left open)"?
5. **Chip ordering:** when a message emits 3 chips, who decides order — emission order, or a learned/heuristic priority? (Default: emission order; LLM controls.)

---

## Provenance + linked artifacts

- This brief: `scripts/data/exec-chip-system-design-2026-05-09.md` (this file).
- Stub registry: `lib/operator-studio/chip-actions.ts` (parser + ChipActionId enum + handlers).
- Parser tests: `lib/operator-studio/chip-actions.test.ts`.
- Plan card: `step-exec-chip-system` (carded today; Phase 2 brief lives in the card body).
- Sibling registry to model on: `lib/operator-studio/power-strings.ts` (the existing single-token detector).
- Existing send-message infrastructure (used by `send-to-agent` handler in Phase 2): `lib/server/agent-bridge/app-control.ts` + `app-deeplink-focus.ts` + `cockpit-send-smoke.ts`.
- Existing spawn infrastructure (used by `approve-phase-2` + `spawn-worker` handlers in Phase 2): `lib/server/agent-bridge/app-new-session.ts` + `lib/operator-studio/thread-card-bindings.ts`.
