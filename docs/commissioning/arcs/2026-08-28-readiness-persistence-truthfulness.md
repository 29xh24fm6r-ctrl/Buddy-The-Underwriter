# Readiness persistence truthfulness

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `7e05f2daf40042634f872edc8b984e1d3e4df169`

## Production and source evidence

- PR 949 is deployed on the baseline production build. `www.buddysba.com`
  returned HTTP 200 and no `not_authenticated` worker logs were found in the
  three-hour verification window. An authorized worker fixture is still needed
  to close that finding transactionally.
- The canonical readiness writer treated returned Supabase errors and silent
  zero-row mutations as successful across readiness inputs, state persistence,
  pipeline evidence, cached reads, and readiness regression.
- Checklist reconciliation exceptions were logged as non-fatal before readiness
  was evaluated from potentially stale data.
- A missing spread-invariant RPC was silently ignored, allowing a deal to become
  ready without proving spread completeness.
- A failed `ready_reverted` event could leave `ready_at` cleared with no
  canonical regression evidence. A failed pipeline insert could leave
  `ready_at` set while operator evidence was absent.

## Root cause and risk

The writer checked thrown exceptions in a few optional paths but did not enforce
the PostgREST result contract. Supabase can return `{ error }` without throwing,
and an UPDATE constrained by RLS or a stale predicate can return no error while
affecting zero rows. This created false convergence: callers could finish while
the authoritative row or required evidence had not persisted.

## Repair

- Require explicit evidence for every readiness count, row read, RPC result,
  state mutation, pipeline insert, and cached readiness read.
- Stop readiness evaluation when checklist reconciliation, entity binding, or
  spread-invariant authority is unavailable.
- Read the ready state back after mutation and reject mismatched state or reason.
- Roll back a newly-set `ready_at` value when its pipeline evidence insert
  fails, preserving retryability.
- Prove not-ready persistence before scheduling unified readiness.
- When a readiness regression event fails, conditionally restore the prior
  authoritative state so the next invocation can retry the complete ceremony.
- Preserve concurrent-transition safety with timestamp and null predicates.
- Keep benign lifecycle stage conflicts non-blocking while surfacing lifecycle
  persistence/evidence failures.
- Add behavioral helper tests plus a canonical-writer wiring contract.

## Verification status

- Source repair and regression coverage: implemented on a branch from the
  baseline.
- Full CI, exact-head preview, and complete diff inspection: required before
  merge recommendation.
- No schema, migration, dependency, credential, environment, permission, or
  production-data mutation is included.

## Dependencies, unresolved risks, and next targets

- This arc is independent of PR 950 and does not touch its files.
- Post-merge closure requires an authorized ready and ready-to-not-ready
  transition proving the deal row, pipeline ledger, canonical event, webhook,
  and scheduled unified refresh agree.
- Direct row verification requires a confirmed Buddy-owned Supabase connection.
  The available non-Buddy connection was not accessed.
- PR 878's full Golden Trident seal-to-marketplace-to-lender delivery ceremony
  remains blocked on that verified connection and an authorized transaction.
- Schema drift remains report-only with 1,732 findings.
- After this arc, rotate to identity/signing persistence or calculation-output
  artifact integrity.
