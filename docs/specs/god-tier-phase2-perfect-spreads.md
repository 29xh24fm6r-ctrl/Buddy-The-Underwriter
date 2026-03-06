# GOD TIER PHASE 2 — PERFECT SPREADS SPECIFICATION

**Classification:** Internal — Architectural Specification  
**Version:** 1.0  
**Date:** 2026-03-06  
**Prerequisite:** `docs/specs/god-tier-extraction-spec.md` (Phase 1 complete)  
**Status:** REQUIRED FOR BANK TRUST — PHASE 2

---

## WHERE WE STAND

Phase 1 delivered the extraction and ratio computation foundation:
- 200+ canonical keys across all IRS forms and financial statements
- 37 ratio computations with exact formulas
- K-1, Schedule C, Schedule E, W-2, full 1099 suite extractors
- 10 personal guarantor ratios with 2-year lower-of logic
- 8-metric trend engine with risk signals

**Phase 1 gives Buddy the right numbers. Phase 2 makes those numbers mean something.**

Perfect spreads require 6 additional layers that transform raw extracted data into the kind of analysis a senior credit officer trusts unconditionally.

---

## LAYER 1: ACCOUNTING BASIS DETECTION & NORMALIZATION

### The Problem

Cash basis and accrual basis financials produce materially different spreads for the same business. A cash-basis P&L understates revenue when A/R is growing and overstates it when A/R is shrinking. Comparing two years of cash-basis financials without normalization produces false trend signals.

### Detection Rules

Buddy must detect accounting basis from the following signals, in priority order:

| Signal | Source | Basis Indicated |
|---|---|---|
| "Cash basis" / "Tax basis" notation | Financial statement header | Cash |
| "Accrual basis" notation | Financial statement header | Accrual |
| A/R present on balance sheet AND >5% of revenue | Balance Sheet | Accrual |
| A/R absent from balance sheet | Balance Sheet | Likely cash |
| Inventory present | Balance Sheet | Accrual (GAAP requires) |
| Schedule M-1 Line 1 adjustment present | Form 1120/1120-S | Book-tax diff exists |
| 1065 Schedule M-1 income per books ≠ taxable income | Form 1065 | Book-tax diff |

Canonical key: `accounting_basis` — values: `cash`, `accrual`, `tax_basis`, `unknown`

### Normalization Adjustments (Cash → Accrual)

When financials are cash basis, apply the following adjustments before computing ratios:

```
Accrual Revenue    = Cash Revenue + Ending A/R − Beginning A/R
Accrual COGS       = Cash COGS + Ending Inventory − Beginning Inventory + Ending A/P − Beginning A/P
Accrual Net Income = Accrual Revenue − Accrual COGS − Operating Expenses (accrual-adjusted)
```

Each adjustment must be:
1. Flagged with `basis_adjusted: true` on the canonical fact
2. Sourced to the specific balance sheet line used
3. Presented to the banker as "Accrual-Adjusted" in the spread renderer

### GAAP vs. Tax Basis Differences (Schedule M-1 / M-3)

Schedule M-1 is the IRS's own book-to-tax reconciliation. It tells you exactly where GAAP income diverges from taxable income. **This is the most underutilized data source in commercial underwriting.**

#### Form 1120 / 1120-S Schedule M-1 Extraction

