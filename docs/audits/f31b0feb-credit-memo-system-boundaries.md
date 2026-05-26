# Credit Memo System Boundary Audit — Post f31b0feb

Generated: 2026-05-26

## Purpose
Prevent competing memo, scoring, rating, readiness, and decision systems from developing.
Classify every system as canonical, legacy, or delete-candidate.

## Memo-Facing Systems (Canonical)

| System | File | Classification | Notes |
|--------|------|----------------|-------|
| `buildCanonicalCreditMemo` | `src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts` | **canonical** | Single live deterministic memo builder |
| `buildConventionalRiskRating` | `src/lib/creditMemo/riskRating/buildConventionalRiskRating.ts` | **canonical** | Memo-facing risk grade (1-8 conventional scale) |
| `buildExhibitRegistry` | `src/lib/creditMemo/canonical/buildExhibitRegistry.ts` | **canonical** | Single exhibit label authority |
| `buildDscrReconciliation` | `src/lib/creditMemo/financials/buildDscrReconciliation.ts` | **canonical** | DSCR calculation transparency |
| `evaluateCreditDecisionDataSufficiency` | `src/lib/creditMemo/decisionQuality/evaluateCreditDecisionDataSufficiency.ts` | **canonical-advisory** | Advisory memo metadata, not submission gate |
| `CanonicalMemoTemplate` | `src/components/creditMemo/CanonicalMemoTemplate.tsx` | **canonical** | Single memo rendering template |
| `SubmittedMemoView` | `src/components/creditMemo/SubmittedMemoView.tsx` | **canonical** | Frozen snapshot renderer (uses CanonicalMemoTemplate) |

## Submission / Snapshot Systems (Canonical)

| System | File | Classification | Notes |
|--------|------|----------------|-------|
| `credit_memo_snapshots` | Supabase table | **canonical** | Frozen banker-certified artifact |
| `buildFloridaArmorySnapshot` | `src/lib/creditMemo/snapshot/buildFloridaArmorySnapshot.ts` | **canonical** | Snapshot builder |
| `buildMemoOutput` | `src/lib/creditMemo/submission/buildMemoOutput.ts` | **canonical** | Thin wrapper around snapshot builder |
| `submitCreditMemoToUnderwriting` | `src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts` | **canonical** | Submission orchestrator |
| `evaluateMemoReadinessContract` | `src/lib/creditMemo/submission/evaluateMemoReadinessContract.ts` | **canonical** | Server submit gate |
| `evaluateMemoInputReadiness` | `src/lib/creditMemo/inputs/evaluateMemoInputReadiness.ts` | **canonical** | Pure readiness evaluator |
| `bankerReviewReadiness` | `src/lib/creditMemo/review/bankerReviewReadiness.ts` | **canonical** | Canonical-first required items (shared by client + server) |

## Financial Data Systems (Canonical)

| System | File/Table | Classification | Notes |
|--------|------------|----------------|-------|
| `deal_financial_facts` | Supabase table | **canonical** | Canonical fact store |
| `financial_snapshots` | Supabase table | **canonical** | Point-in-time metric snapshots |
| `ar_aging_reports` | Supabase table | **canonical** | AR aging data |
| `borrowing_base_calculations` | Supabase table | **canonical** | AR borrowing base |
| `deal_loan_requests` | Supabase table | **canonical** | Loan request / product type |
| `loan_product_types` | Supabase table | **canonical** | Product taxonomy |

## Legacy Scoring Systems

| System | File/Table | Classification | Consumers | Action |
|--------|------------|----------------|-----------|--------|
| `computeDealScore` | `src/lib/scoring/dealScoringEngine.ts` | **legacy-dashboard-only** | score/recompute route, lender/match route, portfolio pages | Do NOT use in memo-facing output |
| `deal_underwriting_scores` | Supabase table | **legacy-dashboard-only** | portfolio page, portfolio risk/summary APIs, score GET route | Keep for portfolio monitoring; never render in credit memo |
| `/api/.../underwriting/score` | Route GET | **legacy-dashboard-only** | Unknown UI consumers | Label as "Portfolio monitoring score" |
| `/api/.../underwriting/score/recompute` | Route POST | **legacy-dashboard-only** | Unknown UI consumers | Label as "Portfolio monitoring score recompute" |
| `financial_snapshot_decisions` | Supabase table | **canonical-but-needs-guard** | Score recompute, lender match, portfolio, examiner audit | Used for stress/SBA input to legacy score; not memo-facing |

## Decision Systems (Separate from Memo)

| System | File/Table | Classification | Notes |
|--------|------------|----------------|-------|
| `decision_snapshots` | Supabase table | **canonical** | Immutable credit decision audit trail (separate from memo) |
| `generateDecisionSnapshot` | `src/lib/decision/generateDecisionSnapshot.ts` | **canonical** | Creates immutable decision records |
| Decision PDF route | `src/app/api/deals/[dealId]/decision/[snapshotId]/pdf/route.ts` | **canonical** | Renders from immutable decision_snapshots |
| Committee packet route | `src/app/api/deals/[dealId]/committee/packet/generate/route.ts` | **canonical** | Uses decision_snapshots; tracks narrative provenance but does not overlay |

## Legacy/Orphan Systems

| System | File/Table | Classification | Notes |
|--------|------------|----------------|-------|
| `deal_memo_overrides` | Supabase table | **legacy-read-only** | Legacy qualitative override store; canonical-first fallback only |
| `canonical_memo_narratives` | Supabase table | **canonical-but-needs-guard** | AI narrative cache; must be input_hash gated on all read paths |
| `deal_credit_memos` | Referenced in `packageDeal.ts` | **delete-candidate** | No migration; orphan table reference |
| Old `MemoTemplate.tsx` | `src/components/memo/MemoTemplate.tsx` | **delete-candidate** | Legacy non-canonical template |

## Narrative Overlay Hash Gate Status

| Path | File | Hash Gated? | Status |
|------|------|-------------|--------|
| Canonical page | `src/app/(app)/credit-memo/[dealId]/canonical/page.tsx` | YES | Safe |
| Canonical print page | `src/app/(app)/credit-memo/[dealId]/canonical/print/page.tsx` | YES | Safe |
| Decision PDF | `src/app/api/deals/[dealId]/decision/[snapshotId]/pdf/route.ts` | N/A | Uses immutable decision_snapshots, no overlay |
| Committee packet | `src/app/api/deals/[dealId]/committee/packet/generate/route.ts` | N/A | Provenance tracking only, no overlay |
| Frozen snapshot | `credit_memo_snapshots.memo_output_json` | N/A | Immutable at certification time |

## Boundary Rules

1. **Memo-facing credit grade MUST come from `buildConventionalRiskRating`**
2. **`computeDealScore` MUST NOT appear in memo-facing output** (recommendation, template, snapshot, PDF, committee packet)
3. **`deal_underwriting_scores` is portfolio monitoring only** — never render in credit memo
4. **Narrative overlays MUST be input_hash gated** on all live-builder read paths
5. **Frozen snapshots are immutable** — no recompute after certification
6. **`evaluateCreditDecisionDataSufficiency` is advisory** — does not gate submission
