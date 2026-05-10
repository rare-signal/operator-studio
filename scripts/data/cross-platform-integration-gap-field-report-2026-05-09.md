# Cross-platform integration gap — field report — 2026-05-09

**Phase 1 sweep only — no writes performed. Awaiting David's go before Phase 2.**

Spawned by exec `claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6` against `step-cross-platform-integration-gap-survey`.
Suggested KB id: `kb-2026-05-09-cross-platform-integration-gap`.

Sibling: `scripts/data/plan-cleanup-field-report-2026-05-09.md`. The proposed lane below (`step-os-cross-platform-parity`) is a **new** top-level lane in the OS plan (`plan-1777793035871-dkq1b8`) and does **not** collide with any bucket the cleanup proposes (`step-os-software-factory-spine`, `step-os-agent-orchestration`, `step-os-operations-desk`, `step-os-idea-gravity`, `step-os-product-launch-media`, `step-os-context-and-recency`, `step-os-creative-media-studio`). Safe to slot in alongside.

---

## TL;DR

The desktop-control bridge (`lib/server/agent-bridge/`) is **macOS-locked** end-to-end. Every keystroke, focus check, frontmost probe, and the only currently-working session-focus mechanism (the `claude://resume?session=<uuid>` deep link) flows through `osascript` + `pbcopy` + `pbpaste` + `open`. There is **no platform-detection branch** anywhere in this directory — Windows or Linux invocations would shell-out to a binary that doesn't exist and fail at the spawn level.

The importer/path side is in much better shape: the importer registry's `_paths.ts` does proper Mac/Linux/Windows resolution with env-var overrides, and the three importers (Claude Code, Codex, OpenCode) declare per-platform defaults. **However** — and this is a confirmed gap with the 2026-04-27 memo — the agent-bridge's own `app-sessions.ts` hardcodes `~/.claude/projects` and `~/.codex/sessions` via `os.homedir()` and bypasses the registry path helper entirely. So the bridge can't even *read* sessions on Windows today, let alone write keystrokes into them.

Net: **eight macOS-locked surfaces, one path-helper-bypass bug, zero permission-model abstractions, zero adapter interface for non-AppleScript backends.** Plan-card proposal is 1 lane → 5 child buckets → ~20 leaf cards.

---

## macOS-only surfaces inventory

