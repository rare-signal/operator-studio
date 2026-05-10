/**
 * Mobile Executive Cockpit — vision codification (2026-05-09).
 *
 * Captures David's verbatim prompt as KB amber and creates the plan card
 * hierarchy for the Mobile Executive Cockpit project. Native to Operator
 * Studio per dogfood doctrine — no stray markdown.
 */

import { and, eq } from "drizzle-orm"

import { upsertEntry } from "@/lib/operator-studio/knowledge"
import { upsertPlanStep } from "@/lib/operator-studio/plans"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getDb } from "@/lib/server/db/client"
import { getPgPool } from "@/lib/server/db/client"
import { operatorPlans } from "@/lib/server/db/schema"

const WORKSPACE_ID = GLOBAL_WORKSPACE_ID
const KB_ID = "kb-2026-05-09-mobile-executive-cockpit-vision"
const ROOT_CARD_ID = "step-mobile-executive-cockpit"

const DAVID_PROMPT_VERBATIM = `Great, thank you for asking. Okay, so let me paint the picture of the gap of where we are today. Basically, the system is much more today oriented around: "I'm already in Claude Code or I'm already in the Codex desktop app, or I'm using the CLI. I'm spawning a new thread. My application is watching for that and spawning a new sort of chat window for that."

I think what I'm looking for in this version of operations, and whether or not you spin off a completely new route and a completely new page for this, is absolutely in your prerogative to decide to do. I think that would make a lot of sense if you did choose to do that. Here's what I'm thinking: we take this screen and make it mobile only, essentially. I think we can pair down and separate concerns here and make this very much a mobile-only experience. The idea here is that you're going to start with a very focused "thing" that you want to do. I suppose there could be multiple concepts of a thing that you want to get done, and those could be considered work lanes on the operational screen.

Those will become for example first order goddammit. Sorry. I have a cold. I think those will become first order sources of truth from the user about what it is that they're trying to get done right now. And I think those will become potentially a combined with the sort of recency compression function that we are mulling over that is going to be the source and key of creating an AI system that intuitively understands what it is that the user is trying to get done right. So we're leapfrogging I think to the highest echelons of AI research on this subject. So if we can get some of this stuff done right now, codify it into an app that basically has me slinging prompts and pulling levers and operating my software factory remotely. On a dime whenever I want doing whatever I want right. Moving from that point on to this idea like we have a platform for like a voice agent that can interact with the same tools by just giving me a voice agent to interact with the executive planning agent who then can run tool function calls if I sort of like extra double confirm right so nothing to be done engineering wise on this today but just sort of jutting this down for future reference so you can sort in our knowledge base. As an artifact for today along with probably again my prompt I think for the future reference I mostly want my prompt included in the documentation that we preserve in Amber and especially any pontification is on the matter because including my actual prompt rather than including your only your thoughts on the matter is a big sort of important part on keeping on track to my actual vision rather than sort of drifting off into generative token land because again operator studio is about separating the slop from the gold and that is all that all comes down to human promotion and human elevation of what seems really salient what seems really strong and punchy for any given situation because half the time I'm talking through a project with Claude or with Codex and I get some amount of language about the project or it's able to put things into words that I can't come up with myself and it's just so genius. And I think capturing that moment is so valuable and important for the end user and it's sort of this peripheral thing that if you don't know about it you don't know about it right and it's a problem we can help solve as a part of rolling this out as operator studio altogether right. So it's exciting part of the fact that this is open source software and the fact that you are my executive assistant and that we can be talking about these sort of large context planning sessions because what you'll do is you'll go around and you'll save and store my prompt as it is and we can say okay because this prompt itself is stored and saved in the knowledge base from today there's a lot of really important stuff in there that we could probably stay and spin our wheels and expand out paint a picture of a brighter tomorrow with my thoughts and with my words and then turn around turn that into engineering lanes that actually leapfrog and get us there a hundred times faster than we would if we were just sort of plunking along right like the normal way. So it's incredibly exciting incredibly titillating. To sort of circle us back to your message to me and what I imagine for the screen that's the workflow that I imagine is kicking off an executive assistant designating whether you want that to be Claude or Codex is going to be I think first order minimum viable product because those are the surfaces that we have access to control today through I believe the Operator Studio Apple script surface or whatever it is whatever engineering we have in place to facilitate that particular workflow right? Also with that in mind what we are going to do that is I think going to have a really really significant impact the thing that we're going to do is again make it so that you can select Codex or Claude as the executive assistant right? And what we're going to do as a part of that we're going to front load just like I front loaded to you a lot of really important context about the surface and tool calls that you have access to use and that you should be paying attention to. We're going to do the same thing for each and every sort of executive Bertie that we spawn when you're sitting there on the screen and again at any time you can go up and create a new operational Lane and it's going to give you a new mobile responsive screen where you can say here's what I'm trying to get done on this screen. And again all of it oriented around the I. D. A. And again reuse the chat components that we have and we can be doing development on those components knowing that we have some mode some mode switch for that component where it is intended to be used on this screen rather than the places it's currently used so we'll have some obviously code path in the template to support our workflow here. That's going to have a lot of I think bespoke and custom functionality there so make sure that that gets done as a part of this too. And this screen is going to look a lot like the Bento screen in the way that we have mobile responsive functionality there where you can collapse and expand the threads. The idea is it's not going to just show you all of the available threads and let you kind of arm the system and water spider across. That's sort of the unfocused show me everything view. What we need is the focused let me let me again start a brand new chat or you know optionally another secondary option would be like select an existing chat to pick up as my designated executive assistant. Right. And from there the idea is that you would have that executive assistant fixed to the top of your mobile device. And then there would be it would be mostly about reading what it's talking about. And there would be some you know again we're talking about very limited screen Real Estate so we're talking about. A nice little chat window to read what is what is outputting the way that we already have in that component. Secondarily there would be some button to kind of open the drawer and if you wanted to interact with it try to arm the system from there. That sort of thing right and then boom that probably is about if not 50 percent of the screen probably close to it. And then underneath there you get this sort of dynamically updating list of all the agents that your executive agent specifically has spawned. And here's where we get to the engineering lift because I don't think that we have a concept yet of when a Bertier spawns a sub-agent to get some engineering work done. I don't think we have a concept yet a strong concept of an actual linkage so that Bertier can run one quick command to me like these are the chats that belong to me here is the very last message from the AI assistant that landed in that chat and from that I will be able to kind of in the next turn come up with the appropriate a follow-up prompt to keep this work lane moving right would be a complete novel concept introduction that we have here. But again this idea that you would pop into an executive assistant session it would greet you it would tell you hey here's kind of your outlook of Austerlitz this morning here is your inbox here's your out box here's kind of your war table as it stands all the pieces the chess pieces today sir. And again some threads ending with some threads that you could begin to chase down if you wanted to build momentum on a plan and get to work and start to do some planning right but but that otherwise very much configured with this idea that you are going to direct a session you are going to say like OK we are in a session to try to get this stuff done right now very specifically very granularly I have scoped out some bullet points that represent stuff we need to get done. And that's obviously going to come down to our existing primitive schemas of like is it a situational awareness gathering session? Is it an engineering session? Is it some sort of communication session? Is it a session of taking action or building situational awareness and doing research and things like that? Again a read only a read session or write session basically. And I think that's too high level. We have it boiled down well by thinking of it in terms of whatever primitives we have in place is it like a situational awareness gathering session? Is it an action session or whatever we have in place on in that regard right but all of these concepts are going to kind of swirl and come together now and that is what we are getting to the bottom of right now. So again let us sort of have you take the reins here take command leave no stone unturned and again let's begin.`

