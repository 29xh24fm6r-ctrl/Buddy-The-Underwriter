# Portfolio snapshot schema and persistence commissioning

Date: 2026-08-29  
Product: Buddy The Underwriter / www.buddysba.com

## Production evidence

The production deployment on commit `9fe4b2471558fbd0e749c0ed6718ae12ea542482`
served the public site with HTTP 200, but the August 29 nightly invocation
returned HTTP 500. Portfolio aggregation reached its canonical write boundary
and PostgREST reported that `public.portfolio_risk_snapshots` was absent from
the schema cache.

Repository-wide source and migration searches found the table in the aggregator
and its unit tests only. No migration owned the table. This was therefore a
schema-lineage failure, not a transient empty-portfolio state.

## Root causes

1. Runtime code and tests depended on a table that the repository could not
   create or reproduce.
2. The upsert checked only the database error channel. It did not request the
   affected row, so a zero-row or mismatched persistence outcome could not be
   distinguished from a successful canonical snapshot.

## Repair

- Add one forward, additive migration for the exact snapshot contract used by
  the nightly aggregator.
- Use `(bank_id, as_of_date)` as the canonical conflict identity so repeated
  daily invocations converge on one bank-scoped evidence row.
- Enforce bank ownership, non-negative counts/exposures, bounded rates,
  object-shaped concentration evidence, and count consistency.
- Enable RLS; deny `PUBLIC`, `anon`, and `authenticated`; permit only the
  server-side `service_role` path currently used by the worker.
- Reload the PostgREST schema after migration.
- Require the upsert to return the canonical row and verify its tenant, date,
  metrics, and concentration evidence before reporting success.
- Record migration provenance in the schema manifest and add direct behavior
  plus structural regression coverage.

## Safety and scope

The migration is non-destructive: it creates a missing table and index, adds no
public policy, deletes no row, and changes no existing table or function. It
touches Buddy The Underwriter source only.

The migration is prepared but has not been applied directly to production
because the available database connection has not been proven to be the
Buddy-owned Supabase project. No ambiguous project was queried or modified.

## Closure requirements

1. Required CI and exact-head preview verification must pass.
2. Matt must merge the PR; do not merge automatically.
3. Apply the migration through the verified Buddy deployment path.
4. Observe a subsequent authorized nightly invocation and prove one canonical
   returned row for a bank with final decisions.