| Line | Description | Canonical Key | Spread Implication |
|---|---|---|---|
| 1 | Net income (loss) per books | `m1_book_income` | GAAP baseline |
| 2 | Federal income tax per books | `m1_federal_tax_book` | Add back to get pre-tax |
| 3 | Excess of capital losses over gains | `m1_excess_cap_loss` | |
| 4 | Income subject to tax not on books | `m1_income_not_on_books` | Non-GAAP income — flag |
| 5a | Depreciation (book vs. tax difference) | `m1_depr_book_tax_diff` | **CRITICAL**: tax depr > book depr = overstated deductions |
| 5b | Amortization (book vs. tax difference) | `m1_amort_book_tax_diff` | |
| 5c | Depletion | `m1_depletion_diff` | |
| 5d | Other | `m1_other_book_additions` | Must itemize |
| 6 | Total of lines 1–5 | `m1_total_additions` | |
| 7a | Income recorded on books not taxed | `m1_income_book_not_tax` | Tax-exempt income |
| 7b | Expenses on books not deducted on return | `m1_expense_book_not_deducted` | Non-deductible expenses |
| 7c | Other reductions | `m1_other_reductions` | |
| 8 | Taxable income | `m1_taxable_income` | Must = Form 1120 Line 30 |

**The depreciation line (5a) is the most important.** When a company takes bonus depreciation or Section 179 on the tax return, the tax depreciation far exceeds book depreciation. The tax return understates earnings. Use BOOK depreciation for cash flow analysis, not tax depreciation.

#### Key Computed Adjustment
```
Book EBITDA = Tax Return EBITDA + (Tax Depreciation − Book Depreciation)
           = is_ebitda + m1_depr_book_tax_diff
```

---

## LAYER 2: QUALITY OF EARNINGS ENGINE

### The Problem

EBITDA is only meaningful if it's recurring. A business with $500K EBITDA that includes $300K of PPP loan forgiveness, $150K insurance proceeds from a flood, and $50K gain on asset sale has $0 recurring EBITDA. Banks lose money when underwriters don't strip non-recurring items.

### Non-Recurring Item Classification

Every income and expense line must be classified as `recurring`, `non_recurring`, or `uncertain`. The classification engine applies these rules:

#### Automatic Non-Recurring Flags

| Line Item Pattern | Classification | Action |
|---|---|---|
| "PPP forgiveness" / "EIDL grant" | Non-recurring income | Exclude from EBITDA |
| "Insurance proceeds" / "Business interruption" | Non-recurring income | Exclude; require documentation |
| "Gain on sale of assets" / Form 4797 gain | Non-recurring income | Exclude; check if routine |
| "Litigation settlement" / "Legal settlement" | Non-recurring income or expense | Flag; require explanation |
| "Disaster loss" / "Fire loss" / "Flood" | Non-recurring expense | Add back with documentation |
| "Severance" / "Restructuring" | Non-recurring expense | Add back with documentation |
| "Moving expense" / "Relocation" | Non-recurring expense | Add back |
| "Start-up costs" / "Pre-opening" | Non-recurring expense | Add back; one-time |
| Bad debt > 200% of prior year average | Elevated; uncertain | Flag for review |
| Legal fees > 150% of prior year | Elevated; uncertain | Flag for review |
| Any single "other income" or "other expense" > 5% of revenue | Uncertain | Require itemization before use |

#### Non-Recurring Income Sources (Automatic Exclusion)

```typescript
const NON_RECURRING_INCOME_PATTERNS = [
  /PPP/i, /paycheck protection/i,
  /EIDL/i, /SBA grant/i,
  /insurance proceeds/i, /business interruption/i,
  /gain on sale/i, /gain on disposal/i,
  /casualty gain/i,
  /litigation/i, /settlement proceeds/i,
  /tax refund/i,
  /forgiven/i, /debt forgiveness/i,
  /employee retention credit/i, /ERC/i,
];
```

#### Quality of Earnings Output

For every deal, Buddy must produce:

```typescript
interface QualityOfEarningsReport {
  reported_ebitda: number;
  adjustments: QoEAdjustment[];
  adjusted_ebitda: number;
  confidence: 'high' | 'medium' | 'low';
  // high = no non-recurring items found or all well-documented
  // medium = some uncertain items flagged, banker review needed
  // low = material non-recurring items found, EBITDA unreliable
}

interface QoEAdjustment {
  line_item: string;
  amount: number;
  direction: 'add_back' | 'deduct';
  classification: 'non_recurring_income' | 'non_recurring_expense' | 'owner_benefit' | 'normalization';
  source: string; // form + line number
  documentation_required: boolean;
  auto_approved: boolean; // true if pattern match is unambiguous
}
```