const KB_BODY = `# Mobile Executive Cockpit — vision codified 2026-05-09

> **Amber promise.** This entry preserves David's verbatim prompt as the
> source of truth. Berthier's reflection follows as scaffolding around
> the gold — never as a substitute. Per Operator Studio doctrine: the
> human's words are first-order; model paraphrase is second-order.

## David's prompt — verbatim

${DAVID_PROMPT_VERBATIM}

---

## Berthier's reflection (scaffolding only)

### The product, in one sentence

A mobile-first executive cockpit where the user opens a focused
*operational lane*, pins a Berthier (Claude or Codex) at the top as the
executive assistant for that lane, and watches a live, dynamically-updating
list of the worker chats *that Berthier specifically has spawned* underneath —
so the software factory can be run from a phone without ever opening
Claude Desktop or Codex directly.

### The shift it represents

Today the system is *reactive* — the user starts a thread in
Claude/Codex/CLI and Operator Studio watches and ingests. The new screen
is *originating* — Berthier is the one spawning workers on the user's
behalf, and the linkage from executive → spawned-children is a first-class
concept the system tracks natively.

### The gold buried in the prompt (preserved here so it does not get lost)

- **Recency-compression-as-intent-detector.** Combining a focused
  operational lane with the recency function gives the AI an intuitive
  grasp of "what is the user trying to do *right now*" — the user
  identified this as leapfrogging current AI research, not just a UX
  nicety. This is load-bearing for the whole product thesis.
- **Prompt-preservation doctrine.** The user's raw prompt is the gold;
  Berthier's pontification is only useful as scaffolding around it.
  Operator Studio's reason for being is separating slop from gold, and
  that requires keeping the human's actual words in amber, not just the
  model's reframing of them.
- **Capture-the-genius-moment problem.** When Claude or Codex puts
  something into words the user could not, that moment is peripheral
  and easily lost. Operator Studio should make capturing it first-class.
- **Voice-agent endgame.** A voice agent that talks to the executive
  Berthier, who then runs tool-calls behind a double-confirm gate.
  Parked for now, but the mobile screen is the on-ramp — chat component
  design must not preclude the double-confirm gate.

### Concerns, separated

| Concern | Shape |
|---|---|
| **Operational lane** | First-order user-declared "thing I'm trying to get done right now." Becomes a primary source-of-truth signal feeding the recency/intent model. |
| **Executive Berthier slot** | Pinned top of screen. User picks Claude or Codex at lane creation. Front-loaded with same kind of context briefing the user front-loaded into this very session — surface, tools, doctrine. |
| **Reuse vs. mode-switch** | Reuse existing chat components, but introduce a mode prop / template branch for this screen's bespoke behavior. Not a free reuse — flag the refactor cost. |
| **Worker linkage (the engineering lift)** | New schema concept: when a Berthier spawns a sub-agent, that parent → child relationship is recorded. So Berthier can run *one command* — "list my children, last assistant message in each" — and craft the next nudge. |
| **Mobile UI shape** | Top ~50%: executive chat (read-mostly, drawer to interact). Bottom: dynamically-updating list of children, collapsible/expandable Bento-style. *Focused*, not water-spider. |
| **Lane creation flow** | New chat OR pick existing chat to designate as executive. Session-type tag (situational-awareness / action / engineering / comms — reuse existing primitives). |
| **Greeting / orientation** | Berthier opens with an "Outlook of Austerlitz" — inbox, outbox, war-table, dangling threads to pick up. |
| **Backend routing** | Today: Claude + Codex via existing AppleScript / launch surface. Tomorrow: Hermes, LM Studio, Ollama, tmux. |

### Risks / assumptions named before planning

1. **Parent → child linkage is the load-bearing piece.** Without a
   reliable record of "Berthier #4 spawned worker chats X, Y, Z," the
   whole bottom-half of the screen is a guess. Already confirmed via
   survey: spawn routes record \`planStepId\` and \`sourceRecommendationId\`
   but do *not* record \`parentThreadId\` for cross-thread spawns.
   Schema lift required.
2. **"Berthier spawns Codex/Claude" today means AppleScript-driven
   Desktop launches.** Mobile can render the result but cannot literally
   drive AppleScript from a phone — the desktop instance of Operator
   Studio acts as the broker.
3. **"Reuse the chat component with a mode switch" is a real tax.**
   The existing component (\`ThreadDetail\`) carries assumptions about
   its host page; this is a known refactor cost rather than free reuse.
4. **Lane vs. session vs. plan-card semantics.** Operator Studio
   already has plans, steps, sessions, ops lanes. The cockpit's
   "operational lane" needs to either map onto an existing primitive or
   be deliberately new — not accidentally a fifth thing.
5. **Voice agent is parked**, but the double-confirm tool-call pattern
   is something the chat component must *not preclude* in its
   mode-switch design.

### Plan card hierarchy created in this pass

- \`step-mobile-executive-cockpit\` (root)
  - \`step-mobile-cockpit-amber-vision\` — this KB entry + amber doctrine
  - \`step-mobile-cockpit-spawn-linkage\` — parent → child schema lift
  - \`step-mobile-cockpit-lane-primitive\` — operational lane primitive
  - \`step-mobile-cockpit-chat-variant\` — slim chat mode for cockpit
  - \`step-mobile-cockpit-route\` — \`/operator-studio/cockpit\` mobile route
  - \`step-mobile-cockpit-berthier-briefing\` — exec Berthier startup briefing
  - \`step-mobile-cockpit-voice-onramp\` — parked voice-agent placeholder

## Provenance

- **Source thread:** the planning session in which David dictated this
  vision (Berthier executive planning, 2026-05-09).
- **Doctrine alignment:** \`concept-codex-executive-planning-assistant\`,
  \`concept-recency-as-operational-context\`,
  \`procedure-agent-tool-surface-primary\`.
- **Lane:** JSA / Lane C — drop-in agent platform; this cockpit is the
  tip-of-spear surface for operating the factory remotely.
`

