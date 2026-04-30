# Operator Studio Server — Spec (Draft)

Status: **draft for discussion**, not yet approved.
Owner: TBD
Last updated: 2026-04-24

## What this is

Operator Studio today runs entirely local: one Postgres, one user, one Next.js app. This document specs a **server tier** that lets multiple Operator Studio instances share threads, plans, and workspaces — either by *publishing & duplicating* (asynchronous, fork-and-go) or by *interacting in place* (synchronous, multiplayer).

Two modes are intentional. They're different products with different costs, and most of the value is in the simpler one.

## Goals

1. **Promote a thread or workspace to a shared location** that other people can see.
2. **Duplicate a shared thread or workspace** down to a peer's local instance, where they own the copy and can fork.
3. **Optionally interact in place** with a shared thread (chat, plan edits, message promotion) without first duplicating it locally.
4. Preserve the local-first feel: an instance offline keeps working; the server is a peer, not a master.

## Non-goals

- Not a SaaS rewrite. The local Operator Studio remains the canonical authoring environment.
- Not a generic auth platform. Identity is the minimum viable for attribution + access; not SSO/RBAC.
- Not real-time collaborative editing of in-flight messages. (Live multiplayer applies to thread-level state, not character-level CRDT.)
- Not Slack. Comments, reactions, threads-on-threads — out of scope for v1.

## Existing seams

The local data model already gives us most of the primitives. We are not designing from scratch.

- **`workspaces.isGlobal`** already separates a "library" workspace from private sub-workspaces. The server replaces the role of the local global workspace with a remote one.
- **`promotedFromId` / `pulledFromId`** on threads already model the publish/duplicate provenance edges.
- **API tokens** (`operator_api_tokens`) already exist with per-user attribution and per-workspace scoping.
- **Webhooks** (`operator_webhook_subscriptions`) already exist with `thread.promoted` / `thread.imported` events and HMAC signing.
- **Import runs** (`operator_import_runs`) already provide an audit trail with provenance.

The server design should *extend* these, not replace them.

## Architecture

### Components

```
┌──────────────────────────┐         ┌────────────────────────────────┐
│  Operator Studio (local) │         │  Operator Studio Server         │
│  Next.js + local Postgres│ <────>  │  Next.js (or Hono) + Postgres   │
│                          │  HTTPS  │  + object storage for blobs     │
│  - Authoring             │         │  - Shared workspaces            │
│  - Private workspaces    │         │  - Federation registry          │
│  - Local global library  │         │  - Identity & tokens            │
└──────────────────────────┘         │  - Webhook fanout               │
                                      └────────────────────────────────┘
```

Two deployment shapes — **pick one for v1**, both later:

- **Single-tenant server:** one team, self-hosted, owns its Postgres. Easier; closest to current code. Recommended for v1.
- **Multi-tenant cloud:** Anthropic-hosted or vendor-hosted, namespaced per org. Bigger lift.

### Data model (server side)

Reuse the local schema as the trunk. Server-side adds:

- **`server_users`** — `id`, `email`, `display_name`, `avatar_url`, `created_at`. Identity for attribution.
- **`server_orgs`** — top-level tenant boundary (single-tenant: one row).
- **`server_workspace_grants`** — `(workspace_id, user_id, role)` where role ∈ `viewer | contributor | maintainer`.
- **`server_origin_instances`** — registry of which local instances are allowed to publish here, identified by an installation key.
- **`server_publication_log`** — append-only log of every promote/pull, keyed by `origin_instance_id` + `origin_thread_id`. Lets us answer "where did this thread come from" and detect cycles.

Existing tables (`operator_threads`, `operator_thread_messages`, `operator_plans`, etc.) are reused unchanged on the server. The server just *also* enforces grants on read/write.

### Identity model

Two layers, kept separate:

1. **Instance identity** — every local install registers an *origin instance* with the server, gets back an installation key. The key signs all outbound publish requests. Trusted by default; revocable.
2. **User identity** — within an instance, the existing `OPERATOR_STUDIO_REVIEWER` cookie supplies a display name. To publish, the user must also be linked to a `server_users` row (via OAuth, magic-link, or — initially — a manually-issued bearer token).

This means an instance can publish on behalf of multiple users, with each thread carrying both the instance origin and the human author.

