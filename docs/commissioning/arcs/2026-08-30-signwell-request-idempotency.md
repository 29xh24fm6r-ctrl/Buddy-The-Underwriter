# SignWell request idempotency — 2026-08-30

## Scope

Buddy The Underwriter's SignWell request boundary, durable `signing_requests` state, and terminal retry behavior.

## Evidence and root cause

- `requestSignature` rendered a filled PDF and created a live SignWell document before inserting its durable `signing_requests` row.
- A retry or concurrent request during that interval could create another provider document for the same deal, form, signer, template version, and recipient.
- The provider external ID was deterministic, but Buddy did not enforce it as a database-owned concurrency invariant.
- Existing `signwell_document_id` uniqueness cannot serialize requests because the provider ID does not exist until after the unsafe side effect.

## Repair

- Add a nullable deterministic `idempotency_key` and partial unique index. Historical rows remain untouched and excluded.
- Resolve IAL2, legal-review, and identity-provenance evidence before reserving or contacting SignWell.
- Insert and prove a `Creating` reservation before PDF rendering or provider submission.
- Reuse equivalent active requests, including exact legacy rows created before the migration.
- Promote the reservation to the returned provider ID and signing URL with compare-and-set predicates and returned-row proof.
- Cancel untracked provider documents on incomplete final persistence. Failed terminal attempts release the key only when it is safe to retry; failed provider cleanup holds the key closed.
- Return deterministic non-green outcomes for unavailable, in-progress, or unproven state.

## Regression coverage

- Normal reservation-to-provider-to-durable transition.
- Active legacy request reuse without rendering or provider work.
- Concurrent equivalent calls create one provider document.
- Reservation failure stops before all external side effects.
- Missing provider URL and failed final tracking proof are reconciled safely.
- Failed terminal webhooks release the retry lock only after durable state transition.

## Verification ledger

- Focused and broad validation: pending CI on the exact branch head.
- Production verification requires merge, migration deployment, and an authorized SignWell sandbox fixture.
- No production database was accessed because the Buddy-owned Supabase connection remains unverified.

## Independent unresolved paths

- PR 878's complete Golden Trident seal-to-marketplace-to-lender transaction still requires the verified Buddy-owned Supabase connection and an authorized sealed fixture.
- The unresolved Twilio inbound-message path still requires a product-owned persistence sink and an approved PII retention/redaction policy.