Canonical keys:
- `qoe_reported_ebitda` — raw EBITDA from extraction
- `qoe_adjusted_ebitda` — after all QoE adjustments
- `qoe_adjustment_total` — sum of all adjustments
- `qoe_confidence` — high/medium/low
- `qoe_adjustments` — JSON array of QoEAdjustment

---

## LAYER 3: OWNER BENEFIT ADD-BACKS

### The Problem

Owner-operated businesses routinely run personal expenses through the company. These are legitimate tax deductions but are NOT real business expenses from a credit perspective — if the owner dies or sells, those costs go away. Identifying them is the single highest-value thing an underwriter does manually. Buddy must do it systematically.

### Categories of Owner Benefits

#### 3A. Above-Market Owner Compensation

If the owner pays themselves $500K/year but a CFO replacement would cost $180K, the $320K difference is an add-back.

**Detection:**
- Officer compensation > $250K on any single officer → flag for reasonableness review
- Officer works < 100% on the business (Line 1125-E) → proportional add-back
- Multiple family members on payroll → each name comparison needed

**Formula:**
```
Compensation Add-back = Officer Compensation − Market Rate Replacement Cost
```

Market rate lookup by title × NAICS × geography (requires industry benchmark data — see Layer 6).

Canonical key: `addback_excess_compensation`

#### 3B. Owner Vehicle / Auto Expenses

- Auto expense or depreciation on a vehicle used personally
- Schedule C Line 9 (car and truck) or Form 4562 vehicle depreciation
- If no mileage log provided, apply IRS business use percentage (typically 50-80% for SMBs)

Canonical key: `addback_auto_personal_use`

#### 3C. Owner Cell Phone / Home Office

- Sch C Line 30 (home office) is always an add-back — it's the owner's home
- Utilities allocated to home office add-back
- Cell phone expenses claimed fully on business

Canonical key: `addback_home_office`, `addback_cell_phone`

#### 3D. Family Member Salaries

If the owner's spouse, children, or relatives are on payroll:
- Flag name matches in W-2 issuees vs. family members listed on 1040
- Apply market rate test: is the salary reasonable for the documented role?
- Add back amounts above reasonable market compensation

Canonical key: `addback_family_compensation`

#### 3E. Owner-Paid Insurance / Benefits

- Life insurance premiums on owner (deductible to S-Corp, personal benefit)
- Health insurance for owner and family (Schedule 1 add-back source)
- Long-term disability insurance

Canonical key: `addback_owner_insurance`

#### 3F. Below/Above-Market Related Party Rent

If the business pays rent to an entity the owner also controls:
- Compare to market rent per square foot
- Below-market rent understates expenses (add expense normalization)
- Above-market rent overstates expenses (add back excess)

Canonical key: `addback_rent_normalization`, `rent_normalization_direction`

#### 3G. Travel, Meals, Entertainment

- Meals at 50% deductible rate — assess if personal in nature
- Travel for owner/family mixed business/personal trips
- Club dues, entertainment venues

Canonical key: `addback_personal_travel_meals`

### Owner Benefit Add-Back Summary Output

```typescript
interface OwnerBenefitSummary {
  total_addbacks: number;
  adjusted_ebitda: number; // after owner benefit adds
  items: OwnerBenefitItem[];
  documentation_gaps: string[]; // items needing supporting docs
}
```

---

## LAYER 4: ADDITIONAL IRS FORMS

### 4A. Form 4562 — Depreciation & Amortization

This form is the source of truth for every depreciation deduction. Without it, you don't know if the $400K depreciation on the tax return is:
- Section 179 immediate expensing of equipment (one-time, not recurring)
- Bonus depreciation (50-100% first-year, distorts every subsequent year)
- Normal MACRS straight-line (recurring, predictable)
- Amortization of intangibles (goodwill from acquisition — flag heavily)

