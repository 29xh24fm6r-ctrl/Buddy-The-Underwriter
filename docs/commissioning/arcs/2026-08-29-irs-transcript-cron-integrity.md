# IRS transcript cron integrity — 2026-08-29

## Scope and checkpoint

This arc is limited to Buddy The Underwriter. It changes no schema, credential,
provider configuration, production data, or other product.

PR 878 is merged and deployed. Its complete Golden Trident
seal-to-marketplace-to-lender transaction still requires a verified Buddy-owned
Supabase connection and an authorized sealed fixture. Production was serving
`bea361e11dadf756281ae913441a80c5e1b4cb64` with HTTP 200 and no warning,
error, fatal, or grouped runtime-error evidence in the latest two-hour scan when
this arc began.

## Evidence and root cause

- The IRS-transcript scheduled route returned `ok: true` and HTTP 200 after the
  worker regardless of reconciliation failures.
- Pending-request discovery discarded the Supabase read error, making an outage
  indistinguishable from an empty queue.
- Received, expired, and polling-cursor updates did not check database errors or
  prove the exact returned row and requested state.
- Delayed-transcript gap persistence was unchecked.
- Reconciliation discarded request and borrower-fact read errors, so an outage
  could look like a missing request or zero discrepancies.
- Discrepancy gaps, reconciled status, and the completion event were all
  unchecked, yet the function still returned success.
- The orchestration layer silently ignored non-successful reconciliations.

## Repair

- Fail closed on pending-request, request, and authoritative financial-fact read
  failures.
- Use compare-and-set request mutations and require exact returned-row, status,
  attempt-count, and cursor proof before emitting a successful polling outcome.
- Require returned-row proof for delayed and discrepancy gap writes, reconciled
  status, and the completion event.
- Preserve explicit per-request failure evidence in the polling orchestration.
- Map any incomplete reconciliation batch to the shared non-green scheduled-job
  response.
- Add behavior coverage for read failures and zero-row mutations plus a
  cross-boundary scheduled-route regression guard.

## Verification

Focused and broad validation, complete-diff inspection, required CI, and the
exact-head Vercel preview are recorded on the pull request before merge
recommendation. No merge is performed by commissioning automation.

## Remaining closure

After merge, authorized end-to-end proof requires the verified Buddy-owned
Supabase connection and a transcript fixture that covers received,
still-pending, expired, discrepancy, and controlled persistence-failure paths.
