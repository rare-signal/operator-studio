/**
 * Echoes fixture — operator turns, verbatim, in chronological order.
 *
 * Where Trails synthesized (named, rationalized, calibrated), Echoes
 * does retrieval only. Each entry is a single operator turn from a
 * recent agentic session, rendered exactly as it was said. The agent's
 * one job is the `relatedTurnIds` field — pairwise pointers between
 * turns whose words rhyme. The operator does the synthesis themselves
 * by reading the verbatim matches side by side.
 *
 * No titles. No rationales. No temperatures. If any of those fields
 * appear in this surface, the surface is broken — the agent has
 * stopped retrieving and started narrating.
 *
 * Quotes from this session (2026-05-05 trails-poc) are verbatim. A
 * small handful of older-session turns are synthetic seeds, kept
 * deliberately rough — fragments, lowercase, "kind of", etc. — and
 * clearly labeled in code comments so a future maintainer doesn't
 * mistake them for ingested data.
 */

export interface OperatorTurn {
  id: string
  sourceApp: "claude" | "codex" | "claude_code" | "manual"
  sourceThreadKey: string
  threadTitle: string | null
  turnIndex: number
  occurredAt: string // ISO
  content: string // verbatim
  /** Other turn ids whose words rhyme with this one. Pairwise, not
   *  clustered — the operator reads matched pairs and decides for
   *  themselves whether they belong together. */
  relatedTurnIds: string[]
}

export interface EchoesFeed {
  workspaceId: string
  windowStart: string
  windowEnd: string
  turns: OperatorTurn[]
}

