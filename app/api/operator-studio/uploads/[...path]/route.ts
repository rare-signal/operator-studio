import { stat } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { join, normalize, sep, extname } from "node:path"
import { Readable } from "node:stream"
import { ReadableStream as WebReadableStream } from "node:stream/web"

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"

export const dynamic = "force-dynamic"

const UPLOADS_ROOT = join(process.cwd(), "uploads")

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
}

/**
 * GET /api/operator-studio/uploads/[...path]
 *
 * Streams a previously-uploaded file from ./uploads/. Auth-gated so
 * private images don't leak. The path is normalized + checked to stay
 * inside UPLOADS_ROOT (no traversal).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { path } = await ctx.params
  const requested = normalize(path.join("/"))
  // Reject absolute paths and parent-directory traversal.
  if (
    requested.startsWith("..") ||
    requested.includes(`..${sep}`) ||
    requested.startsWith(sep)
  ) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 })
  }
  const abs = join(UPLOADS_ROOT, requested)
  if (!abs.startsWith(UPLOADS_ROOT + sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 })
  }
  let info
  try {
    info = await stat(abs)
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!info.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const ext = extname(abs).toLowerCase()
  const mime = MIME[ext] ?? "application/octet-stream"
  const nodeStream = createReadStream(abs)
  // Adapt Node Readable → Web ReadableStream for NextResponse.
  const webStream = Readable.toWeb(nodeStream) as WebReadableStream<Uint8Array>
  return new NextResponse(webStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=300",
    },
  })
}
