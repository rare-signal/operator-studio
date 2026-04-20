import { describe, it, expect } from "vitest"
import { parseUniversal } from "./universal-parser"

describe("parseUniversal - structured JSON formats", () => {
  describe("operator-studio-native", () => {
    it("detects native shape with messages + title", () => {
      const input = {
        title: "My Thread",
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("operator-studio-native")
      expect(result.messages).toHaveLength(2)
      expect(result.title).toBe("My Thread")
      expect(result.messages[0]).toMatchObject({ role: "user", content: "hello" })
      expect(result.messages[1]).toMatchObject({ role: "assistant", content: "hi there" })
    })

    it("native shape without title leaves title undefined", () => {
      const input = {
        messages: [{ role: "user", content: "hi" }],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("operator-studio-native")
      expect(result.title).toBeUndefined()
    })
  })

  describe("anthropic-messages", () => {
    it("handles string content (falls back to operator-studio-native)", () => {
      // When all content is string, looksLikeMessages matches first and gets
      // categorized as operator-studio-native — that's the expected branch order.
      const input = {
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: "answer" },
        ],
      }
      const result = parseUniversal(input)
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[1].role).toBe("assistant")
    })

    it("handles content-block arrays (extracted via operator-studio-native branch)", () => {
      // NOTE: because looksLikeMessages() only inspects the first message and
      // checks for a `role` key, an Anthropic-shaped payload is matched by the
      // operator-studio-native branch before the anthropic-messages branch can
      // fire. The content-block array is still correctly extracted via
      // extractContent(), but the detectedFormat label reflects the actual
      // matched branch.
      const input = {
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "world" },
              { type: "text", text: "!" },
            ],
          },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("operator-studio-native")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].content).toBe("hello")
      expect(result.messages[1].content).toContain("world")
      expect(result.messages[1].content).toContain("!")
    })

    it("detects anthropic-messages when the first message lacks role/author/from", () => {
      // Without role on the first message, looksLikeMessages returns false,
      // so the operator-studio-native branch is skipped and we reach the
      // anthropic-messages branch which checks for any array content.
      const input = {
        messages: [
          { content: [{ type: "text", text: "hello" }] },
          { role: "assistant", content: [{ type: "text", text: "world" }] },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("anthropic-messages")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].content).toBe("hello")
      expect(result.messages[1].content).toBe("world")
    })
  })

  describe("openai-chat", () => {
    it("captures both prompt messages and choices[].message (ordering)", () => {
      const input = {
        messages: [
          { role: "system", content: "be helpful" },
          { role: "user", content: "hi" },
        ],
        choices: [
          {
            message: { role: "assistant", content: "hello back" },
          },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("openai-chat")
      expect(result.messages).toHaveLength(3)
      // Ordering: prompts first, then choices
      expect(result.messages[0].role).toBe("system")
      expect(result.messages[1].role).toBe("user")
      expect(result.messages[1].content).toBe("hi")
      expect(result.messages[2].role).toBe("assistant")
      expect(result.messages[2].content).toBe("hello back")
    })

    it("extracts top candidate from choices-only shape", () => {
      const input = {
        choices: [
          { message: { role: "assistant", content: "just an answer" } },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("openai-chat")
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe("just an answer")
    })
  })

  describe("gemini-generate", () => {
    it("extracts assistant text from candidates parts", () => {
      const input = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "The " }, { text: "answer." }],
            },
          },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("gemini-generate")
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe("assistant")
      expect(result.messages[0].content).toBe("The answer.")
    })

    it("includes request.contents prompt + response", () => {
      const input = {
        request: {
          contents: [
            { role: "user", parts: [{ text: "what is 2+2?" }] },
          ],
        },
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "4" }],
            },
          },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("gemini-generate")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[0].content).toBe("what is 2+2?")
      expect(result.messages[1].role).toBe("assistant")
      expect(result.messages[1].content).toBe("4")
    })
  })

  describe("gemini-conversation", () => {
    it("parses contents[] history shape", () => {
      const input = {
        contents: [
          { role: "user", parts: [{ text: "q1" }] },
          { role: "model", parts: [{ text: "a1" }] },
          { role: "user", parts: [{ text: "q2" }] },
          { role: "model", parts: [{ text: "a2" }] },
        ],
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("gemini-conversation")
      expect(result.messages).toHaveLength(4)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[1].role).toBe("assistant") // "model" normalizes to assistant
      expect(result.messages[2].content).toBe("q2")
      expect(result.messages[3].content).toBe("a2")
    })
  })

  describe("chatgpt-share", () => {
    it("parses mapping, surfaces title, converts create_time", () => {
      const createTimeSeconds = 1700000000 // Nov 2023
      const input = {
        title: "Shared chat",
        mapping: {
          node1: {
            message: {
              author: { role: "user" },
              content: { parts: ["hello"] },
              create_time: createTimeSeconds,
            },
          },
          node2: {
            message: {
              author: { role: "assistant" },
              content: { parts: ["hi!"] },
              create_time: createTimeSeconds + 5,
            },
          },
        },
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("chatgpt-share")
      expect(result.title).toBe("Shared chat")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[0].content).toBe("hello")
      expect(result.messages[0].timestamp).toBe(
        new Date(createTimeSeconds * 1000).toISOString()
      )
      expect(result.messages[1].timestamp).toBe(
        new Date((createTimeSeconds + 5) * 1000).toISOString()
      )
    })
  })

  describe("jsonl-messages", () => {
    it("parses one JSON object per line", () => {
      const input = [
        '{"role":"user","content":"q1"}',
        '{"role":"assistant","content":"a1"}',
        '{"role":"user","content":"q2"}',
      ].join("\n")
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("jsonl-messages")
      expect(result.messages).toHaveLength(3)
      expect(result.messages[0].content).toBe("q1")
      expect(result.messages[2].content).toBe("q2")
    })
  })

  describe("role-content-array", () => {
    it("parses top-level array of {role, content}", () => {
      const input = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("role-content-array")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[1].role).toBe("assistant")
    })
  })

  describe("nested conversation wrapper", () => {
    it("recurses into .conversation to detect inner shape", () => {
      const input = {
        conversation: {
          messages: [
            { role: "user", content: "nested hi" },
            { role: "assistant", content: "nested hello" },
          ],
        },
      }
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("operator-studio-native")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].content).toBe("nested hi")
    })
  })
})

