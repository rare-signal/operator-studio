/**
 * 2026-05-04 — AIDA → Telegento workbook-chat port. Sibling leg to
 * step-C-pipeline-{A..E}. Parent: step-C-pipeline-chat (open). Eleven
 * children spanning schema → migration → Gemini wrapper → tools →
 * runner → API → UI → tenant-scoping test → PR.
 *
 * Spec (already approved by David):
 *   - 3 new tables: chat_sessions, chat_messages, chat_feedback
 *   - 7 tools: search_calls, lookup_call, get_call_statistics,
 *     create_workbook, add_calls_to_workbook,
 *     create_enrichment_columns, query_workbook_data
 *   - Gemini-2.5-flash default, pro opt-in. SSE polling v1.
 *   - chat_sessions.workbook_id nullable-no-FK in 0011, FK in 0012
 *   - Branch: chat-port-from-aida off main
 *   - Tenant scoping injected at tool boundary; Gemini never sees
 *     tenant_id
 *
 * The Gemini key is already in Secrets Manager from
 * step-C-pipeline-D-gemini-source — chat work reuses that secret but
 * wires it into App Runner env (separate from insight-Lambda env).
 *
 * Idempotent.
 */

import { and, eq, max } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlans, operatorPlanSteps } from "../lib/server/db/schema"

const WORKSPACE_ID = "global"
const PARENT_ID = "step-C-pipeline-chat"
const PARENT_OF_PARENT = "step-C-pipeline"

type Card = { id: string; title: string; description: string }

const PARENT: Card = {
  id: PARENT_ID,
  title: "AIDA → Telegento workbook-chat port",
  description: [
    "Port AIDA's chat surface (Gemini tool-calling over call data +",
    "workbook CRUD) to Telegento. End shape: user opens",
    "/telegento/workbook-chat, asks plain-English questions, Gemini",
    "tool-calls into tenant_calls + the existing workbook engine.",
    "",
    "Sibling to Leg D (batch insight pipeline). Reuses Gemini key",
    "from step-C-pipeline-D-gemini-source; reuses tenant_calls",
    "schema from Leg C.",
    "",
    "Approved decisions:",
    "  - workbook_id nullable-no-FK in 0011, FK in 0012",
    "  - SSE polling 250ms for v1, LISTEN/NOTIFY for v2",
    "  - gemini-2.5-flash default, pro opt-in per session",
    "  - branch chat-port-from-aida off main",
    "",
    "Marquee feature: 'Make me a workbook of all calls last week",
    "where the agent missed the bank confirmation' → Gemini calls",
    "create_workbook + create_enrichment_columns, results stream",
    "back as the workbook fills.",
  ].join("\n"),
}

