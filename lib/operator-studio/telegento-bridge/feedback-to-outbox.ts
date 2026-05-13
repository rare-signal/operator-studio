/**
 * Stage a Telegento user-feedback row as an ADO addComment outbox row.
 *
 * The outbox row sits in `awaiting_approval` until David approves it
 * (cockpit pin OR in-chat "send it"). The existing `addWorkItemComment`
 * writer (lib/operator-studio/clients/ado-writer.ts) does the HTTP POST
 * to ADO once approval fires.
 *
 * v1: only `ado.addComment` against an existing requested_by_ado_id.
 * v2 will create a new ticket if requested_by_ado_id is null.
 */

import "server-only"

import { createOutbox } from "@/lib/operator-studio/outbox"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import type { TelegentoFeedbackRow } from "./feedback-fetcher"

export interface StageFeedbackResult {
  kind: "staged"
  feedbackId: string
  outboxRowId: string
  workItemId: number
  outboxRendered: string
}

export interface StageFeedbackSkipped {
  kind: "skipped"
  feedbackId: string
  reason: "no-ado-anchor"
}

export type StageFeedbackOutcome = StageFeedbackResult | StageFeedbackSkipped

export async function stageFeedbackAsAdoComment(
  row: TelegentoFeedbackRow
): Promise<StageFeedbackOutcome> {
  if (row.requestedByAdoId == null) {
    return { kind: "skipped", feedbackId: row.id, reason: "no-ado-anchor" }
  }

  const workItemId = row.requestedByAdoId
  const renderedText = renderFeedbackMarkdown(row)

  const outbox = await createOutbox({
    workspaceId: GLOBAL_WORKSPACE_ID,
    surface: "ado",
    action: "ado.addComment",
    targetId: String(workItemId),
    targetLabel: `ADO #${workItemId} — ${row.knownIssueTitle}`,
    payload: { workItemId, text: renderedText },
    renderedText,
    rationale: `User feedback relayed from Telegento page-scoped advisory modal. Feedback id ${row.id}, known-issue ${row.knownIssueId}, verdict ${row.verdict}.`,
  })

  return {
    kind: "staged",
    feedbackId: row.id,
    outboxRowId: outbox.id,
    workItemId,
    outboxRendered: renderedText,
  }
}

export function renderFeedbackMarkdown(row: TelegentoFeedbackRow): string {
  const lines: string[] = []
  lines.push(`**From:** Telegento AI Eng — relayed from user feedback`)
  lines.push(``)
  lines.push(`**Submitted by:** ${row.submittedByEmail}`)
  lines.push(`**Surface:** ${row.pageScope ?? "(unscoped)"}`)
  lines.push(`**Current version:** ${row.currentVersion ?? "(unset)"}`)
  lines.push(`**Verdict:** ${row.verdict}`)
  lines.push(``)
  lines.push(row.notes.trim() || "(no notes)")
  lines.push(``)
  lines.push(`---`)
  lines.push(``)
  lines.push(
    "This feedback was submitted via the page-scoped advisory modal on the Telegento app. Operator Studio routed it here per the known-issue's `requested_by_ado_id`. Reply on this ticket — the cycle closes when the page-scoped advisory's `feedback_target_version` is satisfied."
  )
  return lines.join("\n")
}