describe("parseUniversal - text formats", () => {
  describe("labeled-transcript", () => {
    it("parses User:/Assistant: pattern", () => {
      const input = "User: what time is it?\n\nAssistant: I cannot tell."
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("labeled-transcript")
      expect(result.messages.length).toBeGreaterThanOrEqual(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[0].content).toContain("what time is it?")
      expect(result.messages[0].content).not.toMatch(/^User:/)
      expect(result.messages[1].role).toBe("assistant")
      expect(result.messages[1].content).toContain("I cannot tell.")
    })

    it("normalizes You:/Human:/Me: to user", () => {
      const inputs = [
        "You: hi\n\nAssistant: hello",
        "Human: hi\n\nAssistant: hello",
        "Me: hi\n\nAssistant: hello",
      ]
      for (const input of inputs) {
        const result = parseUniversal(input)
        expect(result.messages[0].role).toBe("user")
      }
    })

    it("normalizes AI/Model/Bot/Claude/Gemini/GPT/ChatGPT/Assistant/Copilot/Cursor to assistant", () => {
      const labels = [
        "AI",
        "Model",
        "Bot",
        "Claude",
        "Gemini",
        "GPT",
        "ChatGPT",
        "Assistant",
        "Copilot",
        "Cursor",
      ]
      for (const label of labels) {
        const input = `User: hi\n\n${label}: hello`
        const result = parseUniversal(input)
        expect(result.detectedFormat).toBe("labeled-transcript")
        expect(result.messages).toHaveLength(2)
        expect(result.messages[1].role).toBe("assistant")
      }
    })

    it("normalizes System:/Developer: to system", () => {
      const input = "System: be brief\n\nUser: hi\n\nAssistant: hello"
      const result = parseUniversal(input)
      expect(result.messages[0].role).toBe("system")
      const input2 = "Developer: rules\n\nUser: hi\n\nAssistant: ok"
      const result2 = parseUniversal(input2)
      expect(result2.messages[0].role).toBe("system")
    })
  })

  describe("markdown-heading-split", () => {
    it("splits on markdown headings that include label punctuation (# User:)", () => {
      // detectLabel requires trailing punctuation (`:` `>` `-` `—`). Bare
      // heading text like "# User" / "# Assistant" does NOT match detectLabel
      // and instead falls through to inferRoleFromHeading, which defaults to
      // "user" for anything that doesn't match /response|answer|reply|completion/.
      // To exercise the explicit detectLabel path from markdown, include the
      // trailing colon in the heading text.
      const input = [
        "# User:",
        "what is this?",
        "",
        "# Assistant:",
        "a test",
      ].join("\n")
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("markdown-heading-split")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[0].content).toContain("what is this?")
      expect(result.messages[1].role).toBe("assistant")
      expect(result.messages[1].content).toContain("a test")
    })

    it("bare `# User` / `# Assistant` headings (no trailing colon) resolve correctly", () => {
      const input = [
        "# User",
        "what is this?",
        "",
        "# Assistant",
        "a test",
      ].join("\n")
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("markdown-heading-split")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[1].role).toBe("assistant")
    })

    it("falls back to inferRoleFromHeading for unknown headings", () => {
      const input = [
        "# Prompt",
        "do the thing",
        "",
        "# Response",
        "done",
      ].join("\n")
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("markdown-heading-split")
      expect(result.messages).toHaveLength(2)
      expect(result.messages[0].role).toBe("user") // "prompt"
      expect(result.messages[1].role).toBe("assistant") // "response"
    })
  })

  describe("raw-blob", () => {
    it("no-structure text becomes single user message with hint note", () => {
      const input = "this is just some free form text with no labels at all"
      const result = parseUniversal(input)
      expect(result.detectedFormat).toBe("raw-blob")
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe("user")
      expect(result.messages[0].content).toBe(input)
      expect(result.notes.join(" ")).toContain("No structure detected")
    })
  })
})

