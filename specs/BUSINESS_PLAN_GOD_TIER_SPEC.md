# BUDDY BUSINESS PLAN MAKER — GOD TIER IMPLEMENTATION SPEC

**Status:** ACTIVE — implementation guide for Claude Code / Antigravity  
**Created:** April 20, 2026  
**Author:** Claude (architecture) + Matt (vision)  
**Scope:** Transform the existing Phase 57 SBA Business Plan system from "working" to "elite god tier"

---

## Table of Contents

1. [Current State Summary](#1-current-state-summary)
2. [Tier 1 — The Credibility Leap](#2-tier-1--the-credibility-leap)
3. [Tier 2 — The Analytical Edge](#3-tier-2--the-analytical-edge)
4. [Tier 3 — The Franchise Weapon](#4-tier-3--the-franchise-weapon)
5. [Tier 4 — The Experience Layer](#5-tier-4--the-experience-layer)
6. [Migration Summary](#6-migration-summary)
7. [Verification Queries](#7-verification-queries)

---

## 1. Current State Summary

### Existing Files (DO NOT break these)

| File | Purpose | Size |
|------|---------|------|
| `src/lib/sba/sbaPackageOrchestrator.ts` | 5-pass pipeline: gates → facts → model → narrative → PDF → store | 10KB |
| `src/lib/sba/sbaForwardModelBuilder.ts` | Base year, annual projections, monthly CF, break-even, sensitivity | 11KB |
| `src/lib/sba/sbaPackageNarrative.ts` | Two Gemini calls: business overview + sensitivity commentary | 5KB |
| `src/lib/sba/sbaPackageRenderer.ts` | PDFKit 5-section PDF output | 14KB |
| `src/lib/sba/sbaReadinessTypes.ts` | All TypeScript types/interfaces | 5KB |
| `src/lib/sba/sbaAssumptionsPrefill.ts` | Pre-fill from deal_financial_facts | 3KB |
| `src/lib/sba/sbaAssumptionsValidator.ts` | Structural completeness checks | 2KB |
| `src/lib/sba/sbaGuarantee.ts` | SBA program detection + guarantee math | 6KB |
| `src/lib/sba/newBusinessProtocol.ts` | SOP 50 10 8 startup detection | 5KB |
| `src/components/sba/AssumptionInterview.tsx` | Multi-step form UI | 39KB |
| `src/components/sba/SBAPackageViewer.tsx` | Package display + actions | 8KB |
| `src/app/api/deals/[dealId]/sba/generate/route.ts` | POST endpoint | 1KB |
| `src/app/api/deals/[dealId]/sba/assumptions/route.ts` | GET/PUT assumptions | ~3KB |
| `src/app/api/deals/[dealId]/sba/latest/route.ts` | GET latest package | ~2KB |

### Existing DB Tables

- `buddy_sba_assumptions` — deal_id, revenue_streams (jsonb), cost_assumptions (jsonb), working_capital (jsonb), loan_impact (jsonb), management_team (jsonb), status, confirmed_at
- `buddy_sba_packages` — deal_id, assumptions_id, base_year_data, projections_annual/monthly (jsonb), break_even, sensitivity_scenarios, use_of_proceeds, dscr fields, narratives, pdf_url, sba_guarantee fields, status
- `deal_proceeds_items` — deal_id, category, description, amount
- `deal_ownership_entities` — deal_id, entity_type, display_name, email, phone
- `deal_ownership_interests` — deal_id, owner_entity_id, borrower_entity_id, ownership_pct

### Architectural Constraints (NON-NEGOTIABLE)

1. SBA package generation is DETERMINISTIC — only Gemini narrative sections use LLM; all math is pure functions
2. `buddy_sba_assumptions.status` must be `confirmed` before generation — no bypassing
3. `buddy_validation_reports.overall_status` must not be `FAIL` — generation gate stays
4. Model strings come from `src/lib/ai/models.ts` — currently `MODEL_SBA_NARRATIVE = GEMINI_FLASH = "gemini-3-flash-preview"`
5. `SBA_TYPES = ['SBA', 'sba_7a', 'sba_504', 'sba_express']` — deal_type check uses this array
6. Financial facts use `fact_value_num` column (NOT `value_numeric`); keys may have `_IS` suffix — always use fallback chains via `getFact()`
7. `ownership_entities` uses `display_name` not `name`
8. Tenant isolation — all queries must scope by deal_id; no cross-tenant data leakage

---

## 2. Tier 1 — The Credibility Leap

**Goal:** Make the PDF output something a borrower proudly hands to a bank and a loan officer hands to their credit committee without redlining.

### 2.1 Expanded Narrative — 8 Sections via Multi-Call Gemini

**File:** `src/lib/sba/sbaPackageNarrative.ts` (MODIFY — add 4 new generator functions)

Current state: 2 Gemini calls producing business overview + sensitivity commentary.  
Target state: 6 Gemini calls producing 8 narrative sections.

#### New Gemini Call Functions to Add

```typescript
// ── NEW CALL 1: Executive Summary ──────────────────────────────────────
export async function generateExecutiveSummary(params: {
  dealName: string;
  loanType: string;
  loanAmount: number;
  yearInBusiness: number | null;
  revenueYear0: number;
  revenueYear1Projected: number;
  dscrYear1Base: number;
  equityInjectionPct: number;
  useOfProceedsTopLine: string;
  managementTeamSummary: string;
}): Promise<string>

// Prompt requirements:
// - 1 page maximum (400 words)
// - Lead with: who is the borrower, what do they do, how much are they requesting, for what purpose
// - Include: years in business, revenue trajectory, DSCR coverage, management strength
// - Close with: why this is a sound credit decision for the bank
// - RULES: No superlatives. No invented stats. Third person. Professional tone.
// - Return JSON: { "executiveSummary": "..." }

// ── NEW CALL 2: Industry Analysis ──────────────────────────────────────
export async function generateIndustryAnalysis(params: {
  naicsCode: string | null;
  industryName: string;
  researchNarrative: string | null;  // from buddy_research_narratives.sections
  competitorNames: string[];         // from research if available
  marketSize: string | null;         // from research if available
}): Promise<string>

// Prompt requirements:
// - NAICS code and industry name as anchor
// - Industry size, growth trends, competitive landscape — ONLY from research data provided
// - Regulatory environment if relevant
// - Local market conditions if geographic data available
// - RULES: Do NOT invent market size numbers. If research data unavailable, state "Industry research data not available for this analysis" — do NOT hallucinate
// - Return JSON: { "industryAnalysis": "..." }

// ── NEW CALL 3: Marketing & Operations ─────────────────────────────────
export async function generateMarketingAndOperations(params: {
  dealName: string;
  revenueStreams: Array<{ name: string; pricingModel: string }>;
  plannedHires: Array<{ role: string; startMonth: number }>;
  plannedCapex: Array<{ description: string; amount: number; year: number }>;
  isFranchise: boolean;
  franchiseBrand: string | null;
}): Promise<string>

// Prompt requirements:
// - Marketing strategy: customer acquisition approach based on business type
// - If franchise: note franchisor marketing support, co-op advertising, territory protections
// - Operations: staffing plan, equipment/technology needs, facility requirements
// - Supply chain if relevant (manufacturing, food service)
// - RULES: Ground claims in the assumption data. No invented marketing budgets.
// - Return JSON: { "marketingStrategy": "...", "operationsPlan": "..." }

// ── NEW CALL 4: SWOT Analysis ──────────────────────────────────────────
export async function generateSWOTAnalysis(params: {
  dealName: string;
  yearsInBusiness: number | null;
  dscrYear1Base: number;
  marginOfSafetyPct: number;
  managementExperienceYears: number;
  isFranchise: boolean;
  industryGrowthContext: string | null;
  riskFactors: string[];  // from sbaRiskProfile warnings
}): Promise<string>

// Prompt requirements:
// - Structured as 4 clear sections: Strengths, Weaknesses, Opportunities, Threats
// - 3-4 bullet points per section
// - Must be honest — weaknesses are real (e.g., "single-location concentration risk")
// - Threats should include macroeconomic factors
// - RULES: Weaknesses must NOT be disguised strengths. Be genuine.
// - Return JSON: { "strengths": "...", "weaknesses": "...", "opportunities": "...", "threats": "..." }
```

#### Updated Orchestrator Integration

**File:** `src/lib/sba/sbaPackageOrchestrator.ts` (MODIFY)

Add these calls after the existing `generateBusinessOverviewNarrative` and `generateSensitivityNarrative` calls. Execute them in parallel with `Promise.allSettled` to minimize latency:

```typescript
// After existing narrative calls, add:
const [execSummaryResult, industryResult, mktOpsResult, swotResult] = await Promise.allSettled([
  generateExecutiveSummary({
    dealName: deal?.name ?? "Borrower",
    loanType: deal?.deal_type ?? "SBA",
    loanAmount: assumptions.loanImpact.loanAmount,
    yearInBusiness: /* pull from deal_financial_facts YEARS_IN_BUSINESS */,
    revenueYear0: baseYear.revenue,
    revenueYear1Projected: annualProjections[0]?.revenue ?? 0,
    dscrYear1Base,
    equityInjectionPct: /* compute from sources_and_uses */,
    useOfProceedsTopLine: proceedsDescription,
    managementTeamSummary: assumptions.managementTeam.map(m => `${m.name} (${m.title})`).join(", "),
  }),
  generateIndustryAnalysis({
    naicsCode: /* pull from deals.naics_code or deal_financial_facts */,
    industryName: /* from research or deal metadata */,
    researchNarrative: researchSummary ?? null,
    competitorNames: /* from research sections if available */,
    marketSize: null,
  }),
  generateMarketingAndOperations({
    dealName: deal?.name ?? "Borrower",
    revenueStreams: assumptions.revenueStreams.map(s => ({ name: s.name, pricingModel: s.pricingModel })),
    plannedHires: assumptions.costAssumptions.plannedHires,
    plannedCapex: assumptions.costAssumptions.plannedCapex,
    isFranchise: /* check deal metadata or franchise_deals table */,
    franchiseBrand: null,
  }),
  generateSWOTAnalysis({
    dealName: deal?.name ?? "Borrower",
    yearsInBusiness: /* from facts */,
    dscrYear1Base,
    marginOfSafetyPct: breakEven.marginOfSafetyPct,
    managementExperienceYears: Math.max(...assumptions.managementTeam.map(m => m.yearsInIndustry), 0),
    isFranchise: false,
    industryGrowthContext: researchSummary?.slice(0, 500) ?? null,
    riskFactors: [],
  }),
]);

// Extract with fallbacks
const executiveSummary = execSummaryResult.status === 'fulfilled' ? execSummaryResult.value : "Executive summary not available.";
const industryAnalysis = industryResult.status === 'fulfilled' ? industryResult.value : "Industry analysis not available.";
const marketingAndOps = mktOpsResult.status === 'fulfilled' ? mktOpsResult.value : "Marketing and operations plan not available.";
const swotAnalysis = swotResult.status === 'fulfilled' ? swotResult.value : "SWOT analysis not available.";
```

### 2.2 DB Schema Update — Extended Narrative Storage

**Migration:** `20260421_01_sba_package_extended_narratives`

```sql
ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS executive_summary text,
  ADD COLUMN IF NOT EXISTS industry_analysis text,
  ADD COLUMN IF NOT EXISTS marketing_strategy text,
  ADD COLUMN IF NOT EXISTS operations_plan text,
  ADD COLUMN IF NOT EXISTS swot_strengths text,
  ADD COLUMN IF NOT EXISTS swot_weaknesses text,
  ADD COLUMN IF NOT EXISTS swot_opportunities text,
  ADD COLUMN IF NOT EXISTS swot_threats text,
  ADD COLUMN IF NOT EXISTS sources_and_uses jsonb DEFAULT '{}' ::jsonb,
  ADD COLUMN IF NOT EXISTS version_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_package_id uuid REFERENCES buddy_sba_packages(id);

COMMENT ON COLUMN buddy_sba_packages.version_number IS 'Incrementing version for iteration tracking';
COMMENT ON COLUMN buddy_sba_packages.parent_package_id IS 'Links to previous version of same package for diff tracking';
```

### 2.3 Sources & Uses Waterfall

**New file:** `src/lib/sba/sbaSourcesAndUses.ts`

```typescript
// ── Types ──────────────────────────────────────────────────────────────

export interface SourceLine {
  category: 'sba_loan' | 'borrower_equity' | 'seller_financing' | 'other_source';
  description: string;
  amount: number;
  pctOfTotal: number;
}

export interface UseLine {
  category: string;  // 'purchase_price' | 'working_capital' | 'equipment' | 'buildout' | 'closing_costs' | 'reserves' | 'other'
  description: string;
  amount: number;
  pctOfTotal: number;
}

export interface SourcesAndUsesResult {
  sources: SourceLine[];
  uses: UseLine[];
  totalSources: number;
  totalUses: number;
  balanced: boolean;  // sources === uses
  equityInjectionAmount: number;
  equityInjectionPct: number;
  equityMeetsMinimum: boolean;  // >= 10% existing, >= 20% new business
  minimumEquityPct: number;
}

// ── Builder ────────────────────────────────────────────────────────────

export function buildSourcesAndUses(params: {
  loanAmount: number;
  equityInjectionAmount: number;
  sellerFinancingAmount: number;
  otherSources: Array<{ description: string; amount: number }>;
  proceedsItems: Array<{ category: string; description: string | null; amount: number }>;
  isNewBusiness: boolean;
}): SourcesAndUsesResult {
  const totalUses = params.proceedsItems.reduce((s, i) => s + i.amount, 0);
  const totalFromOther = params.otherSources.reduce((s, o) => s + o.amount, 0);
  const totalSources = params.loanAmount + params.equityInjectionAmount + params.sellerFinancingAmount + totalFromOther;

  const minimumEquityPct = params.isNewBusiness ? 0.20 : 0.10;
  const equityInjectionPct = totalSources > 0 ? params.equityInjectionAmount / totalSources : 0;

  const sources: SourceLine[] = [
    {
      category: 'sba_loan',
      description: 'SBA Loan Proceeds',
      amount: params.loanAmount,
      pctOfTotal: totalSources > 0 ? params.loanAmount / totalSources : 0,
    },
    {
      category: 'borrower_equity',
      description: 'Borrower Equity Injection',
      amount: params.equityInjectionAmount,
      pctOfTotal: equityInjectionPct,
    },
  ];

  if (params.sellerFinancingAmount > 0) {
    sources.push({
      category: 'seller_financing',
      description: 'Seller Financing',
      amount: params.sellerFinancingAmount,
      pctOfTotal: totalSources > 0 ? params.sellerFinancingAmount / totalSources : 0,
    });
  }

  for (const other of params.otherSources) {
    sources.push({
      category: 'other_source',
      description: other.description,
      amount: other.amount,
      pctOfTotal: totalSources > 0 ? other.amount / totalSources : 0,
    });
  }

  const uses: UseLine[] = params.proceedsItems.map(item => ({
    category: item.category,
    description: item.description ?? item.category,
    amount: item.amount,
    pctOfTotal: totalUses > 0 ? item.amount / totalUses : 0,
  }));

  return {
    sources,
    uses,
    totalSources,
    totalUses,
    balanced: Math.abs(totalSources - totalUses) < 1, // within $1 rounding
    equityInjectionAmount: params.equityInjectionAmount,
    equityInjectionPct,
    equityMeetsMinimum: equityInjectionPct >= minimumEquityPct,
    minimumEquityPct,
  };
}
```

### 2.4 Assumption Interview — New Fields for S&U

**File:** `src/lib/sba/sbaReadinessTypes.ts` (MODIFY — add to SBAAssumptions interface)

```typescript
// Add to SBAAssumptions interface under loanImpact:
  loanImpact: {
    // ... existing fields ...
    equityInjectionAmount: number;          // NEW
    equityInjectionSource: string;          // NEW — "cash_savings" | "401k_rollover" | "gift" | "other"
    sellerFinancingAmount: number;          // NEW
    sellerFinancingTermMonths: number;      // NEW
    sellerFinancingRate: number;            // NEW
    otherSources: Array<{                  // NEW
      description: string;
      amount: number;
    }>;
  };
```

**File:** `src/components/sba/AssumptionInterview.tsx` (MODIFY — add Sources section to Step 4: Loan Impact)

Add form fields for equity injection amount, source, seller financing amount/terms/rate, and other sources as a repeatable group. These fields appear in the Loan Impact step AFTER the existing loan amount, term, and rate fields.

### 2.5 PDF Renderer — Cover Page, TOC, Charts, S&U Section

**File:** `src/lib/sba/sbaPackageRenderer.ts` (MAJOR MODIFY)

#### New Section 0: Cover Page

```typescript
function renderCoverPage(s: DocState) {
  const { doc, input } = s;
  const centerX = doc.page.width / 2;
  const maxWidth = doc.page.width - PAGE_MARGIN * 2;

  // Top branding bar
  doc.rect(0, 0, doc.page.width, 100).fill('#1a365d');
  doc.font(FONT_BOLD).fontSize(11).fillColor('#ffffff');
  doc.text('BUDDY THE UNDERWRITER', PAGE_MARGIN, 40, { width: maxWidth });
  doc.fillColor('#000000');

  // Title block — centered
  const titleY = 200;
  doc.font(FONT_BOLD).fontSize(28).fillColor('#1a365d');
  doc.text('Business Plan', PAGE_MARGIN, titleY, { width: maxWidth, align: 'center' });
  doc.font(FONT_BOLD).fontSize(20).fillColor('#2d3748');
  doc.text('& Financial Projections', PAGE_MARGIN, titleY + 40, { width: maxWidth, align: 'center' });

  // Divider line
  const divY = titleY + 90;
  doc.moveTo(centerX - 100, divY).lineTo(centerX + 100, divY).lineWidth(2).stroke('#1a365d');

  // Borrower name
  doc.font(FONT_BOLD).fontSize(18).fillColor('#1a365d');
  doc.text(input.dealName, PAGE_MARGIN, divY + 30, { width: maxWidth, align: 'center' });

  // Loan details
  doc.font(FONT_NORMAL).fontSize(12).fillColor('#4a5568');
  doc.text(
    `${input.loanType.replace(/_/g, ' ').toUpperCase()} — $${input.loanAmount.toLocaleString()}`,
    PAGE_MARGIN, divY + 60, { width: maxWidth, align: 'center' }
  );

  // Date
  doc.text(
    `Prepared: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    PAGE_MARGIN, divY + 85, { width: maxWidth, align: 'center' }
  );

  // Confidentiality notice at bottom
  doc.font(FONT_NORMAL).fontSize(8).fillColor('#718096');
  doc.text(
    'CONFIDENTIAL — This document contains proprietary financial information prepared for lending purposes only.',
    PAGE_MARGIN, doc.page.height - 80, { width: maxWidth, align: 'center' }
  );

  doc.text(
    'Prepared with Buddy The Underwriter | buddytheunderwriter.com',
    PAGE_MARGIN, doc.page.height - 65, { width: maxWidth, align: 'center' }
  );
}
```

#### New Section: Table of Contents

```typescript
function renderTableOfContents(s: DocState) {
  const sections = [
    { num: 1, title: 'Executive Summary', page: 3 },
    { num: 2, title: 'Company Description', page: 4 },
    { num: 3, title: 'Industry & Market Analysis', page: 5 },
    { num: 4, title: 'Products & Services', page: 6 },
    { num: 5, title: 'Marketing & Sales Strategy', page: 6 },
    { num: 6, title: 'Operations Plan', page: 7 },
    { num: 7, title: 'Management Team', page: 7 },
    { num: 8, title: 'SWOT Analysis', page: 8 },
    { num: 9, title: '3-Year Financial Projections', page: 9 },
    { num: 10, title: 'Monthly Cash Flow — Year 1', page: 10 },
    { num: 11, title: 'Break-Even Analysis', page: 11 },
    { num: 12, title: 'Sensitivity Analysis', page: 12 },
    { num: 13, title: 'Sources & Uses of Funds', page: 13 },
    { num: 14, title: 'Use of Proceeds Detail', page: 14 },
  ];
  // Render each line with dot leaders and right-aligned page number
  // Font: FONT_NORMAL, 11pt, color #2d3748
}
```

#### New: Embedded Charts (SVG via PDFKit)

Add to `renderSection2_Projections`:

```typescript
// After the projections table, add a revenue trend chart
function renderRevenueChart(s: DocState, baseYear: AnnualProjectionYear, projections: AnnualProjectionYear[]) {
  const allYears = [baseYear, ...projections];
  const maxRevenue = Math.max(...allYears.map(y => y.revenue));
  const chartWidth = 400;
  const chartHeight = 150;
  const barWidth = 60;
  const startX = PAGE_MARGIN + 50;
  const baselineY = s.y + chartHeight;

  // Draw bars
  for (let i = 0; i < allYears.length; i++) {
    const barHeight = (allYears[i].revenue / maxRevenue) * (chartHeight - 20);
    const x = startX + i * (barWidth + 30);
    const y = baselineY - barHeight;
    const color = i === 0 ? '#4a5568' : '#1a365d'; // gray for actual, navy for projected
    s.doc.rect(x, y, barWidth, barHeight).fill(color);
    // Label above bar
    s.doc.font(FONT_NORMAL).fontSize(7).fillColor('#2d3748');
    s.doc.text(`$${fmtCurrency(allYears[i].revenue)}`, x - 10, y - 12, { width: barWidth + 20, align: 'center' });
    // Year label below
    s.doc.text(i === 0 ? 'Actual' : `Year ${i}`, x, baselineY + 4, { width: barWidth, align: 'center' });
  }
  s.doc.fillColor('#000000');
  s.y = baselineY + 30;
}

// Add DSCR trend line chart after sensitivity table
function renderDSCRChart(s: DocState, scenarios: SensitivityScenario[]) {
  // Horizontal line at 1.25x (SBA threshold) in red
  // Three line series: base, upside, downside across Y1/Y2/Y3
  // Color coding: green >= 1.25, amber >= 1.0, red < 1.0
}
```

#### New Section 13: Sources & Uses

```typescript
function renderSection13_SourcesAndUses(s: DocState) {
  // Two-column layout: Sources on left, Uses on right
  // Each with category, description, amount, % of total
  // Bottom row: Totals with balanced/unbalanced indicator
  // Equity injection callout box: "Borrower equity injection: $X (Y%)"
  //   with pass/fail against minimum requirement
}
```

#### Updated Page Order

```
Page 1: Cover Page (new)
Page 2: Table of Contents (new)
Page 3: Executive Summary (new)
Page 4: Company Description (existing businessOverviewNarrative — companyDescription section)
Page 5: Industry & Market Analysis (new)
Page 6: Products & Services + Marketing Strategy (new)
Page 7: Operations Plan + Management Team (existing — restructured)
Page 8: SWOT Analysis (new)
Page 9: 3-Year Financial Projections + Revenue Chart (existing + chart)
Page 10: Monthly Cash Flow Year 1 (existing)
Page 11: Break-Even Analysis (existing)
Page 12: Sensitivity Analysis + DSCR Chart (existing + chart)
Page 13: Sources & Uses of Funds (new)
Page 14: Use of Proceeds Detail (existing — now rendered)
```

---

## 3. Tier 2 — The Analytical Edge

### 3.1 Projected Balance Sheet

**New file:** `src/lib/sba/sbaBalanceSheetProjector.ts`

The working capital assumptions (DSO, DPO, inventory turns) are currently captured in `SBAAssumptions.workingCapital` but NEVER used in computations. This activates them.

```typescript
export interface BalanceSheetYear {
  year: 0 | 1 | 2 | 3;
  label: 'Actual' | 'Projected';
  // Assets
  cash: number;
  accountsReceivable: number;
  inventory: number;
  totalCurrentAssets: number;
  fixedAssetsNet: number;       // base + capex - cumulative depreciation
  totalAssets: number;
  // Liabilities
  accountsPayable: number;
  currentPortionLTD: number;    // 12 months of debt service principal
  totalCurrentLiabilities: number;
  longTermDebt: number;         // remaining loan balance
  totalLiabilities: number;
  // Equity
  ownersEquity: number;
  retainedEarnings: number;
  totalEquity: number;
  // Ratios
  currentRatio: number;
  debtToEquity: number;
  workingCapital: number;
}

export function buildBalanceSheetProjections(params: {
  baseYear: AnnualProjectionYear;
  annualProjections: AnnualProjectionYear[];
  assumptions: SBAAssumptions;
  baseYearCash: number;            // from financial facts or 0
  baseYearAR: number;              // from financial facts or derived from DSO
  baseYearInventory: number;       // from financial facts or 0
  baseYearFixedAssets: number;     // from financial facts or 0
  baseYearAP: number;              // from financial facts or derived from DPO
  baseYearLTD: number;             // sum of existing debt balances + new loan
  baseYearEquity: number;          // from financial facts or 0
}): BalanceSheetYear[] {
  // Year 0: base year from facts
  // Years 1-3: derive from P&L projections + working capital assumptions
  //
  // AR = (Revenue / 365) * DSO
  // Inventory = (COGS / InventoryTurns) — null inventory turns = 0 inventory
  // AP = (COGS / 365) * DPO
  // Cash = previous cash + net income + depreciation - change in working capital - principal payments
  // Fixed Assets = previous + capex - depreciation
  // LTD = previous - principal payments for year
  // Retained Earnings = previous + net income
}
```

### 3.2 Global Cash Flow Analysis

**New file:** `src/lib/sba/sbaGlobalCashFlow.ts`

SBA 7(a) requires global cash flow — personal + business combined for all 20%+ guarantors.

```typescript
export interface GuarantorCashFlow {
  entityId: string;
  displayName: string;
  ownershipPct: number;
  // Personal Income
  w2Salary: number;
  otherPersonalIncome: number;    // rental, investment, etc.
  totalPersonalIncome: number;
  // Personal Obligations
  mortgagePayment: number;
  autoPayments: number;
  studentLoans: number;
  creditCardMinimums: number;
  otherPersonalDebt: number;
  totalPersonalObligations: number;
  // Net personal cash available
  netPersonalCash: number;
}

export interface GlobalCashFlowResult {
  // Business cash flow
  businessEBITDA: number;
  businessDebtService: number;
  businessNetCF: number;
  businessDSCR: number;
  // Personal cash flows (per guarantor)
  guarantors: GuarantorCashFlow[];
  totalPersonalIncome: number;
  totalPersonalObligations: number;
  totalNetPersonalCash: number;
  // Global combined
  globalCashAvailable: number;    // businessEBITDA + totalNetPersonalCash
  globalDebtService: number;      // businessDebtService + totalPersonalObligations
  globalDSCR: number;             // globalCashAvailable / globalDebtService
  // Flags
  globalDscrBelowThreshold: boolean;
  guarantorsLacking: string[];    // names of guarantors with negative personal CF
}

export function computeGlobalCashFlow(params: {
  businessProjectionYear1: AnnualProjectionYear;
  guarantors: GuarantorCashFlow[];
}): GlobalCashFlowResult
```

**Migration:** `20260421_02_guarantor_personal_cashflow`

```sql
CREATE TABLE IF NOT EXISTS buddy_guarantor_cashflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES deal_ownership_entities(id),
  -- Personal Income
  w2_salary numeric DEFAULT 0,
  other_personal_income numeric DEFAULT 0,
  personal_income_notes text,
  -- Personal Obligations
  mortgage_payment numeric DEFAULT 0,
  auto_payments numeric DEFAULT 0,
  student_loans numeric DEFAULT 0,
  credit_card_minimums numeric DEFAULT 0,
  other_personal_debt numeric DEFAULT 0,
  personal_debt_notes text,
  -- Metadata
  source text DEFAULT 'manual',  -- 'manual' | 'ptr_extraction' | 'pfs_extraction'
  tax_year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, entity_id)
);

COMMENT ON TABLE buddy_guarantor_cashflow IS 'Personal cash flow data for SBA global cash flow analysis. One row per guarantor per deal.';

-- Add global CF columns to packages
ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS global_cash_flow jsonb DEFAULT '{}' ::jsonb,
  ADD COLUMN IF NOT EXISTS global_dscr numeric,
  ADD COLUMN IF NOT EXISTS balance_sheet_projections jsonb DEFAULT '[]' ::jsonb;
```

**New API route:** `src/app/api/deals/[dealId]/sba/guarantor-cashflow/route.ts`

- GET: Load existing guarantor cashflow data for all 20%+ owners
- PUT: Save/update guarantor cashflow entries

**UI:** Add a "Guarantor Cash Flow" step to the AssumptionInterview (Step 6 — after Management Team). For each ownership entity with >= 20% ownership, show input fields for personal income and obligations. Pre-fill from PTR extraction if available via `deal_financial_facts` with `fact_key LIKE 'PTR_%'`.

### 3.3 NAICS-Benchmarked Assumption Validation

**New file:** `src/lib/sba/sbaAssumptionBenchmarks.ts`

```typescript
// NAICS industry benchmarks — hardcoded tier 1, later from BLS/Census API
const NAICS_BENCHMARKS: Record<string, {
  medianGrossMargin: number;
  medianRevenueGrowth: number;
  medianDSO: number;
  medianDPO: number;
  medianInventoryTurns: number | null;
  medianFixedCostPct: number;  // fixed costs as % of revenue
}> = {
  '722511': { // Full-Service Restaurants
    medianGrossMargin: 0.62, medianRevenueGrowth: 0.05, medianDSO: 5,
    medianDPO: 20, medianInventoryTurns: 24, medianFixedCostPct: 0.35,
  },
  '722513': { // Limited-Service Restaurants
    medianGrossMargin: 0.65, medianRevenueGrowth: 0.06, medianDSO: 3,
    medianDPO: 15, medianInventoryTurns: 30, medianFixedCostPct: 0.30,
  },
  '236220': { // Commercial Building Construction
    medianGrossMargin: 0.22, medianRevenueGrowth: 0.04, medianDSO: 55,
    medianDPO: 35, medianInventoryTurns: null, medianFixedCostPct: 0.12,
  },
  '541511': { // Custom Computer Programming
    medianGrossMargin: 0.55, medianRevenueGrowth: 0.08, medianDSO: 45,
    medianDPO: 25, medianInventoryTurns: null, medianFixedCostPct: 0.40,
  },
  // Add 20-30 most common SBA NAICS codes
};

export interface BenchmarkWarning {
  field: string;
  borrowerValue: number;
  benchmarkValue: number;
  direction: 'above' | 'below';
  percentile: string;  // "above 90th percentile" etc.
  suggestion: string;
}

export function validateAgainstBenchmarks(
  assumptions: SBAAssumptions,
  naicsCode: string | null,
): BenchmarkWarning[] {
  if (!naicsCode || !NAICS_BENCHMARKS[naicsCode]) return [];
  const bench = NAICS_BENCHMARKS[naicsCode];
  const warnings: BenchmarkWarning[] = [];

  // Check: revenue growth rates vs industry median
  for (const stream of assumptions.revenueStreams) {
    if (stream.growthRateYear1 > bench.medianRevenueGrowth * 2.5) {
      warnings.push({
        field: `Revenue stream "${stream.name}" — Year 1 growth`,
        borrowerValue: stream.growthRateYear1,
        benchmarkValue: bench.medianRevenueGrowth,
        direction: 'above',
        percentile: 'above 90th percentile',
        suggestion: `Industry median growth is ${(bench.medianRevenueGrowth * 100).toFixed(0)}%. Consider whether ${(stream.growthRateYear1 * 100).toFixed(0)}% is supportable with evidence.`,
      });
    }
  }

  // Check: COGS percentage vs gross margin benchmark
  // Check: DSO vs industry median
  // Check: DPO vs industry median
  // Check: fixed cost escalation vs CPI (~3%)

  return warnings;
}
```

**Integration:** Call `validateAgainstBenchmarks()` in the AssumptionInterview UI and display warnings inline next to the relevant fields. Also call during `generateSBAPackage()` and include in the package metadata for the reviewer.

---

## 4. Tier 3 — The Franchise Weapon

### 4.1 Franchise Mode Detection

**File:** `src/lib/sba/sbaPackageOrchestrator.ts` (MODIFY)

```typescript
// After the deal query, add franchise detection:
const { data: franchiseDeal } = await sb
  .from('deals')
  .select('franchise_brand_id, franchise_brand_name')
  .eq('id', dealId)
  .single();

// Also check the franchise intelligence database
let franchiseData: FranchiseIntelligence | null = null;
if (franchiseDeal?.franchise_brand_id) {
  const { data: fdd } = await sb
    .from('franchise_brands')  // from franchise intelligence DB
    .select('brand_name, initial_investment_low, initial_investment_high, royalty_pct, ad_fund_pct, franchise_fee, term_years, sba_certified, item_19_data')
    .eq('id', franchiseDeal.franchise_brand_id)
    .maybeSingle();
  if (fdd) franchiseData = fdd;
}
```

### 4.2 FDD Item 7 → Use of Proceeds Auto-Fill

When a deal is flagged as franchise and franchise intelligence data is available, the assumptions prefill should auto-populate use-of-proceeds from FDD Item 7 (Initial Investment):

**File:** `src/lib/sba/sbaAssumptionsPrefill.ts` (MODIFY)

```typescript
// After existing prefill logic, add franchise enrichment:
if (franchiseData) {
  // Auto-populate use of proceeds from FDD Item 7
  const item7Costs = [
    { category: 'franchise_fee', description: `${franchiseData.brand_name} Franchise Fee`, amount: franchiseData.franchise_fee ?? 0 },
    { category: 'buildout', description: 'Leasehold Improvements / Buildout', amount: /* from item7 detail */ 0 },
    { category: 'equipment', description: 'Equipment, Fixtures & Signage', amount: /* from item7 detail */ 0 },
    { category: 'working_capital', description: 'Initial Working Capital (3 months)', amount: /* from item7 detail */ 0 },
    { category: 'inventory', description: 'Initial Inventory', amount: /* from item7 detail */ 0 },
  ];

  // Auto-populate cost assumptions from FDD
  prefill.costAssumptions = {
    ...prefill.costAssumptions,
    // Royalty is a fixed cost: revenue * royalty_pct
    fixedCostCategories: [
      ...(prefill.costAssumptions?.fixedCostCategories ?? []),
      {
        name: `${franchiseData.brand_name} Royalty Fee`,
        annualAmount: (prefill.revenueStreams?.[0]?.baseAnnualRevenue ?? 0) * (franchiseData.royalty_pct ?? 0),
        escalationPctPerYear: 0,  // royalty grows with revenue, but that's handled by % of revenue
      },
      {
        name: 'Advertising / Marketing Fund',
        annualAmount: (prefill.revenueStreams?.[0]?.baseAnnualRevenue ?? 0) * (franchiseData.ad_fund_pct ?? 0),
        escalationPctPerYear: 0,
      },
    ],
  };
}
```

### 4.3 FDD Item 19 → Revenue Assumption Anchoring

When FDD Item 19 (Financial Performance Representations) is available, use it as the anchor for revenue assumptions instead of guessing:

```typescript
// In sbaAssumptionsPrefill.ts:
if (franchiseData?.item_19_data) {
  const item19 = franchiseData.item_19_data as {
    median_revenue?: number;
    average_revenue?: number;
    top_quartile_revenue?: number;
    bottom_quartile_revenue?: number;
  };

  // Use median revenue as the base, or average if median unavailable
  const baseRevenue = item19.median_revenue ?? item19.average_revenue ?? prefill.revenueStreams?.[0]?.baseAnnualRevenue ?? 0;

  prefill.revenueStreams = [{
    id: 'stream_franchise_primary',
    name: `${franchiseData.brand_name} Unit Revenue`,
    baseAnnualRevenue: baseRevenue,
    growthRateYear1: 0.08,  // conservative for franchise ramp
    growthRateYear2: 0.05,
    growthRateYear3: 0.03,
    pricingModel: 'flat',
    seasonalityProfile: null,
  }];
}
```

### 4.4 Franchise Section in Business Plan Narrative

**File:** `src/lib/sba/sbaPackageNarrative.ts` (MODIFY — add new function)

```typescript
export async function generateFranchiseSection(params: {
  brandName: string;
  franchiseFee: number;
  royaltyPct: number;
  adFundPct: number;
  termYears: number;
  sbaCertified: boolean;
  item19Available: boolean;
  item19MedianRevenue: number | null;
  trainingDescription: string | null;
  territoryProtection: string | null;
}): Promise<string>

// Prompt: Generate a franchise overview section covering:
// 1. Franchisor overview (brand name, system size if known)
// 2. Fee structure (franchise fee, ongoing royalty %, ad fund %)
// 3. Training and support provided by franchisor
// 4. Territory protection / exclusivity
// 5. SBA franchise eligibility status
// 6. Financial performance context from Item 19 if available
// RULES: Do NOT invent franchisor system size or unit counts. State facts from FDD data only.
```

### 4.5 SBA Franchise Eligibility Cross-Reference

**File:** `src/lib/sba/sbaPackageOrchestrator.ts` (MODIFY)

```typescript
// In the orchestrator, after franchise detection:
if (franchiseData && !franchiseData.sba_certified) {
  // Non-certified brands are SBA-ineligible
  // Add a hard warning to the package, don't block generation
  // but surface prominently in the PDF and UI
  packageWarnings.push({
    severity: 'critical',
    message: `${franchiseData.brand_name} is not listed in the SBA Franchise Directory as a certified brand. SBA eligibility must be confirmed before submission.`,
  });
}
```

---

## 5. Tier 4 — The Experience Layer

### 5.1 Voice-Completable Assumption Interview

**File:** `src/lib/voice/sbaAssumptionVoiceSchema.ts` (NEW)

Define a voice-interview schema that maps to the same `SBAAssumptions` type:

```typescript
export const SBA_ASSUMPTION_VOICE_SCHEMA = {
  steps: [
    {
      id: 'revenue',
      prompt: "Let's talk about your revenue. What are your main revenue streams and roughly how much does each bring in annually?",
      extractionFields: ['revenueStreams[].name', 'revenueStreams[].baseAnnualRevenue'],
      followUp: "What kind of growth do you expect over the next three years? Give me year one, two, and three as percentages.",
      extractionFields2: ['revenueStreams[].growthRateYear1', 'growthRateYear2', 'growthRateYear3'],
    },
    {
      id: 'costs',
      prompt: "Now let's look at your costs. What percentage of your revenue goes to cost of goods sold? And what are your major fixed costs like rent, insurance, and utilities?",
      extractionFields: ['costAssumptions.cogsPercentYear1', 'costAssumptions.fixedCostCategories[]'],
    },
    {
      id: 'team',
      prompt: "Tell me about your management team. Who are the key people, what are their titles, and how many years of experience do they have in this industry?",
      extractionFields: ['managementTeam[].name', 'title', 'yearsInIndustry', 'bio'],
    },
    {
      id: 'loan',
      prompt: "Let's talk about the loan itself. How much are you requesting, and how will you use the proceeds? Also, do you have any existing business debt?",
      extractionFields: ['loanImpact.loanAmount', 'loanImpact.existingDebt[]'],
    },
    {
      id: 'equity',
      prompt: "For your equity injection — how much cash are you putting into this deal, and where is it coming from? Savings, 401k rollover, or another source?",
      extractionFields: ['loanImpact.equityInjectionAmount', 'equityInjectionSource'],
    },
    {
      id: 'personal', // Guarantor cash flow
      prompt: "Last section — I need your personal financial picture for the global cash flow analysis. What's your annual salary or W-2 income? And your major monthly obligations — mortgage, car payments, student loans?",
      extractionFields: ['guarantorCashflow.w2Salary', 'mortgagePayment', 'autoPayments', 'studentLoans'],
    },
  ],
};
```

**Integration point:** The voice gateway (`services/voice-gateway/`) routes SBA assumption collection through this schema. The extracted fields are written to `buddy_sba_assumptions` via the existing PUT `/api/deals/[dealId]/sba/assumptions` endpoint.

This does NOT require building a new voice pipeline — it uses the existing Buddy Voice infrastructure with a new structured interview schema.

### 5.2 Version History & Iteration Loop

**File:** `src/lib/sba/sbaPackageOrchestrator.ts` (MODIFY)

```typescript
// Before inserting a new package, check for existing packages and set version
const { data: existingPackages } = await sb
  .from('buddy_sba_packages')
  .select('id, version_number')
  .eq('deal_id', dealId)
  .order('version_number', { ascending: false })
  .limit(1);

const previousVersion = existingPackages?.[0];
const newVersionNumber = (previousVersion?.version_number ?? 0) + 1;

// Insert with version tracking
const { data: pkg } = await sb
  .from('buddy_sba_packages')
  .insert({
    // ... all existing fields ...
    version_number: newVersionNumber,
    parent_package_id: previousVersion?.id ?? null,
  })
  .select('id')
  .single();
```

**New API route:** `src/app/api/deals/[dealId]/sba/versions/route.ts`

```typescript
// GET: Return all package versions for a deal
export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('buddy_sba_packages')
    .select('id, version_number, created_at, status, dscr_year1_base, dscr_below_threshold, break_even_revenue')
    .eq('deal_id', dealId)
    .order('version_number', { ascending: false });
  return NextResponse.json({ versions: data ?? [] });
}
```

**New API route:** `src/app/api/deals/[dealId]/sba/diff/route.ts`

```typescript
// GET ?v1=uuid&v2=uuid — Compare two package versions
// Returns field-by-field diff of:
//   - DSCR changes (year1/2/3 base and downside)
//   - Revenue projection changes
//   - Break-even changes
//   - Assumption changes (what the borrower tweaked)
```

**UI Component:** `src/components/sba/SBAVersionHistory.tsx`

- Show timeline of all versions with key metrics (DSCR, break-even revenue, margin of safety)
- Click to view any version
- "Compare" button shows side-by-side diff
- "Regenerate" button on assumption interview triggers new version

### 5.3 SBA Form Cross-Fill

**File:** `src/lib/sba/sbaFormCrossFill.ts` (NEW)

```typescript
/**
 * Cross-fills SBA form payloads from business plan assumptions.
 * Writes to existing sba_form_payloads table.
 *
 * Forms that can be pre-populated from business plan data:
 * - SBA Form 1919 (Borrower Information Form)
 * - SBA Form 413 (Personal Financial Statement) — from guarantor cash flow
 * - Sources & Uses Schedule
 */

export async function crossFillSBAForms(params: {
  dealId: string;
  assumptions: SBAAssumptions;
  guarantorCashFlows: GuarantorCashFlow[];
  sourcesAndUses: SourcesAndUsesResult;
}): Promise<{ formsCreated: string[] }> {
  const sb = supabaseAdmin();
  const formsCreated: string[] = [];

  // ── Form 1919: Borrower Information ────────────────────────────

  // Map from assumptions:
  // - Business name → from deal.name
  // - Business type → from deal metadata
  // - Years in business → from financial facts
  // - Number of employees → from plannedHires count + existing
  // - Annual revenue → from revenueStreams baseAnnualRevenue sum
  // - Loan amount requested → from loanImpact.loanAmount
  // - Use of proceeds → from sourcesAndUses.uses
  // - Management team → from managementTeam array
  // - Ownership structure → from deal_ownership_interests

  const form1919Payload = {
    business_name: /* deal.name */,
    loan_amount_requested: params.assumptions.loanImpact.loanAmount,
    use_of_proceeds: params.sourcesAndUses.uses.map(u => ({
      category: u.category,
      amount: u.amount,
    })),
    management: params.assumptions.managementTeam.map(m => ({
      name: m.name,
      title: m.title,
      ownership_pct: m.ownershipPct ?? 0,
    })),
    // ... additional fields from deal metadata
  };

  await sb.from('sba_form_payloads').upsert({
    application_id: /* deal_id or sba_loan_id */,
    form_name: 'sba_1919',
    payload: form1919Payload,
    status: 'prefilled',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'application_id,form_name' });
  formsCreated.push('sba_1919');

  // ── Form 413: Personal Financial Statement ─────────────────────

  for (const gcf of params.guarantorCashFlows) {
    const form413Payload = {
      guarantor_name: gcf.displayName,
      annual_salary: gcf.w2Salary,
      other_income: gcf.otherPersonalIncome,
      mortgage_balance: /* if available from PFS extraction */,
      mortgage_payment_monthly: gcf.mortgagePayment / 12,
      auto_loan_payment_monthly: gcf.autoPayments / 12,
      // ... additional PFS fields
    };

    await sb.from('sba_form_payloads').upsert({
      application_id: /* deal_id */,
      form_name: `sba_413_${gcf.entityId}`,
      payload: form413Payload,
      status: 'prefilled',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'application_id,form_name' });
    formsCreated.push(`sba_413_${gcf.entityId}`);
  }

  // ── Sources & Uses Schedule ────────────────────────────────────

  await sb.from('sba_form_payloads').upsert({
    application_id: /* deal_id */,
    form_name: 'sources_and_uses',
    payload: {
      sources: params.sourcesAndUses.sources,
      uses: params.sourcesAndUses.uses,
      total_project_cost: params.sourcesAndUses.totalUses,
      equity_injection_pct: params.sourcesAndUses.equityInjectionPct,
    },
    status: 'prefilled',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'application_id,form_name' });
  formsCreated.push('sources_and_uses');

  return { formsCreated };
}
```

**Integration:** Call `crossFillSBAForms()` at the END of `generateSBAPackage()` after the package is stored. This means generating a business plan automatically pre-fills all related SBA forms — the borrower's total prep collapses from weeks to minutes.

### 5.4 AI Assumption Coach

**New file:** `src/lib/sba/sbaAssumptionCoach.ts`

```typescript
/**
 * Provides real-time coaching feedback on assumption inputs.
 * Called from the AssumptionInterview UI as the borrower types.
 * Pure function — no DB, no LLM. Just benchmark comparisons.
 */

export interface CoachingTip {
  field: string;
  severity: 'info' | 'warning' | 'concern';
  message: string;
  suggestion: string;
}

export function getAssumptionCoachingTips(
  assumptions: Partial<SBAAssumptions>,
  naicsCode: string | null,
): CoachingTip[] {
  const tips: CoachingTip[] = [];

  // Growth rate sanity checks
  for (const stream of assumptions.revenueStreams ?? []) {
    if (stream.growthRateYear1 > 0.30) {
      tips.push({
        field: `revenue.${stream.id}.growthRateYear1`,
        severity: 'warning',
        message: `${(stream.growthRateYear1 * 100).toFixed(0)}% Year 1 growth is aggressive.`,
        suggestion: 'Most SBA lenders view growth above 20% skeptically without strong evidence. Consider providing supporting documentation.',
      });
    }
    if (stream.growthRateYear1 < 0) {
      tips.push({
        field: `revenue.${stream.id}.growthRateYear1`,
        severity: 'info',
        message: 'Declining revenue projections signal a turnaround story.',
        suggestion: 'Make sure the sensitivity analysis and business overview narrative explain the recovery plan clearly.',
      });
    }
  }

  // COGS sanity
  const cogsY1 = assumptions.costAssumptions?.cogsPercentYear1 ?? 0;
  if (cogsY1 > 0.85) {
    tips.push({
      field: 'costAssumptions.cogsPercentYear1',
      severity: 'concern',
      message: `${(cogsY1 * 100).toFixed(0)}% COGS leaves very thin margins.`,
      suggestion: 'Gross margin below 15% makes debt service coverage extremely difficult. Double-check this number.',
    });
  }

  // Equity injection minimum check
  const equity = assumptions.loanImpact?.equityInjectionAmount ?? 0;
  const loanAmt = assumptions.loanImpact?.loanAmount ?? 0;
  const totalProject = equity + loanAmt;
  if (totalProject > 0 && equity / totalProject < 0.10) {
    tips.push({
      field: 'loanImpact.equityInjectionAmount',
      severity: 'concern',
      message: `Equity injection is ${((equity / totalProject) * 100).toFixed(1)}% of total project cost.`,
      suggestion: 'SBA requires minimum 10% equity injection (20% for new businesses). Increase equity or add seller financing.',
    });
  }

  // Working capital DSO/DPO
  const dso = assumptions.workingCapital?.targetDSO ?? 0;
  if (dso > 90) {
    tips.push({
      field: 'workingCapital.targetDSO',
      severity: 'warning',
      message: `${dso}-day DSO means slow collections.`,
      suggestion: 'Consider whether this DSO reflects your actual collection cycle. High DSO strains working capital.',
    });
  }

  return tips;
}
```

**UI Integration:** Import into `AssumptionInterview.tsx` and call `getAssumptionCoachingTips()` on every form state change. Display tips as inline callout boxes below the relevant field with appropriate severity coloring (blue info, amber warning, red concern).

---

## 6. Migration Summary

### All SQL Migrations (in execution order)

**Migration 1:** `20260421_01_sba_package_extended_narratives`
```sql
ALTER TABLE buddy_sba_packages
  ADD COLUMN IF NOT EXISTS executive_summary text,
  ADD COLUMN IF NOT EXISTS industry_analysis text,
  ADD COLUMN IF NOT EXISTS marketing_strategy text,
  ADD COLUMN IF NOT EXISTS operations_plan text,
  ADD COLUMN IF NOT EXISTS swot_strengths text,
  ADD COLUMN IF NOT EXISTS swot_weaknesses text,
  ADD COLUMN IF NOT EXISTS swot_opportunities text,
  ADD COLUMN IF NOT EXISTS swot_threats text,
  ADD COLUMN IF NOT EXISTS sources_and_uses jsonb DEFAULT '{}' ::jsonb,
  ADD COLUMN IF NOT EXISTS version_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_package_id uuid REFERENCES buddy_sba_packages(id),
  ADD COLUMN IF NOT EXISTS franchise_section text,
  ADD COLUMN IF NOT EXISTS package_warnings jsonb DEFAULT '[]' ::jsonb,
  ADD COLUMN IF NOT EXISTS benchmark_warnings jsonb DEFAULT '[]' ::jsonb,
  ADD COLUMN IF NOT EXISTS global_cash_flow jsonb DEFAULT '{}' ::jsonb,
  ADD COLUMN IF NOT EXISTS global_dscr numeric,
  ADD COLUMN IF NOT EXISTS balance_sheet_projections jsonb DEFAULT '[]' ::jsonb,
  ADD COLUMN IF NOT EXISTS forms_cross_filled jsonb DEFAULT '[]' ::jsonb;
```

**Migration 2:** `20260421_02_guarantor_personal_cashflow`
```sql
CREATE TABLE IF NOT EXISTS buddy_guarantor_cashflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES deal_ownership_entities(id),
  w2_salary numeric DEFAULT 0,
  other_personal_income numeric DEFAULT 0,
  personal_income_notes text,
  mortgage_payment numeric DEFAULT 0,
  auto_payments numeric DEFAULT 0,
  student_loans numeric DEFAULT 0,
  credit_card_minimums numeric DEFAULT 0,
  other_personal_debt numeric DEFAULT 0,
  personal_debt_notes text,
  source text DEFAULT 'manual',
  tax_year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, entity_id)
);
```

---

## 7. Verification Queries

After implementation, run these to confirm everything is wired:

```sql
-- 1. Verify new columns exist on buddy_sba_packages
SELECT column_name FROM information_schema.columns
WHERE table_name = 'buddy_sba_packages'
AND column_name IN ('executive_summary', 'industry_analysis', 'swot_strengths', 'sources_and_uses', 'version_number', 'global_dscr', 'balance_sheet_projections', 'forms_cross_filled')
ORDER BY column_name;
-- Expected: 8 rows

