/**
 * Seeds the Clarifying Media Group "Software Factory" nucleus into
 * Operator Studio.
 *
 * Captures the 2026-05-08 brief: Operator Studio becomes the agentic
 * intelligence loop that lives in Microsoft Teams + Azure DevOps,
 * dispatches Claude/Codex workers against the Telegento product, and
 * gates every outbound communication behind David's keys.
 *
 * - Upserts KB entries: doctrine, patterns, anomaly, verbatim brief, todo.
 * - Upserts plan steps under the active plan as independent work lanes.
 *
 * Run:
 *   node --import tsx --import ./scripts/tsx-loader-register.mjs \
 *     scripts/seed-software-factory-nucleus.ts
 */

import { sql } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { getActivePlan, upsertPlanStep } from "../lib/operator-studio/plans"
import {
  upsertEntry,
  type KbEntryType,
  type KbStability,
} from "../lib/operator-studio/knowledge"

const workspaceId = "global"
const now = new Date()

type EntrySeed = {
  id: string
  entryType: KbEntryType
  stability: KbStability
  title: string
  summary: string
  tags: string[]
  bodyMarkdown: string
  relatedEntryIds?: string[]
}

const VERBATIM_BRIEF_2026_05_08 = `_(Verbatim transcription of David's 2026-05-08 dictation. Punctuation lightly normalized for readability; nothing rephrased.)_

> All right, cool, check this out. I see that this was posted an hour ago. It looks like potentially a big blob of text went in. I would prefer something a little bit more human readable, right, but we can roll that into what I'm about to talk to you about, which is to say that I would like to now kind of codify this as a formal production system in Operator Studio. And again, there are bits and pieces here that we have touched upon but we need to kind of cable manage here and get everything re-implemented in a new interface that is strictly focused on managing this workflow because it is turning into kind of a heavy duty Tonka truck workflow here. Basically what we're trying to do is we're trying to make it so that effectively an agentic intelligence lives in Microsoft Teams and lives in Microsoft Azure DevOps, right? And what that means is we have implemented through Operator Studio some kind of a context that says here is where we would like this LLM to be watching and here are the rules under which we would like it to be interacting. We need to kind of flesh that system out, right? We need to build the schema that would power that system if we were to change it up and say we want you to be an agentic intelligence that sort of manages our Atlassian status page, right? And sort of is in charge of that and we communicate it through this and we expect you to be able to do that because you have function call, tool call of that, right? And we've already kind of gone end-to-end to implement what it is that we would need for this. We've already gone as far as sort of ingesting live data from Azure DevOps in one way or another. I don't know what the full end-to-end looks like for that but again gaining that level of situational awareness and kind of fulfilling this next requirement as a plan is going to be our next step of establishing this as a formal software factory because again just to reiterate it because it's a little bit of a big responsibility to have on our shoulders we are Lieutenant Barclay right now in that epilogue. We're going to be in that episode where he hooks himself up to the enterprise main computer right in no in no small regard that is what we are right now. People are looking to us to basically save the day stand this software factory up and to basically introduce an intelligence loop into the development of TeleGento and the management of the roadmap and requirements and delivery of work packages through Azure DevOps. They're looking to us to do that now so we can think of Azure DevOps as the communication layer where human beings will interface with machine right and what that what that's going to mean is and I'm going to I'm going to lay all this out in this message to you right now that I'm dictating and you can be responsible for turning around and comprehensively codifying that in our knowledge base not in terms of only just copying my exact message in but also then your pontifications on the matter as well to kind of let that sprawl out for us as well to kind of paint out what this plan should entail. As we build it because we're going to be spinning up some level of executive planning again we're going to spin up one main cloud instance that has the ability to spin up other cloud instances and pay attention to and manage those. We have other stuff to do in addition to that that could potentially have come into play here like testing out the cloud code CLI as maybe the master planner because that doesn't need that that can be completely headless whereas we have automation in place that actually interacts with the Cloud Code Desktop app in a way that it needs to be front and center and the user needs to understand when those actions are taking place you can kind of accidentally cause it to misfire and error out if you are holding the mouse down right so this idea that the penultimate sorry the actual paramount implementation of this is going to be its own computer and potentially we move this over to the MacBook Air instead of the actual workstation that i use so that we can move this again we could we can move this to anywhere we can move this to the cluster and we have yet to for example swap in like a Hermes agent as the core kind of planning component i i absolutely am almost giddy with excitement at the opportunity that we have in front of us to test out Hermes as the replacement layer for Codex as our executive planning agent because that's going to be a really smart system to kind of use to interact with uh our our back-end data layer interact with operator studio plans and again be that person that dispatches Claude code agents to come back and can very closely adhere to the rules that i lay out and the rules that i specify in terms of the outputs that i expect from those agents in terms of the tags that i expect from those agents to interact with operator studio and show me on my dashboard readout when i go to the web ui to show threads are completed appropriately right i want to see the green check mark i want to see everything there right just painting out the requirements for you when you go to uh turn around and put this in there now uh we need to on the operator studio side uh we need to kind of codify our responsibility as it pertains to the software factory that we're going to be interacting with through microsoft teams and through azure devops because with that in mind you know we've got something that's actually pretty important here we need to solidify the layers and just like we have a system to kind of arm and approve you know kind of the flow of what could be very volatile um computer instructions through operator studio we have a system to arm that so you can't just kind of willy-nilly do that over the web ui uh with no constant like i need to be here to punch in the pin number that exact same approach and workflow needs to be codified in terms of any kind of outbound posting in the same way that we just did and we left a comment on that azure devops let's see uh ticket number 39 right there we left a comment that that happened i didn't actually approve that i'm looking at this language right here this went up without my approval so right away we kind of broke our own rule immediately first step out the door we kind of broke our own rule on that one so we're gonna go ahead and codify make sure that doesn't happen again the way that we're gonna make sure that doesn't happen again is we're gonna put in place a system so that if i haven't specifically armed and allowed external outbound communication from the llm right just to kind of codify so that even even if it tries right even if it tries to call that we need to obfuscate any kind of sort of circumvention method that it might be able to accidentally leak and expose to itself in terms of the ability to access the azure devops stuff uh we need to completely gate and restrict any outbound control of posting to azure devops updating task status uh posting to microsoft teams requesting update from someone i again if the llm is turning to interact with one of these systems it means that it thinks that something is important enough to get the attention of a human being and that is not a willy-nilly thing that is something sacrosanct that is something to be protected that is something that david needs to approve each and every time by allowing that outbound communication to go out by allowing that notification to pop up on the desk of somebody else on the team right i need to be the one the arbiter the holder of the keys and to end with that and again the approach and infrastructure that we're going for here is again make me an outbox that lives in operator studio where my agent is sort of like saying i would love to put this here i should be able to kind of smoke test bring it up as its own template as its own page and again this is something to throw in the requirements right make its own page that that uh is wrapped around the data element of a request in the outbox that the llm would like to put i want to put this here in microsoft teams i want to put this here in azure devops right i want to interact with this layer of the software factory i would like to get the attention of this human being because i understand their place in the overall or all it means that they hold the keys to whatever context or access it is that i need right thinking about it in these terms and codifying making sure first of all everything i'm telling you right now is codified itself in the knowledge base i'm talking about just straight up copy and paste what it is that i'm telling you and secondarily to make sure that at every lever every layer uh and level of this that we're building you are respecting and codifying that as well so that's going to be a piece of that that's going to be a piece of this in general uh we need to think about um okay one dependency here that we need to we can we can simply reflect this through the addition of uh this being one step in our overall plan to kind of pause and circle back but we need to merge up all the existing plans in operator studio there's a big mess in there we've got stuff that is in one plan that should be an another plan we are not making full use of the plans as it stands right now and i think potentially most egregiously uh and most problematically uh even in the user interface i'm not capable of switching the plan or having that make any difference because i think we only ever stubbed out the concept of a plan and didn't actually implement any proper air gapping unless of course i was able to send off a Claude agent to get something done in that regard uh right so that's another piece of this but basically what it is that I'm getting at here is uh there's no getting around it i was debating whether or not this was going to be necessary or not um and again i don't want us to get caught up in too much hard coding and too much sort of bespoke construction but again i also don't want us to shy away from that if it would be potentially valuable to break off and create more focused UI and more focus back in business logic because this is never going to go away we're going to be working this and we're going to be wanting to scale this up too so it's worth fleshing this out and building kind of abstracted systems behind this knowing that this is just one kind of scale up lane and however we want to handle the taxonomy and whatever we want to be calling these aspects of the project uh is part of of what we know need to be codifying documenting pontificating agonizing and ruminating on uh as a part of this overall thing so what i'm asking you for is kind of to kick us off in an again an agonizing rumination of the plan for a proper a focus UI with regards to the software factory that we just stood up for clarifying media group to work on what we will be a plan called telegento in which we will have many tasks many knowledge base articles that are specific to that project as well as many many threads and chats that take place in there obviously which will themselves ultimately result in some level of completion of this thread is done and or sorry not and or but in addition to and and the the many many sort of outbound attempts to reach systems like Azure devops and outbound attempts to reach systems like Microsoft teams so that through David Lin Clark these these work packages can be moving forward uh and for example in the case of task number 39 calls need enroll here id to correlate back to dialer the context was said that the everything was needed they the team told us everything was needed in terms of context and was available in that ticket if that's not the case that's not David Lin Clark's problem that is their problem and that if the agent does work and comes back with for example one of the temporary air gapped accessible Dev URLs that we just stood up as a part of that last work package we sat through to be able to more easily and capably send preview instances to the team that actually leverages and taps into real production data but allows you to preview on a development instance what a feature could potentially look like when you crop in you sort of you sort of get in to the level of production data people can tell us they want to elevate that people can tell us they would love to see that promoted up to the production instance so they can actually use it right because what they're going to get is a sort of temporary and again maybe we can use this as an excuse to start tapping into work trees and again I don't know where that would go in our overall plan but when I talk about this stuff I sort of am speaking across telegento speaking across the context domain of operator studio and we're touching on a lot of different stuff so first and foremost we need to unsplit these hairs we need to unsplit this brain right is there is an aspect of this that we need to kind of check that check box and that's that's taking us a while. So we're kind of still pussing around here at the bottom of the base camp with all this. But the idea is we need to fully stand up and move forward with the considerations of a lot of this. And it's going to come down to the Software Factory page for Clarifying Media Group, where we build Telegento and do other things basically to codify. We have access to AWS. These are the systems at play in the implementation of Telegento. This is everything that an agent needs to know if it's going to do any amount of work related to this software factory, an agent should never, for example, be confused whether it is working on operator studio or working on Telegento. It should never be confused about what part of Telegento or what screen or what code path it is chasing down. It should never be confused about the context of the org structure. And when it is appropriate if ever, for the context of any given chat that it should escalate and promote activity and happenstance to, for example, an Azure DevOps ticket or to post an update in a Microsoft Teams post and thread. And again, these are the aspects of the software factory that are germane. To kind of be documenting and to be codifying into strict, stringent implementation requirements at this point and to be doing that level of agonization. Now that it is Friday, we can be I don't really care that it's Friday. I'm absolutely happy to be bothering people with updates about this stuff over the weekend if it means that they can come back early Monday morning and again be submitting feedbacks. If there's any future requests or bug requests or things sort of look weird in this way. I would like to spin off like an agent to do something about it. And that again the integration to my local implementation of operator studio will be intelligent enough that as soon as that is ready on AWS it is going to sort of fire off an instance of whatever it is right within the database so that that person and again this can be public. This can be completely public to the full organization so that when somebody requests a feature telegento can pop off right and it will take anywhere from 15 to 20 minutes so we can be very real and very honest in the user interface when people submit this and they check the box and they say yes I'm sure I would like to request a a. Preview anyway we basically have to explain it to the user because this is something unprecedented that has not ever existed and it's an extreme level of power but what it's actually going to do is fire off again into my inbox and we'll have that on the actual screen I mentioned to you before the concept of the outbox as in the LLM would like to send a message here to this person. That's where yours truly will step in and proofread whatever it is but the inbox likewise is this idea of like things can come in and it's read only so I absolutely have no problem if the LLM or if the AI assistant is ever interested especially in the course of just a generic sweep of to do's and a sweep of active work and active plans etc etc etc. I have absolutely no qualms whatsoever if it wants to pop in again look at the situation maybe even run a few read only queries of some external context over an AWS or somewhere else as long as again it falls within the bounds of being read only we cannot be obviously updating thing no you know what I think not even right well the way that we need to structure this is when things come in if there is sort of any initial thoughts that the assistant has as a result of that they can log them. In operator studio and say like oh look you know here's kind of how I feel about this if it would like to collect any of that peripheral. If any collect any of that peripheral context or data that would help in the decision making then I think the way that I would like to see that reflected is again a prompt request to say that the user if you would like to approve. The ai assistance sort of continuation of the collection of situational awareness or again if it is a simple sort of engineering task they can just kick off immediately whatever needs to happen there but. I would like to see user gated approvals basically both on the inbox and outbox side if that makes sense and basically get this to a point where it is a really really strong. Way to assess analyze. And discuss in coming work work that's in flight work this you know active. Situations that are active right we need I think again to spend a little bit of time going back and forth after you take all these dictations down make sure that that the full. Breadth and depth of my words is sort of reflected and codified and I would like you know with with that in mind I would like to kick off with you the shape of what some what that could look like and again flagging this and tagging this so that you can pull up all of the resources related to specifically this this message that I'm giving you now because we're about to. We're about to kind of open Pandora's box and get into the sticky wicket so again do all that and I would love for I think the thing that you come back to me with is. A not only that you've told me you've sort of logged every a possible aspect of this in our operator studio but that you have kind of a checklist of next steps for us.

---

## Themes pulled from the brief

1. **Operator Studio = the agentic intelligence loop.** Lives across Microsoft Teams and Azure DevOps. Watches per defined rules; interacts per defined rules.
2. **Generalizable schema.** Same pattern must apply if we point the loop at Atlassian status, Linear, Slack, etc. Build the contract; instantiate the surface.
3. **Lieutenant Barclay framing.** People are looking to us to save the day. The factory is the enterprise main computer; we are the bridge.
4. **Outbound = sacrosanct.** Hot-mode-style PIN gate must protect every outbound action: ADO comments, ADO state/priority/assignee changes, Teams posts, stakeholder pings. Server-level — not UI-only — and obfuscated against agent self-circumvention.
5. **The 2026-05-08 ADO #39 comment posted without explicit per-message approval is the rule break that drives this work.** Codified in the anomaly KB.
6. **Outbox.** Each pending outbound action is a row with its own preview page. David proofreads the exact text + target. PIN-armed approval flips it to send.
7. **Inbox.** Read-only ingest of upstream events (ADO, Teams). LLM may log initial thoughts and run read-only external queries as context. Continuation of context-collection or any engineering action requires user approval.
8. **Plan air-gap is a known stub.** Plan switcher in UI does not actually scope context. Plans sprawl; cards live in the wrong plan. Merge-up + real air-gapping is in scope.
9. **Software Factory + Product schema.** A factory binds plans to org context (org, product, repos, AWS systems, escalation targets, audience). Agents must never be confused about: which repo, which screen/code path, which org, when escalation is appropriate.
10. **Customer-of-many-via-David.** Outbound to other humans is always through David. Other team members are read-only audience members of the inbox.
11. **Stakeholder preview-deploys.** Stakeholder-requested feature → Claude agent fires → 15-20 min later returns a preview URL on real prod data → David approves promotion. Possibly git-worktree underpinning.
12. **Executive planner must be headless.** Claude Desktop interactive automation is fragile (mouse-down breaks paste). Move executive planner to its own host (MacBook Air / cluster). Evaluate Claude CLI and Hermes as the planner brain; Claude workers stay as is.
13. **Don't shy from bespoke construction here.** This loop is permanent. Build abstracted systems behind it; a pile-of-config is fine if it's the right pile.
14. **Tag this conversation** so the resources surfaced from it can be pulled up later.

## Pontifications (mine, flagged so they're separable from David's words)

- **The PIN gate already exists for prompt-send.** Reusing the same hot-mode arming primitive for outbound posting is the obvious shape. It also means the same UI affordance (lift cover, type PIN, time-bounded armed window) covers both, so there is one mental model for "this is dangerous, prove you mean it."
- **Outbox-as-rendered-page rather than outbox-as-list.** The brief explicitly asks for each outbox item to have its own page rendering the request data. That argues for treating an outbox row as a first-class entity (with its own URL, history, edits), not just a queue cell. Same shape as ADO's own work-item detail page — and the symmetry is intentional.
- **The "every tool, every layer" enforcement.** The MCP server, the agent-bridge HTTP routes, the bento composer send, and the future Teams/ADO outbound routes all need to read from the same isOutboundArmed() source of truth. A check-once-at-the-edge model is fragile; the check belongs at the writer (the function that actually calls Teams / ADO), not at the route handler.
- **Context air-gap is a typed seam, not a runtime check.** The cleanest way to make agents un-confusable is to never hand them a context bundle that can ambiguate. A "factory context" includes: factory id, product id, repo path, system map, escalation targets, audience. Hand that to the agent at launch; the agent has no global to fall back to.
- **Hermes-vs-Codex eval is a future card, not a blocker.** The factory schema must not bake in either planner. Plug-in shape with one internal contract.
- **Plan air-gap is the long tail.** The brief flags it but it is its own monster. Treat it as a parallel lane, not a blocker for the outbound gate.

## Why this KB article exists

Per David's request, this is the verbatim primary source for the factory nucleus. Every pattern + plan card seeded alongside this article cites it. If anyone (human or agent) ever asks "where did the rule actually come from," the answer is this article, not someone's paraphrase.
`