| Line | Description | Canonical Key | Notes |
|---|---|---|---|
| Part I | Section 179 elections total | `f4562_sec179_total` | One-time expensing; add back for normalized EBITDA |
| Part II Line 14 | Special depreciation allowance (bonus) | `f4562_bonus_depreciation` | Front-loaded; normalize to straight-line |
| Part II Line 17 | MACRS deductions | `f4562_macrs_total` | Normal tax depreciation |
| Part III | ACRS deductions | `f4562_acrs_total` | Legacy assets |
| Part IV Line 22 | Total listed property depreciation | `f4562_listed_property` | Vehicles, computers — mixed use flag |
| Part VI | Amortization of intangibles | `f4562_amortization_total` | Non-cash; always add back |

**Critical Computed Adjustment:**
```
Normalized Depreciation = Total Book Depreciation (from financials, not tax return)
                        = f4562_macrs_total × (1 / average_macrs_life)
                        
// Section 179 / bonus depreciation distorts the tax return year
// Use straight-line equivalent for DSCR computation
Normalized Depr Add-back = f4562_sec179_total + f4562_bonus_depreciation (amortized over useful life)
```

### 4B. Form 4797 — Sales of Business Property

Not all Form 4797 income is non-recurring. A car dealership selling trade-ins is operating income. A manufacturer selling a factory is a one-time event.

| Part | Description | Canonical Key | Classification Rule |
|---|---|---|---|
| Part I | Long-term gains (held >1 year) | `f4797_lt_gain` | Non-recurring unless pattern over 3 years |
| Part II | Ordinary gains (§1245/§1250 recapture) | `f4797_ordinary_gain` | Recapture = tax artifact; non-recurring |
| Part III | Section 1231 gains/losses | `f4797_1231_gain` | Check for 3-year pattern |

**Rule:** If Form 4797 income appears in 2 of 3 years, reclassify as recurring. If only 1 year, exclude from EBITDA.

Canonical key: `f4797_recurring_classification` — `recurring` / `non_recurring` / `uncertain`

### 4C. Form 1125-A — Cost of Goods Sold Detail

| Line | Description | Canonical Key | Notes |
|---|---|---|---|
| 1 | Inventory at beginning of year | `f1125a_begin_inventory` | Cross-ref prior year ending inventory |
| 2 | Purchases | `f1125a_purchases` | |
| 3 | Cost of labor | `f1125a_direct_labor` | |
| 4 | Additional §263A costs | `f1125a_263a_costs` | Uniform capitalization rules |
| 5 | Other costs | `f1125a_other_costs` | Itemize |
| 6 | Total | `f1125a_total_before_closing` | |
| 7 | Inventory at end of year | `f1125a_end_inventory` | Cross-ref balance sheet |
| 8 | **Cost of goods sold** | `f1125a_cogs` | Must = tax return COGS line |
| 9a | Inventory method | `f1125a_inventory_method` | FIFO / LIFO / specific identification |
| 9b | LIFO election | `f1125a_lifo_elected` | If yes, LIFO reserve required for normalization |

**LIFO Reserve Normalization:**  
If a company uses LIFO inventory accounting, their balance sheet understates inventory during inflationary periods. To compare fairly with FIFO companies:
```
FIFO Inventory = LIFO Inventory + LIFO Reserve (from balance sheet footnote)
FIFO COGS      = LIFO COGS − Change in LIFO Reserve
```

### 4D. Form 1125-E — Compensation of Officers

| Column | Description | Canonical Key |
|---|---|---|
| (a) | Name of officer | `f1125e_officer_name[]` |
| (b) | SSN (last 4) | `f1125e_officer_ssn_last4[]` |
| (c) | % of time devoted to business | `f1125e_time_pct[]` |
| (d) | % of stock owned — common | `f1125e_stock_pct_common[]` |
| (e) | % of stock owned — preferred | `f1125e_stock_pct_preferred[]` |
| (f) | Amount of compensation | `f1125e_compensation[]` |

