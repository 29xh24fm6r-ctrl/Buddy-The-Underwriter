# GOD TIER PHASE 3 — THE SPREAD OUTPUT LAYER
## Any Deal Type. Better Than Moody's. Holy Shit Look At This.

**Classification:** Internal — Architectural Specification
**Version:** 1.0
**Date:** 2026-03-06
**Prerequisite:** God Tier Phases 1, 2, 2C, 2D complete
**Status:** THE PRODUCT LAYER — THIS IS WHAT BANKS SEE

---

## THE CORE THESIS

Everything built in Phases 1–2D is the engine. It extracts perfectly, normalizes correctly, consolidates accurately, and computes every ratio with the right formula.

Phase 3 is the product. It's what a banker sees, what a credit committee reviews, and what makes a bank choose Buddy over every other tool in the market.

**The standard:** A Moody's spread is a table of numbers. A Buddy spread is a complete credit story — fully explained, benchmarked against peers, adjusted for quality of earnings, with every assumption surfaced and every risk flagged. A banker can walk into a credit committee with a Buddy spread and present the deal without having done any additional analysis.

---

## SECTION 1: UNIVERSAL SPREAD ENGINE — ANY DEAL TYPE

The original system was locked to one spread template: CRE. That is over.

Buddy must detect the deal type from the documents and automatically select and populate the correct spread model. Every spread model shares the same underlying canonical fact registry and ratio engine — only the presentation layer changes.

### 1A. Deal Type Detection

```typescript
type DealType =
  | 'c_and_i'              // Commercial & Industrial — operating business loan
  | 'cre_owner_occupied'   // CRE where borrower occupies the property
  | 'cre_investor'         // Investment CRE — income-producing property
  | 'cre_construction'     // Ground-up construction or major renovation
  | 'sba_7a'               // SBA 7(a) — operating business
  | 'sba_504'              // SBA 504 — fixed asset / real estate
  | 'usda_b_and_i'         // USDA Business & Industry
  | 'agriculture'          // Farm / agricultural lending
  | 'multifamily'          // 5+ unit residential — treated as CRE
  | 'healthcare'           // Medical practice, senior care, hospital
  | 'franchise'            // Franchise business (SBA-eligible)
  | 'professional_practice'// Law firm, dental, medical, accounting
  | 'non_profit'           // 501(c)(3) entities
  | 'holding_company'      // Multi-entity holding structure
  | 'startup'              // Pre-revenue or early stage
  | 'acquisition'          // Business acquisition loan
  | 'equipment'            // Equipment-only financing
  | 'working_capital'      // Line of credit / working capital facility
```

**Detection logic — in priority order:**

1. Loan purpose stated in deal (banker-entered)
2. Document types present (appraisal → CRE; rent roll → investor CRE; SBA form 1919 → SBA)
3. Entity structure (RE holding LLC with no operations → CRE investor)
4. Revenue composition (rental income >80% of revenue → CRE investor)
5. NAICS code (NAICS 62 + individual practice → professional practice)
6. Balance sheet composition (PP&E >70% of assets → capital-intensive; equipment finance candidate)

### 1B. Spread Models by Deal Type

Each deal type gets a purpose-built spread model that emphasizes the ratios and data points that actually matter for that credit.

#### C&I Spread Model
**Primary focus:** Cash flow coverage, working capital cycle, leverage trend
**Key ratios surfaced first:** DSCR, FCCR, Debt/EBITDA, DSO, DIO, DPO, CCC
**Unique sections:** Working capital analysis, borrowing base (if revolver), covenant compliance
**Moody's equivalent:** RiskCalc C&I — Buddy is better because QoE-adjusted EBITDA is the denominator, not raw tax return income

#### CRE Investor Spread Model
**Primary focus:** Property-level cash flows, coverage on rental income, collateral value
**Key ratios surfaced first:** NOI DSCR, Debt Yield, LTV, Cap Rate, WALT, Vacancy, Break-Even Occupancy
**Unique sections:** Rent roll analysis (tenant by tenant), lease expiration schedule, market rent vs. contract rent comparison
**Moody's equivalent:** Moody's CRE model — Buddy adds WALT risk scoring and lease expiration waterfall

