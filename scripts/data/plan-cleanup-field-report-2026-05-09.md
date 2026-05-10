# Plan-cleanup field report — 2026-05-09

**Phase 1 sweep only — no writes performed. Awaiting David's go before Phase 2.**

Spawned by exec `claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6` against `step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup`.

## Inventory: five plans, 437 active cards

| Plan ID | Title | Workspace | Pinned | Cards |
| --- | --- | --- | --- | --- |
| `plan-valikharlia-agentic-studio-buildout` | Valikharlia Engine — Agentic Studio Buildout | global | ✅ active | 215 |
| `plan-1777793035871-dkq1b8` | Operator Studio era · capitalize the moment | global | ✅ | 201 |
| `plan-draft-t-1776930795204` | Ship the OSS treatment of Operator Studio | t | ✅ | 12 |
| `plan-draft-global-1776926241051` | Step one | global | ✅ | 4 |
| `plan-session-t-2026-04-22T18-15` | Session plan | t | ⬜ | 1 |

The `plan-valikharlia` plan currently *holds* the active pin but its 215 cards are a rolling junk drawer: only ~25 are actually about the game engine. The OS-era plan has the cleanest top-level lane structure (A–H).

## Lane classification (heuristic, full per-card list at end)

| Source plan | Game engine | CMG + Telegento | Operator Studio (meta) | Trash / placeholder |
| --- | ---: | ---: | ---: | ---: |
| Valikharlia | **25** | 37 | 153 | 0 |
| OS era | 0 | 104 | 96 | 1 |
| Ship OSS draft | 0 | 0 | 6 | 6 |
| Step one | 0 | 0 | 0 | 4 |
| Session plan | 0 | 0 | 0 | 1 |
| **Total** | **25** | **141** | **255** | **12** |

## Proposed end-state: three plans, one per lane

### Plan A — Operator Studio (meta)
- **Reuse:** `plan-1777793035871-dkq1b8`. Already has the cleanest lane spine.
- **New title:** `Operator Studio · meta lane` (or keep "Operator Studio era").
- **Re-pin as the active plan.**
- **Keeps:** lanes `step-A` (Dogfooding), `step-B` (OS roadmap + B-cont continuum subtree), `step-D` (internal political — meta), `step-F` (KB), `step-G` (portability + Cinema/G1b creative-media subtree).
- **Receives from Valikharlia (153 cards):** all `step-bento-*`, `step-operations-*`, `step-operator-studio-*`, `step-mobile-*`, `step-tactical-operations-screen`, `step-fallow-*`, `step-wayseer-*`, `step-ado-*`, `step-recency-*`, `step-software-factory-*` (the OS-side scaffolding cards F1–F13), `step-agent-*`, `step-idea-gravity-*`, `step-berthier-*`, `step-claude-berthier-*`, `step-executive-*`, `step-product-launch-media-*`, `step-cross-machine-*`, etc. Full list in §"Card-level moves — Valikharlia → OS" below.
- **New parent buckets to create here** (for incoming cards):
  - `step-os-software-factory-spine` → all `step-software-factory-*` orphans (F1–F13).
  - `step-os-agent-orchestration` → `step-agent-*`, `step-berthier-*`, `step-launch-wave-*`, `step-runway-*`, `step-session-aware-agent-start-contract`, `step-cross-machine-*`.
  - `step-os-operations-desk` → `step-operations-*`, `step-tactical-operations-screen`, `step-bento-*`, `step-mobile-executive-cockpit`, `step-mobile-cockpit*`.
  - `step-os-idea-gravity` → all `step-idea-gravity-*` + `step-worker-continuation-detector`.
  - `step-os-product-launch-media` → all `step-product-launch-media-*` (sibling to G1b creative-media).
  - `step-os-context-and-recency` → `step-recency-first-*`, `step-active-work-context-*`, `step-claude-compact-context-hydration`, `step-os-hydrate-*`, `step-fast-operator-state-cli`.
