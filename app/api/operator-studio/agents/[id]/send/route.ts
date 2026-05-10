/**
 * POST /api/operator-studio/agents/:id/send
 * Body: { text?: string, keys?: string[], submit?: boolean, app?: string }
 *
 *   - tmux:<name>  → tmux send-keys: literal text first, then named keys
 *   - claude:<id>  → pbcopy + osascript activate "Claude" + paste + return
 *   - codex:<id>   → same as claude, defaults app to "Codex"
 *
 * For app-kind agents, `app` overrides the default app name (e.g.
 * "Cursor", "Antigravity") so the same path can drive any GUI agent.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { sendKeysToTmux } from "@/lib/server/agent-bridge/tmux"
import { sendToApp } from "@/lib/server/agent-bridge/app-control"
import { focusByDeepLink } from "@/lib/server/agent-bridge/app-deeplink-focus"
import { focusDesktopSession } from "@/lib/server/agent-bridge/app-session-focus"
import { isValidJsonlId, isValidSessionName } from "@/lib/server/agent-bridge/exec"
import { isHotModeArmed } from "@/lib/server/agent-bridge/hot-mode"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!isHotModeArmed()) {
    return NextResponse.json(
      {
        error:
          "Hot mode is not armed. Lift the cover in Bento and enter the PIN to arm before sending.",
      },
      { status: 403 }
    )
  }
  const { id } = await ctx.params
  const parsed = parseAgentId(decodeURIComponent(id))
  if (parsed.kind === null) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  const text = typeof body.text === "string" ? body.text : ""
  const keys: string[] = Array.isArray(body.keys)
    ? body.keys.filter((k: unknown): k is string => typeof k === "string")
    : []
  const submit = body.submit === undefined ? undefined : !!body.submit
  const image = typeof body.image === "string" ? body.image : ""

  if (parsed.kind === "tmux") {
    if (image) {
      return NextResponse.json(
        { error: "tmux panes don't accept image attachments." },
        { status: 400 }
      )
    }
    if (!isValidSessionName(parsed.ref)) {
      return NextResponse.json(
        { error: "Invalid tmux session name" },
        { status: 400 }
      )
    }
    const r = await sendKeysToTmux({ name: parsed.ref, text, keys, submit })
    if ("error" in r) {
      return NextResponse.json({ error: r.error }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      sentTextLength: r.sentTextLength,
      sentKeys: r.sentKeys,
      submitted: r.sentKeys.includes("Enter"),
    })
  }

  if (!isValidJsonlId(parsed.ref)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 })
  }
  // GUI apps: default the app name from the agent kind but accept an
  // override so callers can target Cursor / Antigravity / Kiro / etc.
  const defaultApp = parsed.kind === "claude" ? "Claude" : "Codex"
  const appName = typeof body.app === "string" ? body.app : defaultApp

  // ── Session focus pre-flight ──────────────────────────────────────
  // Primary path: deep-link via Claude Desktop's claude:// URL handler.
  // `claude://claude.ai/resume?session=<uuid>` calls the main process's
  // LocalSessionManager.importCliSession (idempotent — already-imported
  // sessions are unarchived and reused) and dispatches navigate to the
  // session route. This brings the *specific* CLI session to the front
  // in Claude Desktop's single-window UI before paste fires, fixing the
  // 50/50 split routing bug where every paste landed in whichever chat
  // happened to be frontmost.
  //
  // Opt-out: OPERATOR_STUDIO_DEEPLINK_FOCUS_DISABLED=1 falls back to the
  // original "paste into whatever window is frontmost" behavior.
  //
  // Legacy chat-picker path (focusDesktopSession): kept behind
  // OPERATOR_STUDIO_ENABLE_SESSION_FOCUS=1 for completeness, but the
  // deep-link path is strictly better — works without guessing
  // keyboard shortcuts and is the same mechanism Claude Desktop uses
  // for its own internal navigation.
  if (parsed.kind === "claude" && body.focusSession !== false) {
    const f = await focusByDeepLink({
      kind: parsed.kind,
      sessionId: parsed.ref,
    })
    if ("error" in f) {
      return NextResponse.json({ error: f.error }, { status: f.status })
    }
  } else if (
    process.env.OPERATOR_STUDIO_ENABLE_SESSION_FOCUS?.trim() === "1" &&
    typeof body.sessionTitle === "string" &&
    body.sessionTitle.trim().length > 0 &&
    body.focusSession !== false
  ) {
    const f = await focusDesktopSession({
      app: appName,
      sessionTitle: body.sessionTitle.trim(),
    })
    if ("error" in f) {
      return NextResponse.json({ error: f.error }, { status: f.status })
    }
  }

  // ── Interrupt mode ────────────────────────────────────────────────
  // Default = "queue" (current behavior — paste sits in the input;
  // Claude reads it on its next turn). "interrupt" sends Esc first to
  // cancel the in-flight response so the new prompt fires immediately.
  // Both modes go through the existing sendToApp pipeline.
  const mode: "queue" | "interrupt" =
    body.mode === "interrupt" ? "interrupt" : "queue"
  if (mode === "interrupt") {
    const stop = await sendToApp({ app: appName, keys: ["escape"] })
    if ("error" in stop) {
      return NextResponse.json({ error: `interrupt failed: ${stop.error}` }, { status: stop.status })
    }
    // Tiny settle so the in-flight stream flushes before we paste.
    await new Promise((r) => setTimeout(r, 250))
  }

  const r = await sendToApp({ app: appName, text, keys, submit, image })
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: r.status })
  }
  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    sentTextLength: r.sentTextLength,
    sentKeys: r.sentKeys,
    submitted: r.submitted,
    sentImageBytes: r.sentImageBytes,
    mode,
  })
}
