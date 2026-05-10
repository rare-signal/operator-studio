/**
 * macOS GUI-app control: pbcopy + AppleScript activate / paste / submit.
 *
 * Used to "nudge" or "prompt" a Claude Code / Codex / Cursor / etc.
 * desktop app via a tiny AppleScript dance:
 *   1. text → pbcopy stdin (no shell escaping)
 *   2. tell application "<App>" to activate (frontmost)
 *   3. System Events: keystroke "v" using {command down}  (paste)
 *   4. System Events: keystroke return                    (submit)
 *
 * The Node process needs Accessibility permission on first call —
 * macOS will surface the TCC prompt itself.
 *
 * Safety: keystroke shortcuts are pre-defined; arbitrary keys cannot
 * be smuggled in from the request body. App name is regex-validated.
 */

import "server-only"

import { randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { isValidAppName, runCommand } from "./exec"

// 10 MB raw base64 → ~7.5 MB binary. Pastes of fresh screenshots come
// in well under this; the cap exists so a runaway agent can't stuff
// the clipboard with a multi-hundred-MB image.
const IMAGE_BASE64_BYTE_CAP = 10 * 1024 * 1024

interface DecodedImage {
  bytes: Buffer
  /** AppleScript clipboard class: «class PNGf» / «class JPEG». */
  clipboardClass: "PNGf" | "JPEG"
  ext: "png" | "jpg"
}

/** Parse a `data:image/<type>;base64,...` URL, validate type + size. */
function decodeImageDataUrl(
  dataUrl: string
): DecodedImage | { error: string; status: number } {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!m) {
    return {
      error: "Image must be a data:image/png or data:image/jpeg base64 URL",
      status: 400,
    }
  }
  const subtype = m[1].toLowerCase()
  const b64 = m[2].replace(/\s+/g, "")
  if (b64.length > IMAGE_BASE64_BYTE_CAP) {
    return { error: "Image exceeds size cap (~7.5 MB)", status: 413 }
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(b64, "base64")
  } catch {
    return { error: "Failed to decode image base64", status: 400 }
  }
  if (subtype === "png") {
    return { bytes, clipboardClass: "PNGf", ext: "png" }
  }
  return { bytes, clipboardClass: "JPEG", ext: "jpg" }
}

/** Place an image on the macOS clipboard, then ⌘V. Caller must have
 *  already activated the target app. Cleans up its temp file in finally. */
async function pasteImageToActiveApp(
  img: DecodedImage
): Promise<{ ok: true } | { error: string; status: number }> {
  const tmp = path.join(os.tmpdir(), `bento-${randomUUID()}.${img.ext}`)
  try {
    await fs.writeFile(tmp, img.bytes)
    // The ASCII «» characters in `«class PNGf»` MUST be the actual
    // guillemet code points — AppleScript won't accept << or >>. Pass
    // the script through `-e` unchanged.
    const setClip = await runCommand(
      "osascript",
      [
        "-e",
        `set the clipboard to (read POSIX file "${tmp}" as «class ${img.clipboardClass}»)`,
      ],
      { timeoutMs: 5000 }
    )
    if (setClip.code !== 0) {
      return {
        error: `image clipboard set failed: ${
          setClip.stderr.trim() || "unknown"
        }`,
        status: 500,
      }
    }
    const paste = await runCommand(
      "osascript",
      [
        "-e",
        `tell application "System Events" to keystroke "v" using {command down}`,
      ],
      { timeoutMs: 3000 }
    )
    if (paste.code !== 0) {
      return {
        error: `image paste failed: ${
          paste.stderr.trim() || "unknown"
        } — Accessibility permission needed.`,
        status: 500,
      }
    }
    // Desktop apps need a beat to ingest the image attachment before
    // the next paste/return lands; 500ms is consistent in practice.
    await new Promise((r) => setTimeout(r, 500))
    return { ok: true }
  } catch (e) {
    return {
      error: `image temp write failed: ${
        e instanceof Error ? e.message : "unknown"
      }`,
      status: 500,
    }
  } finally {
    fs.unlink(tmp).catch(() => {
      /* best effort */
    })
  }
}

const KEY_SCRIPTS: Record<string, string> = {
  escape: `tell application "System Events" to key code 53`,
  enter: `tell application "System Events" to keystroke return`,
  return: `tell application "System Events" to keystroke return`,
  "ctrl-c": `tell application "System Events" to keystroke "c" using {control down}`,
  tab: `tell application "System Events" to key code 48`,
}