export function buildFixtureEchoes(opts: {
  workspaceId: string
  now: Date
}): EchoesFeed {
  const { workspaceId, now } = opts

  const iso = (d: Date) => d.toISOString()
  const minusMin = (m: number) =>
    new Date(now.getTime() - m * 60 * 1000)
  const minusHours = (h: number) =>
    new Date(now.getTime() - h * 60 * 60 * 1000)
  const minusDays = (d: number) =>
    new Date(now.getTime() - d * 24 * 60 * 60 * 1000)

  // Verbatim turns from the current session (the trails-poc thread).
  // Turn indices match the actual turn order in this conversation.
  const SESSION = "01928e10-trails-poc-3d9b"

  const turns: OperatorTurn[] = [
    // ── Older synthetic seeds — clearly rough, user-voice rough ───────
    {
      // synthetic seed
      id: "t-old-001",
      sourceApp: "claude",
      sourceThreadKey: "01928a02-promotion-pickier-9012",
      threadTitle: "Picky promotion review",
      turnIndex: 22,
      occurredAt: iso(minusDays(10)),
      content:
        "if you summarize what i said in your own words it's already wrong. i want my actual words pinned, not your paraphrase of them",
      relatedTurnIds: ["t-this-016", "t-this-013", "t-this-011"],
    },
    {
      // synthetic seed
      id: "t-old-002",
      sourceApp: "codex",
      sourceThreadKey: "rollout-2026-04-29T13-04-22Z-aida",
      threadTitle: "AIDA scope review",
      turnIndex: 4,
      occurredAt: iso(minusDays(6)),
      content:
        "operator studio is the one tool i'm building that i'm not actually using. that's a problem.",
      relatedTurnIds: ["t-this-001", "t-this-005"],
    },
    {
      // synthetic seed
      id: "t-old-003",
      sourceApp: "claude",
      sourceThreadKey: "01928d2a-plan-page-pickup-91f4",
      threadTitle: "Plan tab pickup",
      turnIndex: 6,
      occurredAt: iso(minusDays(3)),
      content:
        "reading these long threads to figure out what the agent actually did is the worst part of my day honestly",
      relatedTurnIds: ["t-this-003", "t-this-004"],
    },

    // ── This session — verbatim, in turn order ────────────────────────
    {
      id: "t-this-001",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 0,
      occurredAt: iso(minusHours(2)),
      content:
        "the Operator Studio stuff is kind of falling by the wayside",
      relatedTurnIds: ["t-this-005", "t-old-002"],
    },
    {
      id: "t-this-002",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 0,
      occurredAt: iso(minusMin(115)),
      content:
        "I'm sort of just needing to move fast with my agents",
      relatedTurnIds: [],
    },
    {
      id: "t-this-003",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 0,
      occurredAt: iso(minusMin(114)),
      content:
        "still an unsolved problem: how you go through so much data and so many turns between the user and the assistant to sort of assess and analyze whether or not, for example, a task got done",
      relatedTurnIds: ["t-this-004", "t-old-003"],
    },
    {
      id: "t-this-004",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 0,
      occurredAt: iso(minusMin(113)),
      content:
        "That is a tough nut to crack. We're trying to crack it right now. I think we're pretty close.",
      relatedTurnIds: ["t-this-003"],
    },
    {
      id: "t-this-005",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 0,
      occurredAt: iso(minusMin(112)),
      content:
        "things are falling by the wayside and the dogfooding aspect is getting lost here",
      relatedTurnIds: ["t-this-001", "t-old-002"],
    },
    {
      id: "t-this-006",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 0,
      occurredAt: iso(minusMin(110)),
      content:
        "If you had any concepts or considerations of how we can keep up with Operator Studio, I'm all ears here for what you think would be impactful right now.",
      relatedTurnIds: [],
    },
    {
      id: "t-this-007",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 2,
      occurredAt: iso(minusMin(95)),
      content:
        "I could see for example some analysis pass whose result is tasks that are recommended to be inserted. You see them as ghostly cutouts that you can click to accept or send to the trash. With provenance on why it was suggested, right there in line for you. That'd be cool",
      relatedTurnIds: ["t-this-008"],
    },
    {
      id: "t-this-008",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 4,
      occurredAt: iso(minusMin(85)),
      content:
        "I'd like to try it as a proof of concept where the idea is your Claude Code or Codex or coding assistant has basically a set of instructions to be able to do this, and then a schema they need to output all the insights as such that the tasks can be as relevant and strong as possible. Can you do this for me now.",
      relatedTurnIds: ["t-this-007"],
    },
    {
      id: "t-this-009",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 6,
      occurredAt: iso(minusMin(70)),
      content: "You'll be the first input to this, by the way. Exciting.",
      relatedTurnIds: [],
    },
    {
      id: "t-this-010",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 8,
      occurredAt: iso(minusMin(65)),
      content: "Ready or?",
      relatedTurnIds: [],
    },
    {
      id: "t-this-011",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 10,
      occurredAt: iso(minusMin(50)),
      content:
        "those are sacrosanct",
      relatedTurnIds: ["t-this-013", "t-this-016", "t-old-001"],
    },
    {
      id: "t-this-012",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 10,
      occurredAt: iso(minusMin(49)),
      content:
        "The agent should go and elevate and analyze and do investigation and be a detective in piecing all this together and being someone who again is a subject matter expert in the area that the user is discussing",
      relatedTurnIds: [],
    },
    {
      id: "t-this-013",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 14,
      occurredAt: iso(minusMin(30)),
      content:
        "Is this weighting towards like ... what the USER says? Not sure if some of these are like ... ai?",
      relatedTurnIds: ["t-this-011", "t-this-016", "t-old-001"],
    },
    {
      id: "t-this-014",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 14,
      occurredAt: iso(minusMin(29)),
      content: "what the AI says is usually just workslop. The user is gold.",
      relatedTurnIds: ["t-this-016", "t-this-011", "t-old-001"],
    },
    {
      id: "t-this-015",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 16,
      occurredAt: iso(minusMin(20)),
      content:
        "Sure. Go wide here, go multiplexular and give me what I'm trying to ask for but can't put into words. Then UI it.",
      relatedTurnIds: [],
    },
    {
      id: "t-this-016",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 22,
      occurredAt: iso(minusMin(8)),
      content:
        "so what is ur take on why these are...slop...unusable? and what would be better",
      relatedTurnIds: ["t-this-014", "t-this-011", "t-this-013", "t-old-001"],
    },
    {
      id: "t-this-017",
      sourceApp: "claude",
      sourceThreadKey: SESSION,
      threadTitle: "Trails POC + dogfooding",
      turnIndex: 24,
      occurredAt: iso(minusMin(2)),
      content:
        "Whatever man, seems like a lot of humbug but if you can make magic happen rn go",
      relatedTurnIds: [],
    },
  ]

  // Sort newest first — the operator opens this surface to scan
  // recent recurrence, not to scroll the archive backwards.
  turns.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  return {
    workspaceId,
    windowStart: iso(minusDays(14)),
    windowEnd: iso(now),
    turns,
  }
}