| File | Surface | macOS mechanism | Cross-platform classification |
| --- | --- | --- | --- |
| [lib/server/agent-bridge/app-control.ts](lib/server/agent-bridge/app-control.ts) | "Send to frontmost app" — paste text/image + submit | `pbcopy`, `pbpaste`, `osascript` (activate, frontmost, ⌘V, Return), AppleScript `«class PNGf»` clipboard for images | **Locked-in to macOS.** Every line of dispatch is osascript or pbcopy/pbpaste. No platform branch. |
| [lib/server/agent-bridge/app-new-session.ts](lib/server/agent-bridge/app-new-session.ts) | "New thread" launch (⌘N + paste + submit + JSONL reconcile) | `osascript` + `tell application "System Events" keystroke "n" using {command down}`; per-app adapter currently only macOS | **Locked-in.** Modifier names (`command down`) and AppleScript `tell application` are macOS-only constructs. The reconcile-by-mtime poll is platform-agnostic; only the keystroke layer is locked. |
| [lib/server/agent-bridge/app-session-focus.ts](lib/server/agent-bridge/app-session-focus.ts) | Chat-picker session focus (Cmd+K → type title → Return) | `osascript` keystroke chain | **Locked-in** (and largely superseded by deep-link focus on Mac, but no deep-link equivalent exists for non-Claude apps yet). |
| [lib/server/agent-bridge/app-deeplink-focus.ts](lib/server/agent-bridge/app-deeplink-focus.ts) | Claude session focus via `claude://resume?session=<uuid>` | macOS `open <url>` to fire the protocol handler | **Mostly locked-in to macOS.** The URL scheme itself is registered by Claude Desktop on every platform; only the *opener* is `open`. Win = `start "" "<url>"` / `cmd /c start`, Linux = `xdg-open <url>`. Modest fix; the larger question is whether Claude Desktop registers `claude://` on Windows and Linux at all (needs hardware verification). |
| [lib/server/agent-bridge/desktop-lease.ts](lib/server/agent-bridge/desktop-lease.ts) | Frontmost-process probe (collision detection for the lease) | `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'` | **Locked-in.** The lease abstraction is platform-agnostic; the probe is not. Win = `Get-Process \| Where-Object MainWindowHandle` / `GetForegroundWindow` (P/Invoke or PowerShell). Linux X11 = `xdotool getactivewindow getwindowname`; Wayland = no portable answer (compositor-specific, often refused). |
| [lib/server/agent-bridge/app-sessions.ts](lib/server/agent-bridge/app-sessions.ts) | List/find Claude+Codex JSONL sessions for the bridge to act on | Hardcodes `path.join(os.homedir(), ".claude", "projects")` and `path.join(os.homedir(), ".codex", "sessions")` directly; ignores the importer registry's path helper | **Path/IO bug — not macOS-locked, but registry-bypass.** Lucky that Mac and Linux happen to share these layouts; Windows would silently miss `%USERPROFILE%\.codex\sessions` only because it's the same default. The Claude case is fine on Win (`%USERPROFILE%\.claude\projects`) but not what `lib/operator-studio/importers/claude-code.ts` declares (which includes `%APPDATA%/Claude/claude-code-sessions` as an alternate root). **Refactor to use `resolveSourceRoots`.** |
| [lib/server/agent-bridge/exec.ts](lib/server/agent-bridge/exec.ts) | spawn helper used by every surface above | `node:child_process` `spawn` (cross-platform) — fine | **Cross-platform.** No change needed; this is the right primitive. |
| [lib/server/agent-bridge/launch-fallback.ts](lib/server/agent-bridge/launch-fallback.ts) | Stage-name → user-facing failure copy | macOS-flavored copy strings ("System Events isn't allowed to send Cmd+N…", "Open System Settings → Privacy & Security → Accessibility") | **Permissions-model leak.** Copy hard-codes the macOS permission stack (Accessibility/TCC/System Events). On Win there's no equivalent global gate by default (UIPI for elevated targets only); on Linux it's display-server-specific. Copy needs to be platform-aware or genericized. |
| [lib/server/agent-bridge/launch-attempts.ts](lib/server/agent-bridge/launch-attempts.ts) | (referenced but lives at `lib/operator-studio/launch-attempts.ts`) Persistent record of launch attempts | Plain JSON files under `<cwd>/.operator-studio/launch-attempts/` | **Cross-platform.** No change. |
| [lib/server/agent-bridge/tmux-launch.ts](lib/server/agent-bridge/tmux-launch.ts) | Fresh tmux worker launch (Claude inside a tmux pane) | Hardcoded `nvm use 22 && claude` shell command in `OPERATOR_STUDIO_CLAUDE_LAUNCH_CMD`-overridable form | **Mac/Linux only by virtue of tmux.** Windows has no tmux; the per-memory doctrine is "Desktop apps only, not CLIs" so this lane isn't first-priority for Win, but if/when CLI lanes are revived it needs a Windows alternative (Windows Terminal + ConPTY, or WSL2-only). |

### Repo-wide search for `osascript` / `process.platform`

```
lib/server/agent-bridge/app-control.ts          (6 hits — paste pipeline)
lib/server/agent-bridge/app-deeplink-focus.ts   (1 hit — `open` invocation)
lib/server/agent-bridge/app-new-session.ts      (2 hits — Cmd+N + activate)
lib/server/agent-bridge/app-session-focus.ts    (4 hits — picker dance)
lib/server/agent-bridge/desktop-lease.ts        (1 hit — frontmost probe)
lib/operator-studio/importers/_paths.ts         (correct platform branch)
scripts/seed-software-factory-nucleus.ts        (seed data, not runtime)
scripts/seed-mobile-cockpit-vision.ts           (seed data, not runtime)
scripts/spawn-cockpit-cross-platform-worker.ts  (this worker — meta)
```

The only platform-conditional code path in the entire `lib/server/` tree is **zero**. There is no `if (process.platform === 'darwin')` anywhere in agent-bridge.

---

## Importer-side cross-platform check (vs. 2026-04-27 memo)

The memo says: "Importer registry + cross-platform path helper landed 2026-04-27 (Mac live, Win/Linux defaults unverified)." Confirming and refining:

