# Brokerage Comms QA Harness

## Purpose

Deterministic end-to-end QA for the brokerage communications pipeline.
Proves the full chain works: missing docs → nudge eligibility → outbox → adapter → ledger → retry → metrics.

## Running

```bash
pnpm brokerage:comms:qa
```

Default mode: `stub` (no real sends). Blocked if `BROKERAGE_COMMS_MODE=live` unless `ALLOW_LIVE_COMMS_QA=true`.

## Scenarios

| Scenario | What it proves |
|----------|---------------|
| `missing_docs_email_only` | Email nudge enqueued, no SMS when opt-in absent |
| `missing_docs_sms_opted_in` | Both email + SMS enqueued when opt-in present |
| `missing_docs_sms_no_opt_in` | SMS suppressed without explicit opt-in |
| `provider_retry_then_success` | Retryable failure → retry_scheduled → success on retry |
| `provider_retry_exhausted` | 3 retryable failures → exhausted status |
| `banker_alert_ready_for_review` | Banker alert enqueued via outbox |
| `closed_deal_skipped` | Funded/closed deals produce skip ledger event, no outbox |

## Invariants checked

- Ledger recipients are masked (email: `m***d@x.com`, phone: `********1234`)
- No API keys, Bearer tokens, or webhook URLs in ledger metadata
- Outbox items exist only when corresponding ledger events exist
- Cleanup removes all QA-prefixed records

## Live mode safety

By default, the harness **refuses to run** when `BROKERAGE_COMMS_MODE=live`.
To override (e.g., staging environment with real providers):

```bash
ALLOW_LIVE_COMMS_QA=true pnpm brokerage:comms:qa
```

This will send real emails/SMS — use only in controlled environments.
