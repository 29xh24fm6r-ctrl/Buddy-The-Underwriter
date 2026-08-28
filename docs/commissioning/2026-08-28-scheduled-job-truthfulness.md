# Scheduled-job truthfulness commissioning

Date: 2026-08-28 UTC  
Scope: Buddy The Underwriter and www.buddysba.com only

## Production evidence

The production nightly invocation returned HTTP 200 while its logs recorded a telemetry-retention statement timeout and five per-bank portfolio failures. The route source confirmed that this was not only a logging presentation issue: retention, franchise-janitor, bank discovery, and per-bank failures could all be present while the final response remained `{ "ok": true }`.

Source review found the same outcome-reporting defect in two additional scheduled paths:

- borrower reminders recorded per-recipient failures but returned HTTP 200 with `ok: true`;
- KYC reconciliation and template-staleness checks reported partial failures in their payloads but still returned HTTP 200 with `ok: true`.

The borrower-reminder route also used a direct secret comparison instead of the repository's constant-time, header-only worker-authentication boundary.

## Root cause

The scheduled routes treated successful handler completion as successful business completion. Batch-level failure evidence was collected but never converted into the HTTP status consumed by Vercel Cron and external monitors. Nightly bank discovery also discarded the Supabase query error, making a failed query indistinguishable from an empty portfolio.

## Repair

- Added a shared `getCronOutcome` contract that returns HTTP 500 for any real batch failure while preserving detailed partial-work results.
- Applied it to borrower reminders, KYC reconciliation, template-staleness checks, and nightly governance.
- Made nightly bank discovery fail closed when Supabase returns an error.
- Moved borrower reminders to `hasValidWorkerSecret`, preserving the shared constant-time header-only boundary.
- Kept expected lifecycle states green: opted-out recipients, cooldown/max-attempt skips, empty portfolios, and banks without final decisions remain normal non-failures.

## Regression evidence

- Unit coverage verifies green, partial-failure, and invalid-count outcomes.
- Static route guards require the shared authentication and outcome contracts and prevent the old direct secret comparison from returning.
- Focused and repository-wide CI, exact-head preview, unauthorized probes, and runtime-log verification remain required before merge recommendation.

## Production closure

After merge, closure requires observing the next scheduled invocations and confirming that successful runs remain HTTP 200 while an authorized controlled failure returns HTTP 500 and preserves its detailed result payload. No production mutation was performed during this audit.

## Outstanding dependencies

- Direct database verification requires a confirmed Buddy-owned Supabase connection.
- Golden Trident seal-to-marketplace-to-lender delivery still requires an authorized transactional fixture.
- Authenticated document processing and signing replay require controlled product fixtures.
