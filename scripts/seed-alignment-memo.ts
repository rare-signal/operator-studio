import { upsertEntry } from "@/lib/operator-studio/knowledge"
import { getPgPool } from "@/lib/server/db/client"

const body = `# 2026-05-08 alignment pass — Software Factory package

Per \`step-executive-ops-philosophy-alignment-pass\`. Read the three doctrine
KB entries listed in the card (Codex executive planning assistant; agent tool
surface primary; recency as operational context). The package is directionally
right; the gaps are copy-and-empty-state, not architecture.

## What landed in this pass

1. **MCP README updated.** The tools table was missing \`knowledge_*\`,
   \`work_context_*\`, \`outbox_*\`, and \`agent_startup_manifest\`. Added them
   with a CALL-THIS-FIRST callout for the manifest tool, plus an explicit
   "Outbound staging (gated send)" section explaining that no tool writes to
   ADO/Teams directly — the gate is at the writer.

2. **Recency front door (sibling card #2).** \`pnpm os:context\` now opens
   with a Right Now block: factories with last-inbox / pending-outbox /
   in-motion counts, fresh inbox events, awaiting-approval outbox, stale
   in-motion cards, recently covered work, and a single recommended next move.

3. **Agent startup manifest (sibling card #3).** \`agent_startup_manifest\`
   MCP tool + \`pnpm tsx scripts/agent-prompt.ts\` CLI both render the
   one-page contract a fresh worker reads at startup. The "Tools first"
   block lists canonical actions (KB → MCP knowledge_*, plans → MCP plan_*,
   outbound → MCP outbox_stage_*, never \`az boards\` directly).

## What's still drift-y but out-of-scope for this pass

- **Operations page empty state** ("No cards in motion in this lane") could
  point at a "next move" — but the page is in user's in-flight files; deferred.
- **Executive inbox copy** uses the term "executive" without explaining the
  Marshall Berthier framing — would help legibility for new agents but is
  also in user's in-flight files; deferred.
- **Plan switcher (operator-studio-shell.tsx)** does not actually scope UI
  surfaces. Tracked under F6-full; in-flight file too.

## Recommendation

Three follow-up cards if the alignment pass is desired further:
- step-empty-state-next-move-hints — every empty list points at a tool.
- step-executive-inbox-marshall-berthier-copy — explain the role in the page header.
- step-plan-switcher-actually-scopes — wire the dropdown to factory_id.

This pass is the 80% — the package now tells its story through the MCP
README, the recency front door, and the agent startup manifest. The
empty-state drift is real but small and lives behind in-flight diffs.

## Provenance

Source card: \`step-executive-ops-philosophy-alignment-pass\`. Doctrine
sources: \`concept-codex-executive-planning-assistant\`,
\`procedure-agent-tool-surface-primary\`,
\`concept-recency-as-operational-context\`. Sibling cards in the same
review batch: \`step-factory-package-review-fixes\`,
\`step-operator-studio-recency-context-front-door\`,
\`step-agent-startup-tool-manifest\`.
`

async function main() {
  const e = await upsertEntry("global", {
    id: "kb-2026-05-08-software-factory-alignment-pass-memo",
    entryType: "report",
    stability: "stable",
    title: "Software Factory package — 2026-05-08 alignment-pass memo",
    summary:
      "Tight alignment pass over the Software Factory package per Codex review. MCP README was the largest gap (missing four tool families); recency front door + agent manifest sibling cards landed alongside; remaining drift (empty-state copy on Operations page + Executive inbox + plan switcher scoping) noted as deferred follow-ups behind in-flight diffs.",
    tags: [
      "software-factory",
      "alignment-pass",
      "memo",
      "2026-05-08",
      "operator-studio",
    ],
    bodyMarkdown: body,
    relatedEntryIds: [
      "concept-codex-executive-planning-assistant",
      "procedure-agent-tool-surface-primary",
      "concept-recency-as-operational-context",
      "kb-software-factory-doctrine",
      "pattern-outbound-pin-gate",
    ],
  })
  console.log("seeded:", e.id)
  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