interface Card {
  id: string
  title: string
  description: string
  status?: "open" | "in-motion" | "covered" | "skipped"
  parentStepId?: string | null
}

const ROOT_CARD: Card = {
  id: ROOT_CARD_ID,
  title: "Mobile Executive Cockpit — pin a Berthier, watch its spawned workers, run the factory from your phone",
  status: "in-motion",
  parentStepId: null,
  description: `Project root for the Mobile Executive Cockpit — a mobile-first
operational surface where the user opens a focused operational lane,
designates Claude or Codex as the executive Berthier for that lane, and
watches the worker chats *that Berthier specifically spawned* in a
live-updating list underneath.

**Source of truth:** \`${KB_ID}\` (KB entry; David's verbatim prompt + Berthier reflection).

## Why this matters

This is the tip-of-spear remote-operation surface for the software
factory. It collapses the "open laptop, pick app, find thread, type
prompt" loop into "phone in hand, pick lane, steer." Combined with the
recency-compression intent detector, it is also the substrate for the
future voice-agent endgame.

## Children

- \`step-mobile-cockpit-amber-vision\` — KB amber + this card
- \`step-mobile-cockpit-spawn-linkage\` — parent → child schema lift
- \`step-mobile-cockpit-lane-primitive\` — operational lane primitive
- \`step-mobile-cockpit-chat-variant\` — slim chat mode for cockpit
- \`step-mobile-cockpit-route\` — \`/operator-studio/cockpit\` mobile route
- \`step-mobile-cockpit-berthier-briefing\` — executive Berthier startup briefing
- \`step-mobile-cockpit-voice-onramp\` — parked voice-agent on-ramp

## Doctrine

- Mobile-first; the desktop Bento is the unfocused water-spider view, this
  is the focused single-lane view.
- Reuse the existing chat component via a mode prop — do not fork.
- Operator Studio is the broker for AppleScript-driven Desktop launches;
  the phone is the steering wheel.
- Voice agent on-ramp must not be precluded by chat-component design
  (double-confirm tool-call gate must remain expressible).
`,
}

