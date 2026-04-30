# Operator Studio Domain Primitives

This is the product vocabulary the code should orbit. Database names may lag
while migrations are in flight, but new UI copy, API docs, and comments should
prefer these meanings.

## Workspace

A workspace is the isolation boundary. Threads, messages, plans, sessions,
tokens, and webhooks are scoped to one workspace. The `global` workspace is a
shared library; other workspaces are private or project-specific namespaces.

## Thread

A thread is a captured conversation artifact: an imported transcript from
Codex, Claude Code, Cursor, ChatGPT, Gemini, a webhook, or a manual paste.

Threads carry source provenance, review state, promotion metadata, summaries,
messages, and fork/publish/pull lineage. A thread is durable memory, not a live
chat session.

## Message

A message is a single turn inside either a captured thread or a continuation
chat. Messages can be promoted as keepers and can be attached to plan steps as
evidence.

Use "keeper" for user-facing copy when the operator has promoted a message.
Use "promoted message" in code and API docs when the timestamp/metadata matter.

## Continuation Session

A continuation session is an interactive chat inside Operator Studio. It may be
grounded in a thread, but its messages live separately from the imported
thread transcript.

This is represented by `operator_chat_sessions` and `operator_chat_messages`.

## Work Session

A work session is a time-bucketed burst of operator activity, bracketed by a
3+ hour gap. It is useful for timelines, briefs, and "what happened today?"
views.

This is represented by `operator_sessions`. It is not the owner of intent.
The legacy `operator_sessions.plan_steps` column exists only as rollback
shadow storage; durable intent belongs to plans.

## Plan

A plan is the durable unit of intent. It has a title, goal, outcome, lifecycle
state, pinning, owner, and ordered steps. A plan can span many work sessions.

Active-plan resolution is product behavior, not incidental loader logic:

1. Use the most recently updated pinned active plan.
2. Otherwise use the current work session's attached plan.
3. Otherwise reuse the latest drafting plan in the workspace.
4. Otherwise create a blank drafting plan and attach the current work session.

## Plan Step

A plan step is a unit of intended work inside a plan. Steps have order, status,
optional parent/child layout, and optional canvas coordinates.

Step status is a baseline field. UI surfaces may layer evidence-derived status
on top when showing coverage.

## Evidence

Evidence is a thread or message attached to a plan step to show that the step
has been addressed.

The current storage table is `operator_step_fulfillments` and the routes still
use "fulfill" naming for API compatibility. Product copy should say
"evidence" unless it is explicitly talking about the storage table or route.
`session_id` on a fulfillment row is provenance for when the evidence was
accepted; the durable intent boundary is the plan step.

## Candidate

A candidate is a possible piece of evidence that has not been accepted yet.
The current production schema does not have a candidate table. Do not use
"candidate" as a synonym for accepted evidence.