describe("parseUniversal - edge cases", () => {
  it("empty string produces empty messages array with raw-blob format", () => {
    const result = parseUniversal("")
    expect(result.detectedFormat).toBe("raw-blob")
    expect(result.messages).toHaveLength(0)
  })

  it("whitespace-only string produces empty messages array with raw-blob format", () => {
    const result = parseUniversal("   \n\n\t  \n")
    expect(result.detectedFormat).toBe("raw-blob")
    expect(result.messages).toHaveLength(0)
  })

  it("JSON that parses but has no recognizable shape falls to raw-blob with stringified JSON", () => {
    const input = JSON.stringify({ foo: "bar", baz: 42 })
    const result = parseUniversal(input)
    expect(result.detectedFormat).toBe("raw-blob")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe("user")
    expect(result.messages[0].content).toContain("foo")
    expect(result.messages[0].content).toContain("bar")
  })

  it("array with non-object entries skips them without error", () => {
    const input = [
      "not an object",
      42,
      null,
      { role: "user", content: "real message" },
    ]
    const result = parseUniversal(input)
    expect(result.detectedFormat).toBe("role-content-array")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toBe("real message")
  })

  it("message objects missing content are skipped", () => {
    const input = {
      messages: [
        { role: "user", content: "kept" },
        { role: "assistant" }, // no content
        { role: "user", content: "" }, // empty content
        { role: "assistant", content: "also kept" },
      ],
    }
    const result = parseUniversal(input)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].content).toBe("kept")
    expect(result.messages[1].content).toBe("also kept")
  })

  it("timestamp as Unix seconds (number) becomes ISO string", () => {
    const seconds = 1700000000
    const input = {
      messages: [
        { role: "user", content: "hello", timestamp: seconds },
      ],
    }
    const result = parseUniversal(input)
    expect(result.messages[0].timestamp).toBe(
      new Date(seconds * 1000).toISOString()
    )
  })

  it("timestamp as Unix milliseconds (number) becomes ISO string", () => {
    const ms = 1700000000000
    const input = {
      messages: [
        { role: "user", content: "hello", timestamp: ms },
      ],
    }
    const result = parseUniversal(input)
    expect(result.messages[0].timestamp).toBe(new Date(ms).toISOString())
  })

  it("timestamp as ISO string passes through verbatim", () => {
    const iso = "2024-01-01T12:34:56.000Z"
    const input = {
      messages: [
        { role: "user", content: "hello", timestamp: iso },
      ],
    }
    const result = parseUniversal(input)
    expect(result.messages[0].timestamp).toBe(iso)
  })

  it("unknown roles (tool, function, arbitrary) normalize to assistant", () => {
    const input = {
      messages: [
        { role: "tool", content: "tool output" },
        { role: "function", content: "fn output" },
        { role: "some-weird-role", content: "weird" },
      ],
    }
    const result = parseUniversal(input)
    expect(result.messages).toHaveLength(3)
    expect(result.messages[0].role).toBe("assistant")
    expect(result.messages[1].role).toBe("assistant")
    expect(result.messages[2].role).toBe("assistant")
  })
})