- **Draft-OSS migrations:** the 6 non-trash cards from `plan-draft-t-1776930795204` ("Code cleanliness", "Finish the plan builder", "vidi vici", etc.) re-parent under `step-B` (OS roadmap).

### Plan B — Clarifying Media Group + Telegento (NEW)
- **Create:** new plan id `plan-clarifying-media-group-telegento`, workspace `global`, state `active`.
- **Receives from OS-era (104 cards):** `step-C` (JSA spine + C1–C10), `step-C-pipeline` (Telegento data pipeline, all legs A–E + chat port subtree), `step-C-cd` (CD safety rails), `step-E` (Telegento parallel product lane + E1), `step-H` (demo-day readiness + H1–H6 + H4-1..6 + H-sa-* + H-act-* + H-todo-* + H-asks-email).
- **Receives from Valikharlia (37 cards):** all `step-telegento-*` (`step-telegento-agentic-loop-today` + 13 children, `step-telegento-ado-teams-assisted-action-lane` + 8 children, `step-telegento-gemini-31-before-after-lab` + 8 children) and `step-software-factory-clarifying-telegento` + 13 children.
- **Top-level lanes proposed:**
  - `step-cmg-jsa-product` (was `step-C`) — JSA alliance + per-agent portal generator.
  - `step-cmg-telegento-pipeline` (was `step-C-pipeline`) — recording → transcript → enrichment → AI legs.
  - `step-cmg-telegento-product` — `step-E`, `step-telegento-agentic-loop-today` subtree, `step-software-factory-clarifying-telegento` subtree.
  - `step-cmg-telegento-demo-readiness` (was `step-H`) — demo-day + ADO/Teams + Gemini lab.
  - `step-cmg-cd-safety` (was `step-C-cd`).

### Plan C — Valikharlia Engine (game)
- **Reuse:** `plan-valikharlia-agentic-studio-buildout`.
- **Strip down to ~25 cards:** all 24 `step-valikharlia-*` plus `step-side-game-engine-lane`.
- **Status normalization:** Valikharlia uses non-canonical statuses (`done`, `todo`, `in_progress`) where the rest of the system uses `open | in-motion | covered | skipped`. Map: `done` → `covered`, `todo` → `open`, `in_progress` → `in-motion`. 24 cards affected.
- **Unpin** (OS plan becomes the active pin).

### Trash plans — soft-delete
- `plan-draft-global-1776926241051` ("Step one") — 4 placeholder cards.
- `plan-session-t-2026-04-22T18-15` ("Session plan") — 1 "test" card in workspace `t`.
- `plan-draft-t-1776930795204` ("Ship the OSS treatment") — after migrating its 6 OS cards into the OS plan, retire the plan and its 6 "New step" placeholders.
- 12 trash cards total + 3 plans retired.

## Ambiguous cards (recommendations, not auto-moved)

| Card | Reason | Recommendation |
| --- | --- | --- |
| `step-software-factory-clarifying-telegento` (Valikharlia) | Named for CMG but builds OS infrastructure. | **Move to CMG plan** — David memory says CMG is "current focus" and the Software Factory was scoped *for Telegento delivery*. The generic factory work (F1–F13 of `step-software-factory-*`) stays in OS. |
| `step-D` *Internal political play* (OS-era) | Career/comp-window strategy, not a product. | **Keep in OS plan** as a meta lane. Could later split into a personal plan if it grows. |
| `step-G1a/G1b/G1c` Cinema / creative-media subtree (OS-era) | Substantial product surface (Treatment → Acts → Beats → Scenes), but lives under "Portability + onboarding" which is wrong. | **Keep in OS plan** but re-parent G1a/G1b/G1c out of `step-G1` to a new top-level `step-os-creative-media-studio` (Lane G in user memory). G1's actual scope is README/Linux quickstart — the creative-media cards drifted in. |
| `step-product-launch-media-*` (Valikharlia, 5 cards) | Reads as a launch-prep workflow on top of Cinema. | **Move to OS plan** under `step-os-product-launch-media`, sibling to creative-media. |
| `step-operator-studio-plan-snapshot-duplicate` & `step-operator-studio-audio-event-engine` (Valikharlia) | Both single-card "lanes". | **Move to OS plan** under `step-B` (OS roadmap) as B-children. |
| `step-plan-1777793035871-dkq1b8-1777862271137-44` "Work tab: lane click → straight into thread" (OS-era, parented to step-B3) | Fine, just an autogenerated id. | **Keep where it is** — OS roadmap, no move needed. |

