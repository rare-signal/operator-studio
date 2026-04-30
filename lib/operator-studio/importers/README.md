# Importers — adding a new source

This is the playbook for ingesting threads from a new agent / coding tool
(OpenCode, Aider, Zed, Cursor's CLI, whatever's next). It exists because
this surface is the most likely place we'll hit cross-platform / version-
drift hogwash before release, and we've already been burned by silent
failures (Claude Desktop sidecar files masquerading as conversations,
hardcoded `["claude", "codex"]` lists silently excluding new sources).

The contract: **registered importer + UI metadata + integrity check
covers it = source is live everywhere, on every platform, with loud
failure modes.**

---

## The mental model

We are a **parser of untrusted, user-environment-dependent, third-party
data we don't control**. Codex, Claude Code, OpenCode are all pre-1.0,
all changing format under us, all stored in different places on different
OSes. That's not "write careful code" — it's a discipline shift:

- Isolate failures: a bad file from one source must never crash the run.
- Stamp provenance: every imported thread records the upstream tool's
  format version (`metadata.sourceFormatVersion`).
- Self-describe: skip telemetry surfaces in `ImportResult.skipped` so
  bug reports answer themselves.
- One contract: every importer fulfills `ImporterModule` and registers
  in `index.ts`. No more N-place edits per source.

---

## Phase 1 — Reconnaissance (no code yet)

Fill in this checklist for the new source before writing anything. The
80% of variance between sources lives here; everything in Phase 2 is
mechanical once these are answered.

| Question | Why it matters |
|---|---|
| **Surface(s)** — CLI? Desktop? Web? Hybrid? | Determines whether one importer or several. Default: one source = one importer; only split if the desktop writes its own divergent store. |
| **Storage location, per OS** — Mac, Linux, Windows | Plug into `_paths.ts`'s `SourceRootSpec` — XDG on Linux/Mac, `%APPDATA%` / `%LOCALAPPDATA%` on Windows, env-var override (`OPERATOR_STUDIO_<SOURCE>_ROOTS`). |
| **File layout** — one-file-per-thread, one-file-many-threads, SQLite, proprietary? | Drives the importer's internals. JSONL is straightforward; SQLite needs WAL-aware read-only access (see [`opencode.ts`](./opencode.ts)). |
| **Append-only?** | Append-on-grow ([`index.ts:ingestSession`](./index.ts)) trusts positional equivalence by turn index. If the source rewrites history mid-session, replace with content-hash comparison. |
| **Message schema** — how to extract `role` / `content` / `timestamp` | Each format is bespoke. Look for `role` keys (`user`/`assistant`/`human`) and content shapes (string vs array of typed parts). |
| **Per-turn id** | If the source has stable per-turn anchors, stash on `message.metadata.<source>_turn_id` and surface via `deriveMessageMetadata`. Powers future per-turn deep links. |
| **Title source** | AI-generated sidecar (Codex `session_index.jsonl`), in-file line (Claude Code `ai-title`), session row (OpenCode), first-user-message slice (last-resort fallback). |
| **Deeplink mechanism** | Registered URL scheme (Codex `codex://`), CLI resume command (Claude `claude --resume`, OpenCode `opencode --session`), web URL (ChatGPT), or none. |
| **Stable session id** | What goes in `sourceThreadId` — must be stable across re-imports for dedupe to work. Prefix with the source name (`codex-...`, `opencode-...`). |

Document the answers in a comment block at the top of the importer file.

---

## Phase 2 — Implementation

Mechanical. For a working reference, [`opencode.ts`](./opencode.ts)
covers the SQLite case (the harder one); [`codex.ts`](./codex.ts) and
[`claude-code.ts`](./claude-code.ts) cover the JSONL case.

### 1. Write the importer module

Create `lib/operator-studio/importers/<source>.ts` exporting an
`ImporterModule`:

```ts
export const fooImporter: ImporterModule = {
  id: "foo",                          // OperatorSourceApp enum value
  aliases: ["foo-cli"],               // optional: other enum values that route here
  supportsSingleImport: true,         // can parseOne() handle a single locator?

  discover(): DiscoveryResult {
    // Walk storage, return { sessions, skipped }. Never throw.
  },

  parseOne(locator: string): ParseResult {
    // Parse one session. Return {ok: true, session} or
    // {ok: false, locator, reason}. Never throw.
  },

  deriveMessageMetadata(msg) {
    // Optional: extract per-message fields for messages.metadata_json.
  },
}
```

Use [`_paths.ts`](./_paths.ts)'s `resolveSourceRoots` for storage
discovery. Stamp `metadata.sourceFormatVersion` on every parsed session.

### 2. Register it

In [`index.ts`](./index.ts):

```ts
import { fooImporter } from "./foo"
registerImporter(fooImporter)
```

### 3. Wire the enum + UI

- [`lib/operator-studio/types.ts`](../types.ts):
  - Add the id to `OPERATOR_SOURCE_APPS` (TS will then force the next two)
  - Add to `SOURCE_APP_LABELS`, `SOURCE_APP_COLORS`
  - Add to `IMPORTER_SOURCE_IDS` (the client-side mirror used for
    auto-ingest polling and Discover dropdowns)
