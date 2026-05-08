import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  assertOutboundArmed,
  type OutboundIntent,
} from "@/lib/operator-studio/outbound-gate"

const execFileAsync = promisify(execFile)

const ORGANIZATION = "https://dev.azure.com/ClarifyingMarketingGroup"

/**
 * Single typed entry point for outbound writes to Azure DevOps. Every
 * outbound write (comment, state change, priority change, assignment,
 * field update, link, new work item, …) flows through this module.
 *
 * NOTHING in the codebase is allowed to shell out to `az boards
 * work-item update` directly. The gate (`assertOutboundArmed`) is
 * enforced here as the writer's first line. A direct `az boards`
 * invocation from anywhere else bypasses the gate and is considered
 * a bug per `pattern-outbound-pin-gate`.
 *
 * Future hardening: wrap with a Drizzle-backed audit-log writer that
 * persists every (intent, result) for postmortem and debugging.
 */

export interface AdoCommentIntent {
  workItemId: number
  text: string
  outboxRowId: string
  rationale: string
}

export interface AdoCommentResult {
  workItemId: number
  /** ADO `System.Rev` after the update. */
  rev: number
  /** Public URL of the work item — handy for audit / Slack-paste. */
  workItemUrl: string
}

/**
 * Post a comment on an ADO work item under the operator's identity
 * (whoever `az` is logged in as on this machine). Gated.
 */
export async function addWorkItemComment(
  intent: AdoCommentIntent
): Promise<AdoCommentResult> {
  // The gate's first line is THIS line — before any side effect.
  await assertOutboundArmed(toGateIntent(intent))

  const { stdout } = await execFileAsync(
    "az",
    [
      "boards",
      "work-item",
      "update",
      "--id",
      String(intent.workItemId),
      "--organization",
      ORGANIZATION,
      "--discussion",
      intent.text,
      "--output",
      "json",
    ],
    { timeout: 30_000 }
  )
  const parsed = JSON.parse(stdout) as {
    id?: number
    rev?: number
    fields?: Record<string, unknown>
  }
  return {
    workItemId: parsed.id ?? intent.workItemId,
    rev: typeof parsed.rev === "number" ? parsed.rev : -1,
    workItemUrl: `${ORGANIZATION}/_workitems/edit/${intent.workItemId}`,
  }
}

function toGateIntent(intent: AdoCommentIntent): OutboundIntent {
  return {
    surface: "ado",
    action: "ado.addComment",
    targetId: String(intent.workItemId),
    // Payload hash is taken over (workItemId, text). If David edits
    // the rendered text the hash changes and the prior approval no
    // longer matches.
    payload: { workItemId: intent.workItemId, text: intent.text },
    outboxRowId: intent.outboxRowId,
    rationale: intent.rationale,
  }
}
