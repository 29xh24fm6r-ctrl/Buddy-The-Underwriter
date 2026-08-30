# Plaid webhook replay protection

Date: 2026-08-30
Product: Buddy The Underwriter / www.buddysba.com

## Evidence and root cause

The product verified Plaid's ES256 webhook JWT and raw-body SHA-256 claim, but
did not inspect the signed `iat` claim. Plaid's authoritative webhook
verification contract requires rejecting callbacks more than five minutes old
to prevent replay attacks. A captured authentic callback could therefore be
replayed indefinitely and retrigger transaction synchronization or Item
lifecycle writes.

The verifier also compared body-hash strings with ordinary equality and returned
provider/SDK exception details through the public webhook response.

## Repair

- Require a safe integer `iat` in every verified Plaid JWT.
- Reject callbacks older than five minutes and materially future-dated tokens.
- Reject unexpected JWT algorithms before requesting a provider key.
- Validate the claimed SHA-256 shape and compare hash bytes in constant time.
- Return deterministic, non-sensitive verification failure reasons.
- Add real ES256 signed-JWT regression tests for freshness, expiry, future time,
  missing claims, body tampering, malformed hashes, algorithms, and signature
  failure.

## Scope and safety

Buddy The Underwriter only. No schema, credentials, provider configuration,
dependency, production data, or destructive operation is involved. Existing
verified transaction synchronization, Item lifecycle handling, key caching, and
retryable failure behavior remain unchanged.

## Verification

Validation on code head `576730aa3d0ee66e5228e66dbdd383ba06c1d9d8`:

- 13,628 tests: 13,619 passed, 0 failed, and 9 skipped.
- React-server-condition tests passed 18/18. Research evaluation passed 7/7
  with 13 controlled production placeholders explicitly skipped.
- Typecheck, lint, architecture, safety, schema-select, report-only drift,
  Never-500, Build Check, Secret Scan, Route Budget, and public Playwright
  passed.
- Exact-head Vercel preview `dpl_89aPWyHdiFzLZbvkkcf5EmJJMH1F` is READY,
  SHA-matched, HTTP 200, and recorded no warning/error/fatal logs.
- The complete four-file diff was inspected: +343/-14 with no schema,
  dependency, credential, provider configuration, production data, destructive,
  or cross-product change.

This evidence-only commit changes no runtime behavior. Its final head must retain
green required checks and a READY, SHA-matched preview. Post-merge transactional
closure requires an authorized Plaid sandbox webhook fixture.