- [`app/(operator-studio)/operator-studio/components/source-apps.tsx`](../../../app/(operator-studio)/operator-studio/components/source-apps.tsx):
  - Add to `SOURCE_APP_DISPLAY` (TS will force you)
  - Add to `AVATAR_FALLBACK_COLORS` (Record<string, string> — TS won't
    catch a missing entry; the integrity check will)
  - Add to `IMPORT_SHOWCASE_LANES` if it should appear on the dashboard
    showcase strip
- [`lib/operator-studio/source-deeplinks.ts`](../source-deeplinks.ts):
  - Add a branch in `getThreadDeepLink`. Prefer `kind: "url"` (registered
    URL scheme); fall back to `kind: "command"` (CLI resume) if no scheme.

### 4. Optional tints

Per-source visual maps in [`pulse-view.tsx`](../../../app/2/v2/components/pulse-view.tsx)
(`SOURCE_TINT`), [`session-canvas.tsx`](../../../app/(operator-studio)/operator-studio/foundry/session-canvas.tsx),
[`foundry-view.tsx`](../../../app/(operator-studio)/operator-studio/foundry/foundry-view.tsx)
(`SOURCE_COLORS`). Missing entries fall back to a generic style — not
critical but worth doing for visual continuity.

### 5. Watcher integration

If the source auto-syncs:

- File-per-session (JSONL): roots are picked up by [`watcher.ts`](../watcher.ts)
  via `getXSessionRoots()`. Add to the `watchedRoots` block with
  `kind: "single-file"`.
- Single-store (SQLite): same, but `kind: "full-source-resync"` — the
  consumer in [`instrumentation.ts`](../../../instrumentation.ts) calls
  `importFromSource` instead of `importSelectedFiles` because the file
  change doesn't tell us which session moved.

---

## Phase 3 — Verification

1. **`pnpm typecheck`** — catches `Record<OperatorSourceApp, T>` omissions.
2. **`pnpm integrity:importers`** — catches the silent-failure spots TS
   misses (AVATAR_FALLBACK_COLORS, IMPORTER_SOURCE_IDS, deeplinks,
   discover-throws contract). This is also called at dev-server startup
   as a loud warning. **Wire into CI.**
3. **`pnpm probe:importers`** — dry-run discovery against your local
   data per source. Sanity-check the count, format version, and most-
   recent title.
4. **End-to-end ingest** — POST `/api/operator-studio/discover` with
   `{source, mode: "sync"}`, then read the thread back and verify
   message order, roles, content, and `metadata_json` per message.
   [`scripts/inspect-thread.ts`](../../../scripts/inspect-thread.ts)
   does this in one command.
5. **Click the deeplink** — confirm it actually opens the source app.

---

## What lives where

```
lib/operator-studio/importers/
├── README.md                — this file
├── _paths.ts                — cross-platform resolveSourceRoots()
├── _registry.ts             — ImporterModule contract + registry
├── _integrity.ts            — checks the registry is fully wired up
├── index.ts                 — orchestrator (importFromSource, etc.)
│                              + central registration
├── claude-code.ts           — JSONL importer
├── codex.ts                 — JSONL importer
└── opencode.ts              — SQLite importer (better-sqlite3, WAL-aware)
```

```
scripts/
├── check-importers.ts       — CLI for the integrity check (pnpm integrity:importers)
├── probe-importers.ts       — dry-run discovery per source (pnpm probe:importers)
└── inspect-thread.ts        — read back an imported thread + messages
```

---

## Known verification debt

Per-OS path defaults for the three current importers were derived from
documentation and tested live on Mac only. Each cell below is owed a
verification pass on real hardware before we can claim cross-platform
support in release notes.

| source | macOS | Linux | Windows |
|---|---|---|---|
| codex | ✅ tested 2026-04-27 (829 sessions) | ⚠️ unverified | ⚠️ unverified |
| claude-code | ✅ tested 2026-04-27 (341 sessions) | ⚠️ unverified | ⚠️ unverified |
| opencode | ✅ tested 2026-04-27 (1 session, end-to-end ingest) | ⚠️ unverified | ⚠️ unverified |

If you're working on the OS-sensitive code (paths in `_paths.ts`,
storage-root specs in each importer), spinning out a verification task
on the other OSes is appropriate even if your change looks "obviously"
portable. Hardware is available — see the cross-platform-scope memory.

## What we deliberately don't do

- **No DB column for skip telemetry** — `ImportResult.skipped` is in-memory
  + API response only. Add a `skipped_count` / `notes` column on
  `operator_import_runs` when we surface skips in UI.
- **No fixture-based tests per format** — reactive. Add a fixture when
  we hit a real bug; the `discover()` smoke test in `_integrity.ts`
  catches the gross stuff.
- **No compat shims for old upstream versions** — handle reactively;
  `metadata.sourceFormatVersion` tells us who needs migrating.
- **No TCC / signed-binary UX** — real problem on Mac/Windows when we
  ship the desktop wrapper, but downstream of "the importer itself works."
- **No desktop-vs-CLI splits by default** — one source = one enum value
  unless evidence shows the desktop writes its own divergent store.
