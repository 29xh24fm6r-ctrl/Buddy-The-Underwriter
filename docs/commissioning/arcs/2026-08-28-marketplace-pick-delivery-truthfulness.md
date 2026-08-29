# Marketplace pick and lender-delivery truthfulness

Date: 2026-08-28

Scope: Buddy The Underwriter only (`29xh24fm6r-ctrl/Buddy-The-Underwriter` and `www.buddysba.com`).

## Evidence

- PR 878 is merged and its Golden Trident code is deployed.
- Production deployment `dpl_EQob5PMxWaA85DupqtdKcuaYEi49` serves exact commit `fe428208311739a0147294d10c1e2d3d4d1ceb2b` at HTTP 200.
- An exact-deployment runtime scan covering 2026-08-28 17:04–21:04 UTC found no warning, error, or fatal entries.
- Direct source inspection of `src/app/api/brokerage/deals/[dealId]/marketplace/pick/route.ts` found that the route returned `ok: true` without checking the listing update, losing-claim withdrawal, or package-access insert. It could return `accessId: null`; sealed-artifact binding and lender notifications were explicitly non-fatal.
- The same route inserted the irreversible pick before proving that the sealed package contained the frozen business-plan, projections, and feasibility paths required for lender delivery.

## Root cause

The marketplace pick handler treated the borrower selection as a sequence of independent best-effort writes. It had no retry reconciliation after a partially completed request and used the pick row alone as the success boundary, even though the product contract requires a picked listing, withdrawn losing claims, immutable sealed artifacts, a full lender grant, audit evidence, and lender notification.

## Repair

- Allow an interrupted request to resume from a `picked` listing and reuse the same pick and access rows.
- Reject a retry that tries to replace the already-selected claim.
- Prove immutable sealed-artifact bindings before inserting the irreversible pick; legacy backfill is allowed only from that package's sealed snapshot.
- Require returned-row proof for the pick, listing transition, losing-claim withdrawal, full package-access grant, and canonical borrower-pick audit event.
- Require both lender-selection and package-access messages to reach the durable outbox before returning success.
- Return only a non-null, proven `pickId` and `accessId`.

## Regression coverage

`marketplace-pick-truthfulness.test.ts` enforces retryability, artifact-before-pick ordering, returned-row proof, non-null access evidence, required lender notifications, and removal of swallowed persistence failures.

## Production closure and blockers

Code and public runtime are verifiable without customer mutation. Full transactional closure still requires:

1. Matt's merge and the resulting production deployment.
2. A verified Buddy-owned Supabase connection.
3. An authorized sealed Buddy fixture with an active lender claim, so the same transaction can prove pick → listing → claims → access → audit → outbox → lender download.

No unverified database project was queried or modified.

## Next independent commissioning target

Audit the authenticated Trident download dispatchers for fail-open database reads and required download-audit persistence. Current source reads lender access, deal ownership, and bundle rows without checking query errors, which can collapse infrastructure failures into misleading 404 responses; any repair must remain independent of open PRs 964–966 and this marketplace-pick branch.
