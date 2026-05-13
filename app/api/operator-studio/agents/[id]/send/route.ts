/**
 * POST /api/operator-studio/agents/:id/send
 * Body: { text?: string, keys?: string[], submit?: boolean }
 *
 *   - tmux:<name>  → tmux send-keys: literal text first, then named keys
 *   - claude:<id>  → `claude --resume <id> --print <text>` (CLI-only)
 *   - codex:<id>   → not implemented yet (codex-cli resume parity work)
 *
 * CLI-only as of 2026-05-12. The retired AX clipboard+paste path is
 * gone; legacy bindings with `surface = 'desktop'` are still serviced
 * by CLI-resume — `claude --resume` works on any JSONL session in
 * `~/.claude/projects/`, whether it was originally spawned by Desktop
 * or by CLI. So an exec can still chat into a thread that was created
 * via Claude Desktop, just without ever activating Claude.app.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { sendKeysToTmux } from "@/lib/server/agent-bridge/tmux"
import { sendToClaudeCli } from "@/lib/server/agent-bridge/claude-cli-send"
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

  if (parsed.kind === "tmux") {
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

  // CLI-only send path. Works for both:
  //   - CLI-spawned sessions (binding.surface = 'claude-cli')
  //   - Legacy Desktop-spawned sessions (binding.surface = 'desktop')
  // The session id is just a UUID for a JSONL on disk; `claude --resume`
  // doesn't care which app originally created it.
  if (parsed.kind === "claude") {
    if (keys.length > 0) {
      return NextResponse.json(
        {
          error:
            "Key sequences aren't applicable for CLI sessions — pass `text` only.",
        },
        { status: 400 }
      )
    }
    const r = await sendToClaudeCli({ sessionId: parsed.ref, text })
    if (!r.ok) {
      return NextResponse.json(
        { error: r.error, stage: r.stage, stderr: r.stderr },
        { status: r.status }
      )
    }
    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      sentTextLength: r.sentTextLength,
      sentKeys: [],
      submitted: true,
      mode: "cli-resume",
      surface: "claude-cli",
      durationMs: r.durationMs,
    })
  }

  // codex:<id> — CLI-resume parity for Codex is not yet implemented.
  // Bento can still READ the JSONL via app-sessions; for now the operator
  // sends into the live Codex via tmux or directly in the Codex CLI's
  // interactive shell. Returning 501 instead of silently routing to AX.
  return NextResponse.json(
    {
      error:
        "codex-cli resume send is not implemented yet — read-only for now.",
    },
    { status: 501 }
  )
}
