import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { and, desc, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorInboxEvents,
  operatorPlanSteps,
  operatorThreadCardBindings,
  softwareFactories,
} from "@/lib/server/db/schema"

const execFileAsync = promisify(execFile)

/**
 * L5 — keyed ADO intake bundle. One call per work-item id, assembling
 * fast context for a fresh agent from the local Operator Studio read
 * model only. No `az boards` calls and no outbound mutation.
 *
 * Bundle shape — see `step-ado-keyed-intake-cli`:
 *   - liveAdoRead: latest known fields from the most recent ADO change
 *     event payload in the inbox. No live network call.
 *   - diffSinceLastSnapshot: provenance of L2 (snapshot diff engine).
 *     L2 is not yet built — surfaces an explicit missing-data marker.
 *   - comments: last N comment events with a thin local salience tag.
 *     L4 (comment salience extractor) is not yet built — the tag here
 *     is a deliberately-thin proxy until L4 lands.
 *   - lensPosture: stakeholder lens (L3). L3 is not yet built — emits
 *     a deliberate empty marker plus the heuristic-only stakeholder
 *     posture below so callers still get a usable answer.
 *   - planStepReferences: open / in-motion plan steps mentioning the
 *     ADO id, label, or "ADO #<id>" token in title or description.
 *   - shippedCommitReferences: `git log -G "#<id>"` against each
 *     factory's `productRepoPath`. Cross-platform-safe via execFile.
 *   - boundAgent: active thread-card bindings whose plan step is in
 *     `planStepReferences`.
 *   - stakeholderPosture: heuristic flags
 *     (david_assigned, micky_touch_recency, expedite_signal,
 *      inferred_intent) computed from inbox events and assignment.
 */

export interface AdoBundleLiveRead {
  /** Latest values seen for this work item, derived from the freshest
   *  change-event payload in the inbox. */
  title: string | null
  state: string | null
  priority: number | null
  type: string | null
  assignedTo: string | null
  /** Most recent change event timestamp (ISO). */
  latestChangeAt: string | null
  latestChangeActor: string | null
  /** True when there are no inbox events at all for this work item. */
  missing: boolean
  missingReason: string | null
}

export interface AdoBundleDiff {
  available: false
  reason: string
}

export interface AdoBundleCommentRef {
  upstreamId: string | null
  occurredAt: string
  author: string | null
  excerpt: string | null
  /** Thin local proxy until L4 lands. low | medium | high.  */
  salienceTag: "low" | "medium" | "high"
  salienceReason: string
}

export interface AdoBundleLens {
  available: false
  reason: string
}

export interface AdoBundlePlanStepRef {
  planStepId: string
  planId: string
  title: string
  status: "open" | "in-motion" | "covered" | "skipped"
  matchedToken: string
}

export interface AdoBundleCommitRef {
  factoryId: string
  productRepoPath: string
  sha: string
  shortSha: string
  authorDate: string
  subject: string
}

export interface AdoBundleBoundAgent {
  agentId: string
  agentKind: string
  planStepId: string
  planStepTitle: string | null
  source: string
  updatedAt: string
}

export interface AdoBundleStakeholderPosture {
  davidAssigned: boolean | null
  /** ISO timestamp of Micky's most recent touch on this item, if any. */
  mickyTouchRecency: string | null
  expediteSignal: boolean
  expediteReason: string | null
  /** "ack_only" | "carve_card" | "needs_clarification" | "verify_done"
   *  | "unknown" — heuristic only, until L3 lands. */
  inferredIntent:
    | "ack_only"
    | "carve_card"
    | "needs_clarification"
    | "verify_done"
    | "unknown"
}

export interface AdoIntakeBundle {
  workItemId: string
  label: string
  workspaceId: string
  generatedAt: string
  /** When true, no inbox events were found for this id. The bundle is
   *  shaped but every section explains its empty state. */
  missing: boolean
  liveAdoRead: AdoBundleLiveRead
  diffSinceLastSnapshot: AdoBundleDiff
  comments: AdoBundleCommentRef[]
  lensPosture: AdoBundleLens
  planStepReferences: AdoBundlePlanStepRef[]
  shippedCommitReferences: AdoBundleCommitRef[]
  boundAgents: AdoBundleBoundAgent[]
  stakeholderPosture: AdoBundleStakeholderPosture
  /** What the operator can run next when data is thin. */
  pollHints: string[]
}

const COMMENT_LIMIT_DEFAULT = 8
const GIT_LOG_LIMIT_DEFAULT = 20
const HOUR_MS = 60 * 60 * 1000

