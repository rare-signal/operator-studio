/**
 * One-off: apply drizzle/0033_work_lanes.sql directly, then backfill a
 * "Default lane" per workspace from the existing operator_cockpit_execs
 * rows so existing workspaces have somewhere to land.
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { getPgPool } from "@/lib/server/db/client"

async function main() {
  const sql = readFileSync(
    path.join(process.cwd(), "drizzle", "0033_work_lanes.sql"),
    "utf8"
  )
  const pool = getPgPool()
  console.log("Applying 0033_work_lanes.sql…")
  await pool.query(sql)

  console.log("Backfilling Default lane per workspace…")
  const now = new Date().toISOString()
  // For every workspace, ensure there's at least one active lane. If
  // the workspace has a cockpit-exec row, that becomes the lane's exec.
  const res = await pool.query<{
    workspace_id: string
    agent_id: string | null
    agent_kind: string | null
  }>(`
    SELECT w.id AS workspace_id,
           ce.agent_id,
           ce.agent_kind
      FROM workspaces w
      LEFT JOIN operator_cockpit_execs ce ON ce.workspace_id = w.id
      LEFT JOIN operator_work_lanes wl
        ON wl.workspace_id = w.id AND wl.archived_at IS NULL
     WHERE wl.id IS NULL;
  `)
  for (const row of res.rows) {
    const id = `lane_default_${row.workspace_id}`
    await pool.query(
      `INSERT INTO operator_work_lanes
         (id, workspace_id, name, description, exec_agent_id, exec_agent_kind, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        row.workspace_id,
        "Default lane",
        "Auto-created from the workspace's existing cockpit exec.",
        row.agent_id,
        row.agent_kind,
        now,
      ]
    )
    console.log(
      `  · ${row.workspace_id} → ${id}${
        row.agent_id ? ` (exec ${row.agent_id})` : " (no exec yet)"
      }`
    )
  }
  console.log("✅ Applied.")
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
