# Push notification setup — 2026-05-10

Wiring matches the recommendation in KB entry
`kb-2026-05-10-push-notification-options-for-customer-of-one` section 4:
**ntfy.sh hosted, single anonymous topic, thin server-side helper.**

Implementation lives in [lib/operator-studio/notifier.ts](../../lib/operator-studio/notifier.ts).
Trigger lives in [app/api/operator-studio/cockpit/spawned-by/route.ts](../../app/api/operator-studio/cockpit/spawned-by/route.ts).

## One-time phone setup (David)

1. Install the free **ntfy** iOS app from the App Store.
2. Open ntfy, tap **+** (top right) → **Subscribe to topic**.
3. Enter a hard-to-guess topic name, e.g.
   `operator-studio-david-7Hq2L9xkP4mZw3Rt`.
   - Topic name = bearer secret. Anyone who knows it can publish to it.
   - If it ever leaks, rotate by changing the suffix and updating
     `.env.local`.
4. Leave **Server** as the default (`ntfy.sh`).
5. Tap **Subscribe**.

## One-time server setup

Add to `.env.local`:

```
NTFY_TOPIC=operator-studio-david-<your random suffix>
# Optional — both default to enabled / off:
# OPERATOR_STUDIO_NOTIFICATIONS_ENABLED=1
# OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE=0
```

Restart the dev server so the env reload takes effect.

## Verify end-to-end

```
pnpm tsx scripts/push-notification-impl-acceptance.ts
```

The acceptance script runs in **test mode** (`OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE=1`),
so it does NOT fire a real notification to your phone. It asserts the
helper signature, the transition detector (no-op on same-state polls,
single alert on state change), and the disabled / unconfigured branches.

To send yourself one real test ping after the topic is set up:

```
NTFY_TOPIC=operator-studio-david-<suffix> \
  pnpm tsx -e 'import("./lib/operator-studio/notifier").then(({notify}) => notify({title:"ntfy hello", body:"setup OK", url:"http://localhost:4200/operator-studio/cockpit"}))'
```

You should see the alert on your phone within ~5 seconds.

## What fires an alert

The trigger lives on the cockpit poll path (`spawned-by` route). Each
poll computes every active worker's `reviewStatus`. When a worker
transitions FROM a non-ready tier (`live` / `idle`) INTO any
not-yet-human-approved ready tier — `candidate-self-believed`,
`awaiting-berthier-check`, or `berthier-reviewed` — exactly one
notification fires. Re-polls in the same state are ignored.

## Safety rails baked into the helper

- **Env gate.** Set `OPERATOR_STUDIO_NOTIFICATIONS_ENABLED=0` to silence
  everything without removing the topic.
- **Per-minute cap.** Token bucket: max 5 alerts / minute. Overflow is
  dropped with a warn log so a runaway worker can't DOS the topic.
- **Test mode.** `OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE=1` captures
  payloads in-process instead of POSTing — the acceptance script uses
  this to prove the wire without ringing your phone.
- **Unconfigured = no-op.** Missing `NTFY_TOPIC` logs a warning and
  returns `{ status: "unconfigured" }` — never throws.
