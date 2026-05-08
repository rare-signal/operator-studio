import {
  TRAILS_CONTRACT_VERSION,
  type TrailsResponse,
} from "./contracts/trails"

/**
 * Phase 1 fixture for the Trails surface. The real Sleuth runner that
 * reads recent operator messages and emits this shape via an LLM is
 * not yet built — until it is, the page hydrates from this canned
 * payload so the surface is reviewable end-to-end.
 *
 * Voice rule (load-bearing): every quote in this fixture must feel
 * like the operator. Verbatim from a real session whenever possible;
 * synthetic seeds only when filling out a multi-session shape, and
 * even then they must read rough — fragments, "kind of", "sort of",
 * lowercase i, uneven punctuation. AI-textured quotes (clean
 * em-dashes, balanced clauses, sloganey closes) are the failure mode
 * the surface is supposed to expose, so the fixture must not embody
 * them. If you read a quote here and it sounds like a press release,
 * it doesn't belong.
 *
 * The verbatim-from-this-session quotes are the strongest evidence in
 * each trail — they are placed at the bottom of the chronological
 * stack so they are the last thing the operator reads on the card.
 * Synthetic seeds are clearly labeled `// synthetic seed —` so a
 * future maintainer doesn't mistake them for ingested data.
 */
export function buildFixtureTrails(opts: {
  workspaceId: string
  now: Date
  /** Optional. When provided, the fixture's stub `linked_step_ids`
   *  ("step-stub-…") are replaced round-robin with real step ids
   *  from this list. This lets the Trails surface bridge to the
   *  user's *actual* plan without hand-editing the fixture or
   *  wiring a database. Pass empty/undefined to keep the stubs. */
  planSteps?: Array<{ id: string; title: string }>
}): TrailsResponse {
  const { workspaceId, now, planSteps } = opts

  const iso = (d: Date) => d.toISOString()
  const minusHours = (h: number) =>
    new Date(now.getTime() - h * 60 * 60 * 1000)
  const minusDays = (d: number) =>
    new Date(now.getTime() - d * 24 * 60 * 60 * 1000)

  return {
    contract_version: TRAILS_CONTRACT_VERSION,
    workspace_id: workspaceId,
    window_start: iso(minusDays(14)),
    window_end: iso(now),
    trails: [
      {
        trail_id: "trail-dogfood-drift",
        inferred_title: "Dogfood drift on Operator Studio",
        inferred_rationale:
          "Operator keeps flagging that the studio they're building is the one tool they aren't using to capture their own work, and the gap is widening as other lanes accelerate.",
        temperature: "heating",
        observed_in_source_apps: ["claude", "codex"],
        linked_step_ids: ["step-stub-trails-poc", "step-stub-plan-suggestions-contract"],
        crosses_with_trail_ids: ["trail-move-fast-vs-capture", "trail-aaa-watch-progress"],
        quotes: [
          {
            // synthetic seed — user-voice rough; placeholder until older-session ingest is wired
            source_thread_key: "01928d4f-old-lane-g-push-7c1a",
            turn_index: 12,
            role: "user",
            occurred_at: iso(minusDays(11)),
            quote:
              "kind of keep meaning to come back to capture this in operator studio but i'm always in the middle of something else",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "rollout-2026-04-29T13-04-22Z-aida",
            turn_index: 4,
            role: "user",
            occurred_at: iso(minusDays(6)),
            quote:
              "operator studio is the one tool i'm building that i'm not actually using. that's a problem.",
          },
          {
            // verbatim — this session
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 0,
            role: "user",
            occurred_at: iso(minusHours(1)),
            quote:
              "the Operator Studio stuff is kind of falling by the wayside",
          },
          {
            // verbatim — this session
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 0,
            role: "user",
            occurred_at: iso(minusHours(1)),
            quote:
              "things are falling by the wayside and the dogfooding aspect is getting lost here",
          },
        ],
      },
      {
        trail_id: "trail-task-completion-verification",
        inferred_title: "Did the agent actually finish the task",
        inferred_rationale:
          "Recurring concern that long agentic transcripts make it hard to verify whether a particular step was completed; surfaces both as a product problem and as a personal review pain.",
        temperature: "heating",
        observed_in_source_apps: ["claude"],
        linked_step_ids: ["step-stub-plan-suggestions-contract"],
        crosses_with_trail_ids: ["trail-user-voice-is-gold"],
        quotes: [
          {
            // synthetic seed — user-voice rough; placeholder until older-session ingest is wired
            source_thread_key: "01928c91-aaa-flow-review-2e71",
            turn_index: 18,
            role: "user",
            occurred_at: iso(minusDays(8)),
            quote:
              "i lose track of what actually shipped between sessions, kind of. by the time i go back the context is just gone",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928d2a-plan-page-pickup-91f4",
            turn_index: 6,
            role: "user",
            occurred_at: iso(minusDays(3)),
            quote:
              "reading these long threads to figure out what the agent actually did is the worst part of my day honestly",
          },
          {
            // verbatim — this session
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 0,
            role: "user",
            occurred_at: iso(minusHours(1)),
            quote:
              "how you go through so much data and so many turns between the user and the assistant to sort of assess and analyze whether or not, for example, a task got done",
          },
          {
            // verbatim — this session
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 0,
            role: "user",
            occurred_at: iso(minusHours(1)),
            quote:
              "That is a tough nut to crack. We're trying to crack it right now. I think we're pretty close.",
          },
        ],
      },
      {
        trail_id: "trail-user-voice-is-gold",
        inferred_title: "User voice is gold; AI rephrasings are slop",
        inferred_rationale:
          "Operator returns repeatedly to the principle that the operator's own words must be the load-bearing layer of any synthesis surface — paraphrased or AI-textured quotes are a corruption, not a convenience.",
        temperature: "heating",
        observed_in_source_apps: ["claude"],
        linked_step_ids: ["step-stub-trails-poc"],
        crosses_with_trail_ids: ["trail-task-completion-verification"],
        quotes: [
          {
            // synthetic seed — user-voice rough; older-session placeholder
            source_thread_key: "01928a02-promotion-pickier-9012",
            turn_index: 22,
            role: "user",
            occurred_at: iso(minusDays(10)),
            quote:
              "if you summarize what i said in your own words it's already wrong. i want my actual words pinned, not your paraphrase of them",
          },
          {
            // verbatim — this session, turn 10
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 10,
            role: "user",
            occurred_at: iso(minusHours(1)),
            quote: "those are sacrosanct",
          },
          {
            // verbatim — this session, current turn
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 14,
            role: "user",
            occurred_at: iso(new Date(minusHours(1).getTime() - 60_000)),
            quote:
              "Is this weighting towards like ... what the USER says? Not sure if some of these are like ... ai?",
          },
          {
            // verbatim — this session, current turn
            source_thread_key: "01928e10-trails-poc-3d9b",
            turn_index: 14,
            role: "user",
            occurred_at: iso(new Date(minusHours(1).getTime() - 60_000)),
            quote: "what the AI says is usually just workslop. The user is gold.",
          },
        ],
      },
      {
        trail_id: "trail-jsa-drop-in-platform",
        inferred_title: "JSA drop-in agent platform is the wedge",
        inferred_rationale:
          "Operator keeps redirecting general-purpose ambitions back toward a turn-key per-agent product for insurance — when scope drifts wider, this is the concern that pulls it back.",
        temperature: "steady",
        observed_in_source_apps: ["claude", "codex"],
        linked_step_ids: ["step-stub-jsa-pilot"],
        quotes: [
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928a91-jsa-call-prep-2104",
            turn_index: 7,
            role: "user",
            occurred_at: iso(minusDays(13)),
            quote:
              "JSA wants something turn-key — they don't want to learn another portal kind of",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "rollout-2026-04-27T10-12-00Z-jsa",
            turn_index: 14,
            role: "user",
            occurred_at: iso(minusDays(8)),
            quote:
              "per-agent is the actual wedge here. tiered, insurance-flavored. nothing fancy",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928c40-lane-c-scoping-77a3",
            turn_index: 22,
            role: "user",
            occurred_at: iso(minusDays(4)),
            quote:
              "we keep almost-having this and drifting back to general-purpose. need to commit",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928d8c-justin-followup-9b51",
            turn_index: 3,
            role: "user",
            occurred_at: iso(minusDays(1)),
            quote:
              "every demo has to answer one question — would JSA pay for this on monday. if no, kill it",
          },
        ],
      },
      {
        trail_id: "trail-aaa-watch-progress",
        inferred_title: "Plan + Work IS the product",
        inferred_rationale:
          "Operator returns to the principle that the watch-progress-happen surface (Plan + Work as one loop) is the load-bearing artifact, not a dashboard or admin tool.",
        temperature: "steady",
        observed_in_source_apps: ["claude"],
        linked_step_ids: ["step-stub-trails-poc"],
        crosses_with_trail_ids: ["trail-dogfood-drift"],
        quotes: [
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928b03-pulse-rename-debate-1f08",
            turn_index: 11,
            role: "user",
            occurred_at: iso(minusDays(12)),
            quote:
              "Plan + Work IS the product kind of. watch progress happen.",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928c2d-work-tab-tweaks-5e44",
            turn_index: 4,
            role: "user",
            occurred_at: iso(minusDays(7)),
            quote:
              "no dashboards. i want the work happening in front of me",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928d12-work-tab-tweaks-5e44",
            turn_index: 19,
            role: "user",
            occurred_at: iso(minusDays(3)),
            quote:
              "if i can't see what's in motion in 30 seconds it's broken",
          },
        ],
      },
      {
        trail_id: "trail-cross-platform-validation",
        inferred_title: "Win/Linux paths are still theoretical",
        inferred_rationale:
          "Cross-platform was scoped from day one but Mac is the only path actually validated; quotes show the operator flagging the gap themselves rather than waiting for it to bite.",
        temperature: "cooling",
        observed_in_source_apps: ["claude"],
        quotes: [
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928a44-importer-registry-cd71",
            turn_index: 30,
            role: "user",
            occurred_at: iso(minusDays(11)),
            quote:
              "i still haven't actually booted a windows VM. mac is fine but the win path resolver is theoretical right now",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928b5e-cross-plat-helper-08ef",
            turn_index: 8,
            role: "user",
            occurred_at: iso(minusDays(8)),
            quote:
              "we said cross-platform day one and i haven't validated the other platforms. that's a smell",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928c11-cross-plat-helper-08ef",
            turn_index: 16,
            role: "user",
            occurred_at: iso(minusDays(5)),
            quote: "linux defaults are speculation honestly",
          },
        ],
      },
      {
        trail_id: "trail-move-fast-vs-capture",
        inferred_title: "Capture later never happens",
        inferred_rationale:
          "Older preoccupation about the speed-vs-capture tradeoff; surfaces as dormant because it hasn't recurred in the recent window — but the dogfood-drift trail above is arguably the same concern in a hotter form.",
        temperature: "dormant",
        observed_in_source_apps: ["claude", "codex"],
        crosses_with_trail_ids: ["trail-dogfood-drift"],
        quotes: [
          {
            // synthetic seed — user-voice rough
            source_thread_key: "0192890a-capture-debt-9912",
            turn_index: 5,
            role: "user",
            occurred_at: iso(minusDays(13)),
            quote:
              "i keep saying i'll come back and capture later. later never happens",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "rollout-2026-04-22T17-44-12Z-capture",
            turn_index: 11,
            role: "user",
            occurred_at: iso(minusDays(12)),
            quote:
              "bad capture costs more than it saves. fake tradeoff really",
          },
          {
            // synthetic seed — user-voice rough
            source_thread_key: "01928a01-capture-strategy-c2d8",
            turn_index: 18,
            role: "user",
            occurred_at: iso(minusDays(10)),
            quote:
              "the only capture that sticks is the kind that happens while i'm doing the work, not after",
          },
        ],
      },
    ],
    considered_dropped: [
      {
        candidate_title: "Compliance constraints on AI tooling",
        reason:
          "Only two operator quotes in the window touched on this; below the 3-quote floor for emitting a trail.",
      },
      {
        candidate_title: "Story chaining over standalone clips (Lane G)",
        reason:
          "Recurring preoccupation but the recent-window quotes were largely paraphrased from a memory file rather than ingested operator turns; would have meant surfacing AI-textured quotes as if they were the operator's voice. Dropped on the voice rule.",
      },
      {
        candidate_title: "Fast vs. balanced agent model selection",
        reason:
          "Recurred across sessions but the operator's quotes were tactical (per-task) rather than thematic — would be padding to surface as a preoccupation.",
      },
    ],
  } satisfies TrailsResponse
}

