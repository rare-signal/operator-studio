import { sql } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"

const workspaceId = "global"
const now = new Date()
const validAt = "2026-05-06T12:00:00.000-07:00"

type Entry = {
  id: string
  entryType: string
  stability: string
  title: string
  summary: string
  bodyMarkdown: string
  tags: string[]
  relatedEntryIds?: string[]
}

type Claim = {
  id: string
  subject: string
  statement: string
  confidence: number
  sourceExcerpt: string
}

const conversationCitation = [
  {
    kind: "thread",
    label: "Codex working thread, 2026-05-06",
    excerpt:
      "User described the Valikharlia direction as a multiplayer story engine with D&D, Chrono Trigger, Quantum Leap, SimCity/Age of Empires, LLM NPCs, story beats, and agentic authoring.",
  },
]

const entries: Entry[] = [
  {
    id: "concept-valikharlia-engine-north-star",
    entryType: "concept",
    stability: "draft",
    title: "Valikharlia Engine — North Star Vision",
    summary:
      "A customer-of-one, agent-operable multiplayer narrative engine where players inhabit scenario roles, make consequential actions, and preserve canon through story beats.",
    tags: [
      "valikharlia",
      "north-star",
      "game-engine",
      "story-engine",
      "llm-npcs",
      "agentic-authoring",
    ],
    relatedEntryIds: [
      "pattern-valikharlia-engine-current-plan",
      "anomaly-valikharlia-engine-storm-clouds",
    ],
    bodyMarkdown: `# Valikharlia Engine — North Star Vision

Valikharlia is not just a Graal-compatible archive viewer. The fork point is a new multiplayer narrative game engine: a small group of players can drop into a shared pixel world, walk around, chat, roll dice, act in character, and move through authored or AI-assisted story beats.

The strongest framing is: **a multiplayer RPG table inside a living 2D world, operated by a human creator and their agent.**

## Premise

The core story image is intercepted souls. Players may begin with their own character, but a scenario can place them into temporary bodies and roles: a paladin, mage, baker, Grand Vizier, ordinary knight, mayor, governor, lord, or any other role a scene needs. The important distinction is:

- **Player**: the human at the keyboard.
- **Character**: the person they bring across sessions.
- **Role-in-beat**: the body/social position they occupy for a specific scene.

That separation lets a player be "the same person" while being temporarily overwritten by a scenario role, Quantum Leap style, without losing authorship or continuity.

## Intended Use

The primary customer is a customer of one: the creator will not write code by hand. They will focus on art direction, narrative, scene design, emotional beats, and playtesting. Codex/agents should perform implementation work by editing scenario manifests, content files, runtime adapters, and engine primitives.

The engine should therefore optimize for **agentic authoring ergonomics**. The best authoring surface is a thin, explicit contract that an agent can safely modify:

- scenario manifests
- beat definitions
- role briefs and private truths
- NPC intent packets
- cutscene/staging scripts
- enabled gameplay systems
- canon ledger entries

## Core Experience

Most of the time, the experience should remain simple: run around, chat, read, inspect, roll dice, and declare actions. The game becomes special when those simple actions are lifted into consequence:

- A player says something in chat.
- A player declares an action with intent.
- A world master, rules engine, or LLM-backed NPC responds.
- The result becomes a durable beat in the canon ledger.

The engine should support both high-resolution scenes and low-resolution world simulation. A hallway confrontation can play out moment by moment; a famine, mayoral term, war, or generational arc can be advanced by summarizing time and then zooming back into a dramatic moment.

## Inspirations

The engine borrows the feel of D&D sessions, Chrono Trigger scene craft, SNES turn-based RPG clarity, Quantum Leap identity shifts, SimCity/Age of Empires macro views, and forum/play-by-post roleplay, but the product shape is its own thing: live multiplayer narrative with AI as a bounded scenario runtime.

## Design Rule

Prefer scenario-authored features over generic MMO gravity. Do not build "everything an online game might need" first. Build the smallest primitives that let a human creator and their agent create a compelling playable beat.`,
  },
  {
    id: "pattern-valikharlia-engine-current-plan",
    entryType: "pattern",
    stability: "draft",
    title: "Valikharlia Engine — Current Plan And Next Slices",
    summary:
      "The next foundation is scenario manifests, turn-aware beats, durable action/canon logs, level-aware NPCs, and readable scene tools.",
    tags: [
      "valikharlia",
      "roadmap",
      "scenario-manifest",
      "turns",
      "canon-ledger",
      "npc-runtime",
    ],
    relatedEntryIds: [
      "concept-valikharlia-engine-north-star",
      "anomaly-valikharlia-engine-storm-clouds",
    ],
    bodyMarkdown: `# Valikharlia Engine — Current Plan And Next Slices

The prototype already has enough structure to treat it as a game engine fork: browser-native 2D levels, multiplayer presence, chat, dice, table overlays, cutscene phases, scenario loading, NPC actors, and a first \`intercepted-souls-hallway\` scenario.

The immediate job is to convert that promising prototype into a repeatable scenario runtime.

## What Exists Now

- Graal/archive assets and levels can be used as compatibility input and inspiration.
- \`valikharlia-engine\` has a browser runtime and local server.
- Players can walk, chat, use GANI/action experiments, and share room state.
- Table tools introduced dice, overlays, phases, and stage directions.
- Scenario support has begun with \`intercepted-souls-hallway\`.
- Cutscenes can stage actors and present one line at a time.
- The runtime has begun separating normal chat from action declarations via commands such as \`/act\`.
- Early abstractions such as \`faceAt\` point toward LLM-friendly staging tools.

## Foundation To Hit Next

1. **Scenario manifest as the authoring contract**

   A scenario should declare level, room, roles, NPCs, systems, phases, beats, cutscenes, victory/pressure conditions, private role briefs, and enabled mechanics. Codex should be able to create or revise a scenario mostly by editing these files.

2. **Story beats as first-class records**

   A beat is the unit of consequence. It should capture setup, participants, active roles, hidden pressures, player declarations, NPC responses, adjudication, and canon deltas.

3. **Turn mode**

   Add explicit modes such as \`free_roam\`, \`soft_turns\`, \`hard_turns\`, \`reaction_window\`, and \`resolved\`. One-at-a-time readability matters. The system should always know who is speaking, who is being addressed, and whose action is currently expected.

4. **Action declarations distinct from chat**

   Chat is color and roleplay texture. Action declarations are canon candidates. The engine needs a clear lane where a player says, "I step between the Captain and the Vizier," and the system can adjudicate it.

5. **NPC runtime with bounded tools**

   LLM NPCs should not calculate pixels, infer direction math, or invent state. Give them compact perception packets and safe tools: \`sayTo\`, \`faceAt\`, \`moveToMark\`, \`emote\`, \`wait\`, \`offerChoice\`, \`requestRoll\`, and \`recordBeatDelta\`.

6. **World-master review loop**

   The creator should be able to accept, rewrite, or let the AI auto-send an NPC response. The same flow should later cover generated dilemmas, cutscenes, sprite prompts, and canon summaries.

7. **Readable scene presentation**

   One speaker at a time, directed speech, collision-aware bubbles, a legible event log, optional big/fullscreen transcript mode, and enough staging language that scenes feel intentional rather than noisy.

8. **Durable persistence**

   Chat logs, dice, action declarations, stage directions, and beat/canon summaries need durable backing. In-memory room state is fine for experiments but not for the story engine.

## Later But Important

- Character studio and sprite generation.
- Picture-backed levels with paintable collision.
- World map / macro simulation views.
- Rules modules for combat, magic, governance, investigation, rhythm/QTE, or other scenario-specific modes.
- Permissioned world-master tools before any public play.`,
  },
  {
    id: "anomaly-valikharlia-engine-storm-clouds",
    entryType: "anomaly",
    stability: "draft",
    title: "Valikharlia Engine — Storm Clouds And Guardrails",
    summary:
      "The paradise has real weather: scope explosion, unclear authority, LLM mush, fragile authoring, readability, persistence, and identity/canon complexity.",
    tags: [
      "valikharlia",
      "risks",
      "guardrails",
      "scope",
      "llm-safety",
      "architecture",
    ],
    relatedEntryIds: [
      "concept-valikharlia-engine-north-star",
      "pattern-valikharlia-engine-current-plan",
    ],
    bodyMarkdown: `# Valikharlia Engine — Storm Clouds And Guardrails

The vision is powerful because it wants to be wide open. That is also the danger. These are the risks to keep visible while building.

## Scope Gravity

"Any world, any setting, any gameplay mode" can become a stack of half-finished systems. Guardrail: every new mechanic should serve a playable scenario beat. Build vertical slices, not an abstract universal engine.

## Authority Confusion

The system needs to know who decides truth: player, world master, rules engine, LLM NPC, or server. If authority is implicit, the AI will accidentally become the canon author. Guardrail: separate chat, action declaration, adjudication, and canon commit.

## LLM Mush

If NPC dialogue, player chat, stage directions, and resolved outcomes all land in the same undifferentiated stream, the experience becomes roleplay soup. Guardrail: give each event a typed lane, source, target, and consequence level.

## Agentic Authoring Fragility

The creator does not want to write code. If every scenario change requires spelunking runtime JavaScript, the platform loses its premise. Guardrail: make manifests and content files the main interface; runtime changes should add reusable primitives.

## Readability Failure

The game can be visually charming and still fail if speech overlaps names, three lines fire at once, or players cannot tell who is speaking to whom. Guardrail: one-at-a-time scene playback, directed speech, bubble avoidance, and durable readable logs.

## NPC Grounding

LLM NPCs will hallucinate geography, social facts, and invisible motivations unless the server gives them a compact truth packet. Guardrail: pass level-aware perception, nearby actors, current beat, private motives, and allowed tools; never ask the model to infer everything from vibes.

## Persistence Gap

In-memory room events are enough for a toy, but story requires replayable history. Guardrail: persist chat, dice, table events, action declarations, beat summaries, and canon deltas.

## Identity Complexity

Player, bring-your-own character, temporary role, body, and NPC can diverge. Guardrail: model the identity stack explicitly before canon records depend on it.

## Archive vs Engine

The Graal archive compatibility layer is valuable, but the new game should not be trapped by archive-era assumptions. Guardrail: treat archive assets/levels/scripts as inputs and compatibility references; keep Valikharlia scenario runtime cleanly forked.

## Early Scale Temptation

Large multiplayer scale is exciting, but the current strongest product is intimate: 4-6 players, maybe 12, with deeply consequential narrative. Guardrail: optimize for great small sessions before chasing MMO numbers.

## World-Master Power Tools

Current dev tools trust everyone. That is fine locally, dangerous later. Guardrail: add permissions and audit trails before friend/public sessions.`,
  },
]

