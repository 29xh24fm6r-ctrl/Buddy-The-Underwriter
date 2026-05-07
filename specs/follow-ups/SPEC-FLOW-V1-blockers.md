# SPEC-FLOW-V1 — Blocker findings

Drift detected during SPEC-FLOW-V1 PR1 pre-implementation verification (PIV-1..9). Both findings were anticipated as non-blocking by SPEC-FLOW-V1 and do not gate PR1, but each represents a prior PR's stated outcome that did not actually land in `main`. Filed here so future investigation has the audit trail in the repo rather than buried in a PR description.

## SPEC-13 Fix #4 — MemoCompletionWizard write target drift
Detected: SPEC-FLOW-V1 PIV-7 (2026-05-07)
Expected: wizard POSTs to /api/deals/[dealId]/memo-inputs/from-wizard
Actual: wizard still POSTs to /api/deals/[dealId]/credit-memo/overrides at line 31
Impact: bankers who use the wizard write to the legacy table that the new
  memo-inputs gate ignores. Re-entry friction persists.
Resolution: re-execute SPEC-13 Fix #4 in a future PR.

## SPEC-INTAKE-V2 — BTR routing exception drift
Detected: SPEC-FLOW-V1 PIV-8 (2026-05-07)
Expected: BUSINESS_TAX_RETURN exception in routing.ts at confidence 0.70
  with evidence_tier "moderate_with_signals"; gemini_classifier_v3 prompt
Actual: zero references in routing.ts or geminiClassifierPure.ts. PR #399
  appears to have shipped only structural assertions.
Impact: 72% BTR review rate persists. Bankers continue to hit the wall
  of yellow flags at classification confirm.
Resolution: re-execute SPEC-INTAKE-V2 Fix #1 (BTR confidence rebalance)
  in a future PR.