/**
 * Switch the currently-frontmost Claude Code Desktop session to
 * "Bypass permissions" mode via keystroke automation.
 *
 * Per claude-code-guide research (2026-05-09): Claude Desktop has no
 * settings.json knob, no slash command, and no launch flag for this.
 * The only way is the Cmd+Shift+M permission-mode picker. The
 * `defaultMode` field in `.claude/settings.json` does NOT take effect
 * on Desktop (verified by David 2026-05-10), even though Desktop's
 * subprocess is launched with `--setting-sources=user,project,local`.
 *
 * **One-Up wrap finding (David, 2026-05-10):** the Mode picker opens
 * with item 1 (Ask permissions) selected by default, and arrow-key
 * navigation WRAPS at the boundaries. So pressing Up exactly once
 * from the freshly-opened picker lands on item 5 (Bypass permissions
 * — the last item) regardless of how many items the picker has.
 * Earlier attempts used Up x 5 + Down x 4 as a defensive ceiling-and-
 * count navigation, but the simpler one-Up-wraps approach is both
 * shorter and more robust to the picker gaining/losing modes.
 *
 * Sequence:
 *   1. Cmd+Shift+M → open picker
 *   2. delay 1.0s → let picker fully render + start accepting input
 *      (shorter delays empirically eat the first keystroke)
 *   3. Up arrow → highlight wraps to last item (Bypass permissions)
 *   4. Enter → confirm selection, picker dismisses
 *   5. Enter → press default button on any "are you sure" dialog;
 *      harmless newline on empty composer if no dialog appears
 *   6. Click into composer 80px above bottom of front window →
 *      restore focus to chat input (the picker dismiss does NOT
 *      auto-return focus to the input)
 *
 * Total cost: ~2.5s. Best-effort: returns ok:false on AppleScript
 * failure but the caller is expected to log + continue — failing the
 * whole spawn over a permission-mode toggle would be worse than
 * landing in default mode.
 *
 * Caller MUST have already activated Claude Desktop. Runs against
 * whatever chat is currently shown — if Claude lost focus, the
 * keystrokes go elsewhere.
 */
