/**
 * Seed / refresh today's Operator Studio agentic-intelligence-loop plan cluster.
 *
 * This captures David's 2026-05-07 morning directive as durable Operator
 * Studio cards: Claude context pack, signal intake UI/schema, David-only
 * review buckets, multi-agent command center, preview deployment loop, and
 * transcript promotion. Telegento is the first lane proving the pattern.
 * Idempotent: stable ids are updated in place.
 */

import { and, eq, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"
const ROOT_ID = "step-telegento-agentic-loop-today"

type Card = {
  id: string
  title: string
  description: string
  status?: "open" | "in-motion" | "covered" | "skipped"
  parentStepId?: string | null
}

const ROOT_CARD: Card = {
  id: ROOT_ID,
  title: "Today: Operator Studio agentic loop — Telegento first lane",
  status: "in-motion",
  description: [
    "North star for today: Operator Studio becomes David's reusable sidecar",
    "control surface for many lanes. Telegento is the first concrete lane:",
    "ADO + Teams + product context become approved agent work, internal",
    "previews, and product-visible narrative updates.",
    "",
    "The loop:",
    "1. Read upstream lane signals, initially Azure DevOps and Teams.",
    "2. Let an agent infer the floor situation and recommended work.",
    "3. Stage all raw agent output in David-only review buckets.",
    "4. David promotes, edits, or rejects before anything becomes team-visible.",
    "5. Claude/Codex agents execute work through the software factory.",
    "6. Internal preview URLs attach back to the ADO/review trail.",
    "7. Product pages can gain approved known-issue / change provenance.",
    "",
    "Compute posture:",
    "- Codex is the scarce planning/sidecar dialogue layer.",
    "- Claude is abundant implementation compute, but starts fresh; give",
    "  it explicit context packs and plan card targets.",
    "- Claude should read existing repo artifacts and update Operator Studio",
    "  cards, not operate only from chat.",
    "",
    "Important boundary: raw internal executive commentary stays internal.",
    "External/user-facing tone should be calm, supportive, momentum-building,",
    "and specific without leaking private context.",
  ].join("\n"),
}

const CLAUDE_UI_PROMPT = [
  "You are Claude working in Operator Studio as a UI/schema refinement agent.",
  "",
  "Context:",
  "- Operator Studio now has a Work-tab Import bucket backed by Azure DevOps and Telegento Teams signals.",
  "- Telegento is one lane inside Operator Studio, not Operator Studio itself.",
  "- David needs it to be visually obvious what came from Teams versus Azure DevOps.",
  "- The UI should help an agent infer the floor situation without forcing David to parse raw upstream noise.",
  "- Raw agent conclusions are advisory only. Anything publishable or externally visible must pass through David's approval surface.",
  "",
  "Primary task:",
  "Create a clearer version of the signal intake UI and its data schema.",
  "",
  "Desired output:",
  "1. A proposed data model for normalized upstream signals, including source, channel/project, temporal freshness, actor, confidence, urgency, suggested action, provenance refs, and review state.",
  "2. A UI sketch/implementation plan that clearly separates Teams and ADO while still supporting a unified temporal view.",
  "3. A human-readable detail view that explains what we know, why it matters, what action is suggested, and what upstream evidence supports it.",
  "4. A David-only review state machine: raw, needs-review, promoted, edited, rejected, snoozed, imported.",
  "5. Concrete acceptance criteria and minimal code changes needed to land the pass.",
  "",
  "Tone and safety:",
  "- Keep external/team-facing copy calm, supportive, and momentum-oriented.",
  "- Do not include private executive commentary in user-facing copy.",
  "- Do not overbuild permissions in prompt text; assume the host app controls execution permissions.",
].join("\n")

const CHILDREN: Card[] = [
  {
    id: "step-telegento-agentic-loop-claude-context-pack",
    title: "Claude autonomous developer context pack",
    status: "in-motion",
    parentStepId: ROOT_ID,
    description: [
      "Create the reusable onboarding brief for fresh Claude contexts so",
      "they can act as autonomous implementation agents on David's behalf.",
      "Claude should not need to infer the entire operating model from a",
      "single prompt.",
      "",
      "Context pack must include:",
      "- Operator Studio is the reusable control plane; Telegento is one lane.",
      "- Codex is scarce planning/sidecar compute; Claude is abundant",
      "  implementation compute.",
      "- Read the active Operator Studio plan before implementing.",
      "- Inspect existing repo artifacts and AGENTS.md before inventing",
      "  new structures.",
      "- Update relevant plan cards or child cards when implementation",
      "  changes scope, sequence, or discovered facts.",
      "- Verify with typecheck/tests/browser as appropriate.",
      "- Keep raw agent conclusions advisory and David-only until reviewed.",
      "",
      "Deliverable:",
      "A Claude kickoff prompt/template plus any repo docs needed so future",
      "Claude agents can pick up a card, implement, verify, and report back",
      "inside Operator Studio.",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-claude-signal-ui",
    title: "Claude handoff: signal UI + floor-situation schema",
    status: "in-motion",
    parentStepId: ROOT_ID,
    description: [
      "Spin off Claude Compute on the first refinement pass: make the",
      "Import bucket clearer about Teams vs Azure DevOps, and design the",
      "agent-readable schema for inferring what seems to be happening on",
      "the floor.",
      "",
      "Acceptance:",
      "- ADO and Teams are visually distinguishable at a glance.",
      "- The unified list still supports temporal browsing.",
      "- Detail views show source, time, actor, confidence/priority,",
      "  provenance, suggested action, and review state.",
      "- The schema can support agent-authored situation summaries later.",
      "",
      "Claude prompt:",
      "```text",
      CLAUDE_UI_PROMPT,
      "```",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-review-buckets",
    title: "David-only review buckets for agent conclusions",
    parentStepId: ROOT_ID,
    description: [
      "Create the interstitial layer between agent inference and anything",
      "team-visible. Agents may discover possible issues, product narrative,",
      "commit provenance, or suggested work, but those claims must sit in",
      "a David-only review bucket until promoted, edited, or rejected.",
      "",
      "Acceptance:",
      "- Raw agent output is visible only to David Clark at clarifying.com.",
      "- Review items can be promoted, edited, rejected, snoozed, or linked",
      "  to an Operator Studio card.",
      "- The model supports provenance links to page, commit, ADO item,",
      "  Teams message/channel, and agent run.",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-known-issues",
    title: "Known-issue / product narrative provenance loop",
    parentStepId: ROOT_ID,
    description: [
      "Connect the known issue system to product-page provenance. As agents",
      "inspect Git history, commits, pages, and current app behavior, they",
      "can propose narrative snippets about what changed or what is known.",
      "Those snippets go into the David-only bucket before becoming visible",
      "to the broader group.",
      "",
      "Acceptance:",
      "- Product page context can link to approved known-issue articles.",
      "- Proposed narratives include source evidence and confidence.",
      "- Published copy tells the internal deployment story without leaking",
      "  raw internal commentary.",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-bento-command-center",
    title: "Bento command center for many agents",
    parentStepId: ROOT_ID,
    description: [
      "Build the compact tiled interface for watching and nudging many",
      "agent sessions at once. This builds on the beta remote system for",
      "tapping agents through tmux and turns it into a software-factory",
      "control surface.",
      "",
      "Acceptance:",
      "- Many agent panes can be monitored at once.",
      "- David can tap/nudge/prompt a given agent quickly.",
      "- Sessions connect back to Operator Studio cards and software-factory",
      "  work units.",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-preview-review",
    title: "Preview deployment + ADO review loop",
    parentStepId: ROOT_ID,
    description: [
      "Close the loop from imported work to internal preview URL. Agents",
      "should be able to work a task, produce a test deployment, attach the",
      "preview to the ADO card or Operator Studio card, and let reviewers",
      "say yes/no before release.",
      "",
      "Acceptance:",
      "- Imported ADO work can be associated with agent runs.",
      "- A preview URL can be captured for internal review.",
      "- Review result attaches back to the source work item.",
      "- Nothing publishes to production without the normal app-level gate.",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-daily-intake",
    title: "Daily ADO + Teams intake after foundation lands",
    parentStepId: ROOT_ID,
    description: [
      "Once the control surfaces are in place, turn attention back to the",
      "actual upstream work: Telegento Teams channels and Azure DevOps",
      "assigned items. Run a morning/regular routine that reads upstream,",
      "compares downstream Operator Studio state, and proposes the next",
      "stack of work for David to approve.",
      "",
      "Acceptance:",
      "- Morning brief lists fresh ADO + Teams signals by time/source.",
      "- Agent proposes prioritized work with reasoning and source evidence.",
      "- David can import approved items into plan cards.",
    ].join("\n"),
  },
  {
    id: "step-telegento-agentic-loop-promote-this-thread",
    title: "David pass: promote salient nuggets from this planning thread",
    parentStepId: ROOT_ID,
    description: [
      "David should return to this Codex planning thread in Operator Studio",
      "and promote/highlight the most salient turns. The thread contains",
      "the higher-order operating model for the agentic intelligence loop,",
      "Claude/Codex compute split, David-only review boundary, and product",
      "provenance vision.",
      "",
      "Acceptance:",
      "- Important passages are promoted or attached as evidence to the",
      "  relevant plan cards.",
      "- Salient work packages are extracted instead of left buried in chat.",
      "- Future Claude agents can find the promoted context through the plan",
      "  or Wayseer without needing this raw chat pasted in full.",
    ].join("\n"),
  },
]

async function main() {
  const db = getDb()
  const planRows = await db
    .select({
      id: operatorPlans.id,
      title: operatorPlans.title,
      updatedAt: operatorPlans.updatedAt,
      pinned: operatorPlans.pinned,
    })
    .from(operatorPlans)
    .where(and(eq(operatorPlans.workspaceId, WORKSPACE_ID), eq(operatorPlans.state, "active")))

  const targetPlan =
    planRows
      .filter((r) => r.pinned === 1)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
    planRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]

  if (!targetPlan) throw new Error("No active Operator Studio plan found")

  const now = new Date()
  await upsertCard({ planId: targetPlan.id, card: ROOT_CARD, now })
  for (const child of CHILDREN) {
    await upsertCard({ planId: targetPlan.id, card: child, now })
  }

  await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, targetPlan.id))
  console.log(`Seeded ${1 + CHILDREN.length} cards into ${targetPlan.title} (${targetPlan.id})`)
}

async function upsertCard({
  planId,
  card,
  now,
}: {
  planId: string
  card: Card
  now: Date
}) {
  const db = getDb()
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.id, card.id),
        eq(operatorPlanSteps.planId, planId),
        eq(operatorPlanSteps.workspaceId, WORKSPACE_ID)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    await db
      .update(operatorPlanSteps)
      .set({
        title: card.title,
        description: card.description,
        status: card.status,
        parentStepId: card.parentStepId ?? null,
        updatedAt: now,
      })
      .where(eq(operatorPlanSteps.id, card.id))
    console.log(`Refreshed ${card.id}`)
    return
  }

  const baseOrder =
    ((
      await db
        .select({ max: max(operatorPlanSteps.stepOrder) })
        .from(operatorPlanSteps)
        .where(eq(operatorPlanSteps.planId, planId))
    )[0]?.max ?? -1) + 1

  await db.insert(operatorPlanSteps).values({
    id: card.id,
    planId,
    workspaceId: WORKSPACE_ID,
    title: card.title,
    description: card.description,
    stepOrder: baseOrder,
    status: card.status ?? "open",
    parentStepId: card.parentStepId ?? null,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`Inserted ${card.id}`)
}

main()
  .catch((error) => {
    console.error("Seed failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
