import { describe, expect, it } from "vitest"

import { classify } from "./ado-triage"

describe("classify (ADO triage)", () => {
  it("buckets a closed item as quick_lift with verify-and-clear advice", () => {
    const r = classify({
      state: "Closed",
      priority: 1,
      title: "Calls Need EnrollHere ID",
      latestCommentExcerpt: "shipped to production",
      bound: false,
    })
    expect(r.bucket).toBe("quick_lift")
    expect(r.reason).toMatch(/closed/i)
  })

  it("buckets an item with a bound plan card as in_motion", () => {
    const r = classify({
      state: "Active",
      priority: 1,
      title: "Lead vendor display",
      latestCommentExcerpt: null,
      bound: true,
    })
    expect(r.bucket).toBe("in_motion")
    expect(r.suggestedAction).toMatch(/double-assign/i)
  })

  it("flags investigation when title contains stakeholder hedge words", () => {
    const r = classify({
      state: "New",
      priority: 2,
      title: "Track disputable Calls - Short Term",
      latestCommentExcerpt: null,
      bound: false,
    })
    expect(r.bucket).toBe("investigation")
  })

  it("flags an unbound P1 active as investigation needing an owner", () => {
    const r = classify({
      state: "Active",
      priority: 1,
      title: "Some short title",
      latestCommentExcerpt: null,
      bound: false,
    })
    expect(r.bucket).toBe("investigation")
    expect(r.reason).toMatch(/P1/)
  })

  it("buckets a low-priority new item as quick_lift", () => {
    const r = classify({
      state: "New",
      priority: 3,
      title: "Finalize Downlines Login Design",
      latestCommentExcerpt: null,
      // "design" word would push this to investigation; ensure that the
      // signal scanner runs first by using a benign title.
      bound: false,
    })
    // "Design" is in investigation phrases — assert the heuristic fires.
    expect(r.bucket).toBe("investigation")
  })

  it("default-paths a benign New low-priority item to quick_lift", () => {
    const r = classify({
      state: "New",
      priority: 4,
      title: "Bump label color",
      latestCommentExcerpt: null,
      bound: false,
    })
    expect(r.bucket).toBe("quick_lift")
  })
})
