import { eq } from "drizzle-orm"
import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"

async function main() {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorPlanSteps)
    .set({
      status: "covered",
      description: [
        "COVERED 2026-05-04 — registry pattern + first callout shipped to",
        "the Telegento app (uncommitted on the chat-port-from-aida branch).",
        "",
        "Files added (apps/v4):",
        "  - lib/telegento/admin-callouts/types.ts  (Callout, CalloutQuery)",
        "  - lib/telegento/admin-callouts/unknown-agent.ts  (Drizzle query",
        "    against tenant_calls; severity ladder by % rate)",
        "  - lib/telegento/admin-callouts/index.ts  (registry + gather()",
        "    that drops nulls and sorts by severity)",
        "  - app/(app)/telegento/components/admin-callouts.tsx  (server",
        "    component renderer, three severity color schemes)",
        "",
        "Wired into:",
        "  - app/(app)/telegento/page.tsx          (literal homepage)",
        "  - app/(app)/telegento/command-center/page.tsx",
        "",
        "Renders nothing if the registry returns zero callouts (e.g. local",
        "dev DB has no tenant_calls rows). On prod Aurora today the query",
        "returns 77 / 188 (41%, action_required severity).",
        "",
        "Follow-ups to add as new callouts (next time something needs to",
        "be loud): DLQ depth > 0, enrichment Lambda error rate, transcript",
        "freshness lag, Snowflake query failures.",
      ].join("\n"),
      updatedAt: now,
    })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-admin-callouts-unknown-agent"))
  // Roll the parent admin-callouts card to in-motion (registry exists +
  // first callout shipped, but not all the operational fundamentals like
  // dismissal persistence are done).
  await db
    .update(operatorPlanSteps)
    .set({ status: "in-motion", updatedAt: now })
    .where(eq(operatorPlanSteps.id, "step-C-pipeline-admin-callouts"))
  console.log("Covered step-C-pipeline-admin-callouts-unknown-agent")
  console.log("Set step-C-pipeline-admin-callouts to in-motion")
}
main().catch((e)=>{console.error(e);process.exitCode=1}).finally(async()=>{await getPgPool().end()})
