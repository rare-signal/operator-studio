import { eq } from "drizzle-orm"
import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"
async function main() {
  const db = getDb()
  const now = new Date()
  await db.update(operatorPlanSteps).set({
    status: "covered",
    description: [
      "COVERED 2026-05-04 night. App now reads from Aurora cluster",
      "(telegento-prod-cluster) via RDS Proxy, not from telegento-pg.",
      "",
      "Steps actually executed:",
      "  1. Added SG ingress on Aurora Proxy SG ← App Runner",
      "     SG (sg-02f7a23a39edca324) on tcp/5432.",
      "  2. Applied 0012_chat_sessions.sql to Aurora via the",
      "     enrichment Lambda's query action.",
      "  3. Bootstrapped Aurora's telegento_schema_migrations table",
      "     with all 13 known-applied migration ids so prod-web.sh's",
      "     pnpm db:migrate is a no-op on next boot.",
      "  4. Built new DATABASE_URL from telegento-prod/db/master",
      "     (username/password) + RDS Proxy endpoint + sslmode=require,",
      "     wrote it as a new version of telegento/DATABASE_URL.",
      "  5. aws apprunner start-deployment to force the container",
      "     restart with the new env. Reached RUNNING in ~5 min.",
      "  6. Smoke: /api/health 200, /telegento 200 (redirect to login),",
      "     /telegento/command-center 200, all from Aurora.",
      "",
      "Roll-back: previous DATABASE_URL value saved at",
      "/tmp/db-url-rollback.txt on the build host. To revert: aws",
      "secretsmanager put-secret-value --secret-id telegento/DATABASE_URL",
      "--secret-string \"$(cat /tmp/db-url-rollback.txt)\" + a force",
      "deployment. ~5 min back on telegento-pg.",
      "",
      "Implication: the admin-callouts unknown-agent query will now",
      "show 77 / 188 (41%, action_required) for any logged-in user",
      "who hits /telegento or /telegento/command-center, since those",
      "pages run the Drizzle query against Aurora.",
    ].join("\n"),
    updatedAt: now,
  }).where(eq(operatorPlanSteps.id, "step-C-pipeline-E-cutover-config"))
  console.log("Covered step-C-pipeline-E-cutover-config")
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await getPgPool().end()})