const claims: Claim[] = [
  {
    id: "claim-valikharlia-agentic-authoring-customer-of-one",
    subject: "Valikharlia authoring model",
    confidence: 0.96,
    statement:
      "The creator wants Valikharlia optimized for a customer-of-one workflow where they focus on art and narrative while Codex or another agent writes implementation details.",
    sourceExcerpt:
      "User said they are never going to write code, will focus on artistic/narrative work, and wants agents to implement the systems.",
  },
  {
    id: "claim-valikharlia-player-character-role-separation",
    subject: "Valikharlia identity model",
    confidence: 0.94,
    statement:
      "Valikharlia needs to distinguish player, bring-your-own character, and temporary role-in-beat so scenarios can overwrite a player into another body while preserving authorship and continuity.",
    sourceExcerpt:
      "User described bring-your-own characters being placed into other bodies for a scene while preserving that the player operated that person at that time.",
  },
  {
    id: "claim-valikharlia-beats-canon-core",
    subject: "Valikharlia story architecture",
    confidence: 0.95,
    statement:
      "Story beats and a durable canon ledger are the core architecture for turning live chat, action declarations, dice, NPC responses, and adjudication into consequential narrative history.",
    sourceExcerpt:
      "User emphasized story beats, replayable situations, consequential inputs, and continuity/canon across worlds.",
  },
  {
    id: "claim-valikharlia-action-declarations-not-chat",
    subject: "Valikharlia interaction model",
    confidence: 0.92,
    statement:
      "Valikharlia should separate ordinary chat from action declarations because actions are canon candidates that may need turn order, adjudication, dice, and NPC responses.",
    sourceExcerpt:
      "User asked for turn-based one-at-a-time consideration and described players needing to step between NPCs or respond as their character.",
  },
  {
    id: "claim-valikharlia-llm-tool-abstractions",
    subject: "Valikharlia LLM runtime",
    confidence: 0.93,
    statement:
      "LLM NPCs should operate through bounded scene tools and perception packets rather than raw map math, minimizing the model's lift while improving on-screen scene quality.",
    sourceExcerpt:
      "User asked for a codified abstraction layer so the LLM does as little lift as possible to create compelling scenes, with parameters in a preconfigured environment.",
  },
  {
    id: "claim-valikharlia-small-session-first",
    subject: "Valikharlia scale target",
    confidence: 0.88,
    statement:
      "The near-term multiplayer target is intimate sessions of roughly 4-6 players, with 12 feeling like an upper bound for certain scenarios, before pursuing large-scale concurrency.",
    sourceExcerpt:
      "User reframed toward 4-6 players and maybe 12 after earlier large-scale exploration.",
  },
  {
    id: "claim-valikharlia-scenario-manifest-contract",
    subject: "Valikharlia implementation plan",
    confidence: 0.9,
    statement:
      "Scenario manifests should become the primary contract that agents edit: levels, roles, NPCs, systems, beats, cutscenes, stage marks, and enabled gameplay modules.",
    sourceExcerpt:
      "The implemented fork introduced intercepted-souls-hallway as a manifest-backed scenario and the discussion moved toward agent-authored content instead of hand-built UI tools.",
  },
  {
    id: "claim-valikharlia-readability-is-gameplay",
    subject: "Valikharlia presentation",
    confidence: 0.91,
    statement:
      "Readability is gameplay in Valikharlia: scenes need one speaker at a time, directed speech, and collision-aware bubbles/logs so players can understand what is happening.",
    sourceExcerpt:
      "User complained that too much speech happened at once and later asked for intelligent text avoidance around chat/name collisions.",
  },
]

