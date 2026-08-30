# Outbound provider acceptance truthfulness

Date: 2026-08-30
Product: Buddy The Underwriter / www.buddysba.com

## Evidence and root cause

The canonical brokerage communications adapters treated any HTTP-success response
from Resend or Telnyx as a successful delivery even when the provider response
was malformed, unreadable, or missing its message identifier. Both the durable
brokerage outbox and the lender marketplace outbox could then mark the message
as sent without provider acceptance evidence.

The ten-minute marketplace worker also returned a green HTTP response whenever
a failed provider call remained retryable. That made an incomplete lender
delivery batch indistinguishable from a fully delivered batch until attempts
were exhausted.

## Repair

- Require a non-empty provider message identifier from successful Resend and
  Telnyx responses.
- Convert HTTP-success responses without that evidence into retryable,
  deterministic failures.
- Enforce the same acceptance invariant at both durable outbox boundaries so a
  custom or regressed adapter cannot mark email or SMS sent without evidence.
- Preserve Slack behavior because Slack webhooks do not return message
  identifiers.
- Return HTTP 503 from the marketplace schedule whenever delivery is retrying
  or exhausted.
- Keep provider idempotency keys and compare-and-set persistence unchanged.

## Regression coverage

Behavioral coverage proves malformed provider-success responses remain
retryable, neither outbox marks unproven email delivery sent, and the scheduled
marketplace path reports every incomplete delivery batch as non-green.

## Scope and safety

Buddy The Underwriter only. This application-boundary repair changes no schema,
production row, provider configuration, credentials, dependency, storage
object, or external system. No database connection was used.

## Closure

After merge, authorized provider fixtures must prove Resend and Telnyx
acceptance IDs persist through the canonical durable outbox and that a
controlled retryable lender failure yields a non-green scheduled result.
