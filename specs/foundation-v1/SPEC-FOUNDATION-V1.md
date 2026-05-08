# SPEC-FOUNDATION-V1 — Bullet-proof Underwriting Foundation

**Status:** In progress
**Filed:** 2026-05
**Owner:** Matt (architecture + credit policy) → Claude Code (implementation)
**Depends on:** SPEC-FLOW-V1 PR1, PR2, PR3 all merged
**Predecessor:** SPEC-13.5 closed; the V-12 deferred chain (research gate, financial pipeline, doc finalization, borrower-flow consolidation) is partially absorbed into this spec

## Why this exists

Audit on Samaritus Yacht Management (deal `0279ed32-c25c-4919-b231-5790050331dd`, the only deal in production at `stage='underwriting'`) revealed four structural gaps preventing any deal from walking end-to-end through submission:

1. **Issue A — Orphaned `principal_bio` overrides after canonical migration.** SPEC-13.5 PR-A migrated legacy `deal_memo_overrides` into canonical `deal_management_profiles`, but the migration assigned new UUIDs to management profiles while preserving the override keys keyed by old UUIDs. The `principal_bio_{oldId}` keys point to principals that don't exist in the canonical store anymore.
2. **Issue B — DSCR computation depends on missing upstream facts.** The GLOBAL_CASH_FLOW spread is correctly shaped with formula references, but the upstream facts (`CASH_FLOW_AVAILABLE`, `ANNUAL_DEBT_SERVICE`) are never written. The 169 raw extractions for Samaritus include all the inputs — but no aggregator combines them.
3. **Issue C — Collateral GROSS_VALUE fact never written.** Bankers enter collateral via `deal_collateral_items` with `estimated_value` filled in. But the contract reads `memo.collateral.gross_value.value`, sourced from a `COLLATERAL/GROSS_VALUE` fact that nobody writes. There's no code path from `deal_collateral_items.estimated_value` → `COLLATERAL/GROSS_VALUE` fact.
4. **Issue D — T12 (trailing 12) treated as primary spread, not opportunistic.** Banking packages don't reliably include T12 statements. Any code path that requires T12 as a primary input is structurally wrong for SBA / commercial banking.