**Critical rule:** If officer devotes <100% of time to the business, their compensation must be normalized:
```
Full-Time Equivalent Compensation = Reported Compensation / Time_Pct
// If FTE > market rate → add back excess
// If owner works 50% at $300K → FTE equivalent is $600K → likely above market
```

### 4E. Schedule M-1 / M-2 / M-3 (Book-Tax Reconciliation)

See Layer 1 for M-1 extraction. Additionally:

**Schedule M-2 — Analysis of Unappropriated Retained Earnings**

| Line | Description | Canonical Key |
|---|---|---|
| 1 | Balance at beginning of year | `m2_retained_earnings_begin` |
| 2 | Net income per books | `m2_net_income_books` |
| 3 | Other increases | `m2_other_increases` |
| 5 | Distributions | `m2_distributions` |
| 6 | Other decreases | `m2_other_decreases` |
| 7 | Balance at end of year | `m2_retained_earnings_end` |

Cross-reference: `m2_retained_earnings_end` must equal `bs_retained_earnings`. Flag if different — either the balance sheet is stale or the tax return has errors.

### 4F. Schedule L — Balance Sheet Per Tax Return

Every Form 1120, 1120-S, and 1065 includes a balance sheet (Schedule L). This is a second source of balance sheet data that must be reconciled against separately-provided financial statements.

| Asset Lines | Canonical Key |
|---|---|
| Cash | `sl_cash` |
| Trade notes and accounts receivable | `sl_ar_gross` |
| Less allowance for bad debts | `sl_ar_allowance` |
| Inventories | `sl_inventory` |
| U.S. government obligations | `sl_us_gov_obligations` |
| Tax-exempt securities | `sl_tax_exempt_securities` |
| Other current assets | `sl_other_current_assets` |
| Loans to shareholders | `sl_shareholder_loans_receivable` |
| Mortgage and real estate loans | `sl_mortgage_loans` |
| Other investments | `sl_other_investments` |
| Buildings and other depreciable assets | `sl_ppe_gross` |
| Less accumulated depreciation | `sl_accumulated_depreciation` |
| Depletable assets | `sl_depletable_assets` |
| Land | `sl_land` |
| Intangible assets | `sl_intangibles_gross` |
| Less accumulated amortization | `sl_accumulated_amortization` |
| Other assets | `sl_other_assets` |
| **Total assets** | `sl_total_assets` |

**Reconciliation Rule:**
```
if abs(sl_total_assets - bs_total_assets) / bs_total_assets > 0.03:
  flag "BALANCE SHEET DISCREPANCY: Tax return vs. financial statement variance >3%"
  require explanation before proceeding
```

### 4G. Form 8825 — Rental Real Estate Income/Expense (Partnerships)

For partnerships (Form 1065) with real estate, Form 8825 provides per-property detail that Schedule E on the 1040 provides for individuals.

| Column | Description | Canonical Key |
|---|---|---|
| (a) | Property description | `f8825_property_desc[]` |
| (b) | Kind of property | `f8825_property_type[]` |
| (c) | Fair rental days | `f8825_fair_rental_days[]` |
| (d) | Personal use days | `f8825_personal_use_days[]` |
| (e) | Gross rents | `f8825_gross_rents[]` |
| (f)–(p) | Expense detail (taxes, mortgage int., depreciation, etc.) | `f8825_expenses_[]` |
| (q) | Net income (loss) | `f8825_net_income[]` |

---

## LAYER 5: INTERCOMPANY & CONSOLIDATED ANALYSIS

### The Problem

A borrower almost always has multiple related entities. The banker needs a consolidated picture. Without consolidation, intercompany transactions inflate both revenue and expenses — a double-count that makes the business look both larger and less profitable than it is.

### Entity Relationship Mapping

