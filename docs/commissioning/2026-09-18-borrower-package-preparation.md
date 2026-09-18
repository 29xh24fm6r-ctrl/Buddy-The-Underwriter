# Borrower package preparation

The borrower could complete the guided questions, upload financial documents and
confirm assumptions, yet final package preparation remained disabled. The gate
required validation and research that only staff routes could start. The repair
adds a durable coordinator in front of the existing final Trident factory.

## Behavior

1. `package-status` distinguishes complete borrower inputs (`readyToPrepare`) from
   final factory admission (`readyToGenerate`). GET remains read-only.
2. The existing cookie-authorized, rate-limited `build-package` POST claims one
   preparation per deal. Repeated requests return that preparation's identity.
3. The workflow synchronizes the saved budget with canonical proceeds, runs the
   existing deterministic validator, and starts/reuses the existing committee
   research workflow. Research uses the saved business answers as context;
   borrower statements do not become banker certification.
4. The coordinator waits with durable timers, rechecks current inputs and research
   identity, then starts the existing final Trident workflow. Validation and
   research finish before Trident freezes its immutable input snapshot.
5. The borrower screen displays progress across both workflows, resumes polling
   after reload and permits retry after failure/expiry. The HTTP journey harness
   follows the preparation ID into its exact final bundle before inspecting files.

There is no replacement financial engine or memo pipeline. Missing financial
evidence, failed validation, insufficient research trust, changed assumptions and
final release checks still block publication. Existing test-deal research policy,
borrower-only downloads, identity checks and signature requirements are unchanged.

## Data and retry boundaries

- `borrower_package_preparations` is service-role-only with RLS enabled. Its
  admission RPC verifies deal/bank ownership and permits one active run per deal.
  A 45-minute expiry fences abandoned workers; research waits at most 30 minutes.
- A final bundle with a live lease is reused without modifying its frozen inputs.
- Budget synchronization copies borrower-saved positive lines into
  `deal_proceeds_items`. Repeated synchronization is idempotent. Staff-created or
  subsequently edited schedules are preserved; conflicting schedules require
  reconciliation instead of silent replacement.
- Failed durable starts release their admission. Failed tracking writes after a
  successful start preserve ownership. Final admission remains independently
  atomic and retry-safe.
- Research identity hashing now includes nested subject content. The old JSON
  replacer discarded that content, so changed business details could reuse stale
  research. Current equivalent requests remain idempotent.
- Validation caching reuses only the latest matching report. Returning to an
  earlier valid fact snapshot can no longer leave a newer unrelated FAIL active.

## Verification and rollout

Regression coverage executes the real borrower package action, readiness gate,
validator and coordinator with in-memory storage and stubbed external research /
artifact services. It covers the previously blocked path, duplicate clicks,
durable start/tracking failures, genuine validation failures, research failures
and timeout, changed inputs, changed research identity and QA policy. Separate
PGlite tests execute the actual migration twice and exercise concurrency,
expiry, tenant permissions, active final bundles and budget preservation.

The browser fixture covers prepare-button availability when system outputs are
missing, visible research progress, reload and retry on desktop/mobile. The HTTP
journey harness rejects failed, unfinished or mismatched preparation identities.

Merge must be followed by a successful **Borrower Package Preparation Schema**
workflow and Vercel deployment. That workflow applies only the reviewed,
repeat-safe migration using the repository's existing Production database
connections and verifies the access boundaries. It also supports a manual rerun
on main. A deployment with an unapplied migration fails closed when loading
preparation status; do not call it commissioned until schema verification passes.

Internal tests do not certify production credentials, extraction providers,
research providers or the contents of a newly generated production package.
After deployment, run the existing authorized QA borrower journey against a
completed test application and inspect all six artifacts and the downloaded ZIP.
No test should sign legal forms or deliver a synthetic application to a lender.
