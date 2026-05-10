import { describe, expect, it } from "vitest"

import { diffItem, type AdoItemSnapshot } from "./ado-read-model"

function snapshot(over: Partial<AdoItemSnapshot>): AdoItemSnapshot {
  return {
    workItemId: 39,
    rev: 5,
    type: "Bug",
    title: "Calls Need EnrollHere ID",
    state: "Active",
    priority: 1,
    assignedTo: "David Lin Clark",
    assignedToUniqueName: "dlclark@clarifying.com",
    createdBy: "Micky Sakora",
    changedBy: "David Lin Clark",
    changedAt: new Date("2026-05-08T14:00:00Z"),
    fields: {},
    ...over,
  }
}

describe("diffItem", () => {
  it("treats first observation as a fresh revision with empty diff", () => {
    const r = diffItem(null, snapshot({}))
    expect(r.shouldAppendRevision).toBe(true)
    expect(r.changedFields).toEqual({})
    expect(r.stateChanged).toBeNull()
  })

  it("skips when rev is not strictly greater than prior", () => {
    const prior = {
      rev: 5,
      type: "Bug",
      title: "x",
      state: "Active",
      priority: 1,
      assignedTo: "David Lin Clark",
      assignedToUniqueName: "dlclark@clarifying.com",
      createdBy: "Micky Sakora",
      changedBy: "David Lin Clark",
    }
    const r = diffItem(prior, snapshot({ rev: 5 }))
    expect(r.shouldAppendRevision).toBe(false)
    expect(r.changedFields).toEqual({})
  })

  it("captures state, priority, and assignee transitions", () => {
    const prior = {
      rev: 5,
      type: "Bug",
      title: "Calls Need EnrollHere ID",
      state: "New",
      priority: 2,
      assignedTo: "Micky Sakora",
      assignedToUniqueName: "msakora@clarifying.com",
      createdBy: "Micky Sakora",
      changedBy: "Micky Sakora",
    }
    const next = snapshot({ rev: 6, state: "Active", priority: 1 })
    const r = diffItem(prior, next)
    expect(r.shouldAppendRevision).toBe(true)
    expect(r.stateChanged).toEqual({ from: "New", to: "Active" })
    expect(r.priorityChanged).toEqual({ from: 2, to: 1 })
    expect(r.assignmentChanged).toEqual({
      from: "Micky Sakora",
      to: "David Lin Clark",
    })
    expect(r.changedFields.state).toEqual({ from: "New", to: "Active" })
    expect(r.changedFields.priority).toEqual({ from: 2, to: 1 })
    expect(r.changedFields.assignedTo).toEqual({
      from: "Micky Sakora",
      to: "David Lin Clark",
    })
  })

  it("records new rev with no field deltas (e.g. comment-only revision)", () => {
    const prior = {
      rev: 5,
      type: "Bug",
      title: "Calls Need EnrollHere ID",
      state: "Active",
      priority: 1,
      assignedTo: "David Lin Clark",
      assignedToUniqueName: "dlclark@clarifying.com",
      createdBy: "Micky Sakora",
      changedBy: "David Lin Clark",
    }
    const r = diffItem(prior, snapshot({ rev: 6 }))
    expect(r.shouldAppendRevision).toBe(true)
    expect(r.changedFields).toEqual({})
    expect(r.stateChanged).toBeNull()
  })
})
