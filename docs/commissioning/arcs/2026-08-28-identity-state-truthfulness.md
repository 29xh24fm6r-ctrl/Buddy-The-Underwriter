# Identity verification state truthfulness — 2026-08-28

## Scope

Buddy The Underwriter only: borrower-portal and brokerage identity-verification
status/start surfaces plus the shared Didit orchestration service.

## Evidence and root cause

Supabase query failures are returned as { data, error } and do not necessarily
throw. Several authoritative identity paths inspected only data:

- borrower GET could report no qualifying owners or no verifications during a
  database failure;
- brokerage GET could report owner-not-found, verification-not-started, or an
  empty owner list;
- refresh could report no verification;
- start could miss an existing session and create a second provider session, or
  report owner-not-found;
- batch reconciliation could report a zero-work success.

Those outcomes collapse "state unavailable" into valid business state and can
mislead borrowers or create provider-side duplication.

## Repair

- Return HTTP 503 identity_state_unavailable from borrower and brokerage status
  surfaces when authoritative reads fail.
- Keep legitimate zero-row results distinct from database errors.
- Stop identity initiation before the Didit create call when existing-session or
  owner provenance cannot be proven.
- Preserve reconciliation's best-effort behavior while recording a failed batch
  and readError instead of a false zero-work success.
- Map shared STATE_READ_FAILED results to HTTP 503.
- Add behavioral and contract regression coverage.

No schema, dependency, production-data, or provider mutation is included.

## Verification plan

- focused identity/Didit tests;
- full CI, build, security, schema, Never-500, research, and public browser
  checks;
- exact-head Vercel preview and runtime logs;
- authenticated production transaction after merge with an authorized fixture.

## Remaining evidence

- Transactional identity start/refresh/webhook proof requires a verified
  Buddy-owned Supabase connection and authorized borrower fixture.
- Golden Trident seal-to-marketplace-to-lender transactional closure remains
  blocked on the same class of approved fixture and connection.
- Authenticated Playwright remains blocked on configured QA credentials.

## Next target

Audit upload/storage status and signed-download metadata surfaces for the same
database-error ambiguity.
