/**
 * Fallow next-prompt inference engine.
 *
 * When a worker pane is fallow (idle past the threshold while bound to
 * an in-motion card), produce a single non-destructive prompt
 * suggestion the operator can copy into the worker. Never auto-sent —
 * callers surface this in a pane footer with a copy button.
 *
 * Three grounding sources:
 *   (a) the linked plan card (title, status, body)
 *   (b) recent operator intent (active plan goal + a couple of hot
 *       step titles)
 *   (c) the worker's tail — last assistant text + last tool name
 *
 * No-op for tmux panes: scrollback has no semantic tail we trust to
 * classify, so the engine returns null and the UI hides the suggestion.
 */
import type { OperatorPlanStep } from "./types"

export type FallowSignal =
  | "blocker"
  | "verify_result"
  | "completion_claim"
  | "needs_instruction"
  | "stale_assistant"
  | "no_tail"

export interface FallowNextPromptInput {
  /** Worker kind. tmux returns null. */
  workerKind: "tmux" | "claude" | "codex"
  /** Linked plan card. Required to ground (a). When null, the engine
   *  produces a much weaker generic prompt or null. */
  card: OperatorPlanStep | null
  /** Last assistant text from the worker tail. May be empty. */
  lastAssistantText: string
  /** Last tool invocation name (if known) — Bash, Read, Edit, etc. */
  lastToolName?: string | null
  /** Operator intent — the active plan's goal/title and 0-3 other hot
   *  step titles. Used to anchor the suggestion to current focus. */
  workspaceIntent?: {
    planTitle: string | null
    planGoal: string | null
    hotStepTitles: string[]
  } | null
}

export interface FallowNextPromptSuggestion {
  /** The prompt text the operator can copy verbatim. */
  prompt: string
  /** One-line rationale shown next to the copy button. */
  rationale: string
  /** Which tail signal drove the suggestion. */
  signal: FallowSignal
  /** Compact diagnostic — what we grounded on, for debugging in the UI
   *  hover and scan logs. */
  basis: {
    cardId: string | null
    tailChars: number
    usedWorkspaceIntent: boolean
    lastToolName: string | null
  }
}