## Stale-status retirement candidates (35 cards, optional)

Any `covered` card older than ~30 days with no children worth keeping is a soft-delete candidate. Spot-checked examples worth retiring on confirmation:

- `step-bento-pending-observation-no-error`, `step-bento-executor-pinning-mobile-branding`, `step-fallow-thread-opportunity-cost-visuals`, `step-wayseer-fallow-next-prompt-engine`, `step-bento-delivery-draft-and-input-sanity`, `step-bento-composer-perf-isolation`, `step-bento-prompt-kit-menu`, `step-operations-thread-card-binding`, `step-operations-fast-context-cli`, `step-operations-graph-sidecar`, `step-autolink-urls-in-chat-components`, `step-bento-mobile-focused-thread-view`, `step-operations-control-loop-first-principles`, `step-live-token-piggyback-experiment`, `step-active-work-context-scope-routing`, `step-plan-sprawl-inventory-merge-prune`, `step-david-review-queue-category`, `step-factory-package-review-fixes`, `step-operator-studio-recency-context-front-door`, `step-agent-startup-tool-manifest`, `step-executive-ops-philosophy-alignment-pass`, `step-ops-dream-paradise-hygiene-pass`, `step-outbox-smoke-row-cleanup`, `step-operator-studio-timeline-story-surface`, `step-hot-mode-leakage-alarm-and-focus-guard`, `step-plan-card-list-cli`, `step-os-hydrate-factory-scope-resolution`, `step-hide-unready-today-rail`, `step-fallow-thread-opportunity-cost-visuals`.

Recommendation: **do not** auto-retire. Once they land in their right plan they're easy to scroll past, and `covered` is provenance.

## Operations to execute (Phase 2)

The `plan:card` CLI does not currently support cross-plan moves; `plan_id` is on `operator_plan_steps` and not exposed by `pnpm plan:card upsert`. Phase 2 needs **two artifacts**:

### 1. `scripts/cleanup-plans-2026-05-09.ts` (new, one-shot)

Runs against `getDb()` and performs in a single transaction:

```ts
// (a) Create new CMG plan
INSERT INTO operator_plans (id, workspace_id, title, state, pinned, ...) VALUES
  ('plan-clarifying-media-group-telegento', 'global', 'Clarifying Media Group + Telegento', 'active', true, ...);

// (b) Create new top-level "bucket" cards in destination plans
//     (step-os-software-factory-spine, step-os-agent-orchestration, ..., step-cmg-jsa-product, ...).
//     These are upserts against operator_plan_steps.

// (c) Bulk update step rows to move them across plans:
UPDATE operator_plan_steps
   SET plan_id = 'plan-1777793035871-dkq1b8',
       parent_step_id = '<new bucket id>'
 WHERE id IN (<list of OS cards currently in plan-valikharlia>);
// ...repeat for CMG cards.

// (d) Re-parent OS-era CMG subtrees (step-C, step-C-pipeline, step-C-cd, step-E, step-H + descendants)
//     into the new CMG plan.

// (e) Status normalization on remaining Valikharlia cards:
UPDATE operator_plan_steps SET status='covered'  WHERE plan_id='plan-valikharlia-...' AND status='done';
UPDATE operator_plan_steps SET status='open'     WHERE plan_id='plan-valikharlia-...' AND status='todo';
UPDATE operator_plan_steps SET status='in-motion' WHERE plan_id='plan-valikharlia-...' AND status='in_progress';

// (f) Re-pin
UPDATE operator_plans SET pinned = false WHERE id IN ('plan-valikharlia-...','plan-draft-global-...','plan-draft-t-...');
UPDATE operator_plans SET pinned = true  WHERE id = 'plan-1777793035871-dkq1b8';

// (g) Soft-delete trash plans (deleted_at on plan or state='archived')
UPDATE operator_plans SET state = 'archived' WHERE id IN ('plan-draft-global-1776926241051','plan-draft-t-1776930795204','plan-session-t-2026-04-22T18-15');

// (h) Provenance: append a body line to each moved card
//     "moved 2026-05-09 from <src plan id> by exec 2526ed14 — Phase 2 plan cleanup"
UPDATE operator_plan_steps SET description = COALESCE(description,'') || E'\n\n— moved 2026-05-09 from plan-valikharlia-... (Phase 2 plan-cleanup, exec 2526ed14)' WHERE id IN (...);
```

