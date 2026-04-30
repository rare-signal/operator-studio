import { getActivePlan } from "@/lib/operator-studio/plans"
import { getPgPool } from "@/lib/server/db/client"
async function main() {
  try {
    const plan = await getActivePlan("t", null, "test")
    console.log("OK:", plan.id, "—", plan.title, "—", plan.steps.length, "steps")
  } catch (e) {
    console.error("FAILED:", (e as Error).message)
    console.error((e as Error).stack?.split("\n").slice(0, 12).join("\n"))
  }
  await getPgPool().end()
}
main()