| Component | Status | Notes |
| --- | --- | --- |
| [`_paths.ts`](lib/operator-studio/importers/_paths.ts) | ✅ Confirmed cross-platform | Handles `~`, `$XDG_*`, `%APPDATA%`/`%LOCALAPPDATA%`/`%USERPROFILE%`, Win-on-Mac dev-time fallback, env-var override with platform-aware delimiter. Solid. |
| [`claude-code.ts`](lib/operator-studio/importers/claude-code.ts) | ✅ Declares mac/linux/windows | `mac: ~/.claude/projects + ~/Library/Application Support/Claude/claude-code-sessions`; `linux: ~/.claude/projects`; `windows: %USERPROFILE%/.claude/projects + %APPDATA%/Claude/claude-code-sessions`. Defaults look right; **unverified on real Win/Linux hardware**. |
| [`codex.ts`](lib/operator-studio/importers/codex.ts) | ✅ Declares mac/linux/windows | `~/.codex/sessions + ~/.codex/archived_sessions` everywhere; Win uses `%USERPROFILE%`. **Unverified on Win/Linux hardware**. |
| [`opencode.ts`](lib/operator-studio/importers/opencode.ts) | ✅ Declares mac/linux/windows | XDG-spec on Mac/Linux (`$XDG_DATA_HOME/opencode + ~/.local/share/opencode`); Win uses `%LOCALAPPDATA%/opencode + %APPDATA%/opencode`. **Unverified on Win/Linux hardware**. |
| [`watcher.ts`](lib/operator-studio/watcher.ts) | ✅ Cross-platform | `chokidar`, with documented `full-source-resync` for the SQLite-backed OpenCode source. |
| **`lib/server/agent-bridge/app-sessions.ts`** | ❌ **Refutes the memo's "consolidated" claim for the bridge side** | This file walks `~/.claude/projects` and `~/.codex/sessions` with `os.homedir()` + literal path segments — bypasses the registry. On Windows it would still happen to work for the `~/.codex/sessions` case (since the importer also uses `%USERPROFILE%/.codex/sessions`) but would miss the `%APPDATA%/Claude/claude-code-sessions` Claude root entirely. **Confirmed gap.** |

Memo update needed: "Importer registry is cross-platform-aware, BUT the agent-bridge's `app-sessions.ts` JSONL walker still hardcodes Mac/Linux paths and is the second source of truth that needs to be unified onto `resolveSourceRoots`."

---

## Equivalent stacks per platform

### macOS (today)

- Dispatch: `osascript -e '...'` for keystrokes; `pbcopy` / `pbpaste` for clipboard; `open <url>` for protocol handlers.
- Frontmost probe: `tell application "System Events" to get name of first application process whose frontmost is true`.
- Permission gate: **Accessibility (TCC)** — granted to the parent process (Node / Terminal / iTerm). One-time TCC prompt on first keystroke.

### Windows

- **Dispatch options, in order of fidelity:**
  1. **PowerShell + `System.Windows.Forms.SendKeys.SendWait`** — works for foreground keystrokes; brittle on Unicode and modifier sequences. No native ⌘ equivalent — Codex/Claude on Windows would use Ctrl+N, Ctrl+V (already different from macOS, so the per-app adapter must be platform-aware).
  2. **UI Automation (UIA) via `System.Windows.Automation` (PowerShell or .NET subprocess)** — proper accessibility-tree access, can find a specific control by name and `SetValue` text directly into a textbox without keystroke fragility. **Recommended primary.** Requires a small native shim (PowerShell script or .NET CLI tool) we'd ship alongside.
  3. **AutoHotkey v2** — most mature scripting layer for Windows, but requires the user to install AHK. Useful as a community-maintainable plugin layer.
  4. **`SendInput` via Win32 P/Invoke from a Node N-API addon** — most robust, most build-system overhead.
- Clipboard: `Set-Clipboard` / `Get-Clipboard` (PowerShell), or `clip.exe` for stdin-only set; image clipboard goes through `System.Windows.Forms.Clipboard.SetImage`.
- Protocol handler open: `cmd /c start "" "<url>"` or `Start-Process <url>` (handles registered URI schemes the same way `open` does on Mac).
- Frontmost probe: `Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();' ...` (P/Invoke), or `Get-Process | Where-Object { $_.MainWindowHandle -eq [foregroundwindow] }`.
- **Permission model: there is no global Accessibility gate by default.** Most automation works without elevation. Two real gates: (a) **UIPI** — automating a window owned by a higher-integrity process requires the operator process to also be elevated; (b) **Defender SmartScreen / EDR** — corporate boxes will flag a Node process spawning PowerShell with SendKeys as suspicious. Plan must surface this as "expect a SmartScreen prompt the first time" rather than the macOS "open System Settings → Privacy & Security" copy.

