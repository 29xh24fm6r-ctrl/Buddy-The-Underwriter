# Lifecycle persistence truthfulness

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`

## Evidence and root cause

The canonical `advanceDealLifecycleCore` writer updated `deals.stage` and then
unconditionally returned success after its two required evidence calls. Three
failure modes were dark:

- Supabase UPDATE can return no error while affecting zero rows; no read-back
  proved the requested stage was durable.
- `writeEvent` already returns `{ ok: false }` on canonical event failure, but
  the lifecycle writer ignored that result.
- `logLedgerEvent` swallowed both thrown errors and PostgREST `{ error }`
  results, so a rejected pipeline insert was indistinguishable from success.

This could make callers and the UI believe a lifecycle transition converged
when the authoritative stage, canonical event, or operator evidence was absent.

## Repair

- Distinguish database lookup failure, missing deal, and missing bank ownership.
- Read the authoritative stage back after UPDATE and refuse success unless it
  exactly matches the requested transition.
- Require the canonical lifecycle event before attempting the pipeline record.
- Add a strict pipeline-evidence API while preserving the exact
  `Promise<void>` contract for existing best-effort callers.
- Return truthful partial-persistence states when evidence fails after the
  stage has already been written.
- Add executable regression coverage for silent zero-row updates, lookup
  failures, canonical event failure, pipeline evidence failure, and success.

## Verification

Exact repair head before this evidence-only ledger update:
`dcd1a496c7e87e3c8d3beed65cc6e2e783be37b7`.

- Complete four-file diff inspected: 273 additions, 13 deletions.
- Typecheck, lint, architecture, legacy-write, safety, Never-500, schema-select,
  Build Check, Secret Scan, and public Playwright gates passed.
- Unit suite: 13,348 tests; 13,339 passed; 0 failed; 9 skipped.
- React-server condition: 18 passed, 0 failed.
- Research evaluation: 7 passed, 0 failed; 13 known placeholders skipped.
- Schema drift remains report-only with 1,732 unacknowledged findings.
- Exact-head Vercel deployment `dpl_Hm2n2zLzpGDWv9zUZmkaUR6GJtBp` is READY,
  returned HTTP 200, exposed matching `x-buddy-build`, and had no error/fatal
  runtime logs.
- Production remained READY and HTTP 200 on
  `be5ee2a382a99711f1b987d833bc3a0b5f251cb3`, with no runtime-error clusters
  in the two-hour verification window. The repair is not yet deployed.

## Dependencies, unresolved risks, and closure

- This arc is independent of open PRs 947, 948, and 949 and does not touch their
  files.
- Direct production-row verification requires a verified Buddy-owned Supabase
  connection; the available connection identifies as another product and was
  not accessed.
- After merge, closure requires an authorized lifecycle transition proving the
  state row, canonical event, and pipeline evidence agree.
- The next readiness-persistence error-handling target overlaps PR 949 and must
  remain paused until that PR merges or closes. The next independent audit
  should rotate to identity/signing or calculation-output persistence.

No schema, dependency, credential, environment, permission, or production-data
mutation is part of this repair.
