# Brokerage Lifecycle-Triggered Communications

> Phase 12A–12D: Hooks that bridge deal/document lifecycle events to the comms pipeline.

## Supported Lifecycle Hooks

| Event | Trigger Source | Comms Action |
|-------|---------------|-------------|
| `documents_received` | Banker or borrower uploads a document | Banker alert (email + optional Slack) |
| `readiness_regressed` | Previously-ready deal becomes not-ready | Banker alert |
| `deal_ready_for_review` | Deal transitions from not-ready to ready | Banker alert |
| `missing_documents_detected` | Readiness gap detects unfulfilled required slots | Borrower nudge (email + optional SMS) |
| `borrower_nudge_failed` | Borrower nudge outbox item fails non-retryably | Banker escalation alert |
| `borrower_nudge_exhausted` | Borrower nudge outbox item exhausts all retries | Banker escalation alert |

## Source Call Sites

| Hook | File | Trigger Point |
|------|------|--------------|
| `documents_received` | `src/app/api/deals/[dealId]/files/record/route.ts` | After banker document insert + ledger |
| `documents_received` | `src/app/api/portal/[token]/files/record/route.ts` | After borrower upload + `recomputeDealReady()` |
| `deal_ready_for_review` | `src/lib/deals/readiness.ts` | After atomic `ready_at` transition (null -> set) |
| `readiness_regressed` | `src/lib/deals/readiness.ts` | After `ready_at` cleared on previously-ready deal |
| `borrower_nudge_failed` | `src/lib/brokerage/commsOutbox.ts` | After non-retryable failure on nudge outbox item |
| `borrower_nudge_exhausted` | `src/lib/brokerage/commsOutbox.ts` | After retry exhaustion on nudge outbox item |

## Core Module

`src/lib/brokerage/commsLifecycleHooks.ts`

- `handleLifecycleHook(input, sb)` — routes events to existing `enqueueBorrowerNudges()` or `enqueueBankerAlerts()`
- `handleLifecycleHookBatch(inputs, sb)` — sequential batch processor

## Invariants

### processOutbox = false
All lifecycle hooks enqueue into the outbox only. They never process/send.
Outbox processing is a separate, gated operation (admin action, cron, or explicit API call).

### Hook failure isolation
All call sites use `void import(...).then(...).catch(() => {})`.
A hook failure never blocks uploads, readiness recomputation, or outbox processing.

### Idempotency / dedup
Hooks rely on the outbox idempotency key format: `{type}:{dealId}:{channel}:{purpose}:{YYYY-MM-DD}`.
Duplicate hooks on the same day for the same deal/channel/purpose are deduplicated automatically.

### No direct adapter calls
Lifecycle hooks call `enqueueBorrowerNudges()` or `enqueueBankerAlerts()`, which call `enqueueCommsMessage()`.
No hook ever calls `createEmailAdapter()`, `createSmsAdapter()`, or any adapter directly.

### No schema changes
Phase 12 added no database tables, columns, or migrations.
All data flows through existing `brokerage_comms_outbox` and `brokerage_comms_ledger` tables.

## Ledger Events

| Event Type | Meaning |
|-----------|---------|
| `comms_lifecycle_hook_received` | Hook was called |
| `comms_lifecycle_hook_enqueued` | Hook successfully enqueued outbox item(s) |
| `comms_lifecycle_hook_skipped` | Hook skipped (inactive deal, no eligible recipient, dedup) |
| `comms_lifecycle_hook_failed` | Hook threw an error (isolated, non-blocking) |

## Observability

### Admin UI
`/admin/brokerage/comms` — "Lifecycle Hooks" section shows:
- Event type, outcome (received/enqueued/skipped/failed), channel, purpose, masked recipient, reason, timestamp
- Per-deal summary when deal ID entered
- Global recent view otherwise

### API
`GET /api/brokerage/comms/lifecycle?dealId=...&limit=25`
- Auth: `requireBrokerageCommsAdmin()`
- Limit: 1–100 (default 25)
- Response: redacted via `redactResponseSecrets()`
- Never returns raw message bodies, API keys, or full recipients

### Module
`src/lib/brokerage/commsLifecycleObservability.ts`
- `getLifecycleCommsSummary(dealId, sb)` — counts, skip reasons, outbox correlation, warnings
- `getRecentLifecycleCommsEvents(sb, opts)` — redacted event views
- `summarizeLifecycleHookOutcomes(events)` — pure summary builder

## Operator Troubleshooting

### Hook fires but no outbox item produced
Check `latestSkipReasons` in the summary. Common causes:
- `no_banker_contact` — `BROKERAGE_BANKER_EMAIL` not set
- `deal_status_closed` — deal is in a terminal status
- `no_missing_docs` — all required document slots are filled
- Idempotency dedup — same hook already fired today for this deal/channel

### Hook failure in ledger
Check `comms_lifecycle_hook_failed` events. The `error` field in metadata describes the cause.
Hook failures are isolated and never block the primary workflow.

### Borrower not receiving nudges
1. Check `borrower_email` on the deal
2. Check `sms_opt_in` and valid E.164 phone in concierge session
3. Check `BROKERAGE_COMMS_MODE` — must not be `stub` for real sends
4. Check outbox for pending items (may need outbox processing)

## Rollback / Disable

### Disable all lifecycle hooks
Set `BROKERAGE_COMMS_MODE=stub`. Hooks will still fire and enqueue, but outbox processing will use stub adapters (no real sends).

### Disable specific hooks
Remove the `void import(...)` call at the specific call site. Each hook is a single fire-and-forget line that can be commented out independently.

### Emergency stop all sends
Set `BROKERAGE_COMMS_MODE=stub` immediately. No data loss. Outbox items remain pending. Resume by switching back to `live`.

## Regression Commands

```bash
pnpm brokerage:comms:lifecycle-regression   # Phase 12 full regression
pnpm brokerage:comms:regression             # Phase 11 full regression
```

## Test Coverage

| File | Tests | Covers |
|------|-------|--------|
| `commsLifecycleHooks.test.ts` | 11 | Hook routing, dedup, inactive skip, failure isolation |
| `commsLifecycleWiring.test.ts` | 9 | Call site wiring, no adapter calls, pending-only, governance |
| `commsLifecycleObservability.test.ts` | 9 | Summary, counts, warnings, limit, redaction, UI, auth |
| `lifecycleCommsRegression.test.ts` | 10 | Cross-cutting regression invariants |
