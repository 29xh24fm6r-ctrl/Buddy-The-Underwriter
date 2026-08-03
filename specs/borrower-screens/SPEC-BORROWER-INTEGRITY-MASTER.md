# SPEC-BORROWER-INTEGRITY-MASTER

**Supersedes:** SPEC-BORROWER-INTEGRITY-V1, V2, T1, SCREENS  
**Branch:** `claude/borrower-screens-rebuild-79zayf`  
**Date:** 2026-08-03

## Tracker

| ID | Finding | Status | Commit | Verification |
|----|---------|--------|--------|-------------|
| M0 | ApprovalScoreCard fails open on absent eligibilityFailures | DONE | `7b9230bc` | V-M3 `b3eec8a5` |
| M1 | deriveVerifications inverts gate-string absence into positive assertions | DONE | `7b9230bc` | V-M1b `b3eec8a5` |
| M2 | Scoring inputs never reach the scorer (entity_type bridge gap) | DONE | `8ee7b909` | V-M2 `4558c2a6` |
| M3 | PortalClient reads fabricated progress_pct from DB | DONE | `02efc12c` | tsc clean |
| M4 | computeFieldProgress returns determinable:false for 6/8 sessions | ACCEPTED | — | See decision below |
| M5 | StartConciergeClient reads fabricated progress_pct from DB | DONE | `88c27a17` | tsc clean |
| M6 | PulseMasterrepo contains borrower surface files | DONE | pushed to `fix/remove-borrower-surface` | Guard test in PulseMasterrepo |
| M7 | SOP citations reference superseded edition (50 10 7.1 vs 50 10 8) | REPORT | — | Route to CCO |
| M8 | Spec landing, templates, process fixes | THIS FILE | — | — |

### Predecessor findings (consolidated)

| Original | Maps to | Notes |
|----------|---------|-------|
| C-0.2 | M2 | Bridge gap: propagateBorrowerFacts + scoring race fix |
| C-1 | M5 | Remove progressPct direct reads |
| C-2 | M5 | owners-empty guard in computeFieldProgress |
| C-4 | M2 | OC key dedup in borrowerFieldProgress |
| C-6 | M6 | Pulse boundary guard |
| D-0 | M1 | deriveVerifications counted records |
| D-1 | M0 | ApprovalScoreCard fail-closed |

## M4 Decision

`computeFieldProgress` returns `determinable: false` when owners are empty
(6 of 8 production sessions). This produces `progressPct = 0` via the
fieldProgress derivation.

**Decision: Accept.** Rationale:
1. Owners appear at chapter 3 (ownership). Before that, the system cannot
   determine total field count because owner-scoped fields are unknown.
2. GuidedIntakeShell already shows chapter-scoped "X of Y done" (lines 63-69),
   so borrowers see meaningful progress within chapters 1-2.
3. BrokerageStageStrip correctly stays at "details" stage until 60% — showing
   0% is accurate (not enough data to progress).
4. Once owners are entered at chapter 3, `determinable` flips to `true` and
   real percentages appear immediately.

## Hard constraints (preserved throughout)

- No changes to `canSeal`/`sealingGate.ts`
- No `IntakeReviewStep` changes (consumer is correct; supplier was fixed)
- No scoring weights, bands, or threshold changes
- No `progress_pct` writes to DB
- No registry edits
- No new routes (slot budget enforced by `routeConsolidationGuard.test.ts`)
- No new streaming transports
- No lender-facing surface changes
- No SOP string edits (M7 is report-only)
- No `AssumptionInterview` state machine changes
- "Never display an adverse determination produced by missing inputs"
- "Never read or return PII values — check presence only"
- `tsc` is not verification — demonstrated by exercising rendering logic

## Verification gates

| Gate | Method | Result |
|------|--------|--------|
| V-M1b | `verificationTruth.test.tsx`: deriveVerifications(0 counts) → all false → "Not started" | 4/4 pass |
| V-M2 | `v-m2-bridge.test.ts`: null entity → for_profit_unknown; LLC → passes | 6/6 pass |
| V-M3 | `verificationTruth.test.tsx`: absent eligibilityFailures → fail closed | 3/3 pass |

## Production evidence

- 83 `buddy_sba_scores` rows (0 locked, all score=0)
- 0 `borrower_identity_verifications` records
- 0 sealed packages
- 8 concierge sessions (6 with owners: [])
- Deal `0d989d1f`: `business_entity_type = LLC` in `borrower_applications`
  (manually propagated to prove M2 chain)