const CHILDREN: Card[] = [
  {
    id: "step-C-pipeline-chat-schema",
    title: "Schema — 0011 chat tables + Drizzle types",
    description: [
      "Write apps/v4/drizzle/0011_chat_sessions.sql (or 0012 if",
      "0011 collides). Three tables: chat_sessions, chat_messages,",
      "chat_feedback. Modeled on AIDA AIChatSession/Message/Feedback",
      "plus branching (parent_id) + cancellation (status) + public/",
      "private + feedback thumbs.",
      "",
      "Add Drizzle schema TS in apps/v4/lib/db/schema/chat.ts (or",
      "wherever sibling schemas live).",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-migration-apply",
    title: "Apply migration via in-VPC enrichment Lambda",
    description: [
      "Drop SQL into infra/enrichment-lambda/migrations/, rezip,",
      'redeploy, invoke {"action":"migrate"}. Verify with',
      '{"action":"query","sql":"SELECT count(*) FROM chat_sessions"}.',
      "",
      "Aurora is private-subnets only; no laptop path.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-gemini-key-wiring",
    title: "Wire Gemini key into App Runner env",
    description: [
      "Key already in Secrets Manager from",
      "step-C-pipeline-D-gemini-source (telegento-prod/gemini/",
      "api-key-pXrFQc). Add a Secrets Manager read to the App Runner",
      "instance role (if not already), expose as GEMINI_API_KEY env",
      "var to the Next.js process.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-gemini-wrapper",
    title: "Gemini wrapper — port google.py to apps/v4/lib/server/gemini.ts",
    description: [
      "Three exports matching AIDA's three entry points:",
      "  - geminiSimpleRequest",
      "  - geminiKeyValueRequest",
      "  - geminiFunctionCallRequest",
      "",
      "Same FunctionDeclaration / FunctionCall / FunctionCallResponse",
      "shapes. Same retry/backoff/usage tracking. Match",
      "AI_USAGE_RATES so cost telemetry stays consistent.",
      "",
      "Use @google/genai SDK or raw fetch to",
      "generativelanguage.googleapis.com (your call).",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-tools",
    title: "Tool catalog — 7 tools + tenant-scoping wrapper",
    description: [
      "apps/v4/lib/server/chat/tools/{search-calls,lookup-call,",
      "get-call-statistics,create-workbook,add-calls-to-workbook,",
      "create-enrichment-columns,query-workbook-data}.ts",
      "",
      "Each tool = FunctionDeclaration (Gemini-facing schema, NO",
      "tenant_id field) + executor (server-side TS, receives ctx",
      "with tenantId from cookie).",
      "",
      "Cuts vs AIDA: no line_of_business / vendor / campaign filters",
      "(those columns don't exist in tenant_calls). Search limit",
      "250k → 50k.",
      "",
      "Wires into existing workbook-engine.ts createWorkbook /",
      "runColumn paths; doesn't replace LM Studio enrichment path.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-system-prompt",
    title: "System prompt — port AI_CHAT_SYSTEM_PROMPT verbatim",
    description: [
      "Copy AIDA's AI_CHAT_SYSTEM_PROMPT (api/search/tasks.py L3118)",
      "verbatim, then strip Five9/Vonage refs and AIDA-specific bits,",
      "retarget to Telegento vocabulary (tenant_calls, workbook_columns,",
      "tenant_agents).",
      "",
      "Lives in apps/v4/lib/server/chat/system-prompt.ts.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-runner",
    title: "Runner — orchestration loop",
    description: [
      "apps/v4/lib/server/chat/runner.ts — runChatTurn({",
      "assistantMessageId }). Mirrors AIDA's process_chat_message",
      "(api/search/tasks.py L4740-L4988):",
      "",
      "  1. append user message → chat_messages",
      "  2. build context + tool catalog",
      "  3. call Gemini with tools",
      "  4. if function_calls: execute (with tenantId injected),",
      "     append tool message, loop",
      "  5. else: append assistant text, done",
      "",
      "max_turns=10. Cancellation poll between turns + before each",
      "tool. Persist every step → chat_messages (SSE endpoint tails).",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-http",
    title: "HTTP routes — 5 API endpoints",
    description: [
      "apps/v4/app/api/telegento/chat/",
      "  - sessions/route.ts                  POST create, GET list",
      "  - sessions/[id]/route.ts             GET, PATCH, DELETE",
      "  - sessions/[id]/messages/route.ts    POST send msg → runner",
      "  - sessions/[id]/stream/route.ts      SSE (250ms poll v1)",
      "  - messages/[id]/feedback/route.ts    POST thumbs",
      "",
      "POST /messages kicks runner async, returns immediately. Client",
      "opens SSE to watch chat_messages rows fill in.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-ui",
    title: "UI — replace placeholder + components",
    description: [
      "apps/v4/app/(app)/telegento/workbook-chat/page.tsx (replace",
      "current placeholder hero) + components/{session-list,",
      "message-stream,tool-call-card,compose-box,feedback-thumbs}.tsx.",
      "",
      "Use shadcn primitives. Tool-call cards collapsible (collapsed",
      "default; expand to see args + results). Branch / regenerate /",
      "cancel controls ported from AIDA. Feedback thumbs on assistant",
      "messages.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-tenant-test",
    title: "Tenant-scoping smoke test",
    description: [
      "Prove a forged tenant_id arg from Gemini cannot reach another",
      "tenant's data. The tool wrapper injects tenantId from cookie;",
      "Gemini never sees the field. Document the boundary in code +",
      "ship a small test or manual curl that demonstrates it.",
      "",
      "Insurance call data — non-negotiable.",
    ].join("\n"),
  },
  {
    id: "step-C-pipeline-chat-pr",
    title: "PR — open against main",
    description: [
      "Branch chat-port-from-aida → main. Link this card cluster in",
      "the PR body. Rebase if other agent's users.ts /",
      "cognito-callback changes landed first.",
    ].join("\n"),
  },
]

async function main() {
  const db = getDb()
  const planRows = await db
    .select({ id: operatorPlans.id, updatedAt: operatorPlans.updatedAt, pinned: operatorPlans.pinned })
    .from(operatorPlans)
    .where(and(eq(operatorPlans.workspaceId, WORKSPACE_ID), eq(operatorPlans.state, "active")))
  const targetPlan =
    planRows.filter((r) => r.pinned === 1).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
    planRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  if (!targetPlan) throw new Error("No active plan")
  const planId = targetPlan.id
  console.log(`Target plan: ${planId}`)

  const now = new Date()

  // Insert / refresh parent card under step-C-pipeline
  await upsertCard({ planId, parentId: PARENT_OF_PARENT, card: PARENT, status: "in-motion", now })

  // Insert / refresh children under the new parent
  for (const child of CHILDREN) {
    await upsertCard({ planId, parentId: PARENT_ID, card: child, status: "open", now })
  }

  await db.update(operatorPlans).set({ updatedAt: now }).where(eq(operatorPlans.id, planId))
  console.log("Done.")
}

async function upsertCard({
  planId,
  parentId,
  card,
  status,
  now,
}: {
  planId: string
  parentId: string
  card: Card
  status: "open" | "in-motion" | "covered"
  now: Date
}) {
  const db = getDb()
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(eq(operatorPlanSteps.id, card.id))
  if (existing.length > 0) {
    await db
      .update(operatorPlanSteps)
      .set({ title: card.title, description: card.description, parentStepId: parentId, updatedAt: now })
      .where(eq(operatorPlanSteps.id, card.id))
    console.log(`Refreshed ${card.id}`)
  } else {
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
      status,
      parentStepId: parentId,
      createdAt: now,
      updatedAt: now,
    })
    console.log(`Inserted ${card.id} [${status}] under ${parentId}`)
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
