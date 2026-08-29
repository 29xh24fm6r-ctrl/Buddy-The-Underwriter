# SBA scheduled evidence truthfulness

Date: 2026-08-29  
Scope: Buddy The Underwriter only

## Audit evidence

The `/api/cron/sba-checks` worker was audited from the route through its
Supabase-backed IRS transcript, E-Tran certificate, and official-template
checkers. Production remained HTTP 200 with no new warning, error, fatal, or
grouped runtime-error evidence during the six-hour observation window.

## Finding

Several scheduled checks could convert an unavailable authoritative database
operation into a healthy result:

- IRS polling ignored the pending-request read and every lifecycle write.
- IRS reconciliation ignored request/fact reads and gap, status, and event
  writes; the route always returned `ok: true`.
- E-Tran certificate discovery discarded query errors and returned an empty
  finding set.
- Template discovery ignored authoritative row-read failures, and template
  evidence writes incremented the success count even when Supabase rejected
  the update.

This could leave borrower and banker work incomplete while scheduled monitoring
remained green.

## Repair

- Propagate deterministic operation-scoped failures from every audited IRS
  transcript database boundary.
- Count incomplete IRS reconciliation and derive the HTTP result from the
  shared cron outcome helper.
- Fail E-Tran discovery when certificate evidence cannot be loaded.
- Fail template discovery and persistence when authoritative Supabase
  operations fail.
- Add a regression guard spanning the complete route-to-database boundary.

No schema, production data, credentials, external-provider configuration, or
destructive operation is included.

## Verification plan

- Run the full Node test suite, React-server tests, research tests, typecheck,
  lint, architecture and safety guards, schema guards, Never-500, and public
  Playwright.
- Inspect the complete diff.
- Require all GitHub checks to pass.
- Verify an exact-head Vercel preview is READY, HTTP 200, SHA-matched, and
  runtime-clean.

## Production closure

After merge, invoke each SBA check with an authorized fixture and controlled
Supabase failures. Close only after IRS, E-Tran, and template failure paths
produce non-green outcomes while proven empty/success paths remain green.

PR 878's full Golden Trident seal-to-marketplace-to-lender ceremony remains
blocked on a verified Buddy-owned Supabase connection and an authorized sealed
fixture. PR 979 remains the merge checkpoint for the missing
`portfolio_risk_snapshots` production failure.
