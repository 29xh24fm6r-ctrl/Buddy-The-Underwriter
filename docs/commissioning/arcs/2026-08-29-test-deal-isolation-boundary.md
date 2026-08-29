# Test-deal distribution isolation boundary

Date: 2026-08-29
Product: Buddy The Underwriter / www.buddysba.com

## Production checkpoint

PR 970 is deployed in production as
`e092dc49eeda429f25a9e611d76318792571a660`. The deployment is READY,
`www.buddysba.com` returns HTTP 200, and the audited window contains no
warning, error, fatal, or grouped runtime-error evidence.

PR 972 independently repairs marketplace cadence and lender-message
convergence. It is green, mergeable, and awaits Matt's merge.

## Evidence and root cause

`src/lib/qaIdentity/isolation.ts` queried `deals.is_test` but discarded the
Supabase error and returned `false` for a missing row, malformed state, or
database outage. The same boolean guarded the three real-lender distribution
paths:

- Golden Trident sealing and marketplace publication
- irreversible borrower lender selection
- lender package disclosure

Unavailable authoritative state was therefore interpreted as proof that a deal
was a production deal. Two routes also collapsed every isolation failure into a
403 test-data block, while the seal route allowed an unclassified exception to
escape.

## Repair

- Introduce typed isolation failures for test application, production cleanup
  refusal, missing deal, and unavailable authoritative state.
- Require an error-free returned row with a literal boolean `is_test` value.
- Preserve the 403 distribution block only for a proven test application.
- Preserve non-disclosure with 404 for an absent authoritative deal.
- Return explicit 503 `deal_isolation_state_unavailable` from all three
  distribution routes when the database or isolation flag cannot be trusted.
- Add a cross-route regression guard covering the complete boundary.

## Scope and safety

Buddy The Underwriter only. No schema, dependency, credential, production-data,
or destructive storage change. The branch is independent of PR 972's
application files and uses a separate commissioning arc document.

## Verification

Focused and broad CI, full diff inspection, mergeability, and exact-head Vercel
preview verification are pending on the repair branch.

## Remaining closure

After merge, an authorized Buddy fixture should prove both outcomes in deployed
production: a synthetic QA deal is blocked and a production deal proceeds when
the canonical isolation row is available. Database evidence requires a verified
Buddy-owned Supabase connection; no unverified project was queried.
