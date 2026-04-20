import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseTagResponse, deriveTags } from "./generate-tags"

describe("parseTagResponse", () => {
  it("splits, trims, and lowercases a comma-separated line", () => {
    expect(parseTagResponse("NextJS, App-Router,  Caching ")).toEqual([
      "nextjs",
      "app-router",
      "caching",
    ])
  })

  it("drops empties, whitespace-inside, and invalid chars", () => {
    expect(
      parseTagResponse("good, bad tag, ,!weird, ok-one, another-good")
    ).toEqual(["good", "ok-one", "another-good"])
  })

  it("drops tags longer than 40 chars", () => {
    const longTag = "x".repeat(41)
    expect(parseTagResponse(`short,${longTag},fine`)).toEqual(["short", "fine"])
  })

  it("drops tags that start with a hyphen", () => {
    expect(parseTagResponse("-lead-dash,tail-ok,ok")).toEqual(["tail-ok", "ok"])
  })

  it("dedupes and caps at 5", () => {
    expect(
      parseTagResponse("a,b,c,d,e,f,g,a,b")
    ).toEqual(["a", "b", "c", "d", "e"])
  })

  it("strips common wrappers like code fences and 'tags:' prefix", () => {
    expect(parseTagResponse("```\ntags: foo, bar, baz\n```")).toEqual([
      "foo",
      "bar",
      "baz",
    ])
  })

  it("returns [] on empty input", () => {
    expect(parseTagResponse("")).toEqual([])
    expect(parseTagResponse("   ")).toEqual([])
  })
})

describe("deriveTags", () => {
  const ORIGINAL_ENDPOINTS = process.env.WORKBOOK_CLUSTER_ENDPOINTS
  const ORIGINAL_FAST = process.env.WORKBOOK_FAST_ENDPOINTS

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    if (ORIGINAL_ENDPOINTS === undefined) {
      delete process.env.WORKBOOK_CLUSTER_ENDPOINTS
    } else {
      process.env.WORKBOOK_CLUSTER_ENDPOINTS = ORIGINAL_ENDPOINTS
    }
    if (ORIGINAL_FAST === undefined) {
      delete process.env.WORKBOOK_FAST_ENDPOINTS
    } else {
      process.env.WORKBOOK_FAST_ENDPOINTS = ORIGINAL_FAST
    }
    vi.restoreAllMocks()
  })

  it("returns [] when no endpoints are configured", async () => {
    delete process.env.WORKBOOK_CLUSTER_ENDPOINTS
    delete process.env.WORKBOOK_FAST_ENDPOINTS
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const tags = await deriveTags([{ role: "user", content: "hi" }])
    expect(tags).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns [] when messages is empty", async () => {
    process.env.WORKBOOK_CLUSTER_ENDPOINTS = "http://localhost:9999"
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const tags = await deriveTags([])
    expect(tags).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns cleaned tags when the LLM responds", async () => {
    process.env.WORKBOOK_CLUSTER_ENDPOINTS = "http://localhost:9999"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: "Nextjs, App-Router, Caching, invalid tag" } },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    )
    const tags = await deriveTags([
      { role: "user", content: "router.refresh() not busting cache" },
    ])
    expect(tags).toEqual(["nextjs", "app-router", "caching"])
  })

  it("returns [] when fetch throws", async () => {
    process.env.WORKBOOK_CLUSTER_ENDPOINTS = "http://localhost:9999"
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"))
    const tags = await deriveTags([{ role: "user", content: "hi" }])
    expect(tags).toEqual([])
  })

  it("returns [] when response is not ok", async () => {
    process.env.WORKBOOK_CLUSTER_ENDPOINTS = "http://localhost:9999"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("server error", { status: 500 })
    )
    const tags = await deriveTags([{ role: "user", content: "hi" }])
    expect(tags).toEqual([])
  })
})
