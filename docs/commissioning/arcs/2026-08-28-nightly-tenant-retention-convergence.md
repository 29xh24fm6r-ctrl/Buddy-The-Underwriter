# Nightly tenant and retention convergence — 2026-08-28

## Scope

Buddy The Underwriter only: the production `/api/cron/nightly` worker, its
portfolio aggregation path, and its bounded telemetry-retention evidence. No
other product repository, database, deployment, or integration was accessed.

## Production evidence

The August 28, 2026 production invocation returned HTTP 200 but recorded two
fail-closed paths:

- all five configured banks failed portfolio aggregation because
  `decision_snapshots.bank_id` does not exist;
- retention RPC work could run, but the completion/failure evidence insert was
  rejected by `buddy_system_events_event_type_check`.

Production continued serving `www.buddysba.com` with HTTP 200 on
`be5ee2a382a99711f1b987d833bc3a0b5f251cb3`.

## Root causes

1. `decision_snapshots` is canonically deal-scoped. Its schema exposes
   `deal_id`, while tenant ownership lives on `deals.bank_id`. The nightly
   aggregator queried a denormalized column that never existed.
2. `buddy_system_events.event_type` accepts a bounded operational vocabulary.
   Retention attempted to use semantic names
   `telemetry_retention_purge_completed` and
   `telemetry_retention_purge_failed` as event types instead of retaining the
   semantic name in the JSON payload.

## Repair

- Resolve the bank's canonical deal IDs first, then read final decision
  snapshots through `decision_snapshots.deal_id`.
- Treat a bank without deals or final decisions as an expected empty portfolio.
- Keep deal-scope, snapshot-read, and snapshot-write failures loud.
- Restrict the snapshot select to fields required by the calculation.
- Persist retention outcomes as allowed `success`/`error` event types and
  preserve the detailed outcome in `payload.kind`.
- Preserve fail-closed evidence persistence.

## Regression coverage

- canonical bank-to-deal-to-snapshot tenant filtering;
- no direct `decision_snapshots.bank_id` filter;
- empty bank and empty final-decision states;
- deal-scope, decision-read, and snapshot-write failures;
- successful and failed retention event contracts;
- retention evidence insertion failure.

## Verification status

- Source and schema evidence: complete.
- Code head `a19bac91ef14c2553f27e4f9ffa57c185bebd588`:
  - 13,347 tests: 13,338 passed, 0 failed, 9 skipped;
  - React-server tests: 18 passed, 0 failed;
  - research evaluation: 7 passed, 0 failed, 13 production-fixture placeholders
    skipped;
  - CI, Build Check, Secret Scan, typecheck, lint, architecture, safety,
    schema-select, Never-500, and public Playwright passed.
- Exact-head preview `dpl_DoWsXR1NNqcophKUwjjUjsoArWU3` is READY, HTTP
  200, SHA-matched to the code head, and has no error/fatal runtime logs.
- Production verification requires Matt's merge and the next nightly
  invocation.
- Direct row-level verification: blocked because the available Supabase
  connection identifies as another product and was not accessed.

## Independent checkpoints and next targets

- PR 947 remains an independent clean merge checkpoint.
- PR 878's complete Golden Trident transaction still requires a verified
  Buddy-owned Supabase connection and an authorized fixture.
- After this arc is green, rotate to the owned worker-tick authentication
  failures visible in production, without crossing into the ambiguous
  `/api/pulse/cron-forward-ledger` path.