const BLOCKER_RE =
  /\b(?:i (?:can(?:'|)t|cannot|am unable to|don'?t (?:have|know))|blocked|blocker|need(?:s)? clarification|ambiguous|not sure|unclear how|permission denied|access denied|missing (?:credentials?|env|config))\b/i

const VERIFY_RESULT_RE =
  /\b(?:typecheck (?:passes?|passed|clean|failed|errors?)|tests? (?:pass(?:ed)?|fail(?:ed)?|green|red)|build (?:succeeded|failed)|lint (?:clean|errors?)|all tests (?:pass|fail)|pnpm (?:typecheck|test|build))\b/i

const COMPLETION_RE =
  /\b(?:all done|task complete(?:d)?|finished|ready for review|implementation (?:is )?complete|i'?ve (?:implemented|completed|finished|landed)|that should do it|wrapping up)\b/i

const NEEDS_INSTRUCTION_RE =
  /\b(?:waiting (?:for|on) (?:your |the )?(?:next )?(?:instruction|input|direction)|let me know (?:how|what|when)|what (?:would you like|do you want) (?:me )?to do|should i (?:continue|proceed|stop)|ready (?:for|to receive) (?:the )?next|standing by)\b/i

function classifyTail(text: string): FallowSignal {
  if (!text) return "no_tail"
  if (BLOCKER_RE.test(text)) return "blocker"
  if (VERIFY_RESULT_RE.test(text)) return "verify_result"
  if (COMPLETION_RE.test(text)) return "completion_claim"
  if (NEEDS_INSTRUCTION_RE.test(text)) return "needs_instruction"
  return "stale_assistant"
}

function takeTail(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `…${t.slice(-(max - 1))}`
}

function renderCardBlock(card: OperatorPlanStep): string {
  const lines = [
    `Plan card ${card.id}: "${card.title}" (status=${card.status}).`,
  ]
  if (card.description) {
    lines.push("")
    lines.push("Card body:")
    lines.push(card.description.trim().slice(0, 600))
  }
  return lines.join("\n")
}

function renderIntentBlock(
  intent: FallowNextPromptInput["workspaceIntent"]
): string | null {
  if (!intent) return null
  const lines: string[] = []
  if (intent.planTitle) lines.push(`Active plan: ${intent.planTitle}`)
  if (intent.planGoal) lines.push(`Plan goal: ${intent.planGoal.slice(0, 240)}`)
  const hot = intent.hotStepTitles.filter(Boolean).slice(0, 3)
  if (hot.length > 0) {
    lines.push(
      `Other in-motion cards: ${hot.map((t) => `"${t.slice(0, 80)}"`).join(", ")}`
    )
  }
  return lines.length > 0 ? lines.join("\n") : null
}

/**
 * Build the prompt body for a given signal. Each branch is intentional
 * about *what to do next*, not a generic "please continue".
 */
function bodyForSignal(
  signal: FallowSignal,
  card: OperatorPlanStep | null,
  tail: string,
  toolName: string | null
): string {
  const cardRef = card ? `card ${card.id}` : "this card"
  const toolHint = toolName ? ` Last tool you used: ${toolName}.` : ""
  const tailHint = tail
    ? `\n\nYour last assistant message ended with:\n"""\n${takeTail(tail, 400)}\n"""`
    : ""

  switch (signal) {
    case "blocker":
      return [
        `You appear to have flagged a blocker on ${cardRef}.${toolHint}`,
        `Write a one-paragraph blocker note: what you tried, the exact failure, and the smallest decision you need from David. Do not retry until you have an answer.${tailHint}`,
      ].join(" ")
    case "verify_result":
      return [
        `You reported a verification outcome on ${cardRef}.${toolHint}`,
        `Confirm: does the result satisfy the card's acceptance? If yes, run \`pnpm plan:card status --id=${card?.id ?? "<card-id>"} --status=covered\` and stop. If no, list the remaining gap in one bullet and resume on the smallest next step.${tailHint}`,
      ].join(" ")
    case "completion_claim":
      return [
        `You signaled completion on ${cardRef} but the card is still in-motion.${toolHint}`,
        `Verify acceptance criteria one by one against the card body. If all met, mark covered with \`pnpm plan:card status --id=${card?.id ?? "<card-id>"} --status=covered\`. If any fail, name the missing piece and resume.${tailHint}`,
      ].join(" ")
    case "needs_instruction":
      return [
        `You asked for direction on ${cardRef}.${toolHint}`,
        `Re-read the card body above and resume from the smallest concrete step it implies. If the card is ambiguous, write a blocker note and stop instead of guessing.${tailHint}`,
      ].join(" ")
    case "stale_assistant":
      return [
        `You stopped mid-thread on ${cardRef} without explicit completion or blocker.${toolHint}`,
        `Re-read the card body and your last message, then take the next concrete step. If the card body no longer reflects the work, propose a one-line update before continuing.${tailHint}`,
      ].join(" ")
    case "no_tail":
      return [
        `You haven't produced any assistant text on ${cardRef} yet.`,
        `Read the card body above. State your plan in 1-3 bullets, then take the first step. If the card is unclear, stop and write a blocker note.`,
      ].join(" ")
  }
}

export function inferFallowNextPrompt(
  input: FallowNextPromptInput
): FallowNextPromptSuggestion | null {
  if (input.workerKind === "tmux") return null

  const tail = (input.lastAssistantText ?? "").trim()
  const signal = classifyTail(tail)
  const card = input.card

  if (!card && signal === "no_tail") return null

  const intentBlock = renderIntentBlock(input.workspaceIntent ?? null)
  const cardBlock = card ? renderCardBlock(card) : null
  const body = bodyForSignal(signal, card, tail, input.lastToolName ?? null)

  const parts: string[] = []
  if (cardBlock) parts.push(cardBlock)
  if (intentBlock) parts.push(intentBlock)
  parts.push(body)
  const prompt = parts.join("\n\n")

  const rationale = (() => {
    switch (signal) {
      case "blocker":
        return "Tail flagged a blocker — ask for a structured blocker note, no retry."
      case "verify_result":
        return "Tail reports a verify outcome — gate on acceptance, then mark covered or list the gap."
      case "completion_claim":
        return "Tail claims completion while card is still in-motion — verify against acceptance."
      case "needs_instruction":
        return "Tail asked for direction — point back to the card, not a generic continue."
      case "stale_assistant":
        return "Worker idle mid-thread — resume on the smallest next step grounded in card body."
      case "no_tail":
        return "Worker bound to card with no assistant output yet — ask for plan + first step."
    }
  })()

  return {
    prompt,
    rationale,
    signal,
    basis: {
      cardId: card?.id ?? null,
      tailChars: tail.length,
      usedWorkspaceIntent: Boolean(intentBlock),
      lastToolName: input.lastToolName ?? null,
    },
  }
}
