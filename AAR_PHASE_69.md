# Phase 69 — Reconciliation Wiring ✅ COMPLETE

**Closed:** April 3, 2026
**Commit:** verified on main post-AAR

---

## What shipped

| File | Change |
|---|---|
| `src/app/api/deals/[dealId]/reconcile/route.ts` | New — POST triggers `reconcileDeal()`, GET returns current result without re-running |
| `src/app/api/deals/[dealId]/underwrite/state/route.ts` | Added fire-and-forget auto-trigger (idempotent, only if no result exists) |
| `src/app/api/deals/[dealId]/actions/route.ts` | Gated `case "approve"` — 422 `RECONCILIATION_NOT_RUN` if no row, 422 `RECONCILIATION_CONFLICTS` if status=CONFLICTS, allow if FLAGS or CLEAN |
| `src/app/(app)/deals/[dealId]/committee/CommitteeView.tsx` | Added recon state fetch, ReconStatusCard with "Run now" button, hard failures block |
| `src/app/(app)/deals/[dealId]/committee/CommitteeDecisionPanel.tsx` | Structured error parsing for RECONCILIATION_NOT_RUN / RECONCILIATION_CONFLICTS codes |

## Files NOT modified
`src/lib/reconciliation/dealReconciliator.ts` and all check files,
`src/buddy/lifecycle/deriveLifecycleState.ts`,
`src/core/state/BuddyCanonicalStateAdapter.ts`,
`src/app/(app)/deals/[dealId]/committee/page.tsx`

## Smoke test result — ffcc9733

```json
{
  "dealId": "ffcc9733-f866-47fc-83f9-7c08403cea71",
  "checksRun": 2,
  "checksPassed": 0,
  "checksFailed": 0,
  "checksSkipped": 2,
  "hardFailures": [],
  "softFlags": [],
  "overallStatus": "CLEAN",
  "reconciledAt": "2026-04-03T23:45:36.802Z"
}
```

Row confirmed persisted to `deal_reconciliation_results`.

## Smoke test interpretation

`checksSkipped: 2` is correct behavior, not a failure.

The reconciliator skips checks when prerequisite facts are absent from
`deal_financial_facts`. For Samaritus (LLC, pass-through entity):
- K1_TO_ENTITY skipped → `K1_ORDINARY_INCOME` / `K1_OWNERSHIP_PCT` not
  extracted (K-1 schedule facts not yet in the fact store)
- BALANCE_SHEET skipped → `TOTAL_ASSETS` / `TOTAL_LIABILITIES` / `TOTAL_EQUITY`
  not extracted for this deal

`overallStatus: CLEAN` is the correct result when no hard failures and no
soft flags exist. The approve gate will allow approve on ffcc9733.

The reconciliation corpus will improve as more fact keys are extracted.
K-1 and balance sheet extraction are known Moody's MMAS gaps in the roadmap.

## Deviation note

`CommitteeDecisionPanel.tsx` was listed in the spec header "do not touch" list
but Step 5 of the spec explicitly instructed modifications to it. Step-level
instructions take precedence. The header list was a copy-paste artifact from
Phase 68. Not a real deviation — spec intent was clear.

## Verification
- `tsc --noEmit`: clean (0 errors)
- Tests: 24 pass, 0 fail
- Approve gate confirmed working (blocks NULL, blocks CONFLICTS, allows FLAGS/CLEAN)

## Build rule to carry forward

**Reconciliation skips are not failures.** A check with status SKIPPED means
prerequisite facts were absent — the check was not applicable, not broken.
`overallStatus: CLEAN` with all checks skipped is valid and correct.
The gate must never treat SKIPPED as a failure condition.

## Next priorities

1. **K-1 fact extraction** — `K1_ORDINARY_INCOME`, `K1_OWNERSHIP_PCT` needed
   for K1_TO_ENTITY and OWNERSHIP_INTEGRITY checks to run (Moody's MMAS gap)
2. **Balance sheet extraction** — `TOTAL_ASSETS`, `TOTAL_LIABILITIES`,
   `TOTAL_EQUITY` needed for BALANCE_SHEET check (Schedule L extraction)
3. **Observability** — confirm Pulse events beyond `deal.underwrite.verify`
4. **Model Engine V2** — feature flag + DB seeding
5. **Corpus expansion** — 10+ verified docs needed for bank confidence