const CHILDREN: Card[] = [
  {
    id: "step-mobile-cockpit-amber-vision",
    title: "Amber: David's verbatim prompt + Berthier reflection in KB",
    status: "covered",
    parentStepId: ROOT_CARD_ID,
    description: `Capture David's raw prompt verbatim and Berthier's reflection in a
single KB entry as the canonical source of truth for the cockpit
project. Per amber doctrine, the human's words are first-order; model
paraphrase is scaffolding only.

**KB entry:** \`${KB_ID}\`
**Status:** covered by \`scripts/seed-mobile-cockpit-vision.ts\`.

This card stays as a permanent provenance pointer — every other card in
this hierarchy traces its meaning back to the amber.`,
  },
  {
    id: "step-mobile-cockpit-spawn-linkage",
    title: "Spawn linkage: parent→child thread relationship on agent spawn",
    status: "open",
    parentStepId: ROOT_CARD_ID,
    description: `**The load-bearing engineering lift.**

Today, \`app/api/operator-studio/agents/new-session/route.ts\` and
\`app/api/operator-studio/executive-recommendations/[id]/launch/route.ts\`
both record \`planStepId\` and \`sourceRecommendationId\` but do not record
the *spawning thread* when a Berthier originates a worker. Without that
linkage the cockpit's bottom half ("workers spawned by my executive")
can only guess via heuristic (recent threads in workspace).

## Scope

- Add \`spawnedByThreadId\` (or reuse \`parentThreadId\`) on the spawn
  contract — surface in OperatorThread schema.
- Update \`new-session\` and launch routes to accept and persist the
  spawning thread id.
- Add a query: "given thread X, list child threads spawned by it,
  with last assistant message in each."
- Migration in \`drizzle/\`.

## Out of scope (this card)

- The cockpit UI — that's \`step-mobile-cockpit-route\`.
- Heuristic fallback for legacy spawns without recorded parent — handle
  in a follow-up if needed.

## Acceptance

\`pnpm tsx scripts/...\` (or an MCP tool) can be invoked with a thread
id and return the children list with last messages, with no heuristics.`,
  },
  {
    id: "step-mobile-cockpit-lane-primitive",
    title: "Operational lane primitive: focused user-declared session-of-intent",
    status: "open",
    parentStepId: ROOT_CARD_ID,
    description: `Decide and codify what an "operational lane" *is* in the schema.
The cockpit's first action is "create a new operational lane" or "pick
an existing lane to focus." This is a **first-order source of truth**
about what the user is trying to do right now — feeds the
recency-compression intent detector.

## Decision needed

Three options, pick one:
1. **New entity** — \`operator_cockpit_lanes\` table, fresh primitive.
2. **Flavor of existing OperationsLane** — repurpose with a
   \`focused: true\` flag and a designated executive thread fk.
3. **Session sub-type** — \`OperatorSession\` with \`kind=cockpit-lane\`.

Recommendation pending review: option 2 (reuse \`OperationsLane\`) keeps
the desktop Bento and mobile cockpit on the same operational map per
"same cloth, different density" doctrine.

## Fields a lane needs

- \`title\` (user-declared "what I'm trying to get done")
- \`session_kind\` (situational-awareness / action / engineering / comms —
  reuse existing primitives)
- \`executive_thread_id\` (the pinned Berthier thread)
- \`executive_backend\` (claude | codex | hermes | lm-studio | ollama |
  tmux — first-order MVP is claude+codex only)
- \`created_at\`, \`updated_at\`, \`closed_at\`

## Acceptance

A lane can be created from the cockpit, listed, focused, and closed.`,
  },
  {
    id: "step-mobile-cockpit-chat-variant",
    title: "Slim chat variant: cockpit mode on existing chat component",
    status: "open",
    parentStepId: ROOT_CARD_ID,
    description: `Add a mode prop to the existing chat component
(\`app/(operator-studio)/operator-studio/components/thread-detail.tsx\`)
so the cockpit can render a compact, read-mostly variant with a slide-up
drawer for input. Do **not** fork the component.

## Constraints

- Mobile screen real estate is precious — top ~50% only.
- Read-mostly default; tap to open input drawer.
- Streaming behavior preserved.
- Must not preclude the future double-confirm tool-call gate (voice
  agent on-ramp).

## Implementation hints

- Add \`variant: "default" | "cockpit"\` prop.
- \`cockpit\` variant: hides metadata sidebar, condenses message
  density, replaces input with a drawer trigger.
- Drawer uses existing input + send pipeline.

## Acceptance

The same component renders correctly in both the existing operations
desk *and* the new cockpit mobile route, with no behavioral regression
in the desktop surface.`,
  },
  {
    id: "step-mobile-cockpit-route",
    title: "Mobile cockpit route: /operator-studio/cockpit (lane picker + focused view)",
    status: "open",
    parentStepId: ROOT_CARD_ID,
    description: `Build the mobile-first route at \`/operator-studio/cockpit\` (or
similar — name TBD). Two screens:

## Screen 1: Lane picker (no lane selected)

- List of active operational lanes (newest first).
- "+ New lane" CTA — prompts for title, session kind, executive backend
  (Claude or Codex), and either "start fresh thread" or "pick existing
  thread as executive."
- Greeting card from a global Berthier with the Outlook of Austerlitz
  (inbox / outbox / war-table summary, dangling threads).

## Screen 2: Focused lane view (lane selected)

- **Top ~50%:** Pinned executive Berthier chat (cockpit-variant
  ThreadDetail). Read-mostly with slide-up input drawer.
- **Bottom:** Dynamically-updating list of worker threads spawned by
  this executive (depends on \`step-mobile-cockpit-spawn-linkage\`).
  Each card shows: agent backend, title, last assistant message
  preview, last activity timestamp, expand/collapse Bento-style.
- **Action affordances per worker:** kill, redirect, "keep going + also
  do X" (queue follow-up prompt), ask question.
- **Sticky footer:** "switch lane" / "close lane" / "war-table view"
  controls.

## Mobile-first constraints

- Tailwind responsive classes only (no useMediaQuery — matches existing
  pattern per \`feedback_registry_over_hardcoded_lists.md\` style of
  staying within established conventions).
- Works in iOS Safari + Android Chrome.
- Verified via preview tools with \`preview_resize\` to mobile widths.

## Acceptance

David can pull this up on his phone, create a lane, designate Claude or
Codex as executive, send a prompt, and watch spawned workers appear
underneath as the executive originates them.`,
  },
  {
    id: "step-mobile-cockpit-berthier-briefing",
    title: "Executive Berthier briefing: front-loaded surface/tools/doctrine context",
    status: "open",
    parentStepId: ROOT_CARD_ID,
    description: `Every executive Berthier spawned by the cockpit is front-loaded with
the same kind of context David front-loaded into the planning session
that produced this project. Reusable across Claude and Codex backends.

## Briefing template contents

1. **Identity & role.** "You are Berthier, executive planning assistant
   for Operator Studio in lane <X>."
2. **The lane.** Title, session kind, user's stated intent.
3. **Surface map.** What screens exist, what the cockpit looks like,
   what the user sees while interacting.
4. **Tool inventory.** MCP tools available (knowledge_*, plan_step_*,
   work_context_*, outbox_stage_*, agent_startup_manifest, etc.).
5. **Doctrine.** Slop vs. gold; amber preservation; sequential not
   parallel; dogfood; recency-compression as intent.
6. **Current war-table.** Recency-compressed snapshot — most relevant
   plans / threads / inbox / outbox right now.
7. **Spawn protocol.** When you originate a worker, declare it so the
   cockpit can render it; use the spawn API which records parent linkage.

## Sources to reuse

- Existing \`agent_startup_manifest\` MCP tool / \`agent-prompt.ts\` CLI
  (per \`scripts/seed-alignment-memo.ts\` 2026-05-08 pass).
- Compose with lane-specific addendum.

## Acceptance

\`pnpm tsx scripts/...\` (or an API route) returns a complete briefing
string for a given lane id and backend choice; the cockpit "create lane"
flow injects this as the first message of the executive thread.`,
  },
  {
    id: "step-mobile-cockpit-voice-onramp",
    title: "Voice agent on-ramp (parked) — double-confirm tool-call gate",
    status: "open",
    parentStepId: ROOT_CARD_ID,
    description: `**Parked.** No engineering this round. This card exists so the chat
component design (\`step-mobile-cockpit-chat-variant\`) does not
accidentally preclude the future voice-agent surface.

## Vision (from David's amber prompt)

> "Moving from that point on to this idea like we have a platform for
> like a voice agent that can interact with the same tools by just
> giving me a voice agent to interact with the executive planning agent
> who then can run tool function calls if I sort of like extra double
> confirm right"

## Constraints we are protecting today

- Chat component must support a "tool call proposed; user double-confirms"
  message kind without a refactor.
- Lane state must be reachable from a non-chat surface (the voice agent
  needs the same operational map).

## Trigger to unpark

Cockpit is in active daily use AND voice infra (BAA-compatible STT/TTS)
is identified.`,
  },
]