#### CRE Owner-Occupied Spread Model
**Primary focus:** Business cash flow covers the mortgage — property is collateral, not income source
**Key ratios:** Business DSCR (not NOI DSCR), LTV, Global DSCR
**Unique sections:** Business spread PLUS property valuation — two analyses in one
**Insight Moody's misses:** When the business is struggling but the property is appreciating, Buddy flags the divergence and surfaces which analysis the bank should weight more heavily

#### SBA 7(a) Spread Model
**Primary focus:** Same as C&I but with SBA-specific overlays
**SBA-specific:** Equity injection verification, affiliate business consolidation (SBA requires it), personal financial statement adequacy, use of proceeds alignment
**Key difference from C&I:** SBA requires global cash flow including ALL affiliates — Buddy's Phase 2C consolidation engine handles this natively

#### Construction Spread Model
**Primary focus:** Project feasibility, cost-to-complete, absorption assumptions
**Key ratios:** LTC, LTV (at stabilization), Interest Reserve Coverage, Debt Yield at stabilization
**Unique sections:** Sources and uses of funds, construction budget review, draw schedule analysis, completion guarantee assessment
**What Moody's can't do:** Buddy models the stabilized NOI projection and back-tests it against the construction budget to flag projects where the math doesn't work at the proposed loan amount

#### Professional Practice Spread Model
**Primary focus:** Collections-based revenue, doctor/dentist compensation normalization, practice value
**Key ratios:** Revenue per provider, collections ratio, overhead ratio, DSCR
**Unique normalization:** Provider compensation is always above-market by definition — Buddy applies market comp replacement cost (RVU-based for medical, collections-based for dental)
**What Moody's misses entirely:** The owner IS the business — key-man risk must be quantified. Buddy flags practices where >80% of revenue is attributable to a single provider.

#### Agriculture Spread Model
**Primary focus:** Farm income stability, commodity price sensitivity, land value
**Key ratios:** Current Ratio (farm version), Working Capital/Gross Revenue, Term Debt Coverage Ratio (TDCR), Asset Turnover
**Unique data:** Schedule F extraction, FSA loan cross-reference, crop insurance verification, commodity price scenario analysis
**USDA/FSA requirement:** Farm Service Agency uses TDCR ≥ 1.10 as their minimum — Buddy knows this and flags it separately from commercial DSCR

---

## SECTION 2: THE SPREAD OUTPUT — WHAT HOLY SHIT LOOKS LIKE

### 2A. The Five Panels of a Buddy Spread

Every Buddy spread, regardless of deal type, has five panels. Banks get all five. No other tool produces more than two.

---

**PANEL 1: THE EXECUTIVE SUMMARY**

A single-page credit narrative generated from the extracted and normalized data. Not a template. Not a mail merge. A real paragraph-form summary that a senior credit officer would write after reading the full spread — because Buddy has read the full spread.

```
Structure:
1. Business Overview (2-3 sentences): What does the borrower do, how long have they been doing it, and what is the loan for.
2. Financial Snapshot: Revenue trend, EBITDA margin vs. peers, primary risk factors.
3. Coverage: DSCR headline (business and global), whether it clears the bank's policy minimum.
4. Collateral: Appraised value, LTV, secondary repayment source strength.
5. Risk Flags: Every active red flag trigger, stated in plain English with the supporting number.
6. Recommendation language: "Based on the financial analysis, this credit [presents strong / adequate / marginal / insufficient] coverage..."
```

**This is the thing no tool has ever done.** A banker can hand this to their chief credit officer as a first draft and it will be better than what most junior underwriters write from scratch.

---

**PANEL 2: THE NORMALIZED SPREAD**

The traditional spread table — but with every adjustment visible and explained.

```
Layout: 3 years side by side (or 2 years + YTD)
For each line item:
  - Reported value (from tax return / financials)
  - Adjustments (QoE, owner benefits, depreciation normalization) — shown inline
  - Normalized value (what Buddy uses for ratios)
  - Trend indicator (↑ ↓ → with % change year-over-year)

Color coding:
  - Green: improving trend, ratio above benchmark p50
  - Yellow: stable or slightly below benchmark
  - Red: deteriorating trend or ratio below benchmark p25
  - Gray: not applicable for this deal type
```