Buddy must build an entity map for every deal:

```typescript
interface EntityMap {
  entities: BorrowerEntity[];
  relationships: EntityRelationship[];
  consolidation_required: boolean;
  common_control_entities: string[]; // entities controlled by same owner(s)
}

interface EntityRelationship {
  from_entity_id: string;
  to_entity_id: string;
  relationship_type: 'parent' | 'subsidiary' | 'affiliate' | 'common_control';
  ownership_pct: number;
  intercompany_transactions: IntercompanyTransaction[];
}

interface IntercompanyTransaction {
  type: 'rent' | 'management_fee' | 'loan' | 'services' | 'goods';
  annual_amount: number;
  source: string; // which form/line this was detected on
  elimination_required: boolean;
}
```

### Intercompany Detection Rules

| Signal | Source | Transaction Type |
|---|---|---|
| Schedule E rental income from entity the owner controls | 1040 Sch E vs. K-1 ownership | Rent elimination |
| Management fees paid between entities | P&L line item | Management fee elimination |
| Related party loans on Schedule L | Balance sheet | Loan elimination |
| Guaranteed payments from one entity to another | K-1 Box 4 | Services elimination |
| Same address, same EIN prefix, same owner | Identity matching | Flag for review |

### Consolidation Methodology

When intercompany transactions are identified:
1. **Eliminate revenue**: Remove intercompany income from the revenue entity
2. **Eliminate expense**: Remove corresponding intercompany expense from the paying entity
3. **Eliminate loans**: Remove intercompany receivables and payables
4. **Aggregate remaining**: Sum all remaining revenues, expenses, assets, liabilities

```
Consolidated Revenue  = Sum(entity revenues) − Sum(intercompany revenues)
Consolidated EBITDA   = Sum(entity EBITDAs) − Sum(intercompany margins)
Consolidated Assets   = Sum(entity assets) − Sum(intercompany receivables)
Consolidated Debt     = Sum(entity debt) − Sum(intercompany loans)
```

Canonical keys:
- `consolidated_revenue` — post-elimination
- `consolidated_ebitda` — post-elimination
- `consolidated_total_assets` — post-elimination
- `consolidated_total_debt` — post-elimination
- `consolidated_dscr` — using consolidated figures
- `intercompany_elimination_total` — total amount eliminated
- `consolidation_confidence` — `high` / `medium` / `low`

---

## LAYER 6: INDUSTRY BENCHMARKING

### The Problem

Every ratio is relative. Without knowing what "normal" looks like for a given industry, Buddy's output is data without judgment.

### Benchmark Database Structure

```typescript
interface IndustryBenchmark {
  naics_code: string;
  naics_description: string;
  revenue_range: 'under_1m' | '1m_5m' | '5m_25m' | '25m_100m' | 'over_100m';
  benchmarks: {
    [metric_key: string]: {
      p25: number;   // 25th percentile (weak)
      p50: number;   // median
      p75: number;   // 75th percentile (strong)
      p90: number;   // 90th percentile (exceptional)
    }
  }
}
```

### Priority Benchmark Metrics by NAICS Group

Every ratio in Sections 5A–5D of the God Tier spec must be benchmarked. The most critical by industry type:

#### For All Industries
- Gross margin %
- EBITDA margin %
- Debt/EBITDA
- DSCR
- Current ratio
- Revenue growth rate

#### For Product/Manufacturing (NAICS 31–33)
- Inventory turnover (highly variable by product)
- DIO — critical; 30 days vs. 180 days can both be normal depending on industry
- Gross margin (steel distributor: 15%; specialty chemical: 55%)

#### For Service Industries (NAICS 54, 62, 72)
- Revenue per employee (primary efficiency metric)
- Days cash on hand (no inventory buffer)
- Employee cost as % of revenue

#### For CRE / Real Estate (NAICS 53)
- Cap rate vs. market (by MSA and property type)
- NOI margin
- WALT vs. lease expirations in loan term