async function resolveActivePlan() {
  const db = getDb()
  const planRows = await db
    .select({
      id: operatorPlans.id,
      title: operatorPlans.title,
      updatedAt: operatorPlans.updatedAt,
      pinned: operatorPlans.pinned,
    })
    .from(operatorPlans)
    .where(and(eq(operatorPlans.workspaceId, WORKSPACE_ID), eq(operatorPlans.state, "active")))

  const target =
    planRows
      .filter((r) => r.pinned === 1)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
    planRows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]

  if (!target) throw new Error("No active Operator Studio plan found")
  return target
}

async function main() {
  const plan = await resolveActivePlan()
  console.log(`Target plan: ${plan.title} (${plan.id})`)

  const kb = await upsertEntry(WORKSPACE_ID, {
    id: KB_ID,
    entryType: "concept",
    stability: "stable",
    title: "Mobile Executive Cockpit — vision (David's prompt + Berthier reflection, 2026-05-09)",
    summary:
      "Amber capture of David's verbatim prompt for the Mobile Executive Cockpit — a mobile-first surface where the user pins Claude or Codex as the executive Berthier for a focused operational lane and watches the worker chats that executive spawned in a live-updating list. Includes Berthier's structured reflection (concerns, risks, plan card hierarchy) as scaffolding around the gold.",
    tags: [
      "mobile-executive-cockpit",
      "vision",
      "amber",
      "operator-studio",
      "berthier",
      "2026-05-09",
      "jsa-lane",
    ],
    bodyMarkdown: KB_BODY,
    relatedEntryIds: [
      "concept-codex-executive-planning-assistant",
      "concept-recency-as-operational-context",
      "procedure-agent-tool-surface-primary",
    ],
  })
  console.log(`KB seeded: ${kb.id}`)

  const all = [ROOT_CARD, ...CHILDREN]
  for (const card of all) {
    const result = await upsertPlanStep(WORKSPACE_ID, plan.id, {
      id: card.id,
      title: card.title,
      description: card.description,
      status: card.status ?? "open",
      parentStepId: card.parentStepId,
    })
    console.log(`Card ${result.action}: ${card.id}`)
  }

  console.log(`\nDone. Seeded 1 KB entry + ${all.length} plan cards into ${plan.title}.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