Every adjustment cell is clickable/expandable. Click on "Depreciation Add-back: $142,000" and see:
- Form 4562 Section 179: $380,000 expensed in Year 1
- Normalized to 7-year MACRS straight-line: $54,285/yr
- Add-back of difference: $325,715
- Plus MACRS deduction: $142,000
- Net add-back applied: $142,000

This is traceability that would take a human underwriter 30 minutes to document. Buddy does it automatically.

---

**PANEL 3: THE RATIO SCORECARD**

Every ratio from the God Tier spec, organized by category, with peer context.

```
For each ratio:
┌─────────────────────────────────────────────────────────────────┐
│ DSCR (Business)                                          1.38x  │
│ ████████████████████░░░░░░░░  38th percentile — ADEQUATE       │
│ Industry median: 1.52x  │  Bank minimum: 1.25x  │  ✓ PASS     │
│ "Coverage is above policy minimum but below peer median.        │
│  Normalized EBITDA of $847K after QoE adjustments covers        │
│  annual debt service of $613K with $234K cushion."              │
└─────────────────────────────────────────────────────────────────┘
```

Every ratio gets:
- The number
- A visual percentile bar against NAICS peer group
- Pass/fail against bank's own policy minimums (configurable per bank)
- A one-sentence plain-English narrative explaining what the number means in context

**This is what "holy shit" looks like.** A banker who has been doing this for 20 years sees Buddy explain a ratio in context better than they could explain it in a credit memo.

---

**PANEL 4: THE RISK DASHBOARD**

All active red flag triggers consolidated into one view, organized by severity.

```
CRITICAL (blocks deal without committee review):
  ● DSCR < 1.0x: Business DSCR = 0.94x on standalone basis
    → Resolved by consolidation: Global DSCR = 1.31x (see Panel 5)

ELEVATED RISK:
  ● DSO 87 days: Above 90-day concern threshold; DIO also elevated at 134 days
    → Cash Conversion Cycle = 157 days; industry median = 68 days
  ● Non-recurring income: $187,000 ERC credit excluded from EBITDA
    → Reported EBITDA $1.02M → Normalized EBITDA $833K

WATCH:
  ● Revenue declining: Year 3 → Year 2 revenue fell 8.3%
    → Year 2 → Year 1 stabilized (+1.2%); may be temporary
  ● Related party rent: $180K/yr paid to owner's LLC
    → Add-back applied; market rate analysis included in Panel 2

PASSING:
  ● Tangible Net Worth: $1.24M (positive)
  ● Personal liquidity: Post-close reserves 18.3% of loan amount
  ● No tax liens, no NOL carryforward
```

---

**PANEL 5: THE STORY PANEL**

This is the panel no other tool has. Where everything that seems contradictory gets resolved into a coherent credit narrative with a recommendation.

```
WHAT THE NUMBERS ARE TELLING US:

The standalone C&I analysis shows marginal coverage (0.94x DSCR) driven by 
two factors: an elevated cash conversion cycle that is consuming working capital, 
and a non-recurring ERC credit that inflated prior-year EBITDA. Neither of these 
is a structural problem with the business.

The global analysis is stronger. When ABC Real Estate Holdings (the owner's 
property LLC) is consolidated, the enterprise generates $1.31x global DSCR. 
The RE entity's net cash flow of $62K/yr after its own mortgage service provides 
meaningful cushion.

The DSO/DIO situation deserves monitoring but is not disqualifying. The business 
operates in wholesale distribution (NAICS 4230) where 87-day DSO is at the 72nd 
percentile — elevated but not unusual for this industry. The AR aging report shows 
no concentration above 10% in any single customer. The DIO of 134 days is more 
concerning and warrants a covenant requiring monthly inventory reporting.

SUGGESTED STRUCTURE:
- Approve subject to monthly borrowing base certificate (A/R and inventory)
- Covenant: Current ratio ≥ 1.20x tested quarterly  
- Covenant: DSCR ≥ 1.15x tested annually (below policy minimum triggers review)
- Cross-collateralize with RE entity (additional collateral cushion)
- Personal guarantee of owner (100%)

COMPARABLE DEALS IN PORTFOLIO: [links to 3 similar approved deals for benchmarking]
```