async function upsertEntry(entry: Entry) {
  await getDb().execute(sql`
    INSERT INTO operator_kb_entries (
      id,
      workspace_id,
      entry_type,
      stability,
      title,
      summary,
      body_markdown,
      tags,
      related_entry_ids,
      source_thread_id,
      source_passage_ids,
      citations,
      last_user_edit_at,
      last_user_edit_by,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${entry.id},
      ${workspaceId},
      ${entry.entryType},
      ${entry.stability},
      ${entry.title},
      ${entry.summary},
      ${entry.bodyMarkdown},
      ${JSON.stringify(entry.tags)}::jsonb,
      ${JSON.stringify(entry.relatedEntryIds ?? [])}::jsonb,
      NULL,
      '[]'::jsonb,
      ${JSON.stringify(conversationCitation)}::jsonb,
      ${now},
      'codex',
      ${JSON.stringify({
        seededBy: "scripts/seed-valikharlia-kb.ts",
        project: "valikharlia-engine",
        source: "Codex local conversation and valikharlia-engine docs",
      })}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      entry_type = EXCLUDED.entry_type,
      stability = EXCLUDED.stability,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      body_markdown = EXCLUDED.body_markdown,
      tags = EXCLUDED.tags,
      related_entry_ids = EXCLUDED.related_entry_ids,
      citations = EXCLUDED.citations,
      last_user_edit_at = EXCLUDED.last_user_edit_at,
      last_user_edit_by = EXCLUDED.last_user_edit_by,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at,
      version_count = operator_kb_entries.version_count + 1
  `)
}