These are all symptoms of a class of bugs. Fixing only Samaritus would be a one-off patch (anti-pattern #1). Fixing the class of bugs unblocks every deal that follows.

## Core philosophy: most conservative defensible posture

Per founder direction (Matt), Buddy's underwriting methodology is locked at **the most conservative institutional posture**. The trust thesis: deals that pass Buddy's gauntlet pass anyone's gauntlet. The bar is built so that examiners walking the credit memo cannot find a weak assumption.

This conservatism is encoded in policy locks (below) and enforced by deterministic calculation modules with full provenance. No rules of thumb, no shortcuts, no optimistic assumptions.

## Methodology research — citation hierarchy

Research conducted 2026-05 against authoritative sources:

| Tier | Source | Used for |
|------|--------|----------|
| 1 | SBA SOP 50 10 8 (effective 2025-06-01) | Primary regulatory definitions of OCF, debt service, DSCR thresholds |
| 1 | SBA Procedural Notice 5000-875701 (effective 2026-03-01) | Small Loan underwriting update; EBITDA-based OCF mandate |
| 1 | SBA SOP 50 10 5(F) (carried into 50 10 8) | Historical anchor for global cash flow analysis requirements |
| 1 | OCC Internal Guidance, April 9, 2008 | Federal banking regulator standard for global cash flow |
| 1 | OCC Comptroller's Handbook (Commercial Loans, CRE Lending, Rating Credit Risk) | Federal examiner standards |
| 2 | Fannie Mae Form 1084 Cash Flow Analysis | Industry-standard tax return spreading methodology |
| 2 | Federal Register CRE workout policy statement (2023) | Stress test scenario requirements |
| 3 | Coleman Report (citing SBA SOP requirements) | Authoritative practitioner enumeration of SBA cash flow adjustments |
| 3 | Abrigo / Sageworks | Double-counting rules, K-1 distribution treatment |
| 3 | Wipfli, Linda Keith CPA, Whitlock Co. | Convergent practitioner consensus on GCF construction |
| 3 | Starfield & Smith, Whiteford Taylor & Preston | Legal practice commentary on SOP 50 10 8 changes |
| 4 | RMA-Minnesota UCA training | Alternative model documented for completeness; future enhancement |

## Policy locks — the conservative tier

All locks are non-negotiable defaults for Buddy SBA Brokerage's own deals. Per-tenant override is supported only via explicit credit policy configuration; default is always conservative.

### DSCR thresholds (10bps buffer above SBA SOP floors)

| Path | Base DSCR | Stress C DSCR | Action below |
|------|-----------|---------------|--------------|
| SBA 7(a) Small (≤$350K) | 1.20x | 1.00x | Submission blocked |
| SBA 7(a) Standard (>$350K) | 1.25x | 1.05x | Submission blocked |
| SBA 504 | 1.25x | 1.05x | Submission blocked |
| Conventional commercial | 1.35x | 1.10x | Submission blocked |
| Conventional CRE | 1.40x | 1.15x | Submission blocked |

10bps over SBA SOP 50 10 8 floors (1.10x for Small, 1.15x for Standard) provides measurement-error buffer + signals conservative posture to bank tenants and regulators.

### Stress test scenarios

Worst-of-three reported. Stress C is the binding gate.

| Scenario | Definition |
|----------|------------|
| Base | Historical OCF / contractual P&I |
| Stress A | +300bps applied to variable-rate and near-maturity debt |
| Stress B | Revenue compressed 15%, fixed costs constant |
| Stress C | Stress A + Stress B simultaneously |

The 15% revenue compression number reflects historic peak-to-trough small business revenue decline in the 2008-2010 recession (BLS data). +300bps is the industry-standard rate stress. Combined Stress C captures the historical pattern (1981, 1990, 2008) of rising rates causing recession.

### Cash flow construction locks

1. **Methodology:** Line-by-line Form 1084 + SBA SOP 50 10 8 adjustments. **No 40% shortcuts.** Every fact traces to source document via `provenance` jsonb field.
2. **Owner W-2 add-back:** Only if (a) change-of-ownership AND (b) seller fully exiting (no consulting agreement, no continued employment, no earn-out) AND (c) buyer compensation documented at fair-market level. If any condition unmet, owner W-2 stays as an expense.
3. **Mortgages/notes payable < 1yr:** Always subtracted. No exceptions for "rolling LOC" or "sufficient liquidity."
4. **K-1 income on personal side:** Distributions only (Box 16D for 1120S, Box 19A for 1065). **Box 1 ordinary income is NEVER counted on the personal side.** No projected/available distributions — only actual historical.
5. **K-1 capital contributions:** Always subtracted from personal cash flow.
6. **Affiliate businesses:** **Pro-rata ownership share only.** 40% owner = 40% of affiliate EBITDA contributes to global cash flow. No full EBITDA pickup regardless of operational control.
7. **Contingent liabilities:** All personal guarantees count as real annual debt service (annual P&I of guaranteed obligation).

### Living expense methodology

Worst-of-three method computed; MAX result used.

| Method | Formula |
|--------|---------|
| A | $25,000 joint base + $7,500 per dependent |
| B | 18% of personal AGI |
| C | $36,000 single / $48,000 joint household floor |

Floor of $36K single / $48K joint is the conservative envelope. Method A's $7,500/dependent is at the conservative end of the institutional range. Method B's 18% is the top end of the 8%–18% Sageworks/Abrigo cited range.

### DSCR formulas

```
BaseDSCR    = CashFlowAvailable / AnnualDebtService
StressA     = CashFlowAvailable / DebtServiceAt(rate + 300bps)
StressB     = CashFlowAvailable_at_85%_Revenue / AnnualDebtService
StressC     = CashFlowAvailable_at_85%_Revenue / DebtServiceAt(rate + 300bps)

SubmissionGate = (BaseDSCR ≥ tier_base AND StressC ≥ tier_stress)
```

## PR sequence

| PR | Issue | Effort | Risk |
|----|-------|--------|------|
| FOUNDATION-PR1 | Issue A: Orphaned principal_bio overrides | ~2h | Low — surgical migration fix |
| FOUNDATION-PR2 | Issue C: Collateral gross_value fallback | ~2h | Low — fact materializer |
| FOUNDATION-PR3 | Issue D: T12 opportunistic audit + remediation | ~1h audit + variable | Low |
| FOUNDATION-PR4 | Issue B: Cash flow aggregator | Substantial (multi-day) | Med — touches submission readiness |

PR1 + PR2 ship today. PR3 audit ships today; PR3 remediation ships when audit identifies scope. PR4 spans multiple sessions due to scope.

After all four ship:
- Samaritus walks end-to-end through `/deals/0279ed32-c25c-4919-b231-5790050331dd/credit-memo` to a successful submission.
- Any other deal at canonical `underwrite_in_progress` follows without manual intervention.
- DSCR computation traces every input to source document via provenance.
- Submission readiness gate becomes deterministic from raw fact extractions forward.

## Per-tenant configuration surface

Each policy lock exposes a per-tenant override via `bank_underwriting_policies` table (to be created in PR4):

```sql
CREATE TABLE bank_underwriting_policies (
  bank_id UUID PRIMARY KEY REFERENCES banks(id),
  dscr_buffer_bps INTEGER DEFAULT 10,            -- bps above SBA floor
  stress_c_min_dscr NUMERIC(4,2) DEFAULT 1.00,
  revenue_stress_pct NUMERIC(4,2) DEFAULT 0.85,  -- 1 - 0.15
  rate_stress_bps INTEGER DEFAULT 300,
  owner_wage_addback_policy TEXT DEFAULT 'strict',  -- 'strict' | 'sba_default' | 'lenient'
  living_expense_method TEXT DEFAULT 'max_of_three',  -- 'max_of_three' | 'method_a' | 'method_b' | 'method_c'
  k1_income_basis TEXT DEFAULT 'distributions_only',  -- 'distributions_only' | 'fnma_exception_allowed'
  affiliate_eebitda_treatment TEXT DEFAULT 'pro_rata_only',  -- 'pro_rata_only' | 'full_with_doc'
  contingent_liability_treatment TEXT DEFAULT 'always_count',  -- 'always_count' | 'likely_only'
  short_term_debt_subtraction TEXT DEFAULT 'always',  -- 'always' | 'fnma_exception_allowed'
  -- ...
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);
```

Default is the conservative tier. Banks can configure looser settings only via explicit policy commit — the defaults are not silently overridden.

## Build principles codified by this work

### #19 — Bias elimination through worst-of-N policy stacking

When credit policy admits multiple defensible methodologies (e.g., living expense calculation), compute all and use the worst result. This eliminates founder/operator bias and makes the underwriting methodology defensible regardless of which institutional tradition the examiner is from.

**Source:** SPEC-FOUNDATION-V1 living expense lock — three institutional methods exist (floor+dependents, %AGI, fixed-by-family-size), none is universally canonical. Worst-of-three eliminates the choice.

### #20 — Per-tenant configuration must default to the most conservative setting

Multi-tenant SaaS lending platforms accumulate per-bank configuration over time. The defaults must be set such that a bank that NEVER configures anything gets the safest possible underwriting. Aggressive settings require explicit opt-in; conservative settings are the silent default.

**Source:** SPEC-FOUNDATION-V1 `bank_underwriting_policies` defaults all set to conservative tier.

### #21 — Methodology research with full citation chain precedes spec finalization

Credit policy decisions documented in spec must trace to authoritative sources. Founder credit-officer judgment is captured separately as policy lock decisions, but the methodology research itself is bias-free.

**Source:** SPEC-FOUNDATION-V1 Methodology research section. Founder explicitly delegated research with the directive "I want full and in depth research [...]. It is important that my own bias never influence the calculations."

## How to find related material

- This doc: parent spec
- `SPEC-FOUNDATION-V1-PR1-orphaned-principal-bio.md`: PR1 spec
- `SPEC-FOUNDATION-V1-PR2-collateral-gross-value-fallback.md`: PR2 spec
- `SPEC-FOUNDATION-V1-PR3-t12-opportunistic-audit.md`: PR3 spec
- `SPEC-FOUNDATION-V1-PR4-cash-flow-aggregator.md`: PR4 spec
- `../banker-flow-v1/SPEC-FLOW-V1.md`: parent banker-flow spec
- `../follow-ups/SPEC-13.5-V12-deferred-findings.md`: V-12 chain (partially absorbed here)