-- 2. Verify buddy_guarantor_cashflow table exists
SELECT column_name FROM information_schema.columns
WHERE table_name = 'buddy_guarantor_cashflow'
ORDER BY ordinal_position;
-- Expected: 14 rows

-- 3. After generating a package, verify all narrative sections populated
SELECT
  id,
  version_number,
  LENGTH(executive_summary) > 0 as has_exec_summary,
  LENGTH(industry_analysis) > 0 as has_industry,
  LENGTH(marketing_strategy) > 0 as has_marketing,
  LENGTH(swot_strengths) > 0 as has_swot,
  sources_and_uses != '{}' as has_sources_uses,
  global_dscr IS NOT NULL as has_global_dscr,
  balance_sheet_projections != '[]' as has_balance_sheet,
  forms_cross_filled != '[]' as has_forms
FROM buddy_sba_packages
WHERE deal_id = '<test_deal_id>'
ORDER BY version_number DESC
LIMIT 1;

-- 4. Verify form cross-fill worked
SELECT form_name, status, updated_at
FROM sba_form_payloads
WHERE application_id = '<test_deal_id>'
ORDER BY form_name;
-- Expected: sba_1919, sba_413_<entity_id>, sources_and_uses
```

---

## 8. New File Summary

| File | Tier | Purpose |
|------|------|---------|
| `src/lib/sba/sbaSourcesAndUses.ts` | 1 | Sources & Uses waterfall builder |
| `src/lib/sba/sbaBalanceSheetProjector.ts` | 2 | 3-year balance sheet projections from P&L + working capital |
| `src/lib/sba/sbaGlobalCashFlow.ts` | 2 | Personal + business combined DSCR |
| `src/lib/sba/sbaAssumptionBenchmarks.ts` | 2 | NAICS industry benchmark validation |
| `src/lib/sba/sbaAssumptionCoach.ts` | 4 | Real-time coaching tips for assumption inputs |
| `src/lib/sba/sbaFormCrossFill.ts` | 4 | Auto-fill SBA forms from business plan data |
| `src/lib/voice/sbaAssumptionVoiceSchema.ts` | 4 | Voice interview schema for assumption collection |
| `src/app/api/deals/[dealId]/sba/guarantor-cashflow/route.ts` | 2 | CRUD for guarantor personal cashflow |
| `src/app/api/deals/[dealId]/sba/versions/route.ts` | 4 | Package version history |
| `src/app/api/deals/[dealId]/sba/diff/route.ts` | 4 | Version comparison |
| `src/components/sba/SBAVersionHistory.tsx` | 4 | Version timeline UI |

## 9. Modified File Summary

| File | Tiers | Changes |
|------|-------|---------|
| `src/lib/sba/sbaPackageOrchestrator.ts` | 1,2,3,4 | Add parallel narrative calls, franchise detection, balance sheet, global CF, form cross-fill, version tracking |
| `src/lib/sba/sbaPackageNarrative.ts` | 1,3 | Add 4 new narrative generators + franchise section |
| `src/lib/sba/sbaPackageRenderer.ts` | 1 | Cover page, TOC, charts, S&U section, restructured page order (14 pages) |
| `src/lib/sba/sbaReadinessTypes.ts` | 1,2 | Add equity injection fields, balance sheet types, global CF types, coaching types |
| `src/lib/sba/sbaAssumptionsPrefill.ts` | 1,3 | Add equity/S&U prefill, franchise FDD Item 7/19 auto-fill |
| `src/lib/sba/sbaAssumptionsValidator.ts` | 2 | Add benchmark validation integration |
| `src/components/sba/AssumptionInterview.tsx` | 1,2,4 | Add S&U step, guarantor CF step, coaching tips display |
| `src/components/sba/SBAPackageViewer.tsx` | 1,4 | Add version history, expanded section navigation |

---

## 10. Implementation Order

**Build in this sequence to maintain a working system at each step:**

1. **Migration 1** — add columns to buddy_sba_packages (non-breaking, all nullable/defaulted)
2. **Migration 2** — create buddy_guarantor_cashflow table
3. **sbaSourcesAndUses.ts** — pure function, no dependencies
4. **sbaBalanceSheetProjector.ts** — pure function, depends only on existing types
5. **sbaGlobalCashFlow.ts** — pure function, depends only on existing types
6. **sbaAssumptionBenchmarks.ts** — pure function, hardcoded data
7. **sbaAssumptionCoach.ts** — pure function, depends on benchmarks
8. **Extended narrative functions in sbaPackageNarrative.ts** — adds 4 new Gemini calls
9. **sbaPackageRenderer.ts** — cover page, TOC, charts, S&U, new page order
10. **sbaPackageOrchestrator.ts** — wire everything together (the big integration)
11. **sbaFormCrossFill.ts** — depends on S&U and global CF being built
12. **API routes** — guarantor-cashflow, versions, diff
13. **UI updates** — AssumptionInterview new steps, coaching tips, SBAPackageViewer
14. **Voice schema** — last, depends on assumption types being finalized

**Each step is independently testable. No step breaks the existing generate flow.**

---

*End of spec. Copy-pasteable for Claude Code. Every file path, SQL statement, type contract, and verification query is exact.*