---

### 2B. The Consolidation Bridge Panel (Multi-Entity Deals)

When the deal has multiple entities, a sixth panel appears automatically: the consolidation bridge from Phase 2C, showing every entity's standalone numbers, every elimination, and the consolidated total — all in one visual table with expandable detail rows.

---

## SECTION 3: DEAL TYPE SPREAD TEMPLATES

### 3A. Template Registry

```typescript
interface SpreadTemplate {
  deal_type: DealType;
  version: string;
  
  // Which panels to show
  panels: PanelConfig[];
  
  // Which ratio categories to surface first
  primary_ratio_groups: RatioGroup[];
  secondary_ratio_groups: RatioGroup[];
  
  // Deal-type specific sections
  custom_sections: CustomSection[];
  
  // Policy minimums (bank-configurable)
  policy_thresholds: PolicyThreshold[];
  
  // Red flag rules specific to this deal type
  red_flag_rules: RedFlagRule[];
}
```

### 3B. Template: C&I
- Panels: All 5 standard panels
- Primary ratios: DSCR, FCCR, Debt/EBITDA, DSO, DIO, DPO, CCC
- Custom section: Working Capital Analysis (A/R aging, inventory aging, borrowing base)
- Custom section: Management Assessment (years in business, ownership tenure, key-man risk flag)
- Policy minimums: DSCR ≥ 1.25x, FCCR ≥ 1.15x, Debt/EBITDA ≤ 4.5x, TNW ≥ $0

### 3C. Template: CRE Investor
- Panels: All 5 plus Rent Roll panel
- Primary ratios: NOI DSCR, Debt Yield, LTV, Cap Rate, WALT, Break-Even Occupancy
- Custom section: Rent Roll (tenant, suite, sq ft, monthly rent, lease expiration, % of total rent)
- Custom section: Lease Expiration Schedule (year-by-year rent at risk)
- Custom section: Market Rent Analysis (contract rent vs. market rent per sq ft by space type)
- Policy minimums: DSCR ≥ 1.25x, LTV ≤ 75%, Debt Yield ≥ 8.0%

### 3D. Template: SBA 7(a)
- All C&I panels PLUS SBA-specific overlays:
- Custom section: SBA Eligibility Checklist (size standards, use of proceeds, equity injection)
- Custom section: Affiliate Consolidation (SBA requires ALL affiliates consolidated)
- Custom section: Personal Financial Statement Analysis
- Custom section: Management Experience scoring
- Policy minimums: DSCR ≥ 1.15x (SBA floor), Global DSCR ≥ 1.15x

### 3E. Template: Construction
- Custom section: Sources and Uses of Funds
- Custom section: Construction Budget Review (budget vs. appraised value at completion)
- Custom section: Stabilization Analysis (projected NOI at stabilization → NOI DSCR at stabilization)
- Custom section: Draw Schedule and Interest Reserve Adequacy
- Primary ratios: LTC, LTV-at-stabilization, Debt Yield-at-stabilization, Interest Reserve Coverage
- Red flag: LTC > 80% → ELEVATED RISK
- Red flag: Stabilized DSCR < 1.25x → FLAG — project may not service debt when complete

### 3F. Template: Professional Practice
- Custom section: Provider Productivity Analysis (revenue per provider, RVU analysis if medical)
- Custom section: Collections Analysis (gross charges, adjustments, net collections ratio)
- Custom section: Key-Man Risk Assessment (revenue concentration by provider)
- Custom section: Practice Valuation (multiple of collections or EBITDA by specialty)
- Red flag: Single provider > 80% of revenue → KEY-MAN RISK CRITICAL

---

## SECTION 4: WHAT MAKES BUDDY BETTER THAN MOODY'S — ENUMERATED

