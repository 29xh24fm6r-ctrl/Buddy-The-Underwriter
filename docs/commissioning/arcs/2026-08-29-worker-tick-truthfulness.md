# Composite worker-tick outcome truthfulness

Date: 2026-08-29  
Scope: Buddy The Underwriter only

## Evidence and root cause

The authenticated `/api/jobs/worker/tick` route combines document OCR,
classification, extraction, spreads processing, spread janitors, document-job
recovery, and stale-research recovery.

Source audit proved one coupled false-green failure mode:

- OCR, classification, extraction, and spreads queue discovery discarded
  Supabase errors and returned the same idle result as an empty queue.
- The spreads batch wrapper discarded every non-idle child failure and always
  returned `ok: true`.
- The composite route omitted non-idle processor failures, janitor failures,
  and stale-research failures from its response.
- The dedicated spreads path returned HTTP 200 even when the worker or either
  janitor returned `ok: false`.
- Raw child errors could escape through authenticated worker responses.

A database outage or partially failed maintenance cycle could therefore be
acknowledged to the scheduler as a healthy idle tick.

## Repair

- Distinguish queue-read failure from idle across all four queue families.
- Propagate non-idle spread processor failures through the batch wrapper.
- Classify every critical child outcome as success, idle, or failure.
- Record each failure in the composite result, emit a worker-step error log,
  and send a heartbeat for the non-green invocation.
- Return HTTP 503 whenever any child step is incomplete.
- Redact database/provider detail from route responses while preserving the
  failed step identity.
- Add behavioral and integration-contract regression coverage.

## Verification

- Code head `8b6d14d6ddf6ebef7efd9f4bb2dd07fc31c2898f`.
- Broad unit suite: 13,624 tests; 13,615 passed, 0 failed, 9 skipped.
- React-server suite: 18/18; research golden set: 7 passed, 0 failed.
- CI, typecheck, lint, architecture, safety, schema gates, Never-500, Build
  Check, Secret Scan, Route Budget, and public Playwright passed.
- Exact-head preview `dpl_p8nbWdQZdZYmy5NMX1JEHv3RHYdj` is READY,
  SHA-matched, HTTP 200, and runtime-clean.

## Safety and closure

No schema, dependency, credential, provider configuration, production row, or
cross-product change is included. No unverified Supabase project was queried.

Post-merge transactional closure requires a verified Buddy-owned Supabase
connection plus authorized document and spreads fixtures that prove idle,
queue-read failure, child-processing failure, janitor failure, and complete
success responses.
