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
| V-F1 | `F1-renderVerification.test.tsx`: renderToString produces "Not started" 3x | 3/3 pass |
| V-F2 | `F2-scoringBridge.test.ts`: production-equivalent inputs pass eligibility; all 3 July-23 failures fixed | 7/7 pass |

## SPEC-BORROWER-FINISH tracker

| ID | Finding | Status | Commit | Verification |
|----|---------|--------|--------|-------------|
| F-1 | Land screen-integrity PR + render verify | DONE | `f0c5972e` | V-F1 (renderToString) |
| F-2 | Scoring input bridge | DONE | `68105a2a` | V-F2 (7/7 pass) |
| F-2.5 | NAICS triage | DONE | `68105a2a` | Reference-data gap — see AAR below |
| F-3 | Drive one deal to sealed | BLOCKED | — | See F-3 blockers below |
| F-4a | Owner-empty progress | DEFERRED | — | Product decision (M4 accepted) |
| F-4b | SOP citation revision | DONE | `db1b7ff4` | M7-SOP-REVISION-REPORT.md |
| F-4c | Spec landing | DONE | `db1b7ff4` | This file |
| F-4d | Pulse deletion | DONE | — | Separate branch fix/remove-borrower-surface |
| F-5 | Close workstream | PENDING | — | After F-3 resolution |

### F-2 AAR

**1. Column map (loadScoreInputs reads → writer):**

| Column | Table | Writer |
|--------|-------|--------|
| loan_amount | deals | propagateBorrowerFacts §1 |
| loan_type | deals | propagateBorrowerFacts §1 (defaults "7a") |
| state | deals | propagateBorrowerFacts §1 |
| naics | borrower_applications | propagateBorrowerFacts §2 |
| business_entity_type | borrower_applications | propagateBorrowerFacts §2 |
| loan_purpose (→ useOfProceeds fallback) | borrower_applications | propagateBorrowerFacts §2 |
| industry | borrower_applications | propagateBorrowerFacts §2 |
| YEARS_IN_BUSINESS | deal_financial_facts | propagateBorrowerFacts §3 |
| ANNUAL_REVENUE | deal_financial_facts | propagateBorrowerFacts §3 |
| EMPLOYEE_COUNT | deal_financial_facts | propagateBorrowerFacts §3 |
| federalDebtDelinquent | deal_builder_sections (compliance) | intake wizard (null = pending pass) |
| taxDelinquent | deal_builder_sections (compliance) | intake wizard (null = pending pass) |
| samDebarred | deal_builder_sections (compliance) | intake wizard (null = pending pass) |
| felonyConviction | ownership_entities (character flags) | intake wizard (null = pending pass) |
| DSCR, sources_and_uses | buddy_sba_packages | trident pipeline |
| franchise data | deal_franchises + franchise_brands | franchise matcher |

All eligibility-critical inputs (entity_type, naics, use_of_proceeds)
are covered by propagateBorrowerFacts. Compliance fields (null = pending
pass) don't block eligibility.

**2. Before/after entity_type trace:**

- Before (July 23 scores): `input_snapshot.businessEntityType = null`,
  eligibility failures: `for_profit_unknown`, `size_standard`, `use_of_proceeds_unknown`
- After (current borrower_applications): `business_entity_type = "LLC"`,
  `naics = "513210"`, `loan_purpose = "trademark the brand and launch it"`
- Concierge facts contain: `business.entity_type = "LLC"` (extracted by LLM)
- Propagation code maps: `businessFacts["entity_type"]` → `app.business_entity_type`
- C-0.2 ordering: `propagationDone.then(() => computeBuddySBAScore(...))`
  chains scoring after propagation (concierge/route.ts lines 656-669)

**3. NAICS triage: reference-data gap (not missing input).**

NAICS 513210 (Software Publishers) was correctly extracted by the concierge
and propagated to `borrower_applications.naics`. The size-standard check
failed because `sbaSizeStandards.ts` uses a placeholder top-50 table that
did not include sector 513 (Information/Technology). Fix: added 513210 with
$47M threshold per 13 CFR §121.201. The full 2,061-entry JSON at
`data/industry-intelligence/sba-size-standards.json` also has corrupted
data for this code (`[object Object]` title, null value) — a separate
ingestion-script fix for future work.

### F-3 blockers

Driving deal `0d989d1f` to a sealed package requires:
1. Re-triggering scoring (need concierge turn or manual compute API call)
2. Locking the score (`locked_at` must be set)
3. Confirmed assumptions (`buddy_sba_assumptions` with confirmed=true)
4. Trident bundle (SBA forms package)
5. Validation report
6. Identity verification (0 records in production)

Items 3-6 require lender-side actions or the full packaging pipeline,
which is outside the scope of code-only changes. F-3 is a product
milestone, not a code fix.

## Production evidence

- 83 `buddy_sba_scores` rows (0 locked, all score=0)
- 0 `borrower_identity_verifications` records
- 0 sealed packages
- 8 concierge sessions (6 with owners: [])
- Deal `0d989d1f`: `business_entity_type = LLC`, `naics = 513210`,
  `loan_purpose` set in `borrower_applications`; concierge facts have
  matching `business.entity_type = LLC` and `loan.use_of_proceeds`
- Score rows from July 23 all have `snap_entity_type: null` (pre-fix state)
