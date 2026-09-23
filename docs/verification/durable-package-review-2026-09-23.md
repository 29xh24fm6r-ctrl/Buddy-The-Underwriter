# Durable package review repair

The September 23 live QA run stopped before its third feasibility review:
119,189 settled verifier tokens plus a 40,973-token conservative reservation
exceeded the 150,000-token run cap. The reservation was not billed usage.
Two completed reviews and two repairs existed only in process memory.

## Changes

- Database policy supplies both package admission and atomic reservation limits:
  generator 150,000; underwriter 300,000; verifier 300,000 per run.
- Default verifier daily capacity becomes 1,000,000. QA remains limited to 50%
  of the effective daily budget. Environment overrides remain authoritative;
  an override too small to cover the package allowance causes admission to stop.
  Existing usage and reservation ledgers are preserved.
- Business-plan and feasibility review save each independent review, successful
  repair batch, and the assembled draft awaiting its next review. Matching
  artifact/evidence identity resumes that state, including the review count.
- Checkpoints are service-only, tenant checked, leased, and revision checked.
  A lease lasts ten minutes and renews on each save. Another worker must wait
  for release or expiry. Changed evidence or original prose resets progress.
- Intermediate repairs are private checkpoint data, never a release verdict.
  Only the final independent review can produce a pass. Critical findings,
  advisory disclosures, and the three-repair limit remain in force.
- Final artifact save errors fail the operation. A saved terminal review can
  be reused when publication of its verdict needs retrying.

## Verification

- 52 focused tests: exact review-three interruption/resume, partial batch
  recovery, storage failure, bounded retries, disclosures, existing enrichment,
  gateway scheduling, and real PostgreSQL migration behavior using PGlite.
- 273 package and budget regression tests in the standard runtime.
- Workbook tests pass under the repository's required react-server condition.
- TypeScript and targeted ESLint pass. Schema manifest, migration versions,
  RPC existence, column existence, and tenant RLS guards pass.
- GitHub CI and deployment status are reported with the pull request.

## Rollout and limits

`20260923224841_durable_package_review.sql` was applied to Buddy Supabase before
application deployment. The repository filename matches the recorded database
migration version. Live catalog checks confirmed the intended budget policy,
RLS, service-role execution, and no anonymous/authenticated access.
The advisor reports the expected no-client-policies notice for this service-only
table; all checkpoint access goes through the server.
The migration is additive apart from replacing the existing reservation
function with policy-based enforcement; its signature stays compatible.

The allowance covers the observed failure with additional review/repair room;
it does not guarantee arbitrarily large inputs will fit. A capacity denial
continues to stop the run. Saved checkpoints make a later authorized retry
recover completed work once capacity is available.

A process death after a provider responds but before its checkpoint commits
can still require repeating that uncheckpointed call. This is not an exactly-once
provider execution guarantee. The earlier failed live run predates checkpoints;
its lost in-memory repairs cannot be recovered retroactively.

No new paid model run or lender release is claimed by these regression tests.