#### For Distribution / Wholesale (NAICS 42)
- DSO (30–50 days normal; 70+ days = concern)
- DPO (30–60 days; if >90 = vendor stress signal)
- Inventory turnover (6–12x normal)

### Benchmark Output on Each Ratio

Every ratio surfaced to a banker must include:

```typescript
interface RatioBenchmarkOutput {
  value: number;
  canonical_key: string;
  industry_naics: string;
  percentile: number;       // where this borrower falls in their industry
  assessment: 'strong' | 'adequate' | 'weak' | 'concerning';
  peer_median: number;
  peer_p25: number;
  peer_p75: number;
  narrative: string;  // "DSO of 72 days is at the 38th percentile for NAICS 4230 (wholesale durable goods); industry median is 45 days"
}
```

### Benchmark Data Sources

Primary sources for benchmark database population:
1. **RMA Annual Statement Studies** — the gold standard for bank lending benchmarks by industry/size
2. **IRS SOI (Statistics of Income)** — actual tax return data by industry
3. **Federal Reserve FFIEC Call Report data** — for financial institutions
4. **BLS Occupational Employment Statistics** — for compensation benchmarking

Buddy's benchmark database should be seeded with RMA-equivalent values for the 50 most common NAICS codes seen in commercial lending, covering all 5 revenue size tiers.

---

## LAYER 7: SPREAD NORMALIZATION & FINAL CASH FLOW COMPUTATION

This is the synthesis layer — where all the above comes together into the number banks actually use to make decisions.

### The Canonical Cash Flow Waterfall

Every spread must produce a single, auditable cash flow number through this exact waterfall:

```
STEP 1: Start with Net Income (tax return, most authoritative)
        = is_net_income (or ordinary_business_income for pass-throughs)

STEP 2: Add back non-cash items
        + is_depreciation (from financial statements or tax return)
        + is_amortization
        + f4562_sec179_total (normalized over useful life, not taken all at once)
        + f4562_bonus_depreciation (normalized)

STEP 3: Add back interest expense
        + is_interest_expense
        (to get to EBITDA — before financing costs)

STEP 4: Quality of Earnings adjustments
        − qoe_non_recurring_income_total (PPP, insurance proceeds, gains)
        + qoe_non_recurring_expense_total (one-time losses, with documentation)
        = Adjusted EBITDA

STEP 5: Owner benefit add-backs
        + addback_excess_compensation
        + addback_owner_insurance
        + addback_auto_personal_use
        + addback_home_office
        + addback_personal_travel_meals
        + addback_family_compensation
        ± addback_rent_normalization
        = Owner-Adjusted EBITDA

STEP 6: Subtract taxes (for C-Corps; pass-throughs pay at personal level)
        − normalized_tax_provision (use effective rate, not distorted year)
        
STEP 7: Subtract capital expenditures
        − maintenance_capex (recurring CapEx; exclude expansion CapEx)
        = Net Cash Available for Debt Service (NCADS)

STEP 8: Subtract existing debt service (all obligations, no exceptions)
        − annual_debt_service_total (P+I on all funded debt + revolvers at max draw)
        = Cash Available After Debt Service (CAADS)

STEP 9: DSCR
        DSCR = NCADS / annual_debt_service_total
```

Each step must be traceable to specific canonical keys and source documents. No black boxes.

### Canonical Keys for the Waterfall

