# Signing admission truthfulness

Date: 2026-08-29

## Scope

Buddy The Underwriter's SignWell request and completion gates only. No other
product, database, schema, credential, provider configuration, or production
row is changed.

## Evidence and root cause

- `hasValidIal2` discarded the Supabase error returned by the authoritative
  identity-verification lookup and converted both an outage and a proven
  missing verification into `false`.
- `hasCompletedLegalReview` did the same for required legal-document review.
- Signature admission therefore returned an ordinary business denial when
  compliance state was actually unavailable.
- SignWell completion reused the collapsed IAL2 boolean and could record an
  `completed_without_ial2` anomaly for a database outage rather than
  preserving a retryable state-read failure.

## Repair

- Add typed authoritative-state readers for IAL2 and required legal review.
- Preserve database errors separately from proven negative business state.
- Fail signature admission with `SIGNING_STATE_UNAVAILABLE` before rendering
  or sending any document to SignWell.
- Return HTTP 503 for unavailable signing state and HTTP 403 only for proven
  missing IAL2 or legal review.
- Preserve `SIGNING_STATE_READ_FAILED` during webhook completion so provider
  delivery can retry without misclassifying the event as a compliance anomaly.
- Retain boolean compatibility helpers for non-transactional display callers.

## Verification

- Focused regression coverage proves read errors precede negative-state
  outcomes, both gates execute before provider handoff, completion preserves
  retryable state, and route status mapping remains explicit.
- Full CI, complete diff inspection, exact-head preview, and runtime-log
  verification are required before merge recommendation.

## Closure dependency

After merge, end-to-end closure requires an authorized SignWell sandbox
ceremony and a verified Buddy-owned Supabase connection. No unverified database
connection may be used.
