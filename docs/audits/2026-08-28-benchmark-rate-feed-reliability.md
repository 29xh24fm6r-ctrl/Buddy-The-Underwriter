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

## Evidence plan

- Focused tests cover each primary feed, provider fallback, range validation,
  freshness validation, and bounded stale service.
- Required CI, build, security/schema guards, and public browser smoke must pass
  on the exact PR head.
- The exact preview must be READY, SHA-matched, HTTP 200, and runtime-clean.
- After merge, reverify `/api/rates/latest` in production and confirm pricing
  scenarios no longer depend on an AI-provider call.

## Remaining boundaries

- The complete Golden Trident seal-to-marketplace-to-lender transaction still
  requires an authorized production-safe fixture.
- Direct database verification remains blocked until a confirmed Buddy-owned
  Supabase connection is available. No other product's database was queried.
