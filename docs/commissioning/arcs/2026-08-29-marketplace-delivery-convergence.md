# Marketplace lifecycle and lender-delivery convergence

Date: 2026-08-29
Product: Buddy The Underwriter / www.buddysba.com

## Production checkpoint

PR 970 merged externally as `e092dc49eeda429f25a9e611d76318792571a660`.
Production deployment `dpl_6Gz3dBLifEN5XemqVR4HLbnYxNnk` is READY,
`www.buddysba.com` returns HTTP 200 with the exact build SHA, and the
post-deployment observation window contains no warning, error, fatal, or grouped
runtime-error evidence.

## Evidence and root cause

The ten-minute marketplace worker is the production path that opens sealed
listings, expires unpicked listings, and flushes lender notifications.

- Candidate-list reads discarded Supabase errors and treated database
  unavailability as an empty queue.
- Listing updates treated query success as mutation success without returned-row
  proof. Expiration did not preserve the selected status in its compare-and-set.
- Claim windows opened before every matched lender notification was durably
  admitted. Queue failures were ignored after the lifecycle transition, so the
  next run could not converge the missing notification.
- Provider failures moved outbox rows to terminal `failed` after one attempt;
  the cycle selected only `pending`, permanently stranding transient failures.
- The cron response remained `ok: true` even when delivery attempts exhausted.

## Repair

- Fail closed on both lifecycle candidate reads.
- Admit or prove cooldown suppression for every matched lender notification
  before opening the claim window.
- Require returned-row evidence for open and expiration transitions and preserve
  the selected status in expiration compare-and-set.
- Recover both pending and historical failed outbox rows below a bounded
  five-attempt limit.
- Preserve a five-minute delivery lease between retries, keep transient failures
  pending, and terminally fail only the fifth unsuccessful attempt.
- Return HTTP 503 with `lender_delivery_exhausted` when the bounded cycle
  exhausts a delivery.
- Add runtime and structural regression coverage for the convergence contract.

## Scope and safety

Buddy The Underwriter only. No production data was mutated. The repair changes
no schema, dependency, credential, provider configuration, or infrastructure.
It is reversible application and test code.

## Verification

Focused and broad validation, full diff inspection, exact-head preview
verification, and CI monitoring are pending on the repair branch.

## Remaining closure

A verified Buddy-owned Supabase connection and authorized sealed transaction are
still required to prove the complete PR 878 seal-to-marketplace-to-lender
ceremony and this worker's database/provider behavior in production. No
differently owned or ambiguously owned project was queried.
