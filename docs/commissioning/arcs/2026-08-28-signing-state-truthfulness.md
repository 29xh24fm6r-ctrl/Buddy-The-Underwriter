# SignWell authoritative state truthfulness

Date: 2026-08-28  
Product boundary: Buddy The Underwriter only  
Repository baseline: `b491182a0b3e11c9bd197be8bd9f631094a37c77`

## Evidence

- Signature request provenance, request tracking, webhook idempotency, canonical
  request binding, deal ownership, completion provenance, and race recovery all
  relied on Supabase queries whose returned errors were ignored.
- Banker, borrower-portal, and brokerage signing-status routes translated
  returned database errors into empty collections or HTTP 404 responses.
- Those outcomes could hide an outage, prompt duplicate provider work, or make a
  completed or pending signing ceremony disappear from the user interface.

## Root cause

Supabase returns many database failures as `{ data, error }` without rejecting
the promise. These paths checked only `data`, so an unavailable authoritative
store was indistinguishable from a valid zero-row result. Request insertion also
accepted a mutation without returned-row proof.

## Repair

- Require explicit identity provenance and returned-row confirmation before a
  SignWell request is exposed; cancel the untracked provider document otherwise.
- Stop webhook processing before provider, storage, or event side effects when
  any authoritative state read fails.
- Preserve distinct, retryable `SIGNING_STATE_READ_FAILED` evidence rather than
  misreporting missing records.
- Return HTTP 503 `signing_state_unavailable` from all three signing-status
  surfaces when canonical lists or records cannot be read.
- Keep `deal_events` as secondary timeline evidence; canonical
  `signing_requests` and `signed_documents` remain the durable records.

## Regression coverage

- Behavioral tests prove zero-row request tracking cancels the provider
  document and that an idempotency-read failure causes no provider, storage, or
  event side effects.
- A route contract test covers banker, borrower-portal, and brokerage state
  reads so database errors cannot regress to false empty/not-found responses.

## Production verification

Pending merge and deployment. Closure requires one controlled request and one
completed-webhook replay against a verified Buddy-owned Supabase connection.

## Unresolved evidence

- PR 878's complete Golden Trident seal-to-marketplace-to-lender transaction
  still requires a verified Buddy-owned Supabase connection and authorized
  fixture.
- Authenticated signing browser verification requires an authorized fixture.
- Secondary SignWell timeline events intentionally remain best effort because
  canonical request/document records are the compliance state.

## Next target

Audit identity-verification status surfaces for the same returned-error ambiguity
without crossing into any non-Buddy product infrastructure.