| Capability | Moody's RiskCalc | Moody's CRE | Baker Hill | nCino Spreads | **Buddy** |
|---|---|---|---|---|---|
| QoE-adjusted EBITDA | ❌ | ❌ | ❌ | ❌ | ✅ |
| Depreciation normalization (179/bonus) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Owner benefit add-backs | ❌ | ❌ | ❌ | ❌ | ✅ |
| Book vs. tax reconciliation (M-1) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Multi-entity consolidation | Partial | ❌ | Partial | ❌ | ✅ Unlimited |
| Intercompany elimination | ❌ | ❌ | ❌ | ❌ | ✅ Auto-detected |
| Global DSCR (K-1 dedup) | ❌ | ❌ | ❌ | ❌ | ✅ |
| NAICS peer benchmarks on every ratio | ❌ | ❌ | Partial | ❌ | ✅ |
| Plain-English narrative on every ratio | ❌ | ❌ | ❌ | ❌ | ✅ |
| AI-generated executive summary | ❌ | ❌ | ❌ | ❌ | ✅ |
| 9-step auditable cash flow waterfall | ❌ | ❌ | ❌ | ❌ | ✅ |
| Risk dashboard with resolution narrative | ❌ | ❌ | ❌ | ❌ | ✅ |
| Deal type auto-detection | ❌ | ❌ | ❌ | Partial | ✅ |
| Multiple spread templates | ❌ | CRE only | Partial | Partial | ✅ 14 types |
| Covenant suggestions | ❌ | ❌ | ❌ | ❌ | ✅ |
| Construction stabilization analysis | ❌ | ❌ | ❌ | ❌ | ✅ |
| Professional practice key-man risk | ❌ | ❌ | ❌ | ❌ | ✅ |
| Agriculture TDCR / FSA standards | ❌ | ❌ | ❌ | ❌ | ✅ |
| Adjustment traceability to source line | ❌ | ❌ | ❌ | ❌ | ✅ |
| Comparable deal benchmarking | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## SECTION 5: THE NARRATIVE ENGINE

The most differentiated thing Buddy does is explain what the numbers mean. This requires a purpose-built narrative generation layer on top of the spread computation engine.

### 5A. Narrative Components

Every narrative component follows this rule: **Assertion → Number → Context → Implication**

```
Assertion:   "Coverage is adequate but below peer median."
Number:      "DSCR of 1.38x"
Context:     "Industry median for NAICS 4230 is 1.52x (Buddy's at 38th percentile)"
Implication: "The $234K annual cushion above debt service provides limited buffer 
              against revenue softness; a 17% revenue decline would breach 1.0x."
```

### 5B. Narrative Templates by Condition

For each major ratio and condition, Buddy has a narrative template populated with the actual numbers:

```typescript
interface NarrativeTemplate {
  condition: string;           // "dscr_adequate_below_median"
  assertion: string;           // template string with {variable} placeholders
  supporting_number: string;
  context: string;
  implication: string;
  severity: 'positive' | 'neutral' | 'caution' | 'concern' | 'critical';
}
```

Example conditions and their narratives:

**dscr_strong_above_p75:**
"Business cash flow provides strong debt service coverage. At {dscr}x, the borrower generates ${cushion} of annual cash flow above their debt obligations — a cushion that would absorb a {stress_pct}% revenue decline before coverage fell below 1.0x."

**leverage_elevated_but_declining:**
"Total leverage is elevated at {debt_ebitda}x Debt/EBITDA but has improved from {prior_debt_ebitda}x in the prior year. If the current deleveraging pace continues, the company will reach the {target_ratio}x target in approximately {years_to_target} years."

**dso_deteriorating:**
"Days sales outstanding has increased from {prior_dso} days to {current_dso} days — a {delta_days}-day deterioration suggesting either slower customer payments or a shift toward longer-term receivables. At this DSO level, the company has ${ar_balance} of working capital tied up in receivables compared to ${prior_ar_balance} in the prior year."

