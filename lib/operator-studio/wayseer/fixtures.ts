import {
  ROLLUP_CONTRACT_VERSION,
  type ThreadRollup,
} from "./contracts/thread-rollup"

/**
 * Phase 1 fixture rollup. The Phase 2 planner→writer pipeline will
 * replace this end-to-end; until then the POST endpoint hydrates the
 * `result_payload` of the latest enrichment row with this canned
 * payload so the UI surface is reviewable end-to-end.
 *
 * The shape and tone deliberately mirror the AIDA Observatory
 * screenshot the user shared: pink "what happened" paragraph, green
 * "need-to-know" bullets, blue "vibe" paragraph, three numbered
 * story beats with citations.
 */
export function buildFixtureRollup(opts: {
  threadTitle: string | null
  sourceApp: string
  turnCount: number
}): ThreadRollup {
  const headline =
    opts.threadTitle?.slice(0, 140) ?? "Untitled session, looking strong"

  return {
    headline,
    whatHappened: `Here's what happened in this ${opts.sourceApp} chat — a working session that touched ${opts.turnCount} turns. The operator opened with broad scope-framing, then narrowed in on a single concrete artifact, iterated on it through a tight loop of read/edit/verify, and closed by reflecting on what would carry forward to the next session. The middle of the session is where most of the gain came from; the front and back are scaffolding.`,
    needToKnow: [
      "Scope was set explicitly in the first three turns and held throughout",
      "A single artifact carried the session — no multi-tasking",
      "Verification ran inline, not as a final step",
      "Operator pushed back on the agent twice when it drifted",
      "Session closed with a written handoff for the next pass",
    ],
    vibe: `Calm and disciplined. The operator was in a "build, not browse" mood — short prompts, decisive corrections, almost no chit-chat. Energy stayed even across the whole session; no signs of frustration or scope-creep anxiety.`,
    beats: [
      {
        id: "beat-1",
        index: 1,
        title: "Scope framing and setup",
        summary:
          "The session opens with an explicit, written scope: what's in, what's out, what success looks like. The agent acknowledges and the operator anchors a single artifact as the deliverable.",
        startTurnIndex: 0,
        endTurnIndex: Math.min(2, Math.max(0, opts.turnCount - 1)),
        turnIndexes: Array.from(
          { length: Math.min(3, Math.max(1, opts.turnCount)) },
          (_, i) => i
        ),
        refs: [
          {
            turnIndex: 0,
            role: "user",
            excerpt:
              "Let's keep this tight — single PR, single file, no cleanup tangents. Goal: get the new endpoint behind a flag.",
          },
        ],
      },
      {
        id: "beat-2",
        index: 2,
        title: "Read-edit-verify loop",
        summary:
          "The bulk of the session: the operator and agent move through three tight cycles of read-current-state, propose-edit, run-verify. Each cycle ends with a verification — typecheck, smoke, or a targeted log read — before the next change.",
        startTurnIndex: Math.min(3, Math.max(0, opts.turnCount - 1)),
        endTurnIndex: Math.max(
          3,
          Math.floor(opts.turnCount * 0.75)
        ),
        turnIndexes: Array.from(
          {
            length: Math.max(
              1,
              Math.floor(opts.turnCount * 0.75) - 3
            ),
          },
          (_, i) => i + 3
        ).slice(0, 24),
        refs: [
          {
            turnIndex: 5,
            role: "assistant",
            excerpt:
              "Reading the current handler, then I'll propose the edit. Will run the typecheck after.",
          },
          {
            turnIndex: 8,
            role: "user",
            excerpt:
              "That's the wrong file — point at app/api/foo/route.ts, not the lib helper.",
          },
        ],
      },
      {
        id: "beat-3",
        index: 3,
        title: "Handoff and reflection",
        summary:
          "The session closes with a written handoff: what was shipped, what was deferred, what the next session should pick up first. The operator names two specific follow-up items rather than a vague 'continue tomorrow.'",
        startTurnIndex: Math.max(
          0,
          opts.turnCount - 3
        ),
        endTurnIndex: Math.max(0, opts.turnCount - 1),
        turnIndexes: Array.from(
          { length: Math.min(3, Math.max(1, opts.turnCount)) },
          (_, i) => Math.max(0, opts.turnCount - 1 - i)
        ).reverse(),
        refs: [
          {
            turnIndex: Math.max(0, opts.turnCount - 1),
            role: "user",
            excerpt:
              "Two things for tomorrow: (1) flip the flag in staging, (2) cut the rollback note. That's it — going to bed.",
          },
        ],
      },
    ],
    confidence: 0.6,
    signalsUsed: {
      generationMode: "fixture",
      pipelineVersion: ROLLUP_CONTRACT_VERSION,
      turnsConsidered: opts.turnCount,
      modelEndpoint: null,
      modelName: null,
      plannerUsedFallback: false,
      writerUsedFallback: false,
      coverageIsExact: true,
    },
  }
}
