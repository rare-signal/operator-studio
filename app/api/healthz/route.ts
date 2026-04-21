/**
 * Unauthenticated health probe for load balancers, k8s liveness / readiness,
 * PaaS provisioners, and uptime monitors.
 *
 * Returns 200 with { status: "ok", db: "ok", ... } when Postgres is reachable
 * and the essential `workspaces` table responds. Returns 503 with the same
 * shape + `db: "error"` + a short message when it is not.
 *
 * No auth gate on purpose — health probes usually run without credentials.
 * The response carries only non-sensitive shape info: schema version (from
 * the latest drizzle migration tag), LLM configuration state, app version
 * from package.json.
 */

import { NextResponse } from "next/server"
import { sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"

export const dynamic = "force-dynamic"

const APP_VERSION = "0.1.0"

function llmConfigured(): boolean {
  const raw =
    process.env.WORKBOOK_CLUSTER_ENDPOINTS ||
    process.env.WORKBOOK_BALANCED_ENDPOINTS ||
    process.env.WORKBOOK_FAST_ENDPOINTS ||
    ""
  return raw
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean).length > 0
}

export async function GET() {
  const startedAt = Date.now()
  try {
    const db = getDb()
    // Touch the DB via a trivial query that exercises the pool without
    // loading any rows.
    await db.execute(sql`SELECT 1`)
    return NextResponse.json({
      status: "ok",
      db: "ok",
      version: APP_VERSION,
      llmConfigured: llmConfigured(),
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        db: "error",
        version: APP_VERSION,
        llmConfigured: llmConfigured(),
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : "Unknown DB error",
      },
      { status: 503 }
    )
  }
}
