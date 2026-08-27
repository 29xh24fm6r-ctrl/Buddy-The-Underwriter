# Nightly governance convergence — 2026-08-27

Scope: Buddy The Underwriter production only.

## Production evidence

- The scheduled `/api/cron/nightly` invocation emitted five error groups for
  banks with no final decision snapshots. Source inspection proved this expected
  empty state was thrown as an exception, logged as an error, and prevented
  policy drift and suggestion work for those banks.
- The first telemetry retention RPC failed with
  `canceling statement due to statement timeout`. Its database function looped
  until the entire table was drained inside one RPC transaction, so the failure
  also prevented the two later retention tables from running.
- Rejected Didit and Twilio webhook probes were fail-closed security evidence.
  The older Golden Trident FatalError was an intentional institutional-review
  publication block and is not part of this repair.

## Repair

- Give empty portfolios a typed expected-state error and classify them as
  `skipped_no_final_decisions` while continuing later bank governance work.
- Preserve loud failure behavior for real portfolio, policy, and provider errors,
  with per-step completion evidence in the nightly response.
- Replace unbounded retention functions with 1,000-row single-batch RPCs.
- Repeat those RPCs in the worker under per-table batch and global time budgets,
  continue past one table's failure, and persist completed/partial evidence.
- Preserve service-role-only execution and fixed search paths.

## Verification target

Focused nightly and retention tests, schema/security guards, full CI, exact-head
Vercel preview, complete diff inspection, and runtime-clean preview are required
before merge recommendation. Direct production-row proof remains blocked until
the verified Buddy-owned Supabase connection is available.
