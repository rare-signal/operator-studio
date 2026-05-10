# Exec chip system — design brief — 2026-05-09 (simplified)

**Phase 1 by Berthier (`claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6`). Worker 4 implements Phase 2.**

Carded as `step-exec-chip-system`.

> **2026-05-09 simplification.** An earlier draft proposed a typed action registry with 8 actions, params schemas, and a server-side dispatcher. David read paragraph one and pushed back: chips are next-message suggestions, not typed actions. Tap a chip → the chip's literal label becomes the user's next message → the agent on the receiving end (which already has tools) interprets and acts. No registry. No handler dispatch. No schema. This brief reflects that simpler model.

---

## TL;DR

Executive (and worker) agents whisper to the cockpit UI by emitting **chip sentinels** in their assistant messages. Each chip becomes a tappable pill rendered inline under the message that emitted it. 1–3 chips per message. Tap → the chip's label fills the chat input → user reviews/edits/submits → the agent reads the natural-language request and acts using its existing tools.

Sentinel syntax — minimal, single-line, no JSON:

```
<<chip:Approve Phase 2 for plan-cleanup>>
<<chip:Read Worker 2's field report>>
<<chip:Hold and revisit tomorrow>>
```

That's it. The chip parser is a second pass over assistant messages, complementary to the existing `power-strings.ts` single-token detector. Storage is **derived, not persisted** — chips are re-extracted from message text on render, so editing/redacting the message edits/redacts the chip.

---

## Three forks resolved

### 1. Syntax: literal-label sentinel

```
<<chip:LABEL>>
```

The label is the literal text that becomes the user's next message on tap. No id, no params, no JSON envelope.

**Why:** The agent is already smart. The "action" is just sending a message back to the agent. Anything more elaborate (typed action ids, params schemas) replaces the agent's natural-language understanding with a hand-coded protocol — which is the wrong direction. Parser: one regex (`/<<chip:(.*?)>>/g`), one trim. Render: stripChipSentinels + a flex row of buttons.

### 2. Action universe: there isn't one

The agent picks the chip text. The chip text is the next user message. The receiving agent has every tool it has during normal chat. There is no allowlist, no typed handler, no dispatch route.

**Why:** Aligns with how agents actually work. Removes a whole class of "agent wants to do X but X isn't in the registry" friction. The "registry-over-hardcoded-lists" memory rule still applies elsewhere; here it's resolved by NOT having a registry at all.

**Trade-off / accepted risk:** prompt-injected messages could emit chip sentinels with persuasive labels. Same risk as any agent message containing persuasive text — chips don't fire actions on their own; they fire only when the human taps and (by default) reviews + submits.

### 3. Render: inline pills under the emitting message; tap = fill input

Chips render as a horizontal flex row of pill buttons immediately under the assistant message that contained the sentinel(s). The sentinel itself is hidden from the rendered message body via `stripChipSentinels`.

**Default tap behavior:** clicking a chip fills the chat input with the chip's label and focuses the input. The user reviews + edits (if needed) + presses send. **Auto-send on tap is intentionally NOT the default** — preserves user control and avoids surprise mutations.

Future override: holding `Cmd` (or `Shift`) on tap could mean "send immediately." Out of scope for the first cut.

**Considered + rejected:**
- Fixed bottom suggestion bar — global UI nag; loses message context.
- Per-worker side rail — confuses "exec suggesting" vs "worker suggesting" attribution.

---

## Where chips live in the schema

**Storage decision: derived on read, not persisted.**

- The chip sentinels live inside the existing message body (Claude/Codex JSONL line for the assistant turn).
- On render, the cockpit calls `parseChipsFromMessage(content)` to extract the chip list.
- The sentinel is stripped from the rendered message body via `stripChipSentinels(content)`.

**Why derived:**
- No new table, no new migration. Ships in one PR.
- Editing/redacting/regenerating the message edits/redacts the chip.
- Re-rendering on UI updates is cheap (pure function over text).
- LLM emissions stay reproducible and auditable in the JSONL log.

**Trade-off:** chip "tap state" (already-clicked vs not) needs ephemeral storage if we want to suppress already-tapped chips. Recommend `localStorage` keyed by message id + chip index; refresh the cockpit and your tap history is preserved per-browser. Out of scope for the MVP — first cut re-renders every chip every time.

---

## Tap flow (with the simplification)

```
[chip pill rendered under assistant message]
        │
        ▼ user tap
        │
[chat input is filled with the chip's literal label + input gets focus]
        │
        ▼ user reviews / edits / hits send (or escape to cancel)
        │
[the chip text is sent back to the same agent as a normal user message]
        │
        ▼
[agent reads the natural-language request and acts using its existing tools]
```

No new API routes. No new auth surface. No new mutation paths. The "dispatch" is just the agent's own next turn.

---

## Context-awareness — how the LLM picks 1–3 chips

The LLM (exec or worker) is responsible for picking which chips to emit, given the active plan + active step + bound agents + recent operations + what the user just asked for / what the LLM just delivered. There's no enforcement mechanism; chips are an LLM judgment call.

**Spawn-prompt addendum** (added by Worker 4 to the kickoff prompt of cockpit-spawned agents):