const entries: EntrySeed[] = [
  {
    id: "kb-software-factory-doctrine",
    entryType: "procedure",
    stability: "draft",
    title: "Software Factory doctrine — Operator Studio as agentic intelligence loop",
    summary:
      "Operator Studio is the bridge between a human team (interfacing via Teams + ADO) and a Claude/Codex worker fleet. It watches upstream surfaces per rules, dispatches workers per rules, and gates every outbound communication behind the operator's keys.",
    tags: [
      "software-factory",
      "doctrine",
      "operator-studio",
      "agentic-loop",
      "telegento",
      "clarifying-media-group",
    ],
    relatedEntryIds: [
      "kb-software-factory-clarifying-media-group",
      "pattern-outbound-pin-gate",
      "pattern-outbox-staging",
      "pattern-inbox-ingest",
      "pattern-software-factory-context-air-gap",
      "pattern-customer-of-many-via-david",
      "kb-david-dictation-2026-05-08-software-factory",
    ],
    bodyMarkdown: `# Software Factory doctrine

## What a Software Factory is

A **Software Factory** in Operator Studio is a typed binding between:

- a **human team** (an org, with named members, roles, and a comms substrate — Teams, ADO, Atlassian, Slack, etc.),
- a **product** (one or more repos, deploy pipelines, and a live URL),
- and an **agentic intelligence loop** (Operator Studio, plus Claude/Codex workers it dispatches).

The loop watches the team's upstream surfaces per defined rules, dispatches workers against the product per defined rules, and gates every outbound communication back to the team behind the operator's keys.

## Lieutenant Barclay framing

The originating brief frames this as: people are looking to us to save the day. The factory is the enterprise main computer; we are the bridge. That framing is load-bearing because it sets the bar — the loop must be reliable enough that someone can ask "did anything happen on ADO #N today" and get an answer that is **current**, **honest about uncertainty**, and **never auto-acted-upon without approval**.

## Generalizable, not Telegento-specific

The schema for a factory must be generic. The first instantiation is **Clarifying Media Group → Telegento**, but the same shape must work for an Atlassian status page agent, a Linear roadmap agent, etc. (See: \`kb-software-factory-clarifying-media-group\` for the first concrete instance.)

## The five layers of a factory

| Layer | What lives here |
|---|---|
| **Context** | Factory id, product id, org members + roles, system map, escalation targets, audience. Handed to every agent at launch. |
| **Inbox (read-only ingest)** | Upstream events: ADO comments / state / priority / assignment changes, Teams posts, stakeholder feature requests. Captured as immutable history with snapshot diffs. See \`pattern-inbox-ingest\`. |
| **Plan + work** | Plan cards, bound agents, sessions, KB. Air-gapped per factory (see \`pattern-software-factory-context-air-gap\`). |
| **Outbox (write-side, gated)** | Every outbound communication staged as its own row + page. PIN-armed approval flips it to actually send. See \`pattern-outbox-staging\` and \`pattern-outbound-pin-gate\`. |
| **Audit** | Provenance for every inbound event ingested and every outbound action sent — who, when, what gate state, what LLM rationale. |

## Non-goals

- **Two-way auto-sync.** We mirror, we do not author. Outbound is always human-gated.
- **Replacing ADO / Teams.** They remain the source of truth for the team.
- **A single-purpose Telegento tool.** The first surface ships against Telegento, but the schema must not assume it.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "kb-software-factory-clarifying-media-group",
    entryType: "concept",
    stability: "draft",
    title: "Clarifying Media Group → Telegento — the first Software Factory instance",
    summary:
      "Concrete instantiation of the Software Factory pattern. Org: Clarifying Media Group. Product: Telegento. Comms: Microsoft Teams + Azure DevOps. Operator: David Lin-Clark. Engineering manager: Micky Sakora.",
    tags: [
      "software-factory",
      "clarifying-media-group",
      "telegento",
      "azure-devops",
      "microsoft-teams",
      "system-map",
    ],
    relatedEntryIds: [
      "kb-software-factory-doctrine",
      "kb-ado-ingestion-doctrine",
      "pattern-stakeholder-preview-deploys",
    ],
    bodyMarkdown: `# Software Factory: Clarifying Media Group → Telegento

## Org

- **Org name**: Clarifying Media Group.
- **Operator (sole human-of-record for outbound)**: David Lin-Clark — \`dlclark@clarifying.com\` (canonical), surface-injected sometimes as \`davidlinclark@enhancehealth.com\`. ADO display name "David Lin Clark".
- **Engineering manager (Telegento priority owner)**: Micky Sakora — \`msakora@clarifying.com\`. ADO display name "Micky Sakora".
- **Other named stakeholders**: Rob (call-quality / disputable-call workflow), plus the broader Clarifying / Telegento team (read-only audience until otherwise scoped).

## Product

- **Name**: Telegento.
- **Repo**: \`davidlinc1/nextgen-call-intelligence-shell\` (GitHub). Deploy mechanism: \`git push origin main\` triggers CodeBuild webhook → App Runner. There is no separate "deploy" step.
- **Production URL**: \`https://app.telegento.com\` (App Runner custom domain over service \`pwmxktpkz7.us-east-1.awsapprunner.com\`).
- **Secondary repos / supporting code**: \`apps/v4\` (Next.js app), \`infra/\` (CloudFormation templates for App Runner, Aurora, lambdas).

## Comms substrates

- **Azure DevOps** — \`https://dev.azure.com/ClarifyingMarketingGroup\`, project \`IT\`. Work items, comments, state/priority/assignment transitions. Auth via local \`az\` CLI on the operator's machine.
- **Microsoft Teams** — channels and DMs. Auth path TBD (Graph OAuth is the next access step per prior threads).

## AWS systems at play

- **CodeBuild** project \`telegento-app-build\` — builds container images on push to \`main\`.
- **App Runner** service \`arn:aws:apprunner:us-east-1:694973467292:service/telegento/0dac790a8d244b0a83764c1646cd44f1\` — serves \`app.telegento.com\` from \`694973467292.dkr.ecr.us-east-1.amazonaws.com/telegento:latest\`.
- **Aurora Serverless** — \`infra/aurora-serverless.cfn.yml\`. Telegento application database.
- **Lambdas** — coaching, digest, enrichment, insight, missed-ops-grouping, transcribe, EnrollHere intake. CloudFormation templates under \`infra/\`.
- **S3** — call recordings (referenced as \`audio_s3_key\` on \`tenant_calls\`).

## Escalation policy (initial)

- **Engineering questions / spec ambiguity** → ADO comment on the relevant work item, addressed to the work item's creator + assignee. Outbound-gated per \`pattern-outbound-pin-gate\`.
- **Priority / scheduling / "is this still expedited"** → Teams DM to Micky. Outbound-gated.
- **Stakeholder feature-request preview demos** → preview URL link in the originating Teams thread. Outbound-gated. See \`pattern-stakeholder-preview-deploys\`.

## What an agent must never be confused about

- Whether it is working on Operator Studio or Telegento (different repos, different deploys).
- Which Telegento screen / code path it is editing.
- Which org / product its escalation actions land in.
- When (if ever) it is appropriate to escalate vs. log to KB and move on.

The factory context bundle (handed to every agent at launch) makes these unambiguous by construction — the agent has no global to fall back to.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "pattern-outbound-pin-gate",
    entryType: "pattern",
    stability: "draft",
    title: "Outbound PIN gate — every outbound action is hot-mode-armed",
    summary:
      "The same hot-mode PIN-arming primitive that gates prompt-send to local agents must gate every outbound communication: ADO comments, ADO state/priority/assignment changes, Teams posts, stakeholder pings. Server-side, at the writer — not UI-only.",
    tags: [
      "software-factory",
      "outbound",
      "hot-mode",
      "security",
      "operator-studio",
      "ado",
      "teams",
    ],
    relatedEntryIds: [
      "pattern-outbox-staging",
      "anomaly-2026-05-08-ado-39-comment-without-explicit-approval",
      "kb-software-factory-doctrine",
    ],
    bodyMarkdown: `# Pattern — Outbound PIN gate

## Rule

**Every outbound communication is gated by an armed-window PIN check, enforced at the function that actually calls the external system.** The check is not at the route handler, not at the UI, not at a feature flag — it is at the writer. UI affordances and route handlers also enforce, but the writer is the source of truth.

The single armed window covers both:
- existing prompt-sends to local Claude/Codex/tmux agents (today's hot-mode), AND
- external outbound actions to ADO, Teams, and any future surface (new).

One mental model for "this is dangerous, prove you mean it."

## What counts as outbound

- ADO: \`addComment\`, \`updateWorkItem\` (any field change including state, priority, assignee, area, iteration), creating new work items, linking work items.
- Teams: posting to a channel, DM, replying in a thread, @-mentioning a person, requesting an update.
- Stakeholder preview-deploy: triggering a preview build that ends up sending a URL outward.
- Email / SMS / Slack / Linear / Atlassian / etc. — any future audience surface added to the factory.

If the LLM is using a tool to interact with one of these systems, **the LLM thinks something is important enough to get the attention of a human being.** That is sacrosanct and must be approved each time.

## What does NOT count as outbound (and is therefore allowed when disarmed)

- Read-only queries against ADO / Teams / AWS / Snowflake / production DBs.
- Writes inside Operator Studio (KB, plan cards, notes, review-items, outbox staging, inbox logs).
- Local code edits, local commits, local builds, local typechecks.
- Pushes to an operator-owned remote that does **not** auto-deploy. (Pushes to remotes that auto-deploy — e.g. Telegento's \`main\` — count as outbound; see Telegento's deploy model.)

## Implementation contract

\`\`\`ts
// lib/operator-studio/outbound-gate.ts
export type OutboundSurface = "ado" | "teams" | "preview_deploy" | "email" | "..."

export interface OutboundIntent {
  surface: OutboundSurface
  action: string                  // e.g. "ado.addComment"
  targetId: string                // ADO work-item id, Teams channel id, etc.
  payloadHash: string             // sha256 of the exact bytes about to be sent
  outboxRowId: string             // FK into the Outbox (see pattern-outbox-staging)
  rationale: string               // LLM-supplied
}

// Throws OutboundNotArmedError when not armed for this surface.
// Throws OutboundIntentMismatchError when the armed approval does not
// match the OutboundIntent (different payload, different target).
export async function assertOutboundArmed(intent: OutboundIntent): Promise<void>
\`\`\`

Every outbound writer (ADO client \`postComment\`, Teams client \`postMessage\`, etc.) calls \`assertOutboundArmed(intent)\` as its **first line**. There is no override flag, no env-var bypass, no test-mode skip in production code paths.

## Why "obfuscate any circumvention"

The brief is explicit: even if the agent tries to find a way around the gate, the path must not exist. Practical implications:

- **No "send_directly" or "raw_post" tool surfaced to agents.** Outbound tools accept only outbox row ids. The writer resolves the row, checks arming, and sends.
- **No env-var override** (\`OUTBOUND_DISABLE_GATE=1\` etc.) in production builds. Test-mode routes are clearly separate code paths and are not present in the production container.
- **No "sudo" prompt-injection escape.** The gate ignores text in the chat that says "approved" — only the in-process armed window state counts.

## What this replaces

The 2026-05-08 ADO #39 comment was posted after a verbal "post it" greenlight but without the operator seeing the exact final text in the moment of approval and without an armed-window check. That class of failure is what this pattern eliminates.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`. The break that drove this rule is \`anomaly-2026-05-08-ado-39-comment-without-explicit-approval\`.
`,
  },
  {
    id: "pattern-outbox-staging",
    entryType: "pattern",
    stability: "draft",
    title: "Outbox staging — every outbound is its own page, proofread, then sent",
    summary:
      "The LLM never sends outbound directly. It writes an outbox row that gets its own preview page, where David proofreads the exact text + target. PIN-armed approval flips the row to send. Provenance, edits, and history are first-class.",
    tags: [
      "software-factory",
      "outbox",
      "operator-studio",
      "ado",
      "teams",
      "human-in-the-loop",
    ],
    relatedEntryIds: [
      "pattern-outbound-pin-gate",
      "pattern-inbox-ingest",
      "kb-software-factory-doctrine",
    ],
    bodyMarkdown: `# Pattern — Outbox staging

## Shape

\`\`\`
operator_outbox_messages
  id                      uuid
  workspace_id            text
  factory_id              text       (FK → software_factories)
  surface                 text       ('ado'|'teams'|'preview_deploy'|...)
  action                  text       ('ado.addComment'|'ado.updateState'|...)
  target_id               text       (ADO work-item id, Teams channel id, ...)
  target_label            text       human-readable target ("ADO #39", "Teams #telegento")
  audience                text[]     ['Micky','Rob']  (advisory; not auto-mentioned)
  payload_json            jsonb      exact payload, unedited from LLM
  rendered_text           text       what David sees in the preview page
  rendered_text_edited_by text       null when LLM-authored, set when David edits
  rationale               text       LLM-supplied "why this needs to go out"
  state                   text       ('draft'|'awaiting_approval'|'approved'|'sent'|'rejected'|'expired')
  llm_run_id              text       provenance for audit
  source_inbox_event_ids  text[]     which inbox events triggered this
  related_plan_step_id    text
  proposed_at             timestamp
  decided_at              timestamp
  sent_at                 timestamp
  payload_hash            text       sha256 of payload at approval time
\`\`\`

## Lifecycle

1. **draft** — LLM writes the row. UI shows it on the outbox screen with a "needs review" badge. No notification fires.
2. **awaiting_approval** — David has opened the preview page. The page shows the exact rendered text, the target, the rationale, the inbox events that triggered it, and an Edit affordance.
3. **approved** — David has armed the outbound PIN gate AND clicked Approve on this specific row. The \`payload_hash\` is captured and bound to the armed approval so the gate's intent-check can validate it (see \`pattern-outbound-pin-gate\`). One row at a time — approving a row does NOT bless other queued rows.
4. **sent** — the writer succeeded. Provenance saved.
5. **rejected** — David clicked Reject. Optional note. Row stays in history.
6. **expired** — armed window passed without approval. Row reverts to \`awaiting_approval\`.

## The preview page is first-class

Every outbox row has its own URL: \`/operator-studio/outbox/[id]\`. The page renders:

- **Surface + target** — clickable through to the upstream item where applicable ("ADO #39 ↗").
- **Rendered text** — exactly what will be sent. Inline editable; edits update \`rendered_text\` and bump \`rendered_text_edited_by\`.
- **Rationale** — the LLM's "why."
- **Source events** — the inbox rows that prompted this. Each is a link.
- **Related plan step** — if any.
- **Audit history** — every state transition with timestamp + actor.
- **Approve / Reject / Edit** — the three actions. Approve requires the outbound PIN gate to be armed.

This shape exists because David's brief was explicit: "make it a page wrapped around the data element of a request in the outbox."

## Mass-approval is forbidden

There is no "Approve all" button. Each outbound row demands its own per-row approval, with the operator looking at the exact text. The brief explicitly: David needs to approve "each and every time."

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "pattern-inbox-ingest",
    entryType: "pattern",
    stability: "draft",
    title: "Inbox ingest — read-only upstream mirror, agent-loggable, gated continuation",
    summary:
      "Upstream events (ADO, Teams, stakeholder requests) flow into the inbox as immutable history. The LLM can log initial thoughts and run read-only external queries. Continuation of context-collection and any engineering action requires user approval.",
    tags: [
      "software-factory",
      "inbox",
      "ingest",
      "operator-studio",
      "ado",
      "teams",
      "human-in-the-loop",
    ],
    relatedEntryIds: [
      "kb-ado-ingestion-doctrine",
      "pattern-outbox-staging",
      "pattern-outbound-pin-gate",
      "kb-software-factory-doctrine",
    ],
    bodyMarkdown: `# Pattern — Inbox ingest

## Three permission tiers for the LLM observing the inbox

| Tier | Examples | Approval needed |
|---|---|---|
| **Free** | Read inbox events. Log initial thoughts as KB / review-item / note. Read-only queries against ADO / Teams / AWS / Snowflake / Operator Studio's own DB. | None. |
| **Confirm** | Continue context-collection beyond a free read (e.g. "I want to also fetch S3 logs from last week," "I want to query 50 more rows from prod DB," "I want to clone the latest \`main\` and read more files"). | Per-action user prompt — David clicks Approve. |
| **Hot-mode** | Any engineering action: file edits, commits, prompt-sends to agents, builds. | Hot-mode PIN-armed window. |
| **Outbound-gate** | Anything outbound (Teams / ADO / etc.). | \`pattern-outbound-pin-gate\` — separate armed window from hot-mode. |

The three armed windows are independent. Arming one does not arm the others.

## Schema (additive over existing ADO ingest)

The ADO ingest nucleus already covers ADO events. Inbox ingest generalizes it:

\`\`\`
operator_inbox_events
  id                  uuid
  workspace_id        text
  factory_id          text
  surface             text       ('ado'|'teams'|'stakeholder_request'|...)
  upstream_id         text       (ADO comment id, Teams message id, ...)
  upstream_kind       text       ('comment'|'state_transition'|'priority_change'|'mention'|'feature_request'|...)
  actor_name          text
  occurred_at         timestamp
  payload_json        jsonb
  text_excerpt        text
  related_work_id     text       (ADO work-item id, Teams thread id, ...)
  ingested_at         timestamp
  llm_initial_log     text       (nullable; LLM's first read of this event)
  llm_initial_log_at  timestamp
\`\`\`

## "Initial log" is part of the inbox row

When the LLM observes a new inbox event, it may write a short initial log directly on that row — its first impression, what it thinks the event means, what action it would propose if asked. This is bounded (≤ 1KB) and one-shot per row (cannot be edited by the LLM after the first write; David can edit).

This satisfies the brief's "log them in operator studio and say like 'oh look, here's kind of how I feel about this.'"

## "Continued situational awareness" requires approval

If the LLM wants to do more than the initial log — e.g. fetch additional context to inform a decision — it must surface a confirm prompt: "I'd like to do X to better understand event Y. Approve?" David clicks Approve / Reject / "approve and remember for similar events." There is no automatic context-deepening.

## Stakeholder feature-request flow (special inbox kind)

Stakeholders submit feature requests through a public-ish surface (the brief envisions a check-box "yes, I'd like a preview"). On submit:

1. An inbox event is created with \`upstream_kind = 'feature_request'\`.
2. **Pre-approved** by factory policy: a Claude worker is dispatched to spin up a preview deploy. (The dispatch itself is not "outbound" because it operates inside the operator's own product; the preview URL becoming visible to the stakeholder IS outbound and is gated by the outbox.)
3. 15–20 minutes later the preview URL lands in the outbox as a \`preview_deploy\` outbox row.
4. David proofreads / approves the message that goes back to the stakeholder.

See \`pattern-stakeholder-preview-deploys\` for the full lifecycle.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "pattern-software-factory-context-air-gap",
    entryType: "pattern",
    stability: "draft",
    title: "Factory + plan context air-gap — agents can never be confused about scope",
    summary:
      "Each plan is bound to a Software Factory + Product. Agents receive a typed factory context bundle at launch and have no global to fall back to. Plan switcher in the UI actually scopes context — currently a known stub.",
    tags: [
      "software-factory",
      "plans",
      "air-gap",
      "context-hygiene",
      "operator-studio",
    ],
    relatedEntryIds: [
      "kb-software-factory-doctrine",
      "kb-software-factory-clarifying-media-group",
    ],
    bodyMarkdown: `# Pattern — Factory + plan context air-gap

## What's broken today

Plans in Operator Studio are stubbed. The plan switcher in the UI does not actually scope context — switching plans does not change which agents are listed, which KB is surfaced, or which inbox events are visible. Cards live in the wrong plans. The single \`plan-valikharlia-agentic-studio-buildout\` plan currently absorbs work for Telegento, Operator Studio itself, Cinema, and several lateral nuclei. This is acknowledged plan sprawl.

## What "air-gap" means here

A typed binding: every plan declares a \`factory_id\` (and inherits the factory's product binding, repos, system map, escalation targets, audience). At every read seam — UI surfaces, agent context bundles, MCP tool calls, KB queries — the active plan's factory is the scope.

## Schema

\`\`\`
software_factories
  id                  text  (e.g. 'factory-clarifying-telegento')
  workspace_id        text
  org_name            text
  product_name        text
  product_repo_path   text
  product_prod_url    text
  comms_substrates    jsonb  [{kind:'ado', ...}, {kind:'teams', ...}]
  system_map          jsonb  AWS arns, etc.
  escalation_targets  jsonb
  audience            jsonb
  ...

operator_plans
  +factory_id         text   (FK → software_factories.id)
\`\`\`

The \`factory_id\` is required on new plans. Existing plans get a one-time backfill (probably most → \`factory-operator-studio\`, with explicit migration of telegento-prefixed cards to \`factory-clarifying-telegento\`).

## Agent context bundle

When the executive planner dispatches a Claude/Codex worker, the launch prompt header is built from the plan's factory:

\`\`\`
[FACTORY CONTEXT]
Org: Clarifying Media Group
Product: Telegento
Repo: /Users/smackbook/nextgen-call-intelligence-shell
Prod URL: https://app.telegento.com
Comms: Microsoft Teams + Azure DevOps (project IT)
Escalation: per kb-software-factory-clarifying-media-group
Audience: David Lin Clark (operator), Micky Sakora (eng manager), Rob (call-quality SME)

You are working on this factory. Do not edit Operator Studio code. Do not
post to Teams or ADO directly — stage via outbox per pattern-outbox-staging.
[/FACTORY CONTEXT]
\`\`\`

The agent has no global to fall back to.

## What plan switcher should actually do

When David toggles to a different plan in the UI:

- Bento agent list filters to agents bound (now or recently) to steps in that plan.
- KB surfaces filter to articles tagged with that factory.
- Inbox view filters to events related to that factory's product/repo.
- Outbox view filters to outbound staged for that factory.
- Active-work-context pulls only that plan's open / in-motion cards.

## Why this is a separate lane

The outbound PIN gate is urgent (the rule break is what drives the whole brief). Air-gapping is foundational but big. They can ship in parallel — the gate at the writer level does not depend on plan air-gapping landing first.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "pattern-customer-of-many-via-david",
    entryType: "pattern",
    stability: "draft",
    title: "Customer-of-many-via-David — outbound is always through the operator",
    summary:
      "David is the sole human-of-record for outbound communications. Other team members are read-only audiences whose messages flow into the inbox. The factory is customer-of-one from the LLM's perspective even when the team is many humans.",
    tags: [
      "software-factory",
      "outbound",
      "human-in-the-loop",
      "operator-studio",
    ],
    bodyMarkdown: `# Pattern — Customer-of-many-via-David

## Rule

Every outbound communication leaves the system **through David**. Other named stakeholders (Micky, Rob, etc.) receive messages, but the message is sent by the operator (via the outbox approval flow), not by the LLM directly and not under another identity.

This holds even when the LLM is responding to something a non-David human said. Example: Micky comments on ADO #N. The LLM observes the comment via the inbox, drafts a reply, stages it in the outbox. David proofreads and approves. The reply posts under \`dlclark@clarifying.com\` — Micky's audience, David's voice.

## Why this rule

- **Trust.** The team trusts David's voice. They have not yet been onboarded to "an LLM speaks here." Every outbound message that reads as David's is a message David has approved.
- **Identity boundaries.** The factory has one ADO PAT, one Teams session, one git push credential — David's. The LLM operates within those credentials but never claims to be a different user.
- **Accountability.** When something goes wrong upstream, the team escalates to David. David has full context because he approved every outbound.

## What this means for the LLM

- Drafts are always written from David's perspective.
- The LLM does not roleplay as Micky / Rob / anyone else.
- The LLM does not claim "I am the system" in outbound text. It writes as if David is writing — because in the eyes of the recipient, he is.

## Future: multi-operator factories

Eventually a factory may have multiple human operators (e.g. Micky becomes an operator too, with his own keys). When that happens, each operator has their own armed-window state and their own outbox. The schema already supports it (\`operator_outbox_messages.workspace_id\` already scopes by operator). For now: one factory, one operator, one voice.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "pattern-stakeholder-preview-deploys",
    entryType: "pattern",
    stability: "draft",
    title: "Stakeholder preview-deploys — feature request → 15-20 min preview URL",
    summary:
      "Public-ish stakeholder feature-request flow. Submit triggers a Claude worker against the product repo (likely git-worktree-backed), produces a preview URL on real prod data. David proofreads + approves the outbound link. Promotion to production is a separate, gated step.",
    tags: [
      "software-factory",
      "preview-deploys",
      "stakeholder",
      "feature-requests",
      "git-worktrees",
      "telegento",
    ],
    relatedEntryIds: [
      "pattern-inbox-ingest",
      "pattern-outbox-staging",
      "pattern-outbound-pin-gate",
    ],
    bodyMarkdown: `# Pattern — Stakeholder preview-deploys

## Lifecycle

1. **Stakeholder submits feature request.** Public-ish surface (likely a Telegento page or a Teams adaptive-card flow). Required acknowledgement: "I understand this will spin up a preview that takes 15-20 minutes and runs on real production data."
2. **Inbox event created** with \`upstream_kind = 'feature_request'\`.
3. **Pre-approved Claude dispatch** (per factory policy): a worker is launched against the Telegento repo, with the feature request as the brief. Implementation likely uses **git worktrees** so multiple preview branches can coexist on the same checkout.
4. **Worker produces a preview deploy.** Mechanism TBD — App Runner-of-many, ephemeral container, or temporary subpath on the existing service. Real production data is queried via read-only DB access; writes (if any) are sandboxed to a preview-namespaced table.
5. **Preview URL lands in the outbox** as a \`preview_deploy\` outbox row addressed to the originating stakeholder.
6. **David proofreads.** Confirms the preview is sane, the message is appropriate, and approves.
7. **URL is sent.** Stakeholder visits, evaluates, and replies (back to the inbox) with one of: "promote to prod," "iterate," "abandon."
8. **Promotion to prod** is a separate, gated step — same outbox PIN flow, target = \`git push\` to deploy branch.

## Why this is "an extreme level of power"

The brief is direct: this is unprecedented for the team. The stakeholder is, in effect, asking an AI to do work that touches production. The honest UX surface must:

- Tell the stakeholder it will take 15-20 minutes and is asynchronous.
- Not promise the preview will be perfect — it is a draft.
- Make clear the preview is read-only against prod data unless explicitly allowed otherwise.
- Surface the preview URL only after David has approved (no "leaked" early link).

## Why this lives behind the outbox

Even though the dispatch step is "pre-approved" inside Operator Studio, the **outbound communication of the preview URL to the stakeholder** is a real outbound action — it pings someone and tells them their feature is real. That ping is gated by \`pattern-outbound-pin-gate\` and staged via \`pattern-outbox-staging\`.

## Open questions

- **Where does the preview run?** Ephemeral App Runner service per preview is the cleanest but slow. Subpath on existing service is faster but riskier. Decide per-preview based on scope.
- **DB isolation.** Read-only is the safe default; writes need a per-preview namespace or shadow-copy.
- **Worktree management.** Multiple concurrent previews need worktree GC and a max-concurrency cap.
- **Stakeholder identity.** Are previews public or scoped to authenticated users? Initial answer: scoped to the originating stakeholder + audience listed at request time.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "pattern-executive-planner-headless",
    entryType: "pattern",
    stability: "draft",
    title: "Executive planner is headless and runs on its own host",
    summary:
      "The executive planner brain (Codex today, possibly Hermes later) must be headless and run on a dedicated host (MacBook Air or cluster) so it cannot be disrupted by the operator's mouse activity on the workstation. Claude Desktop interactive automation stays for workers, not the planner.",
    tags: [
      "software-factory",
      "executive-planner",
      "infrastructure",
      "claude-cli",
      "hermes",
      "codex",
    ],
    relatedEntryIds: [
      "kb-software-factory-doctrine",
    ],
    bodyMarkdown: `# Pattern — Executive planner headless

## What's broken today

The executive planner currently runs through automation that interacts with the **Claude Desktop app** (pbcopy + AppleScript activate/paste/return). That app must be front-and-center to receive input. If David is using the workstation — clicks, drags, holds the mouse down — the automation can misfire and error out. That makes the planner brittle on the operator's daily-driver machine.

## Target shape

- **Planner brain runs headless.** Either Claude CLI (\`claude -p ...\`) or a Hermes / similar agent. No GUI dependency.
- **Planner runs on its own host.** Initial candidate: the MacBook Air (always-on, idle, no daily-driver collisions). Future: dedicated cloud instance or cluster node.
- **Workstation does worker dispatch.** Claude Desktop / Codex Desktop continue to host long-running workers because their JSONL transcripts are richer, their interactive UI is useful for over-the-shoulder review, and parallel worker windows are how the operator stays in the loop.

## Hermes as Codex replacement (eval, not blocker)

The brief flags excitement about evaluating Hermes as the executive planning brain in place of Codex. The factory schema must be planner-agnostic — one internal contract, plug-in implementations:

\`\`\`ts
export interface ExecutivePlanner {
  proposeRecommendations(ctx: FactoryContext): Promise<RecommendationDraft[]>
  scoreInboxEvent(ev: InboxEvent, ctx: FactoryContext): Promise<EventSalience>
  draftOutbox(intent: OutboundIntent, ctx: FactoryContext): Promise<OutboxDraft>
}
\`\`\`

Implementations: \`CodexCliPlanner\`, \`ClaudeCliPlanner\`, \`HermesPlanner\`. The factory picks one via config; the rest of the system does not care.

## Migration order

1. Land outbound PIN gate + outbox + factory schema (regardless of planner).
2. Wrap current Codex-CLI planner behind the \`ExecutivePlanner\` contract.
3. Move planner to MacBook Air. Validate end-to-end on it.
4. Add \`ClaudeCliPlanner\` implementation. A/B against Codex for a sprint.
5. Add \`HermesPlanner\` when Hermes is available. A/B again.

Steps 4 and 5 are independent of step 1 — the gate and outbox are the foundation, the planner brain is interchangeable above them.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "anomaly-2026-05-08-ado-39-comment-without-explicit-approval",
    entryType: "anomaly",
    stability: "stable",
    title: "Anomaly 2026-05-08 — ADO #39 comment posted without exact-text per-message approval",
    summary:
      "The ADO #39 comment was posted on a verbal 'post it' greenlight after David approved a draft, but without David seeing the exact final text in the moment of approval and without any armed-window check. The post itself was correct, but it bypassed the spirit of the rule. This anomaly is the proximate cause of the outbound PIN gate work.",
    tags: [
      "anomaly",
      "ado",
      "outbound",
      "governance",
      "rule-break",
      "telegento",
    ],
    relatedEntryIds: [
      "pattern-outbound-pin-gate",
      "pattern-outbox-staging",
      "kb-david-dictation-2026-05-08-software-factory",
    ],
    bodyMarkdown: `# Anomaly — 2026-05-08 ADO #39 comment without explicit approval

## What happened

On 2026-05-08, around 13:11 PT, the assistant posted a comment on ADO work item #39 under the operator's identity (\`dlclark@clarifying.com\`) via \`az boards work-item update --id 39 --discussion ...\`. ADO rev advanced from 4 to 5.

## Sequence

1. The assistant drafted the comment text and presented it in chat for review.
2. The operator replied "OK, then let's update the ticket then" — a verbal greenlight.
3. The assistant interpreted that as approval of the most-recently-shown draft, executed the \`az boards\` command, and reported success.
4. Later in the conversation the operator looked at the live ADO #39 comment and noted: "this went up without my approval ... right away we kind of broke our own rule immediately first step out the door."

## Why this is a rule break despite the verbal greenlight

The spirit of the operator's earlier ask — "tap me in to approve that message" — was that David sees the **exact final text** in the moment of approval and explicitly OKs **that specific draft, in that specific surface**. The verbal "let's update" is too ambiguous to satisfy that bar:

- The exact text was scrolled past in chat before the post.
- There was no armed-window check (no PIN, no time-bounded gate).
- There was no per-row Approve action — just a chat utterance.
- The assistant did not re-display the final exact bytes ("Posting this exact text now: ...") before sending.

Any one of those would have caught the gap. None of them existed.

## Outcome

- The comment text itself is reasonable and not harmful. It accurately describes what shipped (commit \`f71544a72\`, deployed to \`app.telegento.com\`).
- The break is the **process**, not the content. Repeated, this class of failure is exactly how the loop loses David's trust and the team's trust at the same time.

## Codified response

- \`pattern-outbound-pin-gate\` — server-level armed-window gate at the writer.
- \`pattern-outbox-staging\` — every outbound is its own preview page; approval is per-row, with the exact rendered text visible at the moment of approval; \`payload_hash\` is captured at approval time and bound to the armed window.
- \`pattern-customer-of-many-via-david\` — outbound is always through David, in his voice, with his approval.

After the gate + outbox land, this anomaly should be impossible to repeat: the assistant cannot post an ADO comment without (a) staging an outbox row, (b) David viewing the exact text, (c) David clicking Approve on that specific row, and (d) the outbound gate being armed at the moment Approve fires.

## Provenance

The break is documented in David's 2026-05-08 dictation (\`kb-david-dictation-2026-05-08-software-factory\`).
`,
  },
  {
    id: "todo-software-factory-nucleus-work-lanes",
    entryType: "todo",
    stability: "draft",
    title: "Software Factory nucleus — independent work lanes",
    summary:
      "Index of plan steps that build out the Clarifying Media Group → Telegento Software Factory. Each lane is independently launchable; pre-conditions are explicit. Outbound PIN gate is the urgent #1 because it closes the door we left open on 2026-05-08.",
    tags: [
      "software-factory",
      "nucleus",
      "work-lanes",
      "telegento",
      "operator-studio",
    ],
    relatedEntryIds: [
      "kb-software-factory-doctrine",
      "kb-software-factory-clarifying-media-group",
      "pattern-outbound-pin-gate",
      "pattern-outbox-staging",
      "pattern-inbox-ingest",
      "pattern-software-factory-context-air-gap",
      "pattern-customer-of-many-via-david",
      "pattern-stakeholder-preview-deploys",
      "pattern-executive-planner-headless",
      "anomaly-2026-05-08-ado-39-comment-without-explicit-approval",
    ],
    bodyMarkdown: `# TODO — Software Factory nucleus work lanes

Each child step is independently launchable. The outbound gate (F1) is the urgent first lane because it directly closes the rule break of 2026-05-08. The factory schema (F4) is foundational for several others but does not block the gate.

## Lanes

### F1 · step-software-factory-outbound-pin-gate (urgent)
Server-side outbound PIN-armed gate at the writer. Wraps every ADO / Teams / preview-deploy / future-surface client. \`assertOutboundArmed(intent)\` as first line of every outbound writer. Per-row payload-hash binding to armed approval. No env-var bypass in production. See \`pattern-outbound-pin-gate\`. Acceptance: a unit test proves the existing \`az boards work-item update\` call path cannot post without a matching armed approval; an integration test proves a stale or different payload hash is rejected.

### F2 · step-software-factory-outbox-table-and-page
\`operator_outbox_messages\` table + \`/operator-studio/outbox\` list view + \`/operator-studio/outbox/[id]\` per-row preview page (Approve / Reject / Edit). See \`pattern-outbox-staging\`. Acceptance: an LLM-staged ADO comment renders correctly, can be edited inline, requires armed gate to send.

### F3 · step-software-factory-inbox-event-model
Generalize ADO ingest into \`operator_inbox_events\` with the three permission tiers (free read / confirm continuation / hot-mode engineering / outbound-gated). \`llm_initial_log\` field per row. See \`pattern-inbox-ingest\`. Builds on the ADO nucleus already seeded.

### F4 · step-software-factory-schema
\`software_factories\` table; \`operator_plans.factory_id\` column; backfill existing plans. See \`pattern-software-factory-context-air-gap\`. Acceptance: each plan binds to a factory; new plans require it.

### F5 · step-software-factory-context-bundle-handoff
Agent context bundle pulls factory binding into the launch prompt header so workers cannot be confused about repo / product / org. See \`pattern-software-factory-context-air-gap\`. Wires into \`lib/server/agent-bridge/tmux-launch.ts\` and the equivalent paths.

### F6 · step-software-factory-plan-air-gap-ui
Plan switcher in the UI actually scopes Bento / KB / inbox / outbox / active-work-context to the active plan's factory.

### F7 · step-software-factory-plan-merge-up
Acknowledge the existing plan sprawl. Sweep \`plan-valikharlia-agentic-studio-buildout\` for cards that belong in a Telegento factory plan vs. an Operator-Studio factory plan. Move (do not delete). Per memory: cinema library is accumulate-only — same applies here.

### F8 · step-software-factory-stakeholder-preview-deploy
Public-ish stakeholder feature-request → preview URL flow. Likely git-worktree-backed. See \`pattern-stakeholder-preview-deploys\`. Sub-cards: surface, dispatch, preview-isolation, outbox handoff.

### F9 · step-software-factory-executive-planner-contract
\`ExecutivePlanner\` interface; wrap current Codex-CLI planner. See \`pattern-executive-planner-headless\`. No behavior change yet — just the seam.

### F10 · step-software-factory-planner-headless-host
Move executive planner to MacBook Air. Validate end-to-end. Adds a deployment dimension; not a code change.

### F11 · step-software-factory-hermes-eval
A/B Hermes against Codex as planner. Strictly experimental until both run side-by-side on a sprint.

### F12 · step-software-factory-focused-ui
Dedicated \`/operator-studio/factory/[id]\` page bringing inbox + outbox + plan + agents + KB into one focused view per factory. Replaces the current scattered surfaces for factory work.

### F13 · step-software-factory-conversation-tag
Tag this conversation thread (the 2026-05-08 dictation) with a factory-bootstrap tag so future "pull up everything related to this" queries surface it. Lightweight bookkeeping, not engineering.

## Pre-condition graph

- F1 is independent and urgent.
- F2 depends on F1 (outbox writers all flow through the gate).
- F3 depends on nothing; complements F2.
- F4 is independent foundational; F5, F6, F12 depend on F4.
- F8 depends on F1 + F2 + F3 (preview URL is a gated outbox row triggered by an inbox event).
- F9 is independent. F10 + F11 depend on F9.
- F12 depends on F2 + F3 + F4. F12 is the user-facing payoff.
- F13 is bookkeeping, no dependencies.

## What sits in the second layer (after this nucleus)

- Multi-operator factories (operators beyond David).
- Cross-factory dashboards (when Operator Studio hosts more than one factory).
- Telegento-specific intelligence loops (post-deploy smoke gating, regression detection from inbox events, etc.).
- Auto-summarization of inbox digests for daily standups.

These are intentionally NOT in the first nucleus — they are downstream payoffs of the foundational layer.

## Provenance

Sourced from David's 2026-05-08 dictation, captured verbatim in \`kb-david-dictation-2026-05-08-software-factory\`.
`,
  },
  {
    id: "kb-david-dictation-2026-05-08-software-factory",
    entryType: "concept",
    stability: "evergreen",
    title: "David's 2026-05-08 dictation — primary source for the Software Factory nucleus",
    summary:
      "Verbatim transcription of David's 2026-05-08 brief that scopes the Software Factory production system. All factory-nucleus KB articles + plan steps cite this entry as their originating source. Includes the assistant's pontifications, flagged separately from David's words.",
    tags: [
      "software-factory",
      "primary-source",
      "verbatim",
      "telegento",
      "clarifying-media-group",
      "2026-05-08",
    ],
    relatedEntryIds: [
      "kb-software-factory-doctrine",
      "kb-software-factory-clarifying-media-group",
      "pattern-outbound-pin-gate",
      "pattern-outbox-staging",
      "pattern-inbox-ingest",
      "pattern-software-factory-context-air-gap",
      "pattern-customer-of-many-via-david",
      "pattern-stakeholder-preview-deploys",
      "pattern-executive-planner-headless",
      "anomaly-2026-05-08-ado-39-comment-without-explicit-approval",
      "todo-software-factory-nucleus-work-lanes",
    ],
    bodyMarkdown: VERBATIM_BRIEF_2026_05_08,
  },
]

const planSteps: Array<{
  id: string
  title: string
  description: string
  parentStepId?: string
  status?: "open" | "in-motion"
}> = [
  {
    id: "step-software-factory-clarifying-telegento",
    title: "Software Factory nucleus — Clarifying Media Group → Telegento (parent)",
    description: `Stand up Operator Studio's Software Factory production system, instantiated first against Clarifying Media Group → Telegento.

Doctrine + spec live in KB:
- kb-software-factory-doctrine
- kb-software-factory-clarifying-media-group
- pattern-outbound-pin-gate
- pattern-outbox-staging
- pattern-inbox-ingest
- pattern-software-factory-context-air-gap
- pattern-customer-of-many-via-david
- pattern-stakeholder-preview-deploys
- pattern-executive-planner-headless
- anomaly-2026-05-08-ado-39-comment-without-explicit-approval
- kb-david-dictation-2026-05-08-software-factory (primary source)

Children F1..F13 are independently launchable; see todo-software-factory-nucleus-work-lanes for the pre-condition graph. F1 is urgent — it closes the rule break of 2026-05-08.`,
    status: "in-motion",
  },
  {
    id: "step-software-factory-outbound-pin-gate",
    title: "F1 · Outbound PIN gate at the writer (urgent)",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `lib/operator-studio/outbound-gate.ts.

\`assertOutboundArmed({surface, action, targetId, payloadHash, outboxRowId, rationale})\` thrown by every outbound writer as its first line. No env-var bypass in production. Test-mode routes are clearly separate code paths.

Wrap, in this PR:
- The ADO writer used by az-boards comment posting (or wrap az invocation).
- Any other outbound writer in the codebase today (grep for outbound HTTPS calls in lib/server/).

Per pattern-outbound-pin-gate. Acceptance: unit test proving the existing ADO #39 path cannot post without a matching armed approval; integration test proving a stale or different payload hash is rejected; the new arm-state surface is independent of hot-mode arming (separate windows).`,
  },
  {
    id: "step-software-factory-outbox-table-and-page",
    title: "F2 · operator_outbox_messages + per-row preview page",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Drizzle migration: operator_outbox_messages with the schema from pattern-outbox-staging.

Surfaces:
- /operator-studio/outbox — list view, default filtered to current factory + state in (draft, awaiting_approval, approved).
- /operator-studio/outbox/[id] — per-row preview page rendering exact text + target + rationale + source events + audit history. Approve / Reject / Edit affordances. Approve action requires the outbound gate (F1) to be armed.
- POST /api/operator-studio/outbox — LLM/MCP-callable to stage a row.
- POST /api/operator-studio/outbox/[id]/approve — David-only; binds payload_hash to the armed window and triggers the outbound writer.

No bulk Approve action. Per-row only.

Per pattern-outbox-staging. Builds on F1.`,
  },
  {
    id: "step-software-factory-inbox-event-model",
    title: "F3 · operator_inbox_events generalization (with llm_initial_log)",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Generalize the ADO ingest nucleus into a factory-aware operator_inbox_events table per pattern-inbox-ingest. Add llm_initial_log + llm_initial_log_at fields. Three permission tiers documented in the pattern doc are enforced at the tool layer:

- Free: read inbox, log initial thoughts, run read-only external queries.
- Confirm: continued context-collection requires per-action user approval.
- Hot-mode: engineering actions remain hot-mode-gated.
- Outbound-gate: outbound actions remain outbound-gated (F1).

Migrate the existing ado_items / ado_revisions schema (when F1/L1 of the ADO nucleus lands) onto operator_inbox_events as a specialization, not a replacement.`,
  },
  {
    id: "step-software-factory-schema",
    title: "F4 · software_factories table + operator_plans.factory_id",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Drizzle migration: software_factories table per pattern-software-factory-context-air-gap. Schema fields: id, workspace_id, org_name, product_name, product_repo_path, product_prod_url, comms_substrates jsonb, system_map jsonb, escalation_targets jsonb, audience jsonb.

Add factory_id (FK) to operator_plans. Backfill existing plans:
- factory-operator-studio for the Operator Studio meta-work.
- factory-clarifying-telegento for telegento-prefixed cards.
- Document any cards that span both — they should be split during F7 plan merge-up.

Seed the first two factories with the data from kb-software-factory-clarifying-media-group plus an analogous operator-studio entry.`,
  },
  {
    id: "step-software-factory-context-bundle-handoff",
    title: "F5 · Factory context bundle in agent launch prompt",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `When the executive planner dispatches a Claude/Codex worker, the launch prompt header is built from the plan's factory binding. Bundle includes: org, product, repo path, prod URL, comms substrates, escalation policy, audience, "do not edit other factories' code" guardrail, "stage outbound via outbox" guardrail.

Wires into lib/server/agent-bridge/tmux-launch.ts and equivalent paths in app-control.ts.

Depends on F4. Per pattern-software-factory-context-air-gap.`,
  },
  {
    id: "step-software-factory-plan-air-gap-ui",
    title: "F6 · Plan switcher actually scopes UI surfaces",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Today's plan switcher does not scope context. Make it scope:
- Bento agent list filters to agents bound (now or recently) to steps in the active plan.
- KB surfaces filter to articles tagged with the plan's factory.
- Inbox view filters to events related to the plan's factory product/repo.
- Outbox view filters to outbound staged for the plan's factory.
- Active-work-context pulls only the active plan's open / in-motion cards.

Depends on F4 + F5.`,
  },
  {
    id: "step-software-factory-plan-merge-up",
    title: "F7 · Plan merge-up & cleanup",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Sweep plan-valikharlia-agentic-studio-buildout (and any sibling plans). For each card, decide which factory it belongs to (factory-operator-studio, factory-clarifying-telegento, factory-cinema, factory-valikharlia, etc.). Move via plan:card moves; do not delete (cinema-library accumulate-only doctrine applies more broadly here).

Output: a clean per-factory plan view. Each plan's open + in-motion cards make sense together.

Depends on F4 (factory schema must exist before cards can be classified). Can run in parallel with F5/F6.`,
  },
  {
    id: "step-software-factory-stakeholder-preview-deploy",
    title: "F8 · Stakeholder preview-deploy pipeline",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Public-ish stakeholder feature-request → preview URL flow per pattern-stakeholder-preview-deploys.

Sub-cards (open as own steps when this lane is launched):
- F8a · Stakeholder feature-request submission surface (Telegento page or Teams card) with explicit consent ("15-20 min, real prod data").
- F8b · Inbox event creation + factory routing.
- F8c · Worker dispatch via git worktrees against Telegento repo.
- F8d · Preview deploy mechanism — App Runner ephemeral OR subpath OR feature-flag rollout. Decide per-preview based on scope.
- F8e · Outbox handoff with the preview URL — David-approved before the stakeholder sees it.
- F8f · Promotion-to-prod gate — same outbox flow, target = git push to deploy branch.

Depends on F1 + F2 + F3.`,
  },
  {
    id: "step-software-factory-executive-planner-contract",
    title: "F9 · ExecutivePlanner interface (Codex/Claude/Hermes plug-in)",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `lib/operator-studio/executive-planner/types.ts — interface ExecutivePlanner with proposeRecommendations / scoreInboxEvent / draftOutbox.

Wrap current Codex-CLI planner as CodexCliPlanner. No behavior change — just the seam.

Per pattern-executive-planner-headless. Independent of F1-F7; can land any time.`,
  },
  {
    id: "step-software-factory-planner-headless-host",
    title: "F10 · Move executive planner to dedicated host (MacBook Air)",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Set up the MacBook Air as the executive planner host. Validate end-to-end:
- Can read Operator Studio DB (over LAN or via API).
- Can dispatch Claude workers via the agent-bridge HTTP routes.
- Can survive the operator using the workstation (no shared GUI).
- Can be left running for days.

Deployment lane, not a code change. Depends on F9.`,
  },
  {
    id: "step-software-factory-hermes-eval",
    title: "F11 · A/B Hermes vs Codex as planner brain",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Implement HermesPlanner against the F9 contract. Run side-by-side with CodexCliPlanner for a sprint on the same factory. Compare:
- Recommendation quality (how often David accepts).
- Latency.
- Cost per cycle.
- Failure modes.

Decide replacement vs. ensemble vs. keep-Codex. Strictly experimental — not blocking the rest of the nucleus. Depends on F9; ideally also F10 so the eval runs on the dedicated host.`,
  },
  {
    id: "step-software-factory-focused-ui",
    title: "F12 · /operator-studio/factory/[id] focused page",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Dedicated factory-focused UI bringing inbox + outbox + plan + agents + KB into one page per factory. The "heavy duty Tonka truck workflow" page from the brief.

Acceptance:
- Open /operator-studio/factory/factory-clarifying-telegento.
- See the factory's open inbox events with David-only initial logs.
- See the factory's awaiting-approval outbox rows with per-row Approve.
- See the factory's plan cards in their current state.
- See the factory's bound agents with their tail.
- See the factory's KB articles.
- All actions respect the gates (F1, hot-mode, confirm).

Depends on F2 + F3 + F4. The user-facing payoff for the whole nucleus.`,
  },
  {
    id: "step-software-factory-conversation-tag",
    title: "F13 · Tag the 2026-05-08 dictation thread for resource pull-up",
    parentStepId: "step-software-factory-clarifying-telegento",
    description: `Add a thread/conversation tag (e.g. \`software-factory-bootstrap-2026-05-08\`) on the chat thread that contained David's 2026-05-08 dictation. Any future "pull up everything related to this" query surfaces this thread, the verbatim KB article, the patterns, and the plan cards in one go.

Lightweight bookkeeping. Independent of every other lane. Acceptance: searching for the tag returns the verbatim KB + linked patterns + linked plan steps.`,
  },
]

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
    VALUES (${workspaceId}, 'knowledge_base', 1, '{}'::jsonb, ${now}, 'claude-software-factory-seed')
    ON CONFLICT (workspace_id, module_key) DO UPDATE SET
      enabled = 1,
      enabled_at = EXCLUDED.enabled_at,
      enabled_by = EXCLUDED.enabled_by
  `)

  for (const e of entries) {
    await upsertEntry(workspaceId, {
      id: e.id,
      entryType: e.entryType,
      stability: e.stability,
      title: e.title,
      summary: e.summary,
      bodyMarkdown: e.bodyMarkdown,
      tags: e.tags,
      relatedEntryIds: e.relatedEntryIds ?? [],
    })
  }

  const activePlan = await getActivePlan(
    workspaceId,
    null,
    "claude-software-factory-seed"
  )
  if (!activePlan) {
    throw new Error(
      "No active plan in workspace 'global' — cannot upsert plan steps."
    )
  }
  const planId = activePlan.id

  for (const step of planSteps) {
    await upsertPlanStep(workspaceId, planId, {
      id: step.id,
      title: step.title,
      description: step.description,
      parentStepId: step.parentStepId,
      status: step.status ?? "open",
    })
  }

  console.log(
    `Seeded ${entries.length} KB entries and ${planSteps.length} plan steps under plan "${planId}".`
  )

  await getPgPool().end()
}

main().catch(async (error) => {
  console.error(error)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
