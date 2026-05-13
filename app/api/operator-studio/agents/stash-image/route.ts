/**
 * POST /api/operator-studio/agents/stash-image
 *
 * Body: { dataUrl: "data:image/(png|jpe?g);base64,..." }
 *
 * Saves the decoded image to ~/Downloads/operator-stash-<ISO-ts>.<ext>
 * and returns the absolute path. The caller (Bento composer's attach
 * button) inserts the returned path into the prompt draft, so the
 * agent sees a path it can read with its image tools — no Mac
 * clipboard dance, no Universal Clipboard collision with the user's
 * iPhone clipboard.
 *
 * Admin-only. Not hot-mode gated — stashing a file is a passive write,
 * not a send-to-app action; the actual prompt-with-path send still
 * goes through the gated send/new-session pipeline.
 */

import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"

export const dynamic = "force-dynamic"

// 10 MB raw base64 → ~7.5 MB binary. The CLI worker reads images
// from filesystem paths (Bento composer inserts `[image: <path>]` into
// the prompt draft), so this stash cap is just a guard against
// runaway uploads — no relation to any clipboard / AX path.
const IMAGE_BASE64_BYTE_CAP = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }

  const dataUrl = (body as Record<string, unknown>).dataUrl
  if (typeof dataUrl !== "string") {
    return NextResponse.json({ error: "dataUrl required" }, { status: 400 })
  }

  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!m) {
    return NextResponse.json(
      { error: "dataUrl must be data:image/png or data:image/jpeg base64" },
      { status: 400 }
    )
  }
  const subtype = m[1].toLowerCase()
  const ext = subtype === "png" ? "png" : "jpg"
  const b64 = m[2].replace(/\s+/g, "")
  if (b64.length > IMAGE_BASE64_BYTE_CAP) {
    return NextResponse.json(
      { error: "Image exceeds size cap (~7.5 MB)" },
      { status: 413 }
    )
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(b64, "base64")
  } catch {
    return NextResponse.json(
      { error: "Failed to decode base64" },
      { status: 400 }
    )
  }

  // ISO-ish timestamp safe for filenames: 2026-05-09T14-32-08-123Z
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const fileName = `operator-stash-${stamp}.${ext}`
  const downloads = path.join(os.homedir(), "Downloads")
  await fs.mkdir(downloads, { recursive: true }).catch(() => null)
  const absPath = path.join(downloads, fileName)
  await fs.writeFile(absPath, bytes)

  return NextResponse.json({
    ok: true,
    path: absPath,
    name: fileName,
    sizeBytes: bytes.length,
  })
}

/**
 * GET /api/operator-studio/agents/stash-image?path=<absolute>
 *
 * Streams a previously-stashed image so the chat surface can render
 * `[image: /path]` tokens inline. Path safety: must live under
 * ~/Downloads AND match the `operator-stash-*.{png,jpg,jpeg}`
 * filename — anything else is refused. This makes it impossible to
 * use this endpoint as a generic file-system reader.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }

  const raw = req.nextUrl.searchParams.get("path")
  if (!raw) {
    return NextResponse.json({ error: "path required" }, { status: 400 })
  }
  const downloads = path.join(os.homedir(), "Downloads")
  const resolved = path.resolve(raw)
  if (!resolved.startsWith(downloads + path.sep)) {
    return NextResponse.json(
      { error: "path must be inside ~/Downloads" },
      { status: 400 }
    )
  }
  const base = path.basename(resolved)
  if (!/^operator-stash-.+\.(png|jpe?g)$/i.test(base)) {
    return NextResponse.json(
      { error: "only operator-stash-*.{png,jpg,jpeg} files are servable" },
      { status: 400 }
    )
  }
  let bytes: Buffer
  try {
    bytes = await fs.readFile(resolved)
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const ext = path.extname(resolved).toLowerCase()
  const contentType =
    ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream"
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=3600",
    },
  })
}