> When you finish a substantive turn (a deliverable, a status, a decision point), end with **up to three** `<<chip:...>>` lines representing the most likely next user messages — concrete, self-contained, ready-to-send. Each `<<chip:...>>` should be its own line. The LABEL inside the sentinel is the literal text that will become the user's next message when they tap the chip, so write it as a complete request the receiving agent can act on without further context. Skip chips entirely if no clear next-action stands out.

That prompt addendum applies symmetrically to executive threads AND worker threads. Same parser, same render path, same tap behavior.

---

## Phase 2 implementation slice (Worker 4 scope)

**The smallest implementable cut that delivers visible chips in the cockpit:**

1. **Parser is already wired** (this commit lands `chip-actions.ts` + tests). Worker 4 just imports it.

2. **Render chips in the cockpit message list:**
   - Find where assistant messages are rendered in `app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx` (or its child components).
   - For each assistant message: call `parseChipsFromMessage(content)` and `stripChipSentinels(content)`.
   - Render the stripped content as the message body.
   - Below the body, render a flex-row of pill buttons (one per chip).
   - On tap: fill the chat input with the chip's `label`, focus the input. (Don't auto-send.)
   - Use the existing message id + chip index to render stable keys.

3. **System-prompt addendum** in `scripts/spawn-cockpit-worker.ts` and the two siblings (`spawn-cockpit-cross-platform-worker.ts`, `spawn-cockpit-pending-affordance-worker.ts`): append the chip-emission contract from this brief so newly-spawned workers know how to emit chips.

4. **(Optional, time-permitting) extend the same render** to the executive thread itself — when David is chatting with Berthier, Berthier's chips should also appear as pills. Same parser, same render, same tap behavior.

**Out of scope for Worker 4 (separate cards if needed):**
- Tap-state persistence (localStorage; "already-tapped" suppression).
- Cmd/Shift-click to auto-send override.
- Chip emission from non-cockpit surfaces (operations desk, plan card detail).
- Server-side validation of chip text (none planned; chip = next user message).

---

## Acceptance for `covered`

- A spawned cockpit worker can emit `<<chip:LABEL>>` in an assistant message.
- The cockpit refresh shows that label as a tappable pill under the message; the literal sentinel does NOT appear in the rendered body.
- Tapping the pill fills the chat input with the label and focuses the input. Pressing send delivers it as a normal user message.
- Same behavior in the executive thread (Berthier emits, David sees pills).
- `pnpm typecheck` green; parser tests passing.

---

## Provenance + linked artifacts

- This brief: `scripts/data/exec-chip-system-design-2026-05-09.md` (this file).
- Parser + stripper: `lib/operator-studio/chip-actions.ts`.
- Parser tests: `lib/operator-studio/chip-actions.test.ts`.
- Plan card: `step-exec-chip-system`.
- Sibling pattern this models on: `lib/operator-studio/power-strings.ts` (single-token detector for `task_done`).
- Cockpit UI to extend: `app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx` (and its child components).
- Spawn scripts to update with the addendum: `scripts/spawn-cockpit-worker.ts`, `scripts/spawn-cockpit-cross-platform-worker.ts`, `scripts/spawn-cockpit-pending-affordance-worker.ts`.

---

## v2 (2026-05-09 same-day): bigger pills + optional description + sparkle modal

### Why

David ran v1 on mobile and gave three concrete pieces of feedback:
1. **Pills are too small** — hard to tap accurately.
2. **Long labels truncate** — chip labels are inherently long-ish and the single-line ellipsis hides them.
3. **No "why pick this one now" affordance** — wants situational context per suggestion without making the chips themselves walls of text.

David's framing: *"smaller package, more decision-making power per square inch."* A "magical AI icon button" you tap reveals a curated set of suggestions, each with a title + short description. Conscious of attention budget — NOT three more walls of text.

### Sentinel syntax — backwards-compatible

```
<<chip:LABEL>>                  # v1, still valid
<<chip:LABEL|DESCRIPTION>>      # v2, description optional
```

Parser splits on the **first** `|`. Subsequent pipes inside the description are preserved literally. Empty descriptions (`<<chip:A|>>`) normalize to `undefined` so the sparkle modal never opens over a blank card.

### Render — dual-surface

1. **Inline pills** — bigger touch target (`py-2`, `text-[13px]`, `min-h-[40px]`), 2-line wrap (`whitespace-normal line-clamp-2`) so long labels no longer ellipsize. Label-only.
2. **Sparkle (✨) button** — appears next to the pill row IFF at least one chip carries a description. Tap opens a popover with one card per described chip: label as title, description below in smaller text. Long descriptions soft-truncate at ~120 chars in the card (no further expand-on-tap — chip text IS the action; the description is just orientation).

Tap behavior on EITHER surface fills the composer with the chip's `label` (never the description), focuses the textarea, no auto-send.

### Files touched (v2)

- `lib/operator-studio/chip-actions.ts` — `ChipInstance.description?: string`; parser splits on first `|`.
- `lib/operator-studio/chip-actions.test.ts` — added 6 description cases (with/without, multi-pipe, empty, whitespace, label-only-empty drop).
- `app/2/v2/components/bento-view.tsx` — extracted `ChipPillRow` component with inline pills + Popover-based sparkle modal.
- `scripts/spawn-cockpit-worker.ts`, `scripts/spawn-cockpit-cross-platform-worker.ts`, `scripts/spawn-cockpit-pending-affordance-worker.ts` — addendum noting the optional `|DESCRIPTION`.

Plan card: `step-exec-chip-system-v2`.
