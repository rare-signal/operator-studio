/**
 * pnpm tsx scripts/agent-prompt.ts [factoryId]
 *
 * Emits the agent-startup manifest as plain text. Intended to be
 * pasted into a fresh Claude / Codex / Hermes / local-model launch
 * so the worker has factory context + tools-first rules + recency
 * before its first message.
 *
 * Default factory: factory-clarifying-telegento (the JSA lane).
 */

import { renderAgentManifest } from "../lib/operator-studio/agent-manifest"
import { getPgPool } from "../lib/server/db/client"

const factoryId =
  process.argv[2]?.trim() ||
  process.env.OPERATOR_STUDIO_FACTORY?.trim() ||
  "factory-clarifying-telegento"

async function main() {
  const text = await renderAgentManifest({
    workspaceId: process.env.OPERATOR_STUDIO_WORKSPACE?.trim() || "global",
    factoryId,
  })
  process.stdout.write(text + "\n")
  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