### Linux

- **Display server split is the dominant variable:**
  - **X11:** `xdotool` (mature, scriptable, the default assumption in the open-source automation world) — `xdotool key`, `xdotool type`, `xdotool getactivewindow`. Works headlessly via `Xvfb` for CI.
  - **Wayland:** **No portable equivalent.** `wtype` works on wlroots-based compositors (sway, hyprland, river); GNOME-on-Wayland refuses synthetic input by default and there is no programmatic workaround that doesn't involve enabling debug interfaces. **AT-SPI** can read but not generally inject input. **`ydotool`** uses `/dev/uinput` and works on any Wayland but requires root or a setuid daemon. Most realistic plan: support X11 first-class via xdotool, support wlroots compositors via wtype, document GNOME-on-Wayland as not-yet-supported.
- Clipboard: `xclip` / `xsel` (X11), `wl-copy` / `wl-paste` (Wayland). All four are common-enough to assume one is present, but we must probe and report if none are installed.
- Protocol handler open: `xdg-open <url>` (works on both display servers if `.desktop` files are wired correctly).
- Frontmost probe: X11 — `xdotool getactivewindow getwindowname`; Wayland — `swaymsg -t get_tree` (sway), `hyprctl activewindow` (hyprland), no GNOME-on-Wayland equivalent.
- Permission model: **none by default for X11**; for Wayland, the compositor decides. No system-wide TCC gate to grant.

### CLI lanes (defer for now per `project_no_clis_only_desktop`)

- The tmux pipeline ([tmux-launch.ts](lib/server/agent-bridge/tmux-launch.ts), [tmux.ts](lib/server/agent-bridge/tmux.ts)) is implicitly Mac/Linux-only because tmux doesn't exist on Windows. Doctrine says CLIs aren't the present focus, so this stays scoped-out for v1 of cross-platform parity.

---

## Abstraction-layer proposal

Introduce `lib/server/agent-bridge/desktop-control/` (or rename the directory itself) with this shape:

```
lib/server/agent-bridge/desktop-control/
  types.ts                       # KeystrokeSpec, ClipboardOp, FrontmostProbe, PermissionDiagnosis
  index.ts                       # `getDesktopController()` — picks impl by process.platform + capability probe
  controllers/
    macos.ts                     # current osascript/pbcopy/pbpaste/open code, lifted from app-control.ts etc.
    windows.ts                   # PowerShell/UIA/SendKeys impl. Ships a sidecar `.ps1` script.
    linux-x11.ts                 # xdotool/xclip impl
    linux-wayland.ts             # wtype/wl-copy impl, with GNOME-Wayland detection → "unsupported, here's why"
    unsupported.ts               # explicit "this platform isn't wired" controller that returns helpful errors
  permissions/
    diagnose.ts                  # `diagnoseDesktopPermissions(): { ok, gate, fixHint }` — generic surface
    macos.ts                     # TCC / Accessibility probe via `tccutil`/log query
    windows.ts                   # SmartScreen / UIPI / elevation status
    linux.ts                     # display-server detect + tool presence (xdotool/xclip/wtype/wl-copy)
```

**The five surfaces in `agent-bridge/` collapse to thin adapters over the controller interface:**
- `app-control.ts` → `controller.activate({app}); controller.setClipboard(text); controller.keystroke({key:'v', modifiers:['cmd-or-ctrl']}); controller.keystroke({key:'enter'})`. The "cmd-or-ctrl" modifier is canonicalized in the type system; controllers map it to ⌘ or ^ as appropriate.
- `app-new-session.ts` → same, with a per-app + per-platform `newSessionShortcut` lookup that already has the macOS Cmd+N declared and needs Win/Linux entries.
- `app-session-focus.ts` → unchanged (deprecated path; deep-link is the active path).
- `app-deeplink-focus.ts` → swap `open` for `controller.openProtocolUrl(url)`.
- `desktop-lease.ts` → swap the frontmost probe for `controller.getFrontmostAppName()`.
- `app-sessions.ts` → drop `claudeProjectsRoot()` / `codexSessionsRoot()`, route through the importer registry's `resolveSourceRoots`.