/**
 * Remap a fixture trails response so its stub `linked_step_ids` point
 * at *real* plan step ids. Round-robin assignment — the fixture has
 * three distinct stub ids ("step-stub-trails-poc", "step-stub-plan-
 * suggestions-contract", "step-stub-jsa-pilot"), and we map each one
 * to the next available real step id from `planSteps`. Trails whose
 * stubs aren't covered by the plan keep their stubs (so the surface
 * stays honest about the bridge being partial).
 */
export function remapFixtureLinks(
  response: TrailsResponse,
  planSteps: Array<{ id: string; title: string }>
): TrailsResponse {
  if (planSteps.length === 0) return response

  const stubAssignment = new Map<string, string>()
  let cursor = 0
  const allStubs = new Set<string>()
  for (const t of response.trails) {
    for (const id of t.linked_step_ids ?? []) {
      if (id.startsWith("step-stub-")) allStubs.add(id)
    }
  }
  for (const stub of allStubs) {
    if (cursor >= planSteps.length) break
    stubAssignment.set(stub, planSteps[cursor].id)
    cursor += 1
  }

  return {
    ...response,
    trails: response.trails.map((t) => {
      if (!t.linked_step_ids?.length) return t
      return {
        ...t,
        linked_step_ids: t.linked_step_ids.map(
          (id) => stubAssignment.get(id) ?? id
        ),
      }
    }),
  }
}

/**
 * Build a `stepTitlesById` lookup from a list of plan steps. Trails
 * UI uses this to render `→ Step: <real title>` chips instead of opaque
 * step ids.
 */
export function buildStepTitleLookup(
  planSteps: Array<{ id: string; title: string }>
): Record<string, string> {
  const lookup: Record<string, string> = {}
  for (const s of planSteps) lookup[s.id] = s.title
  return lookup
}