export interface BuildAdoIntakeBundleOptions {
  commentLimit?: number
  gitLogLimit?: number
  /** Override the factories scanned for shipped-commit references.
   *  Defaults to every factory in the workspace with a productRepoPath. */
  factoryIds?: string[]
}

export async function buildAdoIntakeBundle(
  workspaceId: string,
  workItemId: string,
  opts: BuildAdoIntakeBundleOptions = {}
): Promise<AdoIntakeBundle> {
  const id = workItemId.trim()
  if (!/^\d+$/.test(id)) {
    throw new Error(`workItemId must be numeric: ${workItemId}`)
  }

  const db = getDb()
  const now = new Date()
  const commentLimit = opts.commentLimit ?? COMMENT_LIMIT_DEFAULT
  const gitLogLimit = opts.gitLogLimit ?? GIT_LOG_LIMIT_DEFAULT

  const inboxRows = await db
    .select({
      surface: operatorInboxEvents.surface,
      upstreamId: operatorInboxEvents.upstreamId,
      upstreamKind: operatorInboxEvents.upstreamKind,
      occurredAt: operatorInboxEvents.occurredAt,
      actorName: operatorInboxEvents.actorName,
      textExcerpt: operatorInboxEvents.textExcerpt,
      payloadJson: operatorInboxEvents.payloadJson,
      relatedWorkLabel: operatorInboxEvents.relatedWorkLabel,
    })
    .from(operatorInboxEvents)
    .where(
      and(
        eq(operatorInboxEvents.workspaceId, workspaceId),
        eq(operatorInboxEvents.surface, "ado"),
        eq(operatorInboxEvents.relatedWorkId, id)
      )
    )
    .orderBy(desc(operatorInboxEvents.occurredAt))
    .limit(200)

  const events = inboxRows.map((r) => ({
    surface: r.surface,
    upstreamId: r.upstreamId ?? null,
    upstreamKind: r.upstreamKind,
    occurredAt: r.occurredAt,
    actorName: r.actorName ?? null,
    textExcerpt: r.textExcerpt ?? null,
    payload: (r.payloadJson ?? {}) as Record<string, unknown>,
    relatedWorkLabel: r.relatedWorkLabel ?? null,
  }))

  const latest = events[0] ?? null
  const latestChange = events.find((e) => e.upstreamKind === "change") ?? null
  const label = latest?.relatedWorkLabel ?? `ADO #${id}`

  const liveAdoRead: AdoBundleLiveRead = events.length === 0
    ? {
        title: null,
        state: null,
        priority: null,
        type: null,
        assignedTo: null,
        latestChangeAt: null,
        latestChangeActor: null,
        missing: true,
        missingReason:
          "No inbox events for this work item. Run `pnpm tsx scripts/ado-poll.ts` (or POST /api/operator-studio/ingest/ado) to refresh.",
      }
    : {
        title: stringOrNull(latestChange?.payload.title) ?? stringOrNull(latest?.payload.title),
        state: stringOrNull(latestChange?.payload.state) ?? stringOrNull(latest?.payload.state),
        priority: numericOrNull(
          latestChange?.payload.priority ?? latest?.payload.priority ?? null
        ),
        type: stringOrNull(latestChange?.payload.type) ?? stringOrNull(latest?.payload.type),
        assignedTo:
          stringOrNull(latestChange?.payload.assignedTo) ??
          stringOrNull(latest?.payload.assignedTo),
        latestChangeAt: latestChange?.occurredAt.toISOString() ?? null,
        latestChangeActor: latestChange?.actorName ?? null,
        missing: false,
        missingReason: null,
      }

  const diffSinceLastSnapshot: AdoBundleDiff = {
    available: false,
    reason:
      "L2 (snapshot diff engine — step-ado-snapshot-diff-engine) not yet built. Bundle returns latest-known state from the inbox in liveAdoRead instead.",
  }

  const commentEvents = events
    .filter((e) => e.upstreamKind === "comment")
    .slice(0, commentLimit)

  const assignedToLatest = liveAdoRead.assignedTo
  const comments: AdoBundleCommentRef[] = commentEvents.map((e) => ({
    upstreamId: e.upstreamId,
    occurredAt: e.occurredAt.toISOString(),
    author: e.actorName,
    excerpt: e.textExcerpt ? e.textExcerpt.slice(0, 360) : null,
    ...thinSalience(e.textExcerpt, e.actorName, assignedToLatest),
  }))

  const lensPosture: AdoBundleLens = {
    available: false,
    reason:
      "L3 (stakeholder lens — step-ado-stakeholder-lens) not yet built. See stakeholderPosture for the heuristic-only fallback.",
  }

  // Plan-step references — match against any open / in-motion / covered
  // step that mentions the id. Skipping `skipped`, since those are
  // deliberately abandoned and would just add noise.
  const planRows = await db
    .select({
      id: operatorPlanSteps.id,
      planId: operatorPlanSteps.planId,
      title: operatorPlanSteps.title,
      description: operatorPlanSteps.description,
      status: operatorPlanSteps.status,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )

  const idTokens = [`#${id}`, `ADO ${id}`, `ADO #${id}`, label]
  const planStepReferences: AdoBundlePlanStepRef[] = []
  for (const p of planRows) {
    if (p.status === "skipped") continue
    const haystack = `${p.title}\n${p.description ?? ""}`
    const matched = idTokens.find((tok) => haystack.includes(tok))
    if (!matched) continue
    planStepReferences.push({
      planStepId: p.id,
      planId: p.planId,
      title: p.title,
      status: p.status as AdoBundlePlanStepRef["status"],
      matchedToken: matched,
    })
  }

  // Bound agents — only those whose step appears in planStepReferences.
  const matchedStepIds = new Set(planStepReferences.map((r) => r.planStepId))
  const boundAgents: AdoBundleBoundAgent[] = []
  if (matchedStepIds.size > 0) {
    const bindingRows = await db
      .select({
        agentId: operatorThreadCardBindings.agentId,
        agentKind: operatorThreadCardBindings.agentKind,
        planStepId: operatorThreadCardBindings.planStepId,
        source: operatorThreadCardBindings.source,
        updatedAt: operatorThreadCardBindings.updatedAt,
      })
      .from(operatorThreadCardBindings)
      .where(
        and(
          eq(operatorThreadCardBindings.workspaceId, workspaceId),
          isNull(operatorThreadCardBindings.detachedAt)
        )
      )
    const titleByStep = new Map(
      planRows.map((p) => [p.id, p.title as string | null])
    )
    for (const b of bindingRows) {
      if (!matchedStepIds.has(b.planStepId)) continue
      boundAgents.push({
        agentId: b.agentId,
        agentKind: b.agentKind,
        planStepId: b.planStepId,
        planStepTitle: titleByStep.get(b.planStepId) ?? null,
        source: b.source,
        updatedAt: b.updatedAt.toISOString(),
      })
    }
  }

  // Shipped commit references via `git log -G "#<id>"` against each
  // factory's productRepoPath. Cross-platform-safe — uses execFile, no
  // shell. We swallow per-repo failures and surface them as poll hints.
  const factoryRows = await db
    .select({
      id: softwareFactories.id,
      productRepoPath: softwareFactories.productRepoPath,
    })
    .from(softwareFactories)
    .where(eq(softwareFactories.workspaceId, workspaceId))

  const targetFactories = opts.factoryIds
    ? factoryRows.filter((f) => opts.factoryIds!.includes(f.id))
    : factoryRows

  const shippedCommitReferences: AdoBundleCommitRef[] = []
  const repoFailures: string[] = []
  for (const f of targetFactories) {
    if (!f.productRepoPath) continue
    try {
      const refs = await gitLogReferencingId(f.productRepoPath, id, gitLogLimit)
      for (const r of refs) {
        shippedCommitReferences.push({
          factoryId: f.id,
          productRepoPath: f.productRepoPath,
          sha: r.sha,
          shortSha: r.sha.slice(0, 9),
          authorDate: r.authorDate,
          subject: r.subject,
        })
      }
    } catch (e) {
      repoFailures.push(`${f.id}: ${(e as Error).message}`)
    }
  }

  // Stakeholder posture — heuristic fallback until L3 lands.
  const stakeholderPosture = inferStakeholderPosture({
    assignedTo: liveAdoRead.assignedTo,
    state: liveAdoRead.state,
    priority: liveAdoRead.priority,
    title: liveAdoRead.title,
    events,
    now,
  })

  const pollHints: string[] = []
  if (events.length === 0) {
    pollHints.push(
      "No inbox events for this work item. Refresh: `pnpm tsx scripts/ado-poll.ts`."
    )
  }
  if (commentEvents.length === 0 && events.length > 0) {
    pollHints.push(
      "No comment events seen. Comment ingestion requires ADO_PAT in .env.local; without it only state/priority changes land."
    )
  }
  if (repoFailures.length > 0) {
    pollHints.push(
      `git log skipped for ${repoFailures.length} repo(s): ${repoFailures.join("; ")}`
    )
  }

  return {
    workItemId: id,
    label,
    workspaceId,
    generatedAt: now.toISOString(),
    missing: events.length === 0,
    liveAdoRead,
    diffSinceLastSnapshot,
    comments,
    lensPosture,
    planStepReferences,
    shippedCommitReferences,
    boundAgents,
    stakeholderPosture,
    pollHints,
  }
}

interface ThinSalienceResult {
  salienceTag: AdoBundleCommentRef["salienceTag"]
  salienceReason: string
}

const HIGH_PHRASES = ["asap", "urgent", "expedite", "blocker", "blocked", "p0", "p1", "production down"]
const MED_PHRASES = ["please", "need to", "needs to", "?", "concern", "issue", "doesn't work", "not working", "broken"]

function thinSalience(
  excerpt: string | null,
  author: string | null,
  assignedTo: string | null
): ThinSalienceResult {
  const text = (excerpt ?? "").toLowerCase()
  for (const p of HIGH_PHRASES) {
    if (text.includes(p)) {
      return { salienceTag: "high", salienceReason: `phrase '${p}'` }
    }
  }
  // Comments by someone other than the assignee usually warrant
  // attention — that's where stakeholders push back.
  if (author && assignedTo && !nameLooksLike(author, assignedTo)) {
    return {
      salienceTag: "medium",
      salienceReason: `commenter '${author}' is not the assignee '${assignedTo}'`,
    }
  }
  for (const p of MED_PHRASES) {
    if (text.includes(p)) {
      return { salienceTag: "medium", salienceReason: `phrase '${p}'` }
    }
  }
  return { salienceTag: "low", salienceReason: "no salience phrases detected" }
}

interface InferPostureInput {
  assignedTo: string | null
  state: string | null
  priority: number | null
  title: string | null
  events: Array<{
    upstreamKind: string
    occurredAt: Date
    actorName: string | null
    textExcerpt: string | null
  }>
  now: Date
}

function inferStakeholderPosture(
  input: InferPostureInput
): AdoBundleStakeholderPosture {
  const davidAssigned =
    input.assignedTo == null ? null : nameLooksLike(input.assignedTo, "David")

  let mickyTouchRecency: string | null = null
  for (const e of input.events) {
    if (e.actorName && nameLooksLike(e.actorName, "Micky")) {
      mickyTouchRecency = e.occurredAt.toISOString()
      break // events are newest-first
    }
  }

  const text = `${input.title ?? ""}\n${input.events
    .map((e) => e.textExcerpt ?? "")
    .join("\n")}`.toLowerCase()
  let expediteSignal = false
  let expediteReason: string | null = null
  for (const p of HIGH_PHRASES) {
    if (text.includes(p)) {
      expediteSignal = true
      expediteReason = `phrase '${p}'`
      break
    }
  }
  if (
    !expediteSignal &&
    input.priority !== null &&
    input.priority > 0 &&
    input.priority <= 1
  ) {
    expediteSignal = true
    expediteReason = `P${input.priority}`
  }

  const stateLower = (input.state ?? "").toLowerCase()
  const isClosed =
    stateLower === "closed" || stateLower === "done" || stateLower === "resolved"
  const lastEvent = input.events[0] ?? null
  const ageHours = lastEvent
    ? (input.now.getTime() - lastEvent.occurredAt.getTime()) / HOUR_MS
    : null

  let inferredIntent: AdoBundleStakeholderPosture["inferredIntent"] = "unknown"
  if (isClosed) {
    inferredIntent = "verify_done"
  } else if (text.includes("?") || text.includes("clarify") || text.includes("unclear")) {
    inferredIntent = "needs_clarification"
  } else if (ageHours !== null && ageHours < 6 && stateLower === "active") {
    inferredIntent = "ack_only"
  } else if (lastEvent && stateLower !== "") {
    inferredIntent = "carve_card"
  }

  return {
    davidAssigned,
    mickyTouchRecency,
    expediteSignal,
    expediteReason,
    inferredIntent,
  }
}

interface RawCommit {
  sha: string
  authorDate: string
  subject: string
}

async function gitLogReferencingId(
  repoPath: string,
  id: string,
  limit: number
): Promise<RawCommit[]> {
  // Use `--all` so we catch commits on any branch, and `-G` so we
  // match additions/deletions referencing the id rather than just
  // commit messages. Format: <sha>\t<authorDate>\t<subject>.
  const args = [
    "-C",
    repoPath,
    "log",
    "--all",
    "-G",
    `#${id}`,
    `--max-count=${limit}`,
    "--pretty=format:%H%x09%aI%x09%s",
  ]
  const { stdout } = await execFileAsync("git", args, {
    maxBuffer: 4 * 1024 * 1024,
  })
  const out: RawCommit[] = []
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue
    const [sha, authorDate, ...rest] = line.split("\t")
    if (!sha || !authorDate) continue
    out.push({ sha, authorDate, subject: rest.join("\t") })
  }
  return out
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v
  if (typeof v === "number") return String(v)
  return null
}

function numericOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function nameLooksLike(actor: string, needle: string): boolean {
  return actor.toLowerCase().includes(needle.toLowerCase())
}

export function renderAdoIntakeBundle(bundle: AdoIntakeBundle): string {
  const lines: string[] = []
  lines.push(`# ${bundle.label} — keyed intake bundle`)
  lines.push(
    `workspace=${bundle.workspaceId}  generated=${bundle.generatedAt}${bundle.missing ? "  ⚠ missing-data" : ""}`
  )
  lines.push("")

  lines.push("## Live ADO read (latest known from inbox)")
  if (bundle.liveAdoRead.missing) {
    lines.push(`  (none) — ${bundle.liveAdoRead.missingReason}`)
  } else {
    const meta = [
      bundle.liveAdoRead.state ? `state=${bundle.liveAdoRead.state}` : null,
      bundle.liveAdoRead.priority !== null ? `P${bundle.liveAdoRead.priority}` : null,
      bundle.liveAdoRead.type,
      bundle.liveAdoRead.assignedTo ? `assigned=${bundle.liveAdoRead.assignedTo}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
    lines.push(`  ${bundle.liveAdoRead.title ?? "(no title)"}`)
    if (meta) lines.push(`    ${meta}`)
    if (bundle.liveAdoRead.latestChangeAt) {
      lines.push(
        `    last change ${bundle.liveAdoRead.latestChangeAt} by ${bundle.liveAdoRead.latestChangeActor ?? "?"}`
      )
    }
  }
  lines.push("")

  lines.push("## Diff since last snapshot (L2)")
  lines.push(`  (unavailable) — ${bundle.diffSinceLastSnapshot.reason}`)
  lines.push("")

  lines.push(`## Comments (${bundle.comments.length})`)
  if (bundle.comments.length === 0) {
    lines.push("  (none)")
  } else {
    for (const c of bundle.comments) {
      lines.push(
        `  [${c.salienceTag}] ${c.occurredAt} by ${c.author ?? "?"} — ${c.salienceReason}`
      )
      if (c.excerpt) lines.push(`    ${c.excerpt}`)
    }
  }
  lines.push("")

  lines.push("## Lens posture (L3)")
  lines.push(`  (unavailable) — ${bundle.lensPosture.reason}`)
  lines.push("")

  lines.push(`## Plan-step references (${bundle.planStepReferences.length})`)
  if (bundle.planStepReferences.length === 0) {
    lines.push("  (none — no open/in-motion plan card mentions this id)")
  } else {
    for (const r of bundle.planStepReferences) {
      lines.push(
        `  [${r.status}] \`${r.planStepId}\` ${r.title} (matched '${r.matchedToken}')`
      )
    }
  }
  lines.push("")

  lines.push(
    `## Shipped commit references (${bundle.shippedCommitReferences.length})`
  )
  if (bundle.shippedCommitReferences.length === 0) {
    lines.push("  (none across registered factory repos)")
  } else {
    for (const c of bundle.shippedCommitReferences) {
      lines.push(
        `  ${c.shortSha} ${c.authorDate} ${c.subject} — ${c.factoryId}`
      )
    }
  }
  lines.push("")

  lines.push(`## Bound agents (${bundle.boundAgents.length})`)
  if (bundle.boundAgents.length === 0) {
    lines.push("  (none — no active worker bound to a referencing card)")
  } else {
    for (const a of bundle.boundAgents) {
      lines.push(
        `  ${a.agentKind} \`${a.agentId}\` → step \`${a.planStepId}\` (${a.planStepTitle ?? "?"}) · ${a.source}`
      )
    }
  }
  lines.push("")

  lines.push("## Stakeholder posture (heuristic — L3 fallback)")
  const sp = bundle.stakeholderPosture
  lines.push(
    `  david_assigned=${sp.davidAssigned ?? "unknown"} · micky_touch_recency=${sp.mickyTouchRecency ?? "(none)"} · expedite_signal=${sp.expediteSignal}${sp.expediteReason ? ` (${sp.expediteReason})` : ""} · inferred_intent=${sp.inferredIntent}`
  )

  if (bundle.pollHints.length > 0) {
    lines.push("")
    lines.push("## Poll hints")
    for (const h of bundle.pollHints) lines.push(`  - ${h}`)
  }

  return lines.join("\n")
}
