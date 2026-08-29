# Artifact worker truthfulness commissioning arc

Date: 2026-08-29  
Product boundary: Buddy The Underwriter only

## Evidence

The scheduled artifact processor claims queued document work through
`claim_next_artifact_for_processing`. A failed RPC was logged and returned as
`null`, which is also the legitimate “queue is empty” value. The batch stopped
and the API returned an idle HTTP-200 success even though it had never proven
that no work remained.

The same route always returned `ok: true` and HTTP 200 after a completed batch,
including batches whose artifact results contained real failures. Vercel Cron
and operations therefore could not distinguish a healthy idle/complete
invocation from a stalled claim or partially failed document-processing batch.

## Root cause

The worker boundary collapsed three materially different states—empty queue,
claim failure, and item-processing failure—into one green scheduled response.

## Repair

- Throw a deterministic, non-sensitive `artifact_claim_failed` error when the
  canonical queue-claim RPC fails.
- Preserve `null` only for a successfully proven empty queue.
- Derive the route’s HTTP status and `ok` value from the batch failure count
  using the shared scheduled-job outcome contract.
- Retain per-artifact results for diagnosis while making any real failure
  non-green.
- Add structural regression coverage for both failure boundaries.

## Safety

This repair changes only failure reporting and propagation. It does not modify
schema, production rows, storage objects, provider configuration, credentials,
dependencies, claim ordering, or successful processing behavior. It is
independent of all currently open Buddy The Underwriter repair PRs.

## Production closure

After merge and deployment, exercise an authorized worker invocation with a
controlled claim failure and a controlled failed artifact. Both must return a
non-green status, while a proven empty queue and an all-success batch must remain
HTTP 200.

PR 878's full Golden Trident transaction remains blocked on a verified
Buddy-owned Supabase connection and authorized sealed fixture.
