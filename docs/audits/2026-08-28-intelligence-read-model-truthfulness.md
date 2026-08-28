# Intelligence read-model truthfulness commissioning

Date: 2026-08-28
Scope: Buddy The Underwriter only

## Production evidence

Vercel's 24-hour production aggregation reported a 5xx response from the
authenticated auto-intelligence endpoint. The current production deployment is
READY and has no new error, fatal, or warning entries in its most recent
four-hour window, so this repair addresses the persistent failure contract
rather than attributing an unproven current outage.

## Root cause

The two cockpit read models discarded Supabase errors:

- `GET /api/deals/[dealId]/intelligence/auto` treated a failed run query as
  "no run" and a failed step query as an empty step list.
- `GET /api/deals/[dealId]/insights` synthesized a normal response even when
  any of seven source queries failed.

That can make database unavailability appear to users as an empty, incomplete,
or healthy underwriting state. It also prevents the existing polling client
from recognizing a retryable server failure.

## Repair

- Inspect every run, step, snapshot, risk, match, lifecycle, and blocker query.
- Return sanitized HTTP 503 responses with stable error codes when any required
  source fails.
- Mark failures retryable, disable caching, and publish a bounded
  `Retry-After: 10` contract.
- Log source, code, and message server-side without returning database details
  to the browser.
- Preserve the existing authenticated tenant boundary and successful response
  shapes.
- Add static regression guards covering every required source.

## Verification plan

- Auto-intelligence pipeline guard.
- Full Node test suite, typecheck, lint, architecture, schema, security,
  Never-500, and route-budget checks.
- Next.js build and public Playwright.
- Exact-head Vercel preview with SHA verification and runtime-log review.
- After merge, reverify authenticated empty, active, completed, and controlled
  query-failure states in production.

## Dependencies and unresolved evidence

This arc does not require or mutate schema. Direct database fault injection is
blocked until a verified Buddy-owned Supabase connection and controlled
authenticated fixture are available. The available non-Buddy connection was
not accessed.

The next independent evidence target is the authenticated memo-input package:
production recorded a 500 response without a route-level diagnostic. Recheck
after the pending AI/document PRs merge, then isolate its exact failing source
before changing code.

PR 878's complete seal-to-marketplace-to-lender ceremony still requires an
authorized Golden Trident transaction and verified Buddy-owned database
evidence.
