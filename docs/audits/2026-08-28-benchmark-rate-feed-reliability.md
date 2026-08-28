# Benchmark Rate Feed Reliability — 2026-08-28

Scope: Buddy The Underwriter and `www.buddysba.com` only.

## Production evidence

- Vercel recorded HTTP 500 for `GET /api/rates/latest` on 2026-08-27.
- The deployed route delegated every SOFR, five-year Treasury, and prime-rate lookup
  to a grounded generative-AI request.
- Any AI gateway budget, provider, grounding, or response-shape failure therefore
  blocked pricing scenarios even though all three benchmarks have deterministic
  government data sources.
- The previous parser accepted non-finite, implausible, stale, or future values and
  did not attach source URLs.

## Root cause

A probabilistic AI/provider path was used as the source of truth for deterministic
market data. The only resilience was a fifteen-minute process-local cache, so a
cold serverless instance had no last-known-good value.

## Repair

- Read SOFR from the New York Fed Markets Data API.
- Read the five-year par yield from the Treasury daily interest-rate XML feed.
- Read bank prime from the Federal Reserve H.15 series distributed by FRED.
- Use the corresponding FRED series as a bounded fallback for SOFR and the
  five-year Treasury when a primary feed is unavailable.
- Reject non-finite or out-of-range rates and observations more than fourteen days
  old or more than one day in the future.
- Preserve a seven-day last-known-good window after a successful refresh and mark
  stale responses explicitly.
- Return retryable HTTP 503 with `Retry-After` when no validated value exists,
  rather than an opaque HTTP 500.
- Remove the AI gateway from benchmark-rate truth.

## Verification

- PR 941 head `bc67b371e35e1f367d5848644c0eb481d0d82ae8` was mergeable and
  zero commits behind `main`.
- CI ran 13,341 tests: 13,332 passed, 0 failed, and 9 skipped.
- React-server tests passed 18/18. Research evaluation passed 7/7; the 13 known
  production-data placeholders remain explicitly skipped.
- Typecheck, lint, architecture, safety, legacy-write, Never-500, schema-select,
  drift, Build Check, Secret Scan, Route Budget, and public Playwright passed.
- Exact-head Vercel deployment `dpl_4HsNe7yJjQwetiyYZdcXAQQGgt43` is READY.
  The root returned HTTP 200 with matching `x-buddy-build`.
- A live exact-head call to `/api/rates/latest` returned HTTP 200 with SOFR
  3.64% (NY Fed, 2026-08-26), five-year Treasury 4.38% (Treasury,
  2026-08-27), and prime 6.75% (H.15/FRED, 2026-08-26), each with its source URL.
- No error, fatal, or warning runtime logs were recorded after the live probe.
- Post-merge closure still requires the same production call and absence of new
  rate-feed HTTP 500 events.

## Remaining boundaries

- The complete Golden Trident seal-to-marketplace-to-lender transaction still
  requires an authorized production-safe fixture.
- Direct database verification remains blocked until a confirmed Buddy-owned
  Supabase connection is available. No other product's database was queried.