### 2. KB note for provenance

A `procedure` KB entry (`kb-2026-05-09-plan-cleanup-execution`) capturing:
- The exact list of cards moved (id → src plan → dest plan → new parent).
- The bucket IDs created in the OS and CMG plans.
- The status-normalization mapping applied to Valikharlia.
- A `pnpm plan:card list --plan-id=…` snapshot of each plan post-cleanup for diff reference.

## Card-level moves — Valikharlia → OS (153 cards)

All Valikharlia cards whose id matches one of these prefixes/exact ids move to plan-1777793035871-dkq1b8:

```
step-bento-*                                         (5 cards, → step-os-operations-desk)
step-operations-*                                    (16 cards, → step-os-operations-desk)
step-operator-studio-*                               (6 cards, → step-B)
step-mobile-executive-cockpit, step-mobile-cockpit-* (mobile cockpit subtree, → step-os-operations-desk)
step-tactical-operations-screen + 2 children        (3 cards, → step-os-operations-desk)
step-fallow-*                                        (3 cards, → step-os-operations-desk)
step-wayseer-fallow-next-prompt-engine               (1 card, → step-os-context-and-recency)
step-ado-intake-nucleus + 8 children                 (9 cards, → step-os-software-factory-spine sibling, OR new step-os-ado-intake)
step-recency-first-agent-context + 1 child           (2 cards, → step-os-context-and-recency)
step-software-factory-{outbound-pin-gate,outbox-table-and-page,inbox-event-model,schema,context-bundle-handoff,plan-air-gap-ui,plan-merge-up,stakeholder-preview-deploy,executive-planner-contract,planner-headless-host,hermes-eval,focused-ui,conversation-tag}  (13 cards, → step-os-software-factory-spine)
step-agent-orchestration-substrate, step-agent-launch-primitive, step-agent-context-rhythm-cards-kb-prompts, step-agent-launch-transport-validation, step-agent-new-thread-* (5 cards, → step-os-agent-orchestration)
step-idea-gravity-*                                  (5 cards, → step-os-idea-gravity)
step-worker-continuation-detector                    (1 card, → step-os-idea-gravity)
step-operator-situation-dashboard                    (1 card, → step-os-operations-desk)
step-fast-operator-state-cli                         (1 card, → step-os-context-and-recency)
step-autonomy-policy-bounds                          (1 card, → step-os-agent-orchestration)
step-autonomous-claude-launch-flow                   (1 card, → step-os-agent-orchestration)
step-claude-compact-context-hydration                (1 card, → step-os-context-and-recency)
step-teams-graph-readonly                            (1 card, → step-cmg-telegento-demo-readiness — or OS, ambiguous)
step-session-aware-agent-start-contract              (1 card, → step-os-agent-orchestration)
step-launch-wave-ledger-all-agent-sources            (1 card, → step-os-agent-orchestration)
step-runway-compute-planner                          (1 card, → step-os-agent-orchestration)
step-product-launch-media-*                          (5 cards, → step-os-product-launch-media)
step-berthier-*, step-claude-berthier-*              (5 cards, → step-os-agent-orchestration)
step-lm-studio-planner-backend-spike                 (1 card, → step-os-agent-orchestration)
step-backend-registry-*                              (2 cards, → step-os-agent-orchestration)
step-cross-machine-agent-thread-sharing-spike        (1 card, → step-os-agent-orchestration)
step-executive-*                                     (4 cards, → step-os-operations-desk)
step-thread-quality-flags-slop-session               (1 card, → step-os-operations-desk)
step-autolink-urls-in-chat-components                (1 card, → step-os-operations-desk)
step-sound-attention-layer                           (1 card, → step-os-operations-desk)
step-coverage-provenance-hardening                   (1 card, → step-os-operations-desk)
step-david-review-queue-category                     (1 card, → step-os-operations-desk)
step-active-work-context-scope-routing               (1 card, → step-os-context-and-recency)
step-plan-merge-backup-and-sprawl-cleanup            (1 card, → step-B)
step-plan-sprawl-inventory-merge-prune               (1 card, → step-B)
step-plan-card-list-cli                              (1 card, → step-B)
step-os-hydrate-factory-scope-resolution             (1 card, → step-os-context-and-recency)
step-outbox-smoke-row-cleanup                        (1 card, → step-os-software-factory-spine)
step-hide-unready-today-rail                         (1 card, → step-os-operations-desk)
step-hot-mode-leakage-alarm-and-focus-guard          (1 card, → step-os-operations-desk)
step-fallow-next-prompt-pane-footer-ui               (1 card, → step-os-operations-desk)
step-live-token-piggyback-experiment                 (1 card, → step-os-operations-desk)
step-first-class-cli-agent-sources                   (1 card, → step-os-agent-orchestration)
step-local-hermes-router-agent-evaluation + 1 child  (2 cards, → step-os-agent-orchestration)
step-ops-dream-paradise-hygiene-pass                 (1 card, → step-os-operations-desk)
step-factory-package-review-fixes                    (1 card, → step-os-software-factory-spine)
step-operator-studio-recency-context-front-door      (1 card, → step-os-context-and-recency)
step-agent-startup-tool-manifest                     (1 card, → step-os-agent-orchestration)
step-executive-ops-philosophy-alignment-pass         (1 card, → step-os-operations-desk)
step-operator-studio-timeline-story-surface          (1 card, → step-os-operations-desk)
```

