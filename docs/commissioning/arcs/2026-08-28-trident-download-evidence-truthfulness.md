# Golden Trident download evidence truthfulness

Date: 2026-08-28

Scope: Buddy The Underwriter only (`29xh24fm6r-ctrl/Buddy-The-Underwriter` and `www.buddysba.com`).

## Evidence

- PR 878 is merged and its Golden Trident code is deployed.
- Production deployment `dpl_EQob5PMxWaA85DupqtdKcuaYEi49` serves exact commit `fe428208311739a0147294d10c1e2d3d4d1ceb2b` at HTTP 200.
- An exact-deployment runtime scan covering 2026-08-28 17:04–21:04 UTC found no warning, error, or fatal entries.
- Direct source inspection found that the authenticated brokerage dispatcher, borrower portal dispatcher, lender package-access route, package-manifest builder, and assembled-SBA-package lookup ignored authoritative Supabase read errors. Database outages could therefore be reported as ordinary 404 package absence.
- All Golden Trident download routes generated or rendered an artifact before attempting audit persistence, but the audit helper discarded insert failures and callers still returned the deliverable.

## Root cause

The delivery boundary treated audit writes as best-effort telemetry and destructured only database data from several access, ownership, bundle, sealed-package, and assembled-package reads. This made state unavailability indistinguishable from legitimate absence and allowed a signed URL or rendered credit memo to be delivered without canonical marketplace evidence.

## Repair

- Make package view/download audit helpers return explicit success or failure, including thrown database failures.
- Withhold signed URLs and rendered committee artifacts unless the required download audit persists.
- Return HTTP 503 for authoritative-state and audit-persistence failures while preserving non-enumerating 404 responses for genuine authorization denial or package absence.
- Check lender access, deal ownership, preview/final bundle, sealed-package, supporting-form, listing, and assembled-package reads.
- Preserve preview-tier confinement and the existing five-minute signed-URL TTL.
- Map lender package-state unavailability to an explicit 503 rather than a false 404.

## Regression coverage

The authenticated brokerage and borrower-portal authorization suites now prove that:

- database read failures return 503 instead of 404;
- audit persistence failure prevents a signed URL from being returned;
- ordinary missing or unauthorized resources remain 404;
- successful preview and final downloads retain their existing access rules.

Broad CI and exact-head preview evidence are recorded on the focused pull request.

## Production closure and blockers

Code and public runtime are verifiable without customer mutation. Full transactional closure still requires:

1. Matt's merge and the resulting production deployment.
2. A verified Buddy-owned Supabase connection.
3. An authorized sealed Buddy transaction that exercises borrower and lender downloads and proves the corresponding `marketplace_audit_log` rows.

No unverified database project was queried or modified.

## Open PR dependency

This repair is independent of PRs 964–967. It must not be merged by the commissioning agent.

## Next independent commissioning target

Continue the access-evidence rotation across remaining package-view and storage delivery surfaces, checking that authenticated manifest disclosure, signed URL issuance, and view-audit persistence fail closed without overlapping this branch.