async function upsertClaim(claim: Claim) {
  await getDb().execute(sql`
    INSERT INTO operator_kb_claims (
      id,
      workspace_id,
      statement,
      subject,
      confidence,
      source_thread_id,
      source_message_id,
      source_passage_id,
      source_excerpt,
      valid_at,
      superseded_by_id,
      cited_by_entry_ids,
      model_provider,
      model_name,
      prompt_version,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${claim.id},
      ${workspaceId},
      ${claim.statement},
      ${claim.subject},
      ${claim.confidence},
      NULL,
      NULL,
      NULL,
      ${claim.sourceExcerpt},
      ${validAt},
      NULL,
      ${JSON.stringify([
        "concept-valikharlia-engine-north-star",
        "pattern-valikharlia-engine-current-plan",
        "anomaly-valikharlia-engine-storm-clouds",
      ])}::jsonb,
      NULL,
      NULL,
      'valikharlia-kb-seed-v1',
      ${JSON.stringify({
        seededBy: "scripts/seed-valikharlia-kb.ts",
        project: "valikharlia-engine",
      })}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (id) DO UPDATE SET
      statement = EXCLUDED.statement,
      subject = EXCLUDED.subject,
      confidence = EXCLUDED.confidence,
      source_excerpt = EXCLUDED.source_excerpt,
      valid_at = EXCLUDED.valid_at,
      cited_by_entry_ids = EXCLUDED.cited_by_entry_ids,
      prompt_version = EXCLUDED.prompt_version,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  `)
}

async function main() {
  const db = getDb()

  await db.execute(sql`
    INSERT INTO workspace_modules (
      workspace_id,
      module_key,
      enabled,
      config_json,
      enabled_at,
      enabled_by
    )
    VALUES (${workspaceId}, 'knowledge_base', 1, '{}'::jsonb, ${now}, 'codex')
    ON CONFLICT (workspace_id, module_key) DO UPDATE SET
      enabled = 1,
      enabled_at = EXCLUDED.enabled_at,
      enabled_by = EXCLUDED.enabled_by
  `)

  for (const entry of entries) {
    await upsertEntry(entry)
  }

  for (const claim of claims) {
    await upsertClaim(claim)
  }

  console.log(
    `Seeded ${entries.length} Valikharlia KB entries and ${claims.length} claims into workspace "${workspaceId}".`
  )

  await getPgPool().end()
}

main().catch(async (error) => {
  console.error(error)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
