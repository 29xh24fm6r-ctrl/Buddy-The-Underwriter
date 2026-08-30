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

Focused and broad validation, complete-diff inspection, required CI, and exact
preview evidence are pending on the final branch head. Post-merge transactional
closure requires an authorized Plaid sandbox webhook fixture.