**qoe_material_adjustment:**
"Reported EBITDA of ${reported_ebitda} includes ${adjustment_amount} of non-recurring {item_description}. Normalized EBITDA of ${adjusted_ebitda} is the appropriate basis for coverage analysis. Using reported EBITDA would overstate coverage by {overstatement_pct}%."

### 5C. Story Panel Generation

The Story Panel (Panel 5) is generated by a structured composition engine that:

1. Identifies the top 3 credit risks from the active red flags
2. Identifies the top 3 credit strengths from above-median ratios
3. Determines whether risks are structural (multi-year trend) or situational (one-time)
4. Generates a resolution narrative: does the global analysis resolve the standalone concern?
5. Proposes covenant structure based on the specific risk profile
6. Identifies comparable deal types from the bank's policy

This is not a language model hallucinating credit analysis. It is a deterministic composition engine that assembles pre-validated narrative blocks based on the actual computed data — making it auditable, consistent, and regulatorily defensible.

---

## SECTION 6: BANK-CONFIGURABLE POLICY LAYER

Every bank has different credit policy. Buddy must enforce the right bank's policy, not a generic one.

```typescript
interface BankCreditPolicy {
  bank_id: string;
  
  // Coverage minimums by deal type
  coverage_minimums: Record<DealType, {
    dscr_minimum: number;
    fccr_minimum?: number;
    global_dscr_minimum?: number;
  }>;
  
  // Leverage maximums by deal type
  leverage_maximums: Record<DealType, {
    debt_ebitda_max?: number;
    ltv_max?: number;
    ltc_max?: number;
  }>;
  
  // Liquidity minimums
  liquidity_minimums: {
    current_ratio_min: number;
    days_cash_min: number;
    post_close_liquidity_pct: number;
  };
  
  // Red flag thresholds (bank can tighten or loosen defaults)
  red_flag_overrides: Partial<Record<string, number>>;
  
  // Which ratios to show in the scorecard for each deal type
  scorecard_config: Record<DealType, string[]>; // canonical_key[]
  
  // Covenant templates by deal type
  covenant_templates: Record<DealType, CovenantTemplate[]>;
}
```

When a bank configures their policy in Buddy, every spread automatically enforces their minimums, shows pass/fail against their thresholds, and generates covenant suggestions from their own templates.

---

## IMPLEMENTATION PRIORITY FOR CLAUDE CODE

### Phase 3A — Spread Template Engine + Deal Type Detection
1. `dealTypeDetection.ts` — detect deal type from documents, entity structure, NAICS
2. `spreadTemplateRegistry.ts` — template configs for all 14 deal types
3. `spreadRenderer.ts` — unified renderer that applies the right template to computed facts

### Phase 3B — The Five Panels
4. `executiveSummaryGenerator.ts` — Panel 1: AI-structured credit narrative
5. `normalizedSpreadTable.ts` — Panel 2: Year-by-year spread with inline adjustments
6. `ratioScorecardRenderer.ts` — Panel 3: Ratio scorecard with peer bars and pass/fail
7. `riskDashboard.ts` — Panel 4: Consolidated red flags by severity
8. `storyPanelGenerator.ts` — Panel 5: Resolution narrative + covenant suggestions

### Phase 3C — Narrative Engine
9. `narrativeTemplates.ts` — all narrative templates for every ratio condition
10. `narrativeComposer.ts` — deterministic composition engine for story panel

### Phase 3D — Bank Policy Layer
11. `bankPolicyEngine.ts` — configurable policy enforcement per bank
12. `covenantSuggestionEngine.ts` — covenant templates by deal type and risk profile

---

## THE DECLARATION

When Phase 3 is complete:

A banker uploads documents for any deal — C&I, CRE, SBA, construction, professional practice, farm, acquisition — and receives back five panels:

1. A credit narrative their CCO will approve of
2. A normalized spread with every adjustment explained
3. A ratio scorecard that tells them what every number means in context
4. A risk dashboard that tells them what to worry about and why
5. A story that resolves the contradictions and suggests a structure

No other tool in commercial lending does this.

Not Moody's. Not Baker Hill. Not nCino. Not Sageworks.

**Buddy is the world's expert. Banks rely on him. This is why.**
