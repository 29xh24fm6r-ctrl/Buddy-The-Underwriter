# Nightly governance convergence — 2026-08-27

Scope: Buddy The Underwriter production only.

## Production evidence

- The scheduled `/api/cron/nightly` invocation emitted five error groups for
  banks with no final decision snapshots. Source inspection proved this expected
  empty state was thrown as an exception, logged as an error, and prevented
  policy drift and suggestion work for those banks.
- The first telemetry retention RPC failed with
  `canceling statement due to statement timeout`. Its database function looped
  until the entire table was drained inside one RPC transaction, so the failure
  also prevented the two later retention tables from running.
- Rejected identity and messaging webhook probes were fail-closed security
  evidence. The older Golden Trident FatalError was an intentional
  institutional-review publication block and is not part of this repair.

## Root causes and repair

- Give empty portfolios a typed expected-state error and classify them as
  `skipped_no_final_decisions` while continuing later bank governance work.
- Preserve loud failure behavior for real portfolio, policy, and provider errors,
  with per-step completion evidence in the nightly response.
- Lazy-load server-only governance defaults so injected orchestration tests do
  not load the AI provider stack, and classify expected-empty state by its stable
  error code rather than JavaScript class identity.
- Replace unbounded retention functions with service-role-only 1,000-row
  single-batch RPCs.
- Advance all active tables round-robin under per-table batch and global time
  budgets, continue after one table fails, and persist completed or partial
  evidence. A large first table can no longer monopolize the worker window.
- Preserve fixed search paths and revoke browser-role execution.

## Validation

Validated code head: `093069a8317a21d1b0bd5baaa8020c54b732f7f1`.

- CI, Build Check, Secret Scan, Route Budget, typecheck, lint, architecture,
  safety, schema, Never-500, and public Playwright passed.
- Unit suite: 13,246 tests; 13,237 passed; 0 failed; 9 skipped.
- React-server suite: 18 passed; 0 failed.
- Research golden set: 7 passed; 0 failed; 13 skipped placeholders.
- Exact-head Vercel preview `dpl_DqDA1sKd2eXDEizr4o8sJ1uZhdT3` is READY,
  serves HTTP 200, reports the matching `x-buddy-build` SHA, and has no
  error/fatal runtime logs.
- Complete PR diff inspected: 10 expected files, with no unrelated product,
  dependency, credential, or user-interface changes.

## Production verification and dependencies

- The production defect remains open until PR 921 is merged and the deployed
  nightly job is observed completing with structured empty-portfolio and
  retention-progress evidence.
- Direct database row-count, ACL, and function verification remains blocked
  until the verified Buddy-owned Supabase connection is available.
- Transactional closure of Golden Trident delivery remains blocked on an
  authorized production-safe fixture; authenticated browser verification and
  13 production-backed research cases also remain outstanding.
- Open independent PRs must be merged only by Matt. This PR was not merged.

## Next target

After merge, verify the deployed nightly invocation and database progress.
Independent rotation should next inspect policy-drift and suggestion persistence
for fail-closed database/provider evidence, without overlapping open work.