### IDs & cross-instance references

Local IDs are UUIDs with semantic prefixes (`thread-…`, `tok-…`). They're globally unique by construction, so we *don't* need to rewrite them on publish. We do need to namespace them when displayed cross-instance:

- A published thread keeps its UUID.
- The server stores `origin_instance_id` next to it.
- Pulling a thread back to a different instance creates a new local row whose `pulledFromId` = the server's thread id, preserving the chain.

This matches today's `promotedFromId`/`pulledFromId` semantics exactly. No new ID scheme needed.

## Operations

### Promote (publish)

Local → Server. POST `/api/v1/threads/promote`:

```jsonc
{
  "origin_instance_id": "inst-…",
  "origin_thread_id": "thread-…",
  "target_workspace_id": "ws-shared-…",
  "thread": { /* full thread row */ },
  "messages": [ /* all messages */ ],
  "summaries": [ /* if any */ ],
  "privacy_state": "team"
}
```

Server validates instance signature + user grant on target workspace, upserts the thread (idempotent on `origin_instance_id` + `origin_thread_id`), fires `thread.promoted` webhook.

### Pull (duplicate)

Server → Local. GET `/api/v1/threads/:id` returns the thread + messages. Local instance writes them to its own Postgres with `pulledFromId` set, just like today's local promote/pull.

### Interact in place (multiplayer mode)

Same endpoints as the local app, but hosted on the server and gated by `server_workspace_grants`. Specifically:

- `POST /api/v1/threads/:id/messages` — append a message (continuation chat).
- `POST /api/v1/threads/:id/promote-message` — flag a message as a keeper.
- `POST /api/v1/plans/:id/steps/:stepId/fulfill` — bind content to a plan step.

For v1, **last-writer-wins** on most fields. The promote-message and step-fulfillment tables are already designed as append-only with unique constraints, so concurrent edits there merge naturally. Plan-step *order* and *title* edits are the actual conflict surface — leave them as last-writer-wins with a `version` column, revisit if it bites.

### Webhooks

Reuse `operator_webhook_subscriptions`. Add events: `thread.pulled`, `message.promoted`, `plan.step.fulfilled`, `member.added`. HMAC scheme is unchanged.

## Security

- All server endpoints require an instance signature **and** a user bearer token. Either alone is insufficient.
- Server-side encryption at rest is the operator's responsibility (managed Postgres + object store).
- No client-side E2EE in v1. Threads on the server are visible to server admins; document this clearly.
- Rate-limit publish/pull per origin instance; webhook fanout is per-subscription with retry/backoff.

## Migration & rollout

1. **Phase 0:** Ship a `pnpm dev:server` target that boots the same Next.js app in "server mode" (`OPERATOR_STUDIO_MODE=server`). Reuses existing routes; gates on `server_workspace_grants`.
2. **Phase 1:** Add the publish/pull endpoints. Local UI gains a "Publish to server" button on workspace + thread.
3. **Phase 2:** Add the interact-in-place endpoints. UI gains a "Open on server" mode that points the existing screens at remote workspace IDs.
4. **Phase 3:** Optional Anthropic-hosted multi-tenant deployment.

Phases 0–1 ship as the v1. They unlock 80% of the value (asynchronous sharing) at 30% of the cost.

## Open questions

- **Hosting story for v1.** Self-hosted only, or do we offer a managed default?
- **Plans across instances.** A plan promoted from instance A and pulled by instance B — does editing on B propagate back? v1 says no (forks are forks). Long-term unclear.
- **Quota & cost.** Storage for blobs (images, attachments) gets expensive fast. Hard limits per workspace?
- **Federation.** Multiple servers cross-publishing is interesting but explicitly out of scope. Don't paint ourselves into a corner — prefer URLs over numeric IDs in cross-instance references.
- **Real-time presence.** Showing "Alex is viewing this thread" is a different system (websockets / SSE). Probably v1.5.

## What we are NOT building yet

- Real-time CRDT message editing.
- Comments / threads / reactions.
- Notifications hub (rely on webhooks).
- Granular per-message ACLs (workspace-level only in v1).
- Search across instances (search is per-instance until federation lands).

---

**Next step if approved:** Open issues for Phase 0 (mode flag + grants table) and Phase 1 (publish/pull endpoints + UI). Tag the design owner.
