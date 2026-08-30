# Legacy and debug control-plane retirement

Date: 2026-08-30

Scope: Buddy The Underwriter only.

## Evidence

Seven production routes formed isolated legacy or diagnostic control planes:

- Four routes under `/api/ai/*` accepted caller-controlled context or deal state; one reported process-memory mutations and audit events as durably applied.
- `/api/pdfs/[pdfId]` performed no authentication or deal ownership check and read an artifact's server-local `filePath`; an artifact identifier was sufficient for retrieval.
- `/api/admin/deals/[dealId]/checklist/debug` bypassed Clerk with a reusable debug bearer token and returned service-role checklist identifiers, descriptions, statuses, and timestamps.
- `/api/deals/[dealId]/borrower/debug` returned borrower EIN, email, owner identity, filenames, document/OCR coverage, missing-field diagnostics, and Omega state through a normal tenant session.

Repository code search found no product caller for any of the seven endpoints. Production probes matched both debug handlers on the current deployment: checklist debug returned HTTP 401 and borrower debug returned an HTTP-200 diagnostic envelope, proving the dark routes remained deployed.

## Repair

- Remove all seven route handlers from the production route tree.
- Preserve shared development libraries to avoid unrelated churn.
- Add a regression guard that requires every route file to remain absent, forbids product callers for their endpoint paths, and prevents API routes from importing the process-memory action executor, audit store, or PDF store.

## Verification target

- Focused Node regression guard.
- Complete diff inspection.
- Required CI, build, security, route-budget, and public browser checks.
- Exact-head Vercel preview: every retired endpoint must return HTTP 404 through the not-found route while the public Buddy surface remains healthy.
- Production closure after merge: repeat all seven 404 probes against `www.buddysba.com`.

No database, schema, credentials, provider configuration, production data, or other product is changed.