**Permission-model abstraction:** `launch-fallback.ts` copy strings become functions that take `PermissionDiagnosis` and return platform-specific fix hints. The user-facing copy stops mentioning "System Settings → Privacy & Security → Accessibility" by name unless we're actually on macOS.

**Capability probe + graceful degradation:** at server startup, run `diagnoseDesktopPermissions()` once. Surface its result on the cockpit's status bar. On unsupported configurations (GNOME-Wayland, no PowerShell, no xdotool/wtype installed), the controller returns a structured `controller-unavailable` error and the cockpit visibly disables the keystroke-based send/spawn paths — the JSONL reader and importer side stay fully functional, so the UI still shows sessions, just doesn't offer to keystroke into them.

---

## Ranked plan-card proposal

**New top-level lane (proposed parent ID):** `step-os-cross-platform-parity`
- Title: "Cross-platform parity — Windows + Linux dogfood"
- Status: open
- One-line rationale: codify the macOS-only desktop control surface as an explicit cross-platform abstraction, so a Win/Linux operator can dogfood the agentic loop end-to-end before we tag v1.0 OSS. Lives in OS plan `plan-1777793035871-dkq1b8` as a sibling to `step-G` (portability + Cinema/G1b) and the cleanup-proposed buckets (`step-os-software-factory-spine` etc).

**Five child buckets and their leaf cards:**

### 1. `step-xpp-controller-abstraction` — the adapter layer

| ID | Title | Rationale |
| --- | --- | --- |
| `step-xpp-controller-iface` | Define `DesktopController` types (keystroke/clipboard/frontmost/protocol-open) | Foundation; pick the canonical "cmd-or-ctrl" modifier representation now so neither platform branch leaks into call sites. |
| `step-xpp-controller-macos-extract` | Extract current osascript/pbcopy code into `controllers/macos.ts` behind the interface | Pure refactor; preserves all current behavior. Run `pnpm typecheck` + manual smoke as the only gate. |
| `step-xpp-controller-registry` | `getDesktopController()` factory: `process.platform` switch + capability probe | Returns the unsupported controller on first-run if probe fails — fail explicitly, not at the spawn-site. |
| `step-xpp-controller-rewire-call-sites` | Rewire `app-control.ts`, `app-new-session.ts`, `app-deeplink-focus.ts`, `desktop-lease.ts` onto the controller | Mechanical; no behavior change on Mac. Removes every direct `runCommand("osascript", ...)` outside `controllers/macos.ts`. |
| `step-xpp-app-sessions-via-registry` | Refactor `app-sessions.ts` to use `resolveSourceRoots` instead of `os.homedir()` literals | Closes the registry-bypass gap noted in this report. Should land before the Win controller goes near it. |

### 2. `step-xpp-windows` — Windows controller

| ID | Title | Rationale |
| --- | --- | --- |
| `step-xpp-win-controller-impl` | PowerShell-based `controllers/windows.ts` (UIA primary, SendKeys fallback) | Ship the `.ps1` sidecar as part of the package; node `spawn`s it. UIA is more robust than SendKeys but more code. |
| `step-xpp-win-shortcuts-table` | Per-app shortcut adapter for Win (Ctrl+N, Ctrl+V, etc.) | macOS adapter currently hardcodes `command`; needs platform branch. |
| `step-xpp-win-protocol-handler` | `Start-Process <url>` for protocol handlers; verify Claude Desktop registers `claude://` on Windows | If Claude Desktop on Windows doesn't register the URI scheme, the deep-link focus path is Mac-only and we fall back to the chat-picker dance. |
| `step-xpp-win-permission-diagnose` | UIPI/elevation/SmartScreen status surfacer; rewrite `launch-fallback.ts` Win copy | Replace "Accessibility permission" copy with the actual Win gate (or "no gate today, but SmartScreen may flag the spawn"). |
| `step-xpp-win-hardware-verify` | Live verify on a real Windows box: importer paths, controller spawn, permission probe | The 2026-04-27 memo's known gap; can't be ticked off until somebody runs it on actual Windows. |

