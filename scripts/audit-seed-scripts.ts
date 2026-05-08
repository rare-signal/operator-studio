/**
 * Read-only audit of every seed-*.ts script in this folder.
 *
 * For each script, parses out the step ids it tries to insert (the
 * `id: "step-..."` literals inside its STEPS array), queries the
 * operator_plan_steps table, and reports whether each id is present.
 *
 * Output: per-script summary — fully landed / partial / fully missing —
 * plus a workspace-wide summary line.
 *
 * Use case: figure out which seed scripts have actually been run
 * historically vs which are sitting orphaned. The seed-* anti-pattern
 * (AI generates a script, asks the human to run it) leaves no audit
 * trail by itself; this rebuilds the trail from script source + DB
 * state.
 *
 * Read-only by construction — no INSERT / UPDATE / DELETE statements.
 *
 * Usage:
 *   pnpm tsx ./scripts/audit-seed-scripts.ts
 */

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { inArray } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

/** Extract every `id: "step-..."` literal from a script's source. */
function extractStepIds(source: string): string[] {
  const ids = new Set<string>()
  // Match: id: "step-foo" or id: 'step-foo'
  const re = /\bid\s*:\s*["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (m[1].startsWith("step-")) ids.add(m[1])
  }
  return [...ids].sort()
}

interface ScriptAudit {
  file: string
  declaredIds: string[]
  presentIds: string[]
  missingIds: string[]
  status: "fully-present" | "partial" | "fully-missing" | "no-step-ids"
}

async function main() {
  const files = readdirSync(SCRIPTS_DIR)
    .filter((f) => f.startsWith("seed-") && f.endsWith(".ts"))
    .sort()

  if (files.length === 0) {
    console.log("No seed-*.ts scripts found.")
    return
  }

  // Phase 1 — parse every script's declared step ids
  const audits: ScriptAudit[] = []
  const allDeclared = new Set<string>()
  for (const f of files) {
    const src = readFileSync(join(SCRIPTS_DIR, f), "utf8")
    const ids = extractStepIds(src)
    for (const id of ids) allDeclared.add(id)
    audits.push({
      file: f,
      declaredIds: ids,
      presentIds: [],
      missingIds: [],
      status: ids.length === 0 ? "no-step-ids" : "fully-missing",
    })
  }

  // Phase 2 — single batched DB query for every declared id
  const declaredArr = [...allDeclared]
  const db = getDb()
  const rows = declaredArr.length
    ? await db
        .select({
          id: operatorPlanSteps.id,
          title: operatorPlanSteps.title,
          status: operatorPlanSteps.status,
          planId: operatorPlanSteps.planId,
        })
        .from(operatorPlanSteps)
        .where(inArray(operatorPlanSteps.id, declaredArr))
    : []
  const presentSet = new Set(rows.map((r) => r.id))

  // Phase 3 — finalize per-script verdicts
  for (const a of audits) {
    if (a.declaredIds.length === 0) continue
    a.presentIds = a.declaredIds.filter((id) => presentSet.has(id))
    a.missingIds = a.declaredIds.filter((id) => !presentSet.has(id))
    if (a.presentIds.length === a.declaredIds.length) a.status = "fully-present"
    else if (a.presentIds.length === 0) a.status = "fully-missing"
    else a.status = "partial"
  }

  // Phase 4 — print
  const fmtCount = (a: ScriptAudit) =>
    `${a.presentIds.length}/${a.declaredIds.length}`
  const tag: Record<ScriptAudit["status"], string> = {
    "fully-present": "[LANDED]   ",
    partial: "[PARTIAL]  ",
    "fully-missing": "[NOT-RUN]  ",
    "no-step-ids": "[NO-IDS]   ",
  }

  console.log("\n=== Per-script audit ===\n")
  for (const a of audits) {
    console.log(`${tag[a.status]} ${a.file}  (${fmtCount(a)} ids in DB)`)
    if (a.status === "partial") {
      for (const id of a.missingIds) console.log(`              missing: ${id}`)
    }
  }

  // Phase 5 — workspace summary
  const totals = {
    "fully-present": 0,
    partial: 0,
    "fully-missing": 0,
    "no-step-ids": 0,
  }
  for (const a of audits) totals[a.status]++

  console.log("\n=== Summary ===\n")
  console.log(`  scripts inspected:     ${audits.length}`)
  console.log(`  fully landed in DB:    ${totals["fully-present"]}`)
  console.log(`  partially landed:      ${totals.partial}`)
  console.log(`  not run / orphaned:    ${totals["fully-missing"]}`)
  console.log(`  no parseable step ids: ${totals["no-step-ids"]}`)
  console.log(`  declared step ids total: ${allDeclared.size}`)
  console.log(`  declared ids present:    ${presentSet.size}`)
  console.log(`  declared ids missing:    ${allDeclared.size - presentSet.size}`)
}

main()
  .catch((e) => {
    console.error("Audit failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
