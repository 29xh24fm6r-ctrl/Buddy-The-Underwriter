# Buddy borrower-reminder truthfulness commissioning — 2026-08-29

## Scope and production evidence

This arc covers only the scheduled Buddy The Underwriter borrower reminder at
`/api/cron/borrower-reminders`, which is the route configured in
`vercel.json`. The separate campaign-reminder admin processor is not scheduled
and was not combined with this path.

Production remained READY on `9fe4b2471558fbd0e749c0ed6718ae12ea542482`
while this repair was prepared. No new grouped runtime errors or
warning/error/fatal logs appeared in the preceding six-hour observation
window. PR 878's Golden Trident implementation remains deployed; its complete
seal-to-marketplace-to-lender transactional ceremony still requires a verified
Buddy-owned Supabase connection and an authorized sealed fixture.

## Findings and root causes

1. A failed `deal_checklist_items` read was logged and then skipped. The cron
   could return green while silently omitting a borrower who might still need
   documents.
2. `sendSmsWithConsent` dispatched through Twilio, ignored both canonical
   persistence failures, and returned success without returned-row proof.
3. Cooldown/max-attempt accounting read only `deal_events`, even though the
   product also uses `outbound_messages` as its delivery ledger. A partial
   post-dispatch write failure could therefore make a real send disappear and
   permit another reminder.
4. Stub/dry-run suppression was counted as a sent reminder.
5. Cron results included full borrower phone numbers and returned raw
   processing errors.

## Repair

- Candidate selection now fails closed on unavailable portal-link, phone,
  joined-deal, or checklist evidence.
- Live SMS success requires exact returned-row proof from
  `outbound_messages` and, when deal-scoped, `deal_events`.
- Both canonical writes are attempted after provider dispatch. Any failed proof
  raises an explicit dispatched-but-audit-uncertain outcome.
- Reminder statistics reconcile the two ledgers by Twilio SID, scoped to the
  exact deal and borrower phone, so either successful canonical write preserves
  cooldown/max-attempt evidence.
- Suppressed communication is reported as skipped, not sent.
- Authorized cron responses expose only the last four phone digits and
  deterministic error categories; detailed diagnostics remain server-side.

No schema, production data, provider configuration, or deployment setting is
changed.

## Regression coverage

- ledger reconciliation deduplication, partial-ledger recovery, empty state,
  and malformed-evidence fail-closed behavior;
- candidate-selection fail-closed source contract;
- exact returned-row persistence proof for both SMS ledgers;
- explicit suppressed and uncertain cron outcomes;
- full-phone and raw-error response leak guards.

## Remaining verification and risk

Before merge: focused tests, full unit/evaluation suites, typecheck, lint,
architecture, safety, schema, Never-500, build, public Playwright, complete diff
inspection, and exact-head preview/runtime verification.

After merge: an authorized Buddy-owned reminder fixture is required to prove a
live provider dispatch, both canonical rows, callback evolution, cooldown, and
no duplicate delivery. A database-wide outage after Twilio accepts a message
can still leave no canonical row; the cron now reports that uncertainty, but
provider-to-database atomicity requires a durable pre-dispatch outbox and is a
separate schema-backed factory decision.