### 3. `step-xpp-linux` — Linux controller (X11 first, wlroots second, GNOME-Wayland documented-only)

| ID | Title | Rationale |
| --- | --- | --- |
| `step-xpp-linux-x11-impl` | `controllers/linux-x11.ts` via xdotool + xclip | Matches the open-source automation default; least friction. |
| `step-xpp-linux-wayland-wlroots` | `controllers/linux-wayland.ts` via wtype + wl-copy (sway/hyprland) | Covers the operator demographic most likely to dogfood OSS. |
| `step-xpp-linux-gnome-wayland-doc` | Document GNOME-on-Wayland as unsupported with a clear "why and what to do" note | Better than silent breakage. Suggest `Xorg session` workaround. |
| `step-xpp-linux-display-server-detect` | Capability probe: `$WAYLAND_DISPLAY` vs `$DISPLAY`, tool-presence checks | Decides which controller to load at startup. |
| `step-xpp-linux-hardware-verify` | Live verify on a real Linux box (Mac defaults audited, Linux defaults inferred only) | Mirrors the Win verify card. |

### 4. `step-xpp-permissions-and-diagnostics` — first-run permission UX

| ID | Title | Rationale |
| --- | --- | --- |
| `step-xpp-permissions-iface` | `PermissionDiagnosis` type + `diagnoseDesktopPermissions()` cross-platform contract | Generic — `gate: 'macos-tcc-accessibility' \| 'win-uipi' \| 'linux-no-gate' \| 'wayland-input-blocked'`. |
| `step-xpp-launch-fallback-genericize` | Replace macOS-specific copy in `launch-fallback.ts` with platform-aware fix hints | Today the copy reads "Open System Settings → Privacy & Security → Accessibility" for everybody. |
| `step-xpp-cockpit-status-indicator` | Cockpit status bar: "Desktop control: ✅ ready / ⚠️ partial / ❌ unsupported" | Tells the operator before they try to spawn whether the keystroke path will work. |

### 5. `step-xpp-cli-lanes-deferred` — explicitly out-of-scope for v1

| ID | Title | Rationale |
| --- | --- | --- |
| `step-xpp-tmux-windows-deferred` | Document tmux-launch as Mac/Linux-only; track Windows alternative as future work | Matches the "Desktop apps only" doctrine — keeps the lane honest about what's not addressed. |
| `step-xpp-cli-importer-paths-verify` | Re-verify `claude-code.ts` / `codex.ts` / `opencode.ts` Win/Linux defaults on hardware (no controller dependency) | Reading sessions is independent of writing keystrokes; can land before the controller work. |

**Total proposed cards:** 1 lane + 5 buckets + 19 leaves = **25 cards**.

---

## Open questions for David

1. **Controller boundary location** — keep at `lib/server/agent-bridge/desktop-control/` or rename the existing directory to make the change visible? Refactor cost is the same; visibility differs.
2. **Windows automation primary** — UIA (more code, more robust) or SendKeys (less code, more brittle)? UIA gets us deterministic input into Claude Desktop's actual textbox without keystroke timing flakes.
3. **Linux Wayland scope for v1** — wlroots-only acceptable, or do we want a "GNOME-Wayland on Xorg session" fallback documented as a workaround in the README?
4. **Hardware verification ownership** — David runs the Win + Linux verify cards himself, or do we add them as tracked TODOs that block the OSS tag without committing them to the v1 cut?
5. **`step-xpp-app-sessions-via-registry`** is technically a Mac-affecting bug fix today (the alternate Claude root `~/Library/Application Support/Claude/claude-code-sessions` is declared in the importer but invisible to the bridge). Land it as part of this lane, or pull it into the cleanup field report's `step-os-software-factory-spine` as an immediate fix?

---

## Memo update proposed

`memory/project_cross_platform_scope.md` should add:

> **Confirmed gap (2026-05-09):** the agent-bridge's `lib/server/agent-bridge/app-sessions.ts` hardcodes Mac/Linux JSONL roots via `os.homedir()` and bypasses the importer registry's path helper. Mac happens to work; Windows is partially broken (misses the `%APPDATA%/Claude/claude-code-sessions` alternate root). Tracked as plan card `step-xpp-app-sessions-via-registry` under `step-os-cross-platform-parity`.

task_done
