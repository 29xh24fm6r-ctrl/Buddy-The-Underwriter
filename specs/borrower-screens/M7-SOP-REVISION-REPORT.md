# M7 — SOP Citation Revision Report

**Status:** Route to CCO for review  
**Date:** 2026-08-03  
**Scope:** `src/lib/score/eligibility/evaluate.ts`

## Finding

All 12 SBA eligibility checks in `evaluateBuddySbaEligibility` cite
**SOP 50 10 7.1** in their `sopReference` field. This edition is superseded;
the current governing document is **SOP 50 10 8**.

The citations appear in `eligibilityFailures` records written to
`buddy_sba_scores.eligibility_failures` and surfaced on the borrower-facing
`ApprovalScoreCard`.

## Affected Checks

| # | Check ID | Category | SOP Reference (current) |
|---|----------|----------|------------------------|
| 1 | `for_profit` / `for_profit_unknown` | for_profit | SOP 50 10 7.1, Ch 2 |
| 2 | `size_standard` | size_standard | SOP 50 10 7.1, Ch 2 |
| 3 | `use_of_proceeds` / `use_of_proceeds_unknown` | use_of_proceeds | SOP 50 10 7.1, Ch 3 |
| 4 | `sources_and_uses` / `sources_and_uses_unknown` | sources_and_uses | SOP 50 10 7.1, Ch 3 |
| 5 | `franchise_eligible` / `franchise_unknown` | franchise | SOP 50 10 7.1, Ch 2 |
| 6 | `federal_debt` / `federal_debt_unknown` | character | SOP 50 10 7.1, Ch 2 |
| 7 | `tax_delinquent` / `tax_delinquent_unknown` | character | SOP 50 10 7.1, Ch 2 |
| 8 | `sam_debarred` / `sam_debarred_unknown` | character | SOP 50 10 7.1, Ch 2 |
| 9 | `felony` / `felony_unknown` | character | SOP 50 10 7.1, Ch 2 |
| 10 | `incarcerated` / `incarcerated_unknown` | character | SOP 50 10 7.1, Ch 2 |
| 11 | `prior_gov_default` / `prior_gov_default_unknown` | character | SOP 50 10 7.1, Ch 2 |
| 12 | `affiliates_unknown` | affiliation | SOP 50 10 7.1, Ch 2 |

## Recommendation

Update the `SOP` constant map in `evaluate.ts` (lines ~50-80) to reference
SOP 50 10 8 with the corresponding chapter/section numbers from the current
edition. This is a string-only change with no logic impact.

**Constraint:** Per SPEC-BORROWER-INTEGRITY-MASTER, this is report-only.
No SOP string edits are made in this branch. Route to CCO for review and
approval before updating citations.
