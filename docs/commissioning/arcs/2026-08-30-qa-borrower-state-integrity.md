# QA borrower state integrity — 2026-08-30

## Evidence

The QA borrower authentication and application flows ignored errors from
authoritative lead/deal classification reads. Missing data after a failed read
could therefore be treated as permission to create or resume a session. The
low-level marker could directly reclassify a non-test deal, list failures
returned an empty application set, resume lookups were not bank-bound, and
metadata re-reads did not prove success.

The HTTP boundaries also accepted unbounded JSON and returned raw internal
database/RPC messages.

## Root cause

Security comments described fail-closed intent, but the Supabase result objects
were destructured without checking `error` and the marker combined
classification with mutation. Tenant, classification, mutation, and returned
proof were not enforced as one state transition.

## Repair

- Fail closed on every QA lead/deal classification read.
- Require bank-bound deal proof before resume or session creation.
- Prevent the low-level marker from changing `is_test`; it may only complete
  metadata for a row already proven to be a test application.
- Add compare-and-set update conditions and exact returned-row proof.
- Make application-list failures non-green instead of returning an empty list.
- Require exact RPC result evidence for new QA applications.
- Bound route bodies at 8 KiB, validate identifiers, set no-store responses, and
  return deterministic non-sensitive failures.
- Update regression coverage so reclassification of non-test deals is rejected.

## Closure

No production row was read or mutated. Post-merge closure requires a verified
Buddy-owned database connection and authorized QA fixtures for read failure,
cross-bank resume denial, non-test reclassification denial, and successful
partial-metadata reconciliation.
