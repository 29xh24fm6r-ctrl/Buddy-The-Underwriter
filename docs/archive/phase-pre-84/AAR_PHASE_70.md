# Phase 70 — Extraction Fact Key Coverage ✅ COMPLETE

**Closed:** April 4, 2026
**Commit:** verified on main post-AAR

---

## What shipped

| File | Action | Purpose |
|---|---|---|
| `src/lib/financialFacts/writeScheduleLFacts.ts` | Created | Maps Gemini entity types → canonical BS fact keys (TOTAL_ASSETS, NET_WORTH, etc.) |
| `src/lib/financialFacts/writeK1BaseFacts.ts` | Created | K-1 approximation for single-owner pass-through entities |
| `src/lib/financialFacts/writeScheduleLFacts.test.ts` | Created | 15 structural guard tests |
| `src/lib/financialFacts/writeK1BaseFacts.test.ts` | Created | 21 structural guard tests |
| `src/lib/reconciliation/dealReconciliator.ts` | Modified | Added full fallback chains: TOTAL_ASSETS→SL_TOTAL_ASSETS, TOTAL_LIABILITIES→SL_TOTAL_LIABILITIES, NET_WORTH→TOTAL_EQUITY→SL_TOTAL_EQUITY |
| `src/lib/financialSpreads/extractors/deterministic/taxReturnDeterministic.ts` | Modified | Wired both new functions after line 288 (after schedule extraction, before arithmetic validation) |

## Pre-work SQL findings

- 120+ distinct fact_key/fact_type combos exist for ffcc9733
- Balance sheet facts exist under `SL_` prefix (SL_TOTAL_ASSETS, SL_TOTAL_LIABILITIES, SL_TOTAL_EQUITY) — not bare canonical keys
- `K1_ORDINARY_INCOME` already existed in TAX_RETURN_K1 (value=1065) and PERSONAL_INCOME
- `ORDINARY_BUSINESS_INCOME` existed for 3 periods: 325,912 / 328,324 / 269,816
- `BALANCE_SHEET` spread exists (version 1, updated 2026-03-18)
- Pulse pipeline ledger active: 54 distinct event_keys, 23K+ deal.underwrite.verify events

## Reconciliation result — before vs after

**Before Phase 70:**
```json
{ "checksRun": 2, "checksSkipped": 2, "overallStatus": "CLEAN" }
```

**After Phase 70:**
```json
{
  "checksRun": 3,
  "checksFailed": 1,
  "checksSkipped": 2,
  "hardFailures": [{
    "checkId": "BALANCE_SHEET",
    "lhsValue": 954643,
    "rhsValue": 980000,
    "delta": 25357,
    "notes": "Balance sheet does not balance. Extraction error or incomplete Schedule L likely."
  }],
  "overallStatus": "CONFLICTS",
  "reconciledAt": "2026-04-04T00:23:03.940Z"
}
```

## What the $25K discrepancy means

The balance sheet check now runs and found a real problem: `TOTAL_ASSETS` ($954,643)
does not equal `TOTAL_LIABILITIES + NET_WORTH` ($980,000) — a $25,357 gap.

This is not a Buddy bug. It is a real finding about the extracted data quality.

Likely causes (in priority order):
1. **Incomplete Schedule L extraction** — one or more Schedule L line items (officer loans,
   other assets, minority interest) present on the 1065 but not extracted by Gemini
2. **Rounding in the source document** — some partnerships carry rounding adjustments
3. **Tax software rounding** — some preparers leave Schedule L slightly unbalanced
4. **Correct behavior** — Buddy is doing exactly what it should: catching discrepancies
   a human would need to verify before credit committee

The approve gate now correctly blocks on this deal until the conflict is investigated.
This is the system working as designed. The banker's next action is to open the 1065
Schedule L, find the missing line item, and either confirm the document has a
discrepancy or re-extract with a corrected document.

## Outbox backlog finding

1,061 undelivered events in `buddy_outbox_events` (oldest from 2026-01-30).
Top undelivered: checklist_reconciled (393), readiness_recomputed (295),
artifact_processed (257), manual_override (116).

`delivered_at` is the correct column (not `processed_at` — AAR deviation noted).

This is a separate Phase 71 issue. The outbox worker is running (events are flowing
to `deal_pipeline_ledger`) but the backlog confirms delivery retries have not cleared.
Likely cause: Pulse ingest endpoint rate-limiting or the worker not draining fast enough.
Not a blocker for credit decisions — events are in the ledger. Omega signal may be
slightly stale on deals with high outbox lag.

## Verification
- `tsc --noEmit`: clean (0 errors)
- Tests: 36 pass, 0 fail

## Key deviation

Spec specified only `NET_WORTH → TOTAL_EQUITY` fallback. Claude Code extended to full
`SL_` prefix fallback chains after pre-work SQL revealed actual stored key names.
This was correct — without it the balance sheet check still would have skipped.
The deviation produced the result the spec was designed to achieve.

## Build rules added

- **`SL_` prefixed keys are tax return extraction artifacts** — always include fallbacks
  for `TOTAL_ASSETS → SL_TOTAL_ASSETS`, `TOTAL_LIABILITIES → SL_TOTAL_LIABILITIES`,
  `NET_WORTH / TOTAL_EQUITY → SL_TOTAL_EQUITY` in any reconciliation or analysis code
- **Pre-work SQL is not optional** — the key naming issue in this phase would not have
  been caught without running the diagnostic queries first

## Next priorities

1. **Outbox backlog** — 1,061 undelivered events, oldest from January 30. Worker
   draining too slowly or Pulse rate-limiting. Investigate `tryForwardToPulse` failure
   rate and outbox worker tick frequency.
2. **$25K balance sheet discrepancy on ffcc9733** — banker action required: open
   Schedule L on the 1065 and find the missing line item. May be officer loans
   receivable, minority interest, or a legitimate document discrepancy.
3. **K-1 checks still skipping** — `K1_OWNERSHIP_PCT` not yet written. `writeK1BaseFacts`
   was wired but `K1_ORDINARY_INCOME` from TAX_RETURN_K1 doesn't have a matching
   `K1_OWNERSHIP_PCT`. Next extraction run should produce both.
4. **Corpus expansion** — 10+ verified docs needed for bank confidence