| Step | Canonical Key | Description |
|---|---|---|
| 1 | `cf_net_income_base` | Starting point |
| 2 | `cf_noncash_addbacks` | D&A + normalized 179/bonus |
| 3 | `cf_interest_addback` | To EBITDA |
| 4a | `cf_ebitda_reported` | Pre-QoE |
| 4b | `cf_qoe_adjustment` | QoE net adjustment |
| 4c | `cf_ebitda_adjusted` | Post-QoE |
| 5a | `cf_owner_benefit_addbacks` | Owner benefits total |
| 5b | `cf_ebitda_owner_adjusted` | Post-owner-benefits |
| 6 | `cf_tax_provision_normalized` | Normalized taxes (C-Corp) |
| 7 | `cf_maintenance_capex` | Recurring CapEx |
| 7b | `cf_ncads` | Net Cash Available for Debt Service |
| 8 | `cf_annual_debt_service` | ALL debt P+I |
| 9 | `cf_caads` | Cash After Debt Service |
| 9b | `ratio_dscr_final` | The number |

---

## RED FLAG ADDITIONS FOR PHASE 2

In addition to Phase 1 red flags, add:

| Condition | Flag Level | Source Layer |
|---|---|---|
| Accounting basis = cash AND A/R > 20% of revenue | ELEVATED RISK | Layer 1 |
| Book income vs. taxable income variance > 25% | INVESTIGATE | Layer 1 |
| QoE confidence = low | EARNINGS QUALITY CONCERN | Layer 2 |
| Non-recurring income > 20% of reported EBITDA | MATERIAL ADJUSTMENT | Layer 2 |
| Owner compensation > 3× market rate | INVESTIGATE | Layer 3 |
| Section 179 + bonus depreciation > 50% of total depreciation | NORMALIZED DEPR REQUIRED | Layer 4 |
| Schedule L total assets vs. financial statement variance > 3% | RECONCILIATION REQUIRED | Layer 4 |
| Intercompany revenue > 10% of total revenue | CONSOLIDATION REQUIRED | Layer 5 |
| LIFO inventory method elected | LIFO RESERVE ADJUSTMENT REQUIRED | Layer 4 |
| Industry benchmarks: ratio at <25th percentile in 2+ metrics | PEER GROUP UNDERPERFORMANCE | Layer 6 |
| Normalized DSCR (post-QoE) < 1.0× even if reported DSCR > 1.25× | EARNINGS QUALITY FAIL | Layer 7 |

---

## IMPLEMENTATION PRIORITY

### Phase 2A — Highest Impact (implement first)

1. **QoE Engine** (Layer 2) — single highest-value addition; prevents bad approvals
2. **Form 4562 extractor** (Layer 4A) — depreciation normalization affects every EBITDA computation
3. **Cash Flow Waterfall** (Layer 7) — the canonical number every spread must produce
4. **Schedule M-1 extraction** (Layer 1) — book vs. tax reconciliation

### Phase 2B — High Impact

5. **Owner benefit add-backs** (Layer 3) — massive value for owner-operated businesses
6. **Form 1125-A extractor** (Layer 4C) — COGS detail + inventory method
7. **Form 1125-E extractor** (Layer 4D) — officer compensation detail
8. **Schedule L reconciliation** (Layer 4F) — balance sheet cross-check

### Phase 2C — Structural

9. **Intercompany detection & consolidation** (Layer 5) — complex but necessary for multi-entity borrowers
10. **Industry benchmark database** (Layer 6) — requires data sourcing; seed with RMA-equivalent for top 50 NAICS codes
11. **Accounting basis detection & normalization** (Layer 1 full) — cash-to-accrual conversion

---

## DEFINITION OF PERFECT SPREADS

Buddy produces perfect spreads when:

1. Every number is traced to a specific IRS line, form version, and tax year
2. Accounting basis is detected and normalization applied before any ratio is computed
3. Non-recurring items are identified, excluded, and documented
4. Owner benefits are systematically identified and added back
5. The cash flow waterfall is fully populated with no skipped steps
6. Intercompany transactions are eliminated before consolidation
7. Every ratio is contextualized against industry peers
8. The final DSCR reflects normalized, recurring, fully-loaded cash flows
9. A banker can present the spread to any credit committee without re-doing the analysis
10. The spread is reproducible — same inputs produce the same outputs, always

**When these 10 conditions are met for every deal, Buddy is producing perfect spreads.**
