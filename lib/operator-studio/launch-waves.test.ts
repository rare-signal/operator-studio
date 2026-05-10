import { describe, expect, it } from "vitest"

import { summarizeLaunchWaves } from "./launch-waves"

describe("summarizeLaunchWaves", () => {
  it("groups bindings and launch attempts by recommendation across agent sources", () => {
    const ledger = summarizeLaunchWaves({
      now: new Date("2026-05-09T18:00:00.000Z"),
      planSteps: [
        {
          id: "step-launch-wave-ledger-all-agent-sources",
          n: 4,
          title: "Launch-wave ledger across all agent sources",
          status: "in-motion",
        },
      ],
      agents: [
        {
          id: "claude:one",
          kind: "claude",
          source: "claude",
          lastActivityAt: "2026-05-09T17:43:00.000Z",
          isLive: true,
        },
        {
          id: "codex:two",
          kind: "codex",
          source: "codex",
          lastActivityAt: "2026-05-09T17:38:00.000Z",
          isLive: false,
        },
      ],
      bindings: [
        {
          id: "bind-1",
          agentId: "claude:one",
          agentKind: "claude",
          planStepId: "step-launch-wave-ledger-all-agent-sources",
          planId: "plan-launch",
          source: "launch",
          sourceRecommendationId: "rec-123",
          createdBy: "david",
          createdAt: "2026-05-09T17:30:00.000Z",
          updatedAt: "2026-05-09T17:42:00.000Z",
        },
        {
          id: "bind-2",
          agentId: "codex:two",
          agentKind: "codex",
          planStepId: "step-launch-wave-ledger-all-agent-sources",
          planId: "plan-launch",
          source: "manual",
          sourceRecommendationId: "rec-123",
          createdBy: "david",
          createdAt: "2026-05-09T17:35:00.000Z",
          updatedAt: "2026-05-09T17:39:00.000Z",
        },
      ],
      launchAttempts: [
        {
          id: "attempt-1",
          createdAt: "2026-05-09T17:29:00.000Z",
          appKind: "codex",
          planStepId: "step-launch-wave-ledger-all-agent-sources",
          sourceRecommendationId: "rec-123",
          resolvedAt: "2026-05-09T17:36:00.000Z",
          resolvedAgentId: "codex:two",
          status: "resolved",
        },
      ],
    })

    expect(ledger.emptyState).toBeNull()
    expect(ledger.totals.waves).toBe(1)
    expect(ledger.totals.launches).toBe(3)
    expect(ledger.waves[0].id).toBe("recommendation:rec-123")
    expect(ledger.waves[0].initiators).toEqual(["david"])
    expect(ledger.waves[0].sourceCounts).toEqual([
      { source: "codex", count: 2, active: 0, pending: 0, lastSeenAt: "2026-05-09T17:39:00.000Z" },
      { source: "claude", count: 1, active: 1, pending: 0, lastSeenAt: "2026-05-09T17:43:00.000Z" },
    ])
    expect(ledger.waves[0].kindCounts).toEqual([
      { kind: "attempt", count: 1 },
      { kind: "launch", count: 1 },
      { kind: "manual", count: 1 },
    ])
    expect(ledger.waves[0].boundCards).toEqual([
      {
        planStepId: "step-launch-wave-ledger-all-agent-sources",
        planStepTitle: "Launch-wave ledger across all agent sources",
        planStepNumber: 4,
        planStepStatus: "in-motion",
        bindingIds: ["bind-1", "bind-2"],
        agentIds: ["claude:one", "codex:two"],
        launchedAt: "2026-05-09T17:29:00.000Z",
        lastSeenAt: "2026-05-09T17:43:00.000Z",
        statuses: {
          active: 1,
          pending: 0,
          resolved: 1,
          dismissed: 0,
          seen: 1,
        },
      },
    ])
  })

  it("returns a deliberate empty state when there are no launch facts", () => {
    const ledger = summarizeLaunchWaves({
      now: new Date("2026-05-09T18:00:00.000Z"),
      bindings: [],
      launchAttempts: [],
    })

    expect(ledger.waves).toEqual([])
    expect(ledger.emptyState).toEqual({
      kind: "no-launches",
      title: "No launches recorded yet",
      body: "Launch a Claude, Codex, or tmux worker against a plan card to start the launch-wave ledger.",
    })
  })

  it("uses tail-sniffed plan cards for unbound recent agents", () => {
    const ledger = summarizeLaunchWaves({
      now: new Date("2026-05-09T18:00:00.000Z"),
      agents: [
        {
          id: "tmux:ops",
          kind: "tmux",
          source: "tmux",
          lastActivityAt: "2026-05-09T17:55:00.000Z",
          isLive: true,
        },
      ],
      recent: [
        {
          agentId: "tmux:ops",
          source: "tmux",
          lastActivityAt: "2026-05-09T17:56:00.000Z",
          isLive: true,
          detectedPlanCardId: "step-launch-wave-ledger-all-agent-sources",
        },
      ],
    })

    expect(ledger.totals.launches).toBe(1)
    expect(ledger.waves[0].sourceKindCounts).toEqual([
      { source: "tmux", kind: "tail-sniff", count: 1 },
    ])
    expect(ledger.waves[0].boundCards[0].agentIds).toEqual(["tmux:ops"])
  })
})