## Card-level moves — Valikharlia → CMG (37 cards)

```
step-telegento-agentic-loop-today + 13 children      (14 cards, → step-cmg-telegento-product)
step-telegento-ado-teams-assisted-action-lane + 8 ch (9 cards, → step-cmg-telegento-demo-readiness)
step-telegento-gemini-31-before-after-lab + 8 ch     (9 cards, → step-cmg-telegento-demo-readiness)
step-software-factory-clarifying-telegento + 13 ch   (14 cards, → step-cmg-telegento-product)
```

## Card-level moves — OS-era → CMG (104 cards)

```
step-C + 10 children (C1–C10)                        (11 cards, → step-cmg-jsa-product)
step-C-pipeline + entire subtree                     (≈55 cards, → step-cmg-telegento-pipeline)
step-C-cd + 4 children                               (5 cards, → step-cmg-cd-safety)
step-E + 1 child                                     (2 cards, → step-cmg-telegento-product)
step-H + entire subtree (H1–H6, H4-*, H-sa-*, H-act-*, H-todo-*, H-asks-email)  (≈31 cards, → step-cmg-telegento-demo-readiness)
```

## Open questions for David

1. **Confirm the three-plan split** vs. a single plan with three top-level lanes. Three plans give the cockpit/UI separation but force you to switch plans to see the whole picture; one plan is busier but keeps cross-lane context glanceable.
2. **`step-software-factory-clarifying-telegento`** — move with CMG (recommended) or keep with the generic Software Factory in OS?
3. **`step-D` (Internal political play)** — keep in OS plan or split into a personal/career plan?
4. **Status normalization on Valikharlia** — confirm the `done → covered`, `todo → open`, `in_progress → in-motion` mapping.
5. **Soft-delete the `t`-workspace plans** entirely, or migrate before delete?
6. **Provenance footer** on every moved card body — OK to add a single line, or prefer a single KB entry that records all moves and leave card bodies untouched?