export async function setClaudeBypassPermissionMode(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const toggle = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "System Events"`,
      "-e",
      `  keystroke "m" using {command down, shift down}`,
      "-e",
      `  delay 1.0`, // wait for picker to fully render + accept input
      "-e",
      `  key code 126`, // Up — wraps from item 1 to item 5 (Bypass)
      "-e",
      `  delay 0.25`,
      "-e",
      `  keystroke return`, // confirm Bypass selection, picker dismisses
      "-e",
      `  delay 0.6`, // let any "are you sure" confirmation dialog appear
      "-e",
      `  keystroke return`, // press default button on dialog; harmless newline on empty composer if no dialog
      "-e",
      `  delay 0.5`, // let dialog close + focus state settle
      // After bypass is set, focus does NOT return to the chat input
      // — David verified this. We have to explicitly click into the
      // composer area or the subsequent sendToApp paste lands in the
      // wrong place and no JSONL gets created. Click 80px above the
      // window's bottom edge, horizontally centered — that's reliably
      // inside Claude Desktop's composer regardless of window size.
      "-e",
      `  tell process "Claude"`,
      "-e",
      `    set fp to position of front window`,
      "-e",
      `    set fs to size of front window`,
      "-e",
      `    set clickX to (item 1 of fp) + ((item 1 of fs) / 2)`,
      "-e",
      `    set clickY to (item 2 of fp) + (item 2 of fs) - 80`,
      "-e",
      `    click at {clickX, clickY}`,
      "-e",
      `  end tell`,
      "-e",
      `  delay 0.3`, // let the click register + cursor land in input
      "-e",
      `end tell`,
    ],
    { timeoutMs: 6000 }
  )
  if (toggle.code !== 0) {
    return {
      ok: false,
      error: `bypass-mode toggle failed: ${
        toggle.stderr.trim() || "unknown"
      } — Accessibility permission needed.`,
    }
  }
  // JS-side settle so picker dismiss animation + focus restore finish
  // before the caller's next action (Cmd+N or paste).
  await new Promise((r) => setTimeout(r, 500))
  return { ok: true }
}

export interface SendToAppArgs {
  app: string
  text?: string
  /** Default true when text is non-empty. Ignored when keys is provided. */
  submit?: boolean
  /** Alternative to text/submit — emit a sequence of pre-defined keys
   *  (escape / ctrl-c / tab / enter). Used for "interrupt" style nudges. */
  keys?: string[]
  /** Optional `data:image/png;base64,...` (or jpeg). When present, we
   *  paste the image first; if `text` is also given we then paste text;
   *  finally optionally submit. Tmux callers must reject this upstream
   *  — only GUI apps accept image attachments. */
  image?: string
}

export async function sendToApp(args: SendToAppArgs): Promise<
  | {
      ok: true
      sentTextLength: number
      submitted: boolean
      sentKeys: string[]
      sentImageBytes: number
    }
  | { error: string; status: number }
> {
  const app = args.app
  const text = typeof args.text === "string" ? args.text : ""
  const submit = args.submit === undefined ? true : !!args.submit
  const keys = (args.keys ?? []).filter((k) => typeof k === "string")
  const imageDataUrl = typeof args.image === "string" ? args.image : ""
  let decodedImage: DecodedImage | null = null
  if (imageDataUrl) {
    const r = decodeImageDataUrl(imageDataUrl)
    if ("error" in r) return r
    decodedImage = r
  }
  if (!isValidAppName(app)) return { error: "Invalid app name", status: 400 }
  if (text.length === 0 && !submit && keys.length === 0 && !decodedImage) {
    return {
      error: "Nothing to send (empty text, submit=false, no keys, no image)",
      status: 400,
    }
  }
  for (const k of keys) {
    if (!(k in KEY_SCRIPTS)) {
      return { error: `Unknown key: ${k}`, status: 400 }
    }
  }

  // ── Universal Clipboard foot-gun guard ──
  // pbcopy on the Mac auto-syncs to any iCloud-paired device via
  // Universal Clipboard, including David's iPhone. If David has just
  // copied a long prompt on his phone to paste into us, every Bento
  // send would silently erase it. Capture whatever's on the clipboard
  // *before* we trample it, then restore in `finally` so Universal
  // Clipboard re-syncs the original content back to the phone.
  // Text-only capture is sufficient for the iPhone case (Universal
  // Clipboard primarily syncs text); rich/image clipboards on the Mac
  // itself are still overwritten — that's a documented trade.
  const willTouchClipboard = text.length > 0 || decodedImage !== null
  let savedClipboard: string | null = null
  if (willTouchClipboard) {
    const peek = await runCommand("pbpaste", [], { timeoutMs: 1500 })
    if (peek.code === 0) savedClipboard = peek.stdout
  }

  try {
  if (text.length > 0) {
    const pb = await runCommand("pbcopy", [], { input: text, timeoutMs: 3000 })
    if (pb.code !== 0) {
      return {
        error: `pbcopy failed: ${pb.stderr.trim() || "unknown"}`,
        status: 500,
      }
    }
  }
  // `activate` alone can lose the focus race when the caller is a
  // browser tab — Chrome reclaims keyboard focus a few frames later
  // and the paste lands in the address bar. Force the System Events
  // process record frontmost too, then wait long enough for the
  // window-server focus swap to settle (~500ms in practice).
  const activate = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "${app}" to activate`,
      "-e",
      `tell application "System Events" to set frontmost of (first process whose name is "${app}") to true`,
    ],
    { timeoutMs: 3000 }
  )
  if (activate.code !== 0) {
    return {
      error: `activate failed: ${activate.stderr.trim() || "unknown"} — is "${app}" installed?`,
      status: 500,
    }
  }
  await new Promise((r) => setTimeout(r, 500))

  if (keys.length > 0) {
    for (const k of keys) {
      const r = await runCommand("osascript", ["-e", KEY_SCRIPTS[k]], {
        timeoutMs: 3000,
      })
      if (r.code !== 0) {
        return {
          error: `key ${k} failed: ${r.stderr.trim() || "unknown"} — Accessibility permission needed.`,
          status: 500,
        }
      }
      await new Promise((r) => setTimeout(r, 80))
    }
    return {
      ok: true,
      sentTextLength: 0,
      submitted: false,
      sentKeys: keys,
      sentImageBytes: 0,
    }
  }

  // Image paste must come BEFORE the text paste — pbcopy already
  // overwrote the clipboard with `text`, so we'll re-set it for image,
  // paste the image, then re-pbcopy the text and paste again. Doing
  // image first also matches how a human composes: drop the screenshot,
  // then type/paste the prompt next to it.
  if (decodedImage) {
    const r = await pasteImageToActiveApp(decodedImage)
    if ("error" in r) return r
  }

  if (text.length > 0) {
    if (decodedImage) {
      // pbcopy ran before activate; the image paste replaced the
      // clipboard. Put the text back on it before pasting.
      const pb = await runCommand("pbcopy", [], {
        input: text,
        timeoutMs: 3000,
      })
      if (pb.code !== 0) {
        return {
          error: `pbcopy (post-image) failed: ${pb.stderr.trim() || "unknown"}`,
          status: 500,
        }
      }
    }
    const paste = await runCommand(
      "osascript",
      [
        "-e",
        `tell application "System Events" to keystroke "v" using {command down}`,
      ],
      { timeoutMs: 3000 }
    )
    if (paste.code !== 0) {
      return {
        error: `paste failed: ${paste.stderr.trim() || "unknown"} — Accessibility permission needed.`,
        status: 500,
      }
    }
    await new Promise((r) => setTimeout(r, 120))
  }

  if (submit) {
    const enter = await runCommand(
      "osascript",
      ["-e", `tell application "System Events" to keystroke return`],
      { timeoutMs: 3000 }
    )
    if (enter.code !== 0) {
      return {
        error: `enter failed: ${enter.stderr.trim() || "unknown"}`,
        status: 500,
      }
    }
  }

  return {
    ok: true,
    sentTextLength: text.length,
    submitted: submit,
    sentKeys: [],
    sentImageBytes: decodedImage?.bytes.length ?? 0,
  }
  } finally {
    if (savedClipboard !== null) {
      // Best-effort restore. If this fails the user has already lost
      // the clipboard contents — don't compound by failing the send.
      await runCommand("pbcopy", [], {
        input: savedClipboard,
        timeoutMs: 1500,
      }).catch(() => null)
    }
  }
}
