# Lender email delivery idempotency

Date: 2026-08-29
Product: Buddy The Underwriter / www.buddysba.com

## Production checkpoint

PR 878 remains deployed, and production is serving main
`29281c41c919327a442c5c97fcd3476e5723c69a` through READY deployment
`dpl_6C8FEtgABdzGcTB8mT5HdcoLyqwZ`. The public site returns HTTP 200 with the
exact build SHA and no recent warning, error, fatal, or grouped runtime-error
evidence.

The complete seal-to-marketplace-to-lender ceremony remains open because it
requires a verified Buddy-owned Supabase connection and an authorized sealed
transaction. No unverified database or transaction was accessed for this arc.

## Evidence and root cause

The marketplace worker claims a canonical
`brokerage_lender_message_outbox` row, calls the email provider, and then marks
the row sent. The claim uses a five-minute lease.

If Resend accepted the email but the final `mark_sent` database transition
failed, the row remained pending. After the lease expired, the next ten-minute
worker invocation could send the same lender email again. The existing
compare-and-set prevented concurrent workers from sending together, but it did
not give retries after provider acceptance the same provider request identity.

Resend's send-email API supports an `Idempotency-Key` header, unique per
request and retained for 24 hours:

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/api-reference/errors

The canonical lender outbox row is immutable delivery intent, and its ID is
therefore the stable provider-delivery identity.

The older durable `brokerage_comms_outbox` path exposed the same failure
window. It already persisted a caller-supplied `idempotency_key`, but
`processCommsOutboxItem` dropped that identity before invoking the channel
adapter. Provider acceptance followed by a failed `mark_sent` transition could
therefore resend the email after the sending lease expired.

## Repair

- Extend the lender send boundary with a required idempotency key.
- Derive the key deterministically as
  `buddy-lender-outbox:<canonical-outbox-id>`.
- Forward that key through the marketplace cron and real communications adapter.
- Send it to Resend as `Idempotency-Key`.
- Preserve the existing durable-outbox idempotency key through its adapter
  boundary as well.
- Preserve existing stub, dry-run, dashboard, retry-limit, and lease behavior.

The key remains identical when a provider-success/database-failure retry
reclaims the same outbox row. Resend can therefore return the original accepted
request instead of creating a second email during the provider's idempotency
window.

## Regression coverage

- Reproduce provider success followed by a failed canonical sent transition.
- Expire the lease and retry the same row.
- Prove both provider attempts receive the exact same outbox-derived key and the
  recovered row becomes sent.
- Prove the live Resend request carries the key in the provider header.
- Reproduce the same provider-success/database-failure recovery in the durable
  brokerage outbox and prove the stored key is reused after lease reclamation.

## Scope and safety

Buddy The Underwriter only. This is a reversible application-boundary repair.
It changes no database schema, production data, credentials, provider
configuration, dependencies, infrastructure, or stored objects. It does not
send a production message and does not merge the repair.

## Remaining verification

After Matt merges the repair, closure requires an authorized lender-delivery
fixture that simulates or observes provider acceptance followed by a failed sent
transition, then proves retry convergence without duplicate delivery. Full PR
878 closure still requires the verified Buddy-owned Supabase connection and
authorized sealed transaction.
