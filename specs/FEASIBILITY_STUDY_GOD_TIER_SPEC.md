# BUDDY FEASIBILITY STUDY ENGINE — GOD TIER SPEC

**Status:** ACTIVE — implementation guide for Claude Code / Antigravity  
**Created:** April 20, 2026  
**Author:** Claude (architecture) + Matt (vision)  
**Depends on:** `specs/BUSINESS_PLAN_GOD_TIER_SPEC.md` (Phase 1 + Phase 2)  
**Scope:** Build a god tier feasibility study system that makes borrowers feel they sat down with the world's leading expert and should have paid $20,000 for the analysis they received.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Architecture Overview](#2-architecture-overview)
3. [Tier 1 — The Intelligence Foundation](#3-tier-1--the-intelligence-foundation)
4. [Tier 2 — The Feasibility Scoring Engine](#4-tier-2--the-feasibility-scoring-engine)
5. [Tier 3 — The Franchise Weapon](#5-tier-3--the-franchise-weapon)
6. [Tier 4 — The Deliverable](#6-tier-4--the-deliverable)
7. [Tier 5 — The Experience Layer](#7-tier-5--the-experience-layer)
8. [Migration Summary](#8-migration-summary)
9. [API Routes](#9-api-routes)
10. [Verification Queries](#10-verification-queries)
11. [New & Modified Files](#11-new--modified-files)
12. [Implementation Order](#12-implementation-order)

---

## 1. Design Philosophy

### What a Feasibility Study IS vs. What Business Plans and Projections ARE

The business plan answers: **"What is this business and how will it operate?"**  
The projections answer: **"What will the numbers look like?"**  
The feasibility study answers: **"Should this business exist in this specific form, in this specific location, at this specific time?"**

A feasibility study is a JUDGMENT system. It is the only deliverable in Buddy's arsenal that is willing to say **"don't do this."** That honesty is what makes a $20,000 consultant worth the money — they tell you the truth before you spend $500,000 on a franchise that was never going to work in your market.

### The $20,000 Expert Experience

The expert shows up having already done the homework. They know your industry, your geography, your competitive dynamics, your demographics. They don't interrogate you — they CONFIRM what they already know and ask the 5 questions only you can answer. The experience feels like talking to someone who already believes in your deal and is building the case WITH you — but will tell you honestly if the case doesn't hold.

### Governing Principles

1. **Feasibility is deterministic analysis, not LLM opinion.** The scoring engine is pure math. Gemini writes the narrative around the scores — it does NOT produce the scores.
2. **Every feasibility dimension is grounded in data.** No score exists without a data source. If the data is missing, the dimension is scored as "Insufficient Data" — never guessed.
3. **The study consumes existing systems — it does NOT duplicate them.** BIE research, SBA projections, financial spreading, franchise intelligence are all INPUTS. The feasibility engine is an analytical layer ABOVE them.
4. **The go/no-go recommendation is programmatic.** A composite score below threshold = "Not Recommended." Above threshold = "Recommended." Between = "Conditional." The narrative explains why — it does not override the math.
5. **Franchise deals get richer analysis because richer data exists.** Non-franchise deals still get a full feasibility study, but franchise deals benefit from FDD Item 7/19 data, system-wide performance benchmarks, and brand-level failure rates.

### Architectural Position

The feasibility study sits cleanly within Buddy's role as the analytical/policy enforcement layer. It is an analytical output — it doesn't execute anything. It doesn't cross into Omega's advisory domain. It stays on the deterministic side of the SR 11-7 boundary.

---

## 2. Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    FEASIBILITY ENGINE                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Market    │  │Financial │  │Operation-│  │ Location │    │
│  │ Demand   │  │Viability │  │al Readi- │  │ Suitabi- │    │
│  │ Analysis │  │ Analysis │  │ness      │  │ lity     │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │              │              │              │          │
│       ▼              ▼              ▼              ▼          │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           COMPOSITE FEASIBILITY SCORER               │    │
│  │    (weighted average → 0-100 score → recommendation) │    │
│  └──────────────────┬───────────────────────────────────┘    │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              NARRATIVE GENERATOR                      │    │
│  │  (Gemini Pro — turns scores into consultant prose)    │    │
│  └──────────────────┬───────────────────────────────────┘    │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              PDF RENDERER                             │    │
│  │  (Professional feasibility report — 20-30 pages)      │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

INPUTS (consumed, not duplicated):
├── BIE Research Engine → market intelligence, competitive landscape, industry analysis
├── SBA Projections → 3-year P&L, DSCR, break-even, sensitivity scenarios
├── Financial Spreading → historical financials, ratios, trends
├── Franchise Intelligence DB → FDD data, Item 7/19, brand benchmarks
├── NAICS Benchmarks → industry median performance data
├── Deal Metadata → location, NAICS, loan structure, ownership
└── Borrower Application → business description, experience, equity sources
```

### Module Boundaries

| Module | Responsibility | What it does NOT do |
|--------|---------------|---------------------|
| `feasibilityEngine.ts` | Orchestrates the 4 analysis dimensions, runs the composite scorer, triggers narrative + PDF | Does NOT run BIE research, build projections, or spread financials |
| `marketDemandAnalysis.ts` | Quantifies demand using demographics, competitive density, industry benchmarks | Does NOT write prose — returns structured scores |
| `financialViabilityAnalysis.ts` | Evaluates projected DSCR, break-even, cash runway, capitalization adequacy | Does NOT recompute projections — consumes them |
| `operationalReadinessAnalysis.ts` | Scores management experience, staffing readiness, industry-specific operational factors | Does NOT create the business plan |
| `locationSuitabilityAnalysis.ts` | Evaluates trade area demographics, competitive saturation, site-specific factors | Does NOT run BIE research — consumes it |
| `feasibilityScorer.ts` | Pure function: weighted average of 4 dimension scores → composite + recommendation | No DB, no LLM, no side effects |
| `feasibilityNarrative.ts` | Gemini Pro calls to generate consultant-quality prose from scores + data | Does NOT compute scores |
| `feasibilityRenderer.ts` | PDFKit renderer for the feasibility report | Does NOT call Gemini |

---

## 3. Tier 1 — The Intelligence Foundation

### 3.1 Market Demand Analysis

**New file:** `src/lib/feasibility/marketDemandAnalysis.ts`

This module quantifies whether sufficient demand exists for the proposed business in the proposed location. It does NOT rely on LLM judgment — it computes demand ratios from structured data.

```typescript
import "server-only";
import type { ExtractedResearch } from "@/lib/sba/sbaResearchExtractor";
import type { NAICSBenchmark } from "@/lib/sba/sbaAssumptionBenchmarks";

// ── Types ──────────────────────────────────────────────────────────────

export interface MarketDemandScore {
  overallScore: number;               // 0-100
  populationAdequacy: DimensionScore;
  incomeAlignment: DimensionScore;
  competitiveDensity: DimensionScore;
  demandTrend: DimensionScore;
  dataCompleteness: number;           // 0-1 (what % of inputs were available)
  flags: MarketFlag[];
}

export interface DimensionScore {
  score: number;         // 0-100
  weight: number;        // 0-1 (how much this contributes to overall)
  dataSource: string;    // where the data came from
  dataAvailable: boolean;
  detail: string;        // human-readable explanation of the score
}

export interface MarketFlag {
  severity: "info" | "warning" | "critical";
  dimension: string;
  message: string;
}

// ── Input Types ────────────────────────────────────────────────────────

export interface MarketDemandInput {
  // From deal / borrower application
  city: string | null;
  state: string | null;
  zipCode: string | null;
  naicsCode: string | null;
  naicsDescription: string | null;
  projectedAnnualRevenue: number | null;  // Year 1 from projections

  // From BIE research (extracted)
  research: {
    marketIntelligence: string | null;
    competitiveLandscape: string | null;
    industryOverview: string | null;
    demographicTrends: string | null;
  };

  // From franchise intelligence (if franchise deal)
  franchise: {
    brandName: string | null;
    systemAverageRevenue: number | null;     // from FDD Item 19
    systemMedianRevenue: number | null;
    existingUnitsInMarket: number | null;    // same-brand units in trade area
    territoryExclusive: boolean | null;
    minimumPopulationRequired: number | null;
  } | null;

  // NAICS benchmark
  benchmark: NAICSBenchmark | null;

  // Trade area data (from Census API or pre-loaded)
  tradeArea: {
    populationRadius5mi: number | null;
    populationRadius10mi: number | null;
    medianHouseholdIncome: number | null;
    populationGrowthRate5yr: number | null;  // e.g., 0.08 = 8% over 5 years
    competitorCount: number | null;          // same NAICS within 5mi
    totalBusinesses: number | null;          // all businesses within 5mi
  } | null;
}

// ── Scoring Engine ─────────────────────────────────────────────────────

export function analyzeMarketDemand(input: MarketDemandInput): MarketDemandScore {
  const flags: MarketFlag[] = [];
  let dataPoints = 0;
  let dataAvailable = 0;

  // ── Population Adequacy ──────────────────────────────────────────

  dataPoints++;
  let populationScore: DimensionScore;

  if (input.tradeArea?.populationRadius5mi != null) {
    dataAvailable++;
    const pop = input.tradeArea.populationRadius5mi;

    // Franchise-specific: check against brand minimum
    if (input.franchise?.minimumPopulationRequired) {
      const ratio = pop / input.franchise.minimumPopulationRequired;
      const score = Math.min(100, Math.round(ratio * 80)); // 80 at exact minimum, 100 at 1.25x
      populationScore = {
        score,
        weight: 0.30,
        dataSource: "Census trade area + franchise territory requirements",
        dataAvailable: true,
        detail: `Trade area population: ${pop.toLocaleString()}. Brand minimum: ${input.franchise.minimumPopulationRequired.toLocaleString()}. Ratio: ${ratio.toFixed(2)}x.`,
      };
      if (ratio < 1.0) {
        flags.push({
          severity: "critical",
          dimension: "populationAdequacy",
          message: `Trade area population (${pop.toLocaleString()}) is below the brand's minimum requirement (${input.franchise.minimumPopulationRequired.toLocaleString()}).`,
        });
      }
    } else {
      // Non-franchise: score based on general adequacy for business type
      // Use revenue-per-capita as a proxy
      const revenuePerCapita = input.projectedAnnualRevenue
        ? input.projectedAnnualRevenue / pop
        : null;

      let score = 70; // default adequate
      if (pop > 100000) score = 85;
      if (pop > 250000) score = 90;
      if (pop < 10000) score = 40;
      if (pop < 5000) score = 20;

      // Adjust for revenue-per-capita reasonableness
      if (revenuePerCapita != null && revenuePerCapita > 50) {
        score = Math.max(score - 20, 10);
        flags.push({
          severity: "warning",
          dimension: "populationAdequacy",
          message: `Projected revenue requires $${revenuePerCapita.toFixed(0)} per capita in the trade area — this is high for most consumer businesses.`,
        });
      }

      populationScore = {
        score,
        weight: 0.30,
        dataSource: "Census trade area population",
        dataAvailable: true,
        detail: `5-mile trade area population: ${pop.toLocaleString()}.${revenuePerCapita ? ` Revenue per capita: $${revenuePerCapita.toFixed(0)}.` : ""}`,
      };
    }
  } else {
    populationScore = {
      score: 50,
      weight: 0.30,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Trade area population data not available. Score reflects neutral assumption.",
    };
    flags.push({
      severity: "info",
      dimension: "populationAdequacy",
      message: "Trade area population data unavailable — demographic analysis is limited.",
    });
  }

  // ── Income Alignment ─────────────────────────────────────────────

  dataPoints++;
  let incomeScore: DimensionScore;

  if (input.tradeArea?.medianHouseholdIncome != null) {
    dataAvailable++;
    const mhi = input.tradeArea.medianHouseholdIncome;
    const nationalMedian = 75000; // approximate US median HHI

    // Higher income generally supports more business concepts
    // but some concepts (discount, value) target lower income
    const incomeRatio = mhi / nationalMedian;
    let score = 70;
    if (incomeRatio > 1.3) score = 90;
    if (incomeRatio > 1.1) score = 80;
    if (incomeRatio < 0.8) score = 50;
    if (incomeRatio < 0.6) score = 30;

    incomeScore = {
      score,
      weight: 0.20,
      dataSource: "Census median household income",
      dataAvailable: true,
      detail: `Median household income: $${mhi.toLocaleString()}. National median: $${nationalMedian.toLocaleString()}. Ratio: ${incomeRatio.toFixed(2)}x.`,
    };

    if (incomeRatio < 0.7) {
      flags.push({
        severity: "warning",
        dimension: "incomeAlignment",
        message: `Median household income ($${mhi.toLocaleString()}) is significantly below national median. Verify that the business model targets this income bracket.`,
      });
    }
  } else {
    incomeScore = {
      score: 50,
      weight: 0.20,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Median household income data not available.",
    };
  }

  // ── Competitive Density ──────────────────────────────────────────

  dataPoints++;
  let competitiveScore: DimensionScore;

  if (input.tradeArea?.competitorCount != null) {
    dataAvailable++;
    const competitors = input.tradeArea.competitorCount;
    const pop = input.tradeArea.populationRadius5mi ?? 50000;
    const competitorsPerCapita = competitors / (pop / 10000);

    // Fewer competitors per capita = better opportunity
    let score = 70;
    if (competitorsPerCapita < 1) score = 95;
    if (competitorsPerCapita < 2) score = 85;
    if (competitorsPerCapita > 5) score = 45;
    if (competitorsPerCapita > 10) score = 20;

    // Franchise-specific: existing same-brand units
    if (input.franchise?.existingUnitsInMarket != null && input.franchise.existingUnitsInMarket > 0) {
      if (!input.franchise.territoryExclusive) {
        score = Math.max(score - 15, 10);
        flags.push({
          severity: "warning",
          dimension: "competitiveDensity",
          message: `${input.franchise.existingUnitsInMarket} existing ${input.franchise.brandName} unit(s) in the trade area without exclusive territory protection.`,
        });
      }
    }

    competitiveScore = {
      score,
      weight: 0.30,
      dataSource: "Trade area business count + BIE competitive research",
      dataAvailable: true,
      detail: `${competitors} same-category competitors within 5 miles. ${competitorsPerCapita.toFixed(1)} competitors per 10,000 population.${input.franchise?.existingUnitsInMarket ? ` ${input.franchise.existingUnitsInMarket} same-brand unit(s) in area.` : ""}`,
    };
  } else {
    // Fall back to BIE competitive landscape text analysis
    let score = 50;
    let detail = "Competitor count not available.";

    if (input.research.competitiveLandscape) {
      // Heuristic: presence of research means we have some competitive data
      score = 55;
      detail = "Competitive landscape assessed from research intelligence (no quantitative competitor count available).";
      dataAvailable++;
    }

    competitiveScore = {
      score,
      weight: 0.30,
      dataSource: input.research.competitiveLandscape ? "BIE research (qualitative)" : "Insufficient data",
      dataAvailable: !!input.research.competitiveLandscape,
      detail,
    };
  }

  // ── Demand Trend ─────────────────────────────────────────────────

  dataPoints++;
  let trendScore: DimensionScore;

  if (input.tradeArea?.populationGrowthRate5yr != null) {
    dataAvailable++;
    const growthRate = input.tradeArea.populationGrowthRate5yr;
    const annualized = Math.pow(1 + growthRate, 1 / 5) - 1;

    let score = 60; // flat = neutral
    if (annualized > 0.02) score = 85;
    if (annualized > 0.01) score = 75;
    if (annualized < 0) score = 40;
    if (annualized < -0.01) score = 25;

    trendScore = {
      score,
      weight: 0.20,
      dataSource: "Census population growth data",
      dataAvailable: true,
      detail: `5-year population growth: ${(growthRate * 100).toFixed(1)}% (${(annualized * 100).toFixed(2)}% annualized). ${annualized > 0 ? "Growing" : annualized < 0 ? "Declining" : "Stable"} market.`,
    };

    if (annualized < -0.01) {
      flags.push({
        severity: "warning",
        dimension: "demandTrend",
        message: `Population declining at ${(annualized * 100).toFixed(1)}% annually. Shrinking customer base is a structural headwind.`,
      });
    }
  } else {
    trendScore = {
      score: 50,
      weight: 0.20,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Population trend data not available.",
    };
  }

  // ── Composite ────────────────────────────────────────────────────

  const dimensions = [populationScore, incomeScore, competitiveScore, trendScore];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const overallScore = Math.round(weightedSum / totalWeight);

  return {
    overallScore,
    populationAdequacy: populationScore,
    incomeAlignment: incomeScore,
    competitiveDensity: competitiveScore,
    demandTrend: trendScore,
    dataCompleteness: dataAvailable / dataPoints,
    flags,
  };
}
```

### 3.2 Financial Viability Analysis

**New file:** `src/lib/feasibility/financialViabilityAnalysis.ts`

This module consumes the EXISTING projections from `buddy_sba_packages` and evaluates whether the financials support the proposed venture. It does NOT recompute projections — it judges them.

```typescript
import "server-only";

// ── Types ──────────────────────────────────────────────────────────────

export interface FinancialViabilityScore {
  overallScore: number;             // 0-100
  debtServiceCoverage: DimensionScore;
  breakEvenMargin: DimensionScore;
  capitalizationAdequacy: DimensionScore;
  cashRunway: DimensionScore;
  downsideResilience: DimensionScore;
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface FinancialViabilityInput {
  // From buddy_sba_packages (existing projections)
  dscrYear1Base: number | null;
  dscrYear2Base: number | null;
  dscrYear3Base: number | null;
  dscrYear1Downside: number | null;
  breakEvenRevenue: number | null;
  projectedRevenueYear1: number | null;
  marginOfSafetyPct: number | null;

  // From sensitivity scenarios
  downsideDscrYear1: number | null;

  // From sources and uses
  equityInjectionPct: number | null;
  totalProjectCost: number | null;
  workingCapitalReserveMonths: number | null;

  // From global cash flow
  globalDscr: number | null;
  guarantorsWithNegativeCF: string[];

  // From balance sheet projections
  currentRatioYear1: number | null;
  debtToEquityYear1: number | null;

  // From financial spreading (historical)
  historicalRevenueGrowth: number | null;  // actual growth last year
  historicalEBITDAMargin: number | null;

  // Deal metadata
  isNewBusiness: boolean;
  loanAmount: number;
  loanTermMonths: number;
}

// ── Scoring Engine ─────────────────────────────────────────────────────

export function analyzeFinancialViability(input: FinancialViabilityInput): FinancialViabilityScore {
  const flags: MarketFlag[] = [];

  // ── DSCR Coverage ────────────────────────────────────────────────

  let dscrScore: DimensionScore;
  if (input.dscrYear1Base != null) {
    const dscr = input.dscrYear1Base;
    let score = 0;
    if (dscr >= 2.0) score = 95;
    else if (dscr >= 1.5) score = 85;
    else if (dscr >= 1.25) score = 70;
    else if (dscr >= 1.1) score = 45;
    else if (dscr >= 1.0) score = 25;
    else score = 10;

    // Bonus for improving DSCR trajectory
    if (input.dscrYear2Base != null && input.dscrYear3Base != null) {
      if (input.dscrYear2Base > dscr && input.dscrYear3Base > input.dscrYear2Base) {
        score = Math.min(100, score + 5);
      }
      if (input.dscrYear2Base < dscr) {
        score = Math.max(0, score - 5);
        flags.push({
          severity: "warning",
          dimension: "debtServiceCoverage",
          message: `DSCR declines from ${dscr.toFixed(2)}x in Year 1 to ${input.dscrYear2Base.toFixed(2)}x in Year 2. Verify revenue assumptions.`,
        });
      }
    }

    if (dscr < 1.25) {
      flags.push({
        severity: "critical",
        dimension: "debtServiceCoverage",
        message: `Year 1 DSCR of ${dscr.toFixed(2)}x is below the SBA minimum threshold of 1.25x.`,
      });
    }

    dscrScore = {
      score,
      weight: 0.30,
      dataSource: "SBA projection model — base case",
      dataAvailable: true,
      detail: `Year 1 DSCR: ${dscr.toFixed(2)}x.${input.dscrYear2Base ? ` Year 2: ${input.dscrYear2Base.toFixed(2)}x.` : ""}${input.dscrYear3Base ? ` Year 3: ${input.dscrYear3Base.toFixed(2)}x.` : ""} SBA minimum: 1.25x.`,
    };
  } else {
    dscrScore = {
      score: 0,
      weight: 0.30,
      dataSource: "Projections not available",
      dataAvailable: false,
      detail: "Financial projections have not been generated. DSCR cannot be evaluated.",
    };
    flags.push({
      severity: "critical",
      dimension: "debtServiceCoverage",
      message: "No financial projections available. Generate projections before running feasibility analysis.",
    });
  }

  // ── Break-Even Margin ────────────────────────────────────────────

  let breakEvenScore: DimensionScore;
  if (input.marginOfSafetyPct != null) {
    const mos = input.marginOfSafetyPct;
    let score = 0;
    if (mos >= 0.40) score = 95;
    else if (mos >= 0.25) score = 80;
    else if (mos >= 0.15) score = 65;
    else if (mos >= 0.10) score = 50;
    else if (mos >= 0.05) score = 30;
    else score = 15;

    if (mos < 0.10) {
      flags.push({
        severity: "warning",
        dimension: "breakEvenMargin",
        message: `Margin of safety is ${(mos * 100).toFixed(1)}% — less than 10% cushion above break-even.`,
      });
    }

    breakEvenScore = {
      score,
      weight: 0.20,
      dataSource: "SBA projection model — break-even analysis",
      dataAvailable: true,
      detail: `Margin of safety: ${(mos * 100).toFixed(1)}%. Projected revenue exceeds break-even by $${input.projectedRevenueYear1 && input.breakEvenRevenue ? Math.round(input.projectedRevenueYear1 - input.breakEvenRevenue).toLocaleString() : "N/A"}.`,
    };
  } else {
    breakEvenScore = {
      score: 0,
      weight: 0.20,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Break-even analysis not available.",
    };
  }

  // ── Capitalization Adequacy ──────────────────────────────────────

  let capScore: DimensionScore;
  if (input.equityInjectionPct != null) {
    const equity = input.equityInjectionPct;
    const minimum = input.isNewBusiness ? 0.20 : 0.10;
    let score = 0;
    if (equity >= minimum * 2) score = 95;
    else if (equity >= minimum * 1.5) score = 80;
    else if (equity >= minimum) score = 65;
    else if (equity >= minimum * 0.8) score = 35;
    else score = 15;

    if (equity < minimum) {
      flags.push({
        severity: "critical",
        dimension: "capitalizationAdequacy",
        message: `Equity injection of ${(equity * 100).toFixed(1)}% is below SBA minimum of ${(minimum * 100).toFixed(0)}%.`,
      });
    }

    capScore = {
      score,
      weight: 0.15,
      dataSource: "Sources & Uses analysis",
      dataAvailable: true,
      detail: `Equity injection: ${(equity * 100).toFixed(1)}%. Minimum required: ${(minimum * 100).toFixed(0)}% (${input.isNewBusiness ? "new business" : "existing business"}).`,
    };
  } else {
    capScore = {
      score: 0,
      weight: 0.15,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Equity injection data not available.",
    };
  }

  // ── Cash Runway ──────────────────────────────────────────────────

  let cashScore: DimensionScore;
  if (input.workingCapitalReserveMonths != null) {
    const months = input.workingCapitalReserveMonths;
    let score = 0;
    if (months >= 6) score = 95;
    else if (months >= 4) score = 80;
    else if (months >= 3) score = 65;
    else if (months >= 2) score = 40;
    else score = 20;

    if (months < 3) {
      flags.push({
        severity: "warning",
        dimension: "cashRunway",
        message: `Working capital reserve of ${months.toFixed(1)} months is below the recommended 3-month minimum.`,
      });
    }

    cashScore = {
      score,
      weight: 0.15,
      dataSource: "Sources & Uses — working capital allocation",
      dataAvailable: true,
      detail: `Working capital reserve: ${months.toFixed(1)} months of operating expenses. Recommended: 3-6 months.`,
    };
  } else {
    cashScore = {
      score: 50,
      weight: 0.15,
      dataSource: "Not specified",
      dataAvailable: false,
      detail: "Working capital reserve not explicitly budgeted.",
    };
  }

  // ── Downside Resilience ──────────────────────────────────────────

  let downsideScore: DimensionScore;
  if (input.downsideDscrYear1 != null) {
    const dd = input.downsideDscrYear1;
    let score = 0;
    if (dd >= 1.25) score = 95;
    else if (dd >= 1.1) score = 75;
    else if (dd >= 1.0) score = 55;
    else if (dd >= 0.8) score = 30;
    else score = 10;

    if (dd < 1.0) {
      flags.push({
        severity: "critical",
        dimension: "downsideResilience",
        message: `In the downside scenario, DSCR falls to ${dd.toFixed(2)}x — the business cannot cover debt service if revenue underperforms.`,
      });
    }

    downsideScore = {
      score,
      weight: 0.20,
      dataSource: "Sensitivity analysis — downside scenario",
      dataAvailable: true,
      detail: `Downside DSCR: ${dd.toFixed(2)}x. The business ${dd >= 1.0 ? "can" : "CANNOT"} service its debt if revenue underperforms by 15% with 2% cost pressure.`,
    };
  } else {
    downsideScore = {
      score: 0,
      weight: 0.20,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Sensitivity analysis not available.",
    };
  }

  // ── Composite ────────────────────────────────────────────────────

  const dimensions = [dscrScore, breakEvenScore, capScore, cashScore, downsideScore];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const overallScore = Math.round(weightedSum / totalWeight);

  const dataPoints = dimensions.length;
  const available = dimensions.filter(d => d.dataAvailable).length;

  return {
    overallScore,
    debtServiceCoverage: dscrScore,
    breakEvenMargin: breakEvenScore,
    capitalizationAdequacy: capScore,
    cashRunway: cashScore,
    downsideResilience: downsideScore,
    dataCompleteness: available / dataPoints,
    flags,
  };
}
```

### 3.3 Operational Readiness Analysis

**New file:** `src/lib/feasibility/operationalReadinessAnalysis.ts`

```typescript
import "server-only";

export interface OperationalReadinessScore {
  overallScore: number;
  managementExperience: DimensionScore;
  industryKnowledge: DimensionScore;
  staffingReadiness: DimensionScore;
  franchiseSupport: DimensionScore;    // only scored for franchise deals
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface OperationalReadinessInput {
  // From SBA assumptions — management team
  managementTeam: Array<{
    name: string;
    title: string;
    ownershipPct: number;
    yearsInIndustry: number;
    bio: string;
  }>;

  // From SBA assumptions — staffing
  plannedHires: Array<{
    role: string;
    startMonth: number;
    annualSalary: number;
  }>;

  // From BIE research — management intelligence
  managementIntelligence: string | null;
  managementValidated: boolean;   // identity_confirmed from BIE

  // Franchise-specific
  isFranchise: boolean;
  franchiseTrainingWeeks: number | null;
  franchiseOngoingSupport: string | null;
  franchiseOperationsManual: boolean | null;
}

export function analyzeOperationalReadiness(input: OperationalReadinessInput): OperationalReadinessScore {
  const flags: MarketFlag[] = [];

  // ── Management Experience ────────────────────────────────────────

  const maxExperience = Math.max(0, ...input.managementTeam.map(m => m.yearsInIndustry));
  const totalExperience = input.managementTeam.reduce((s, m) => s + m.yearsInIndustry, 0);
  const hasOperator = input.managementTeam.some(m => m.yearsInIndustry >= 5);
  const hasBio = input.managementTeam.some(m => m.bio.length > 20);

  let mgmtScore = 40; // default: no experience data
  if (maxExperience >= 15) mgmtScore = 95;
  else if (maxExperience >= 10) mgmtScore = 85;
  else if (maxExperience >= 5) mgmtScore = 70;
  else if (maxExperience >= 2) mgmtScore = 55;
  else if (maxExperience > 0) mgmtScore = 40;
  else mgmtScore = 20;

  if (!hasOperator && !input.isFranchise) {
    flags.push({
      severity: "warning",
      dimension: "managementExperience",
      message: "No team member has 5+ years in the industry. First-time operators carry higher execution risk.",
    });
  }

  const managementExperience: DimensionScore = {
    score: mgmtScore,
    weight: input.isFranchise ? 0.30 : 0.40,
    dataSource: "SBA assumption interview — management team",
    dataAvailable: input.managementTeam.length > 0,
    detail: `Lead operator: ${maxExperience} years in industry. Team total: ${totalExperience} years across ${input.managementTeam.length} member(s).`,
  };

  // ── Industry Knowledge ───────────────────────────────────────────

  let industryScore = 50;
  if (input.managementIntelligence && input.managementValidated) {
    industryScore = 75;
  } else if (input.managementIntelligence) {
    industryScore = 60;
  }
  if (hasBio) industryScore = Math.min(100, industryScore + 10);

  const industryKnowledge: DimensionScore = {
    score: industryScore,
    weight: 0.25,
    dataSource: "BIE management intelligence + assumption interview bios",
    dataAvailable: input.managementTeam.length > 0,
    detail: `Management profiles ${input.managementValidated ? "verified" : "unverified"} via BIE research. ${hasBio ? "Detailed bios provided." : "No detailed bios."}`,
  };

  // ── Staffing Readiness ───────────────────────────────────────────

  let staffingScore = 60; // default: adequate
  if (input.plannedHires.length > 0) {
    const firstHireMonth = Math.min(...input.plannedHires.map(h => h.startMonth));
    if (firstHireMonth <= 1) staffingScore = 80; // hiring immediately = ready
    if (input.plannedHires.length >= 3) staffingScore = Math.min(90, staffingScore + 10);
    staffingScore = Math.min(100, staffingScore);
  }

  const staffingReadiness: DimensionScore = {
    score: staffingScore,
    weight: 0.15,
    dataSource: "SBA assumption interview — planned hires",
    dataAvailable: true,
    detail: `${input.plannedHires.length} planned hire(s). ${input.plannedHires.length > 0 ? `First hire in month ${Math.min(...input.plannedHires.map(h => h.startMonth))}.` : "No additional hires planned."}`,
  };

  // ── Franchise Support ────────────────────────────────────────────

  let franchiseScore: DimensionScore;
  if (input.isFranchise) {
    let score = 60;
    if (input.franchiseTrainingWeeks && input.franchiseTrainingWeeks >= 4) score += 15;
    if (input.franchiseTrainingWeeks && input.franchiseTrainingWeeks >= 8) score += 10;
    if (input.franchiseOperationsManual) score += 10;
    if (input.franchiseOngoingSupport) score += 5;
    score = Math.min(100, score);

    franchiseScore = {
      score,
      weight: 0.30,
      dataSource: "FDD franchise support data",
      dataAvailable: true,
      detail: `Training: ${input.franchiseTrainingWeeks ?? "unknown"} weeks. Operations manual: ${input.franchiseOperationsManual ? "yes" : "unknown"}. Ongoing support: ${input.franchiseOngoingSupport ?? "not specified"}.`,
    };
  } else {
    franchiseScore = {
      score: 0,
      weight: 0,
      dataSource: "N/A — not a franchise",
      dataAvailable: false,
      detail: "Non-franchise deal — franchise support dimension not scored.",
    };
  }

  // ── Composite ────────────────────────────────────────────────────

  const dimensions = [managementExperience, industryKnowledge, staffingReadiness, ...(input.isFranchise ? [franchiseScore] : [])];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const overallScore = Math.round(weightedSum / totalWeight);

  return {
    overallScore,
    managementExperience,
    industryKnowledge,
    staffingReadiness,
    franchiseSupport: franchiseScore,
    dataCompleteness: dimensions.filter(d => d.dataAvailable).length / dimensions.length,
    flags,
  };
}
```

### 3.4 Location Suitability Analysis

**New file:** `src/lib/feasibility/locationSuitabilityAnalysis.ts`

```typescript
import "server-only";

export interface LocationSuitabilityScore {
  overallScore: number;
  economicHealth: DimensionScore;
  realEstateMarket: DimensionScore;
  accessAndVisibility: DimensionScore;
  riskExposure: DimensionScore;
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface LocationSuitabilityInput {
  city: string | null;
  state: string | null;
  zipCode: string | null;

  // From BIE research
  research: {
    marketIntelligence: string | null;     // includes local economic conditions
    areaSpecificRisks: string | null;
    realEstateMarket: string | null;
    trendDirection: "improving" | "stable" | "deteriorating" | "unclear" | null;
  };

  // From trade area data
  tradeArea: {
    unemploymentRate: number | null;       // local vs national (3.9% national approx)
    medianHouseholdIncome: number | null;
    populationGrowthRate5yr: number | null;
    commercialVacancyRate: number | null;  // if available
    medianRentPsf: number | null;         // commercial rent $/sqft if available
  } | null;

  // Property-specific (from deal metadata or borrower input)
  property: {
    hasIdentifiedLocation: boolean;
    isLeaseNegotiated: boolean;
    monthlyRent: number | null;
    squareFootage: number | null;
    zonedCorrectly: boolean | null;
    parkingAdequate: boolean | null;
    trafficCountDaily: number | null;     // if available
  } | null;
}

export function analyzeLocationSuitability(input: LocationSuitabilityInput): LocationSuitabilityScore {
  const flags: MarketFlag[] = [];

  // ── Economic Health ──────────────────────────────────────────────

  let econScore: DimensionScore;
  if (input.research.trendDirection) {
    let score = 50;
    switch (input.research.trendDirection) {
      case "improving": score = 85; break;
      case "stable": score = 65; break;
      case "deteriorating": score = 30; break;
      case "unclear": score = 50; break;
    }

    if (input.tradeArea?.unemploymentRate != null) {
      const ue = input.tradeArea.unemploymentRate;
      if (ue < 0.035) score = Math.min(100, score + 10);
      if (ue > 0.06) score = Math.max(0, score - 15);
      if (ue > 0.08) {
        flags.push({
          severity: "warning",
          dimension: "economicHealth",
          message: `Local unemployment rate of ${(ue * 100).toFixed(1)}% is significantly above national average.`,
        });
      }
    }

    econScore = {
      score,
      weight: 0.30,
      dataSource: "BIE market intelligence + local economic data",
      dataAvailable: true,
      detail: `Market trend: ${input.research.trendDirection}.${input.tradeArea?.unemploymentRate ? ` Local unemployment: ${(input.tradeArea.unemploymentRate * 100).toFixed(1)}%.` : ""}`,
    };
  } else {
    econScore = {
      score: 50,
      weight: 0.30,
      dataSource: "Insufficient data",
      dataAvailable: false,
      detail: "Local economic conditions not assessed.",
    };
  }

  // ── Real Estate Market ───────────────────────────────────────────

  let reScore: DimensionScore;
  let reAvailable = false;

  if (input.property?.hasIdentifiedLocation) {
    reAvailable = true;
    let score = 70; // having a location identified is baseline positive

    if (input.property.isLeaseNegotiated) score += 15;
    if (input.property.zonedCorrectly === true) score += 5;
    if (input.property.zonedCorrectly === false) {
      score -= 30;
      flags.push({
        severity: "critical",
        dimension: "realEstateMarket",
        message: "Proposed location is not correctly zoned for this business type.",
      });
    }
    if (input.property.parkingAdequate === false) {
      score -= 10;
      flags.push({
        severity: "warning",
        dimension: "realEstateMarket",
        message: "Parking at the proposed location may be inadequate for the business type.",
      });
    }

    score = Math.max(0, Math.min(100, score));

    reScore = {
      score,
      weight: 0.25,
      dataSource: "Borrower-provided property details",
      dataAvailable: true,
      detail: `Location identified: yes. Lease negotiated: ${input.property.isLeaseNegotiated ? "yes" : "no"}. Zoning: ${input.property.zonedCorrectly === true ? "confirmed" : input.property.zonedCorrectly === false ? "ISSUE" : "unverified"}.`,
    };
  } else {
    reScore = {
      score: 40,
      weight: 0.25,
      dataSource: "No specific location identified",
      dataAvailable: false,
      detail: "Borrower has not identified a specific property. Location-specific analysis is limited.",
    };
    flags.push({
      severity: "info",
      dimension: "realEstateMarket",
      message: "No specific property identified. Feasibility is assessed at the market level only.",
    });
  }

  // ── Access & Visibility ──────────────────────────────────────────

  let accessScore: DimensionScore;
  if (input.property?.trafficCountDaily != null) {
    const traffic = input.property.trafficCountDaily;
    let score = 50;
    if (traffic > 30000) score = 90;
    else if (traffic > 20000) score = 80;
    else if (traffic > 10000) score = 65;
    else if (traffic > 5000) score = 50;
    else score = 35;

    accessScore = {
      score,
      weight: 0.20,
      dataSource: "Traffic count data",
      dataAvailable: true,
      detail: `Daily traffic count: ${traffic.toLocaleString()} vehicles.`,
    };
  } else {
    accessScore = {
      score: 50,
      weight: 0.20,
      dataSource: "Not available",
      dataAvailable: false,
      detail: "Traffic count data not available. Access and visibility not quantified.",
    };
  }

  // ── Risk Exposure ────────────────────────────────────────────────

  let riskScore: DimensionScore;
  let riskAvailable = false;

  if (input.research.areaSpecificRisks) {
    riskAvailable = true;
    // Heuristic: presence of research = some risk data available
    // Start at 70 (most areas are reasonably safe) and deduct for known risks
    let score = 70;

    const riskText = input.research.areaSpecificRisks.toLowerCase();
    if (riskText.includes("flood") || riskText.includes("hurricane") || riskText.includes("wildfire")) {
      score -= 15;
      flags.push({
        severity: "warning",
        dimension: "riskExposure",
        message: "Natural disaster exposure identified in trade area. Verify insurance availability and cost.",
      });
    }
    if (riskText.includes("single employer") || riskText.includes("economic concentration")) {
      score -= 10;
    }
    if (riskText.includes("crime") && (riskText.includes("high") || riskText.includes("elevated"))) {
      score -= 10;
    }

    score = Math.max(0, Math.min(100, score));

    riskScore = {
      score,
      weight: 0.25,
      dataSource: "BIE area risk assessment",
      dataAvailable: true,
      detail: "Area-specific risks assessed from research intelligence.",
    };
  } else {
    riskScore = {
      score: 50,
      weight: 0.25,
      dataSource: "Not assessed",
      dataAvailable: false,
      detail: "Area-specific risk assessment not available.",
    };
  }

  // ── Composite ────────────────────────────────────────────────────

  const dimensions = [econScore, reScore, accessScore, riskScore];
  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const weightedSum = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const overallScore = Math.round(weightedSum / totalWeight);

  return {
    overallScore,
    economicHealth: econScore,
    realEstateMarket: reScore,
    accessAndVisibility: accessScore,
    riskExposure: riskScore,
    dataCompleteness: dimensions.filter(d => d.dataAvailable).length / dimensions.length,
    flags,
  };
}
```

---

## 4. Tier 2 — The Feasibility Scoring Engine

### 4.1 Composite Feasibility Scorer

**New file:** `src/lib/feasibility/feasibilityScorer.ts`

This is the heart of the system. Pure function. No DB, no LLM, no side effects.

```typescript
// ── Types ──────────────────────────────────────────────────────────────

export type FeasibilityRecommendation =
  | "Strongly Recommended"    // 80-100
  | "Recommended"             // 65-79
  | "Conditionally Feasible"  // 50-64
  | "Significant Concerns"    // 35-49
  | "Not Recommended";        // 0-34

export interface CompositeFeasibilityScore {
  overallScore: number;                       // 0-100
  recommendation: FeasibilityRecommendation;
  confidenceLevel: "High" | "Moderate" | "Low";  // based on data completeness

  // Dimension scores
  marketDemand: { score: number; weight: number };
  financialViability: { score: number; weight: number };
  operationalReadiness: { score: number; weight: number };
  locationSuitability: { score: number; weight: number };

  // Aggregate flags
  criticalFlags: number;
  warningFlags: number;
  infoFlags: number;
  allFlags: MarketFlag[];

  // Data quality
  overallDataCompleteness: number;  // 0-1
  dimensionsMissingData: string[];
}

// ── Weights ────────────────────────────────────────────────────────────

// Default weights for non-franchise deals
const DEFAULT_WEIGHTS = {
  marketDemand: 0.30,
  financialViability: 0.35,
  operationalReadiness: 0.15,
  locationSuitability: 0.20,
};

// Franchise deals: financial viability slightly less (franchise system support reduces risk),
// operational readiness slightly more (franchise execution is critical)
const FRANCHISE_WEIGHTS = {
  marketDemand: 0.25,
  financialViability: 0.30,
  operationalReadiness: 0.25,
  locationSuitability: 0.20,
};

// ── Scorer ──────────────────────────────────────────────────────────────

export function computeCompositeFeasibility(params: {
  marketDemand: MarketDemandScore;
  financialViability: FinancialViabilityScore;
  operationalReadiness: OperationalReadinessScore;
  locationSuitability: LocationSuitabilityScore;
  isFranchise: boolean;
}): CompositeFeasibilityScore {
  const weights = params.isFranchise ? FRANCHISE_WEIGHTS : DEFAULT_WEIGHTS;

  const weightedSum =
    params.marketDemand.overallScore * weights.marketDemand +
    params.financialViability.overallScore * weights.financialViability +
    params.operationalReadiness.overallScore * weights.operationalReadiness +
    params.locationSuitability.overallScore * weights.locationSuitability;

  const overallScore = Math.round(weightedSum);

  // ── Recommendation ─────────────────────────────────────────────

  // Critical flags can override a good score
  const allFlags = [
    ...params.marketDemand.flags,
    ...params.financialViability.flags,
    ...params.operationalReadiness.flags,
    ...params.locationSuitability.flags,
  ];

  const criticalFlags = allFlags.filter(f => f.severity === "critical").length;
  const warningFlags = allFlags.filter(f => f.severity === "warning").length;

  let recommendation: FeasibilityRecommendation;
  if (criticalFlags >= 3) {
    recommendation = "Not Recommended";
  } else if (criticalFlags >= 2 && overallScore < 65) {
    recommendation = "Not Recommended";
  } else if (overallScore >= 80 && criticalFlags === 0) {
    recommendation = "Strongly Recommended";
  } else if (overallScore >= 65) {
    recommendation = criticalFlags > 0 ? "Conditionally Feasible" : "Recommended";
  } else if (overallScore >= 50) {
    recommendation = "Conditionally Feasible";
  } else if (overallScore >= 35) {
    recommendation = "Significant Concerns";
  } else {
    recommendation = "Not Recommended";
  }

  // ── Confidence ─────────────────────────────────────────────────

  const dataCompletenessAvg = (
    params.marketDemand.dataCompleteness +
    params.financialViability.dataCompleteness +
    params.operationalReadiness.dataCompleteness +
    params.locationSuitability.dataCompleteness
  ) / 4;

  let confidenceLevel: "High" | "Moderate" | "Low";
  if (dataCompletenessAvg >= 0.75) confidenceLevel = "High";
  else if (dataCompletenessAvg >= 0.50) confidenceLevel = "Moderate";
  else confidenceLevel = "Low";

  const dimensionsMissingData: string[] = [];
  if (params.marketDemand.dataCompleteness < 0.50) dimensionsMissingData.push("Market Demand");
  if (params.financialViability.dataCompleteness < 0.50) dimensionsMissingData.push("Financial Viability");
  if (params.operationalReadiness.dataCompleteness < 0.50) dimensionsMissingData.push("Operational Readiness");
  if (params.locationSuitability.dataCompleteness < 0.50) dimensionsMissingData.push("Location Suitability");

  return {
    overallScore,
    recommendation,
    confidenceLevel,
    marketDemand: { score: params.marketDemand.overallScore, weight: weights.marketDemand },
    financialViability: { score: params.financialViability.overallScore, weight: weights.financialViability },
    operationalReadiness: { score: params.operationalReadiness.overallScore, weight: weights.operationalReadiness },
    locationSuitability: { score: params.locationSuitability.overallScore, weight: weights.locationSuitability },
    criticalFlags,
    warningFlags,
    infoFlags: allFlags.filter(f => f.severity === "info").length,
    allFlags,
    overallDataCompleteness: dataCompletenessAvg,
    dimensionsMissingData,
  };
}
```

### 4.2 Franchise Comparative Analysis

**New file:** `src/lib/feasibility/franchiseComparator.ts`

For franchise deals, this is the killer feature. It doesn't just evaluate the proposed concept — it shows what ELSE could work in this location.

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface FranchiseComparison {
  brandName: string;
  feasibilityScore: number;        // 0-100 computed for this brand in this location
  systemAverageRevenue: number | null;
  initialInvestmentLow: number | null;
  initialInvestmentHigh: number | null;
  royaltyPct: number | null;
  sbaCertified: boolean;
  matchReasons: string[];           // why this brand fits the borrower's profile
  riskFactors: string[];            // brand-specific risks
}

export interface ComparativeAnalysisResult {
  proposedBrand: FranchiseComparison | null;
  alternatives: FranchiseComparison[];      // up to 3 alternatives
  proposedRank: number;                      // 1 = best, 4 = worst
  betterAlternativeExists: boolean;
}

/**
 * Compare the proposed franchise concept against alternatives that fit
 * the same borrower profile and location. Uses the franchise intelligence DB.
 *
 * NOTE: This function requires the franchise intelligence tables to exist.
 * If tables don't exist yet, it returns null gracefully.
 */
export async function runFranchiseComparison(params: {
  proposedBrandId: string | null;
  proposedBrandName: string | null;
  naicsCode: string | null;
  borrowerEquity: number;
  borrowerExperienceYears: number;
  tradeAreaPopulation: number | null;
  tradeAreaMedianIncome: number | null;
}): Promise<ComparativeAnalysisResult | null> {
  const sb = supabaseAdmin();

  // Check if franchise tables exist
  const { data: tables } = await sb
    .from("information_schema.tables" as any)
    .select("table_name")
    .eq("table_schema", "public")
    .like("table_name", "franchise_%");

  if (!tables || tables.length === 0) {
    // Franchise intelligence DB not yet built — return null gracefully
    return null;
  }

  // Query franchise brands in the same NAICS category
  // that fit the borrower's investment capacity
  // This query structure will be finalized when the franchise DB schema is built
  // For now, define the interface and return structure

  // TODO: Implement once franchise_brands table schema is finalized
  // The query should:
  // 1. Find brands in the same or adjacent NAICS codes
  // 2. Filter by initial_investment_low <= borrowerEquity * 5 (80% LTV max)
  // 3. Filter by sba_certified = true
  // 4. Sort by a composite of system revenue performance + brand strength
  // 5. Return top 3 alternatives

  return null; // Placeholder until franchise DB is operational
}
```

---

## 5. Tier 3 — The Franchise Weapon

### 5.1 FDD-Powered Feasibility Enrichment

When the franchise intelligence DB is operational, the feasibility engine gains massive advantages for franchise deals:

**Data that enriches each dimension:**

| Feasibility Dimension | FDD Data Source | What it adds |
|----------------------|-----------------|-------------|
| Market Demand | Item 19 — Financial Performance Representations | Actual system-wide unit revenue to benchmark projected revenue against |
| Market Demand | Item 20 — Outlets & Franchisee Information | System unit count growth/decline trajectory (demand signal) |
| Financial Viability | Item 7 — Initial Investment | Actual startup cost range to validate sources & uses |
| Financial Viability | Item 6 — Other Fees | Royalty, ad fund, tech fees as % of revenue for margin modeling |
| Operational Readiness | Item 11 — Franchisor's Obligations | Training program length, ongoing support commitments |
| Operational Readiness | Item 15 — Obligation to Participate | Owner-operator requirement, daily involvement level |
| Location Suitability | Item 12 — Territory | Exclusive territory terms, territory encroachment protections |
| Location Suitability | Item 20 | Nearest same-brand unit proximity |

### 5.2 Franchise Feasibility Multiplier

**In `feasibilityScorer.ts`, add franchise data quality bonus:**

```typescript
// When franchise data is available, confidence increases because the data is richer
if (params.isFranchise && params.franchiseDataAvailable) {
  // FDD data provides audited financials and operational parameters
  // This is more reliable than general NAICS benchmarks
  if (confidenceLevel === "Moderate") confidenceLevel = "High";
  if (confidenceLevel === "Low") confidenceLevel = "Moderate";
}
```

---

## 6. Tier 4 — The Deliverable

### 6.1 Feasibility Engine Orchestrator

**New file:** `src/lib/feasibility/feasibilityEngine.ts`

This is the main entry point. It gathers all inputs from existing systems, runs all 4 analyses, computes the composite score, generates narratives, and renders the PDF.

```typescript
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractResearchForBusinessPlan } from "@/lib/sba/sbaResearchExtractor";
import { findBenchmarkByNaics } from "@/lib/sba/sbaAssumptionBenchmarks";
import { analyzeMarketDemand } from "./marketDemandAnalysis";
import { analyzeFinancialViability } from "./financialViabilityAnalysis";
import { analyzeOperationalReadiness } from "./operationalReadinessAnalysis";
import { analyzeLocationSuitability } from "./locationSuitabilityAnalysis";
import { computeCompositeFeasibility } from "./feasibilityScorer";
import { generateFeasibilityNarratives } from "./feasibilityNarrative";
import { renderFeasibilityPDF } from "./feasibilityRenderer";
import { runFranchiseComparison } from "./franchiseComparator";

export interface FeasibilityResult {
  ok: boolean;
  error?: string;
  studyId?: string;
  composite?: CompositeFeasibilityScore;
  pdfUrl?: string;
}

export async function generateFeasibilityStudy(params: {
  dealId: string;
  bankId: string;
}): Promise<FeasibilityResult> {
  const sb = supabaseAdmin();
  const { dealId, bankId } = params;

  // ── STEP 1: Gather all inputs from existing systems ──────────

  // 1a. Deal metadata
  const { data: deal } = await sb
    .from("deals")
    .select("id, name, deal_type, city, state, zip_code, naics_code, franchise_brand_id, franchise_brand_name, bank_id")
    .eq("id", dealId)
    .single();

  if (!deal) return { ok: false, error: "Deal not found" };

  // 1b. Borrower application
  const { data: app } = await sb
    .from("borrower_applications")
    .select("naics, industry, years_in_business")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 1c. BIE research
  const research = await extractResearchForBusinessPlan(dealId);

  // 1d. SBA projections (latest package)
  const { data: sbaPackage } = await sb
    .from("buddy_sba_packages")
    .select("*")
    .eq("deal_id", dealId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 1e. SBA assumptions
  const { data: assumptions } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 1f. NAICS benchmark
  const naicsCode = deal.naics_code ?? app?.naics ?? null;
  const benchmark = findBenchmarkByNaics(naicsCode);

  // 1g. Ownership entities (for management team if assumptions missing)
  const { data: owners } = await sb
    .from("deal_ownership_entities")
    .select("id, display_name, entity_type")
    .eq("deal_id", dealId)
    .eq("entity_type", "individual");

  // 1h. Global cash flow
  const { data: guarantorCF } = await sb
    .from("buddy_guarantor_cashflow")
    .select("*")
    .eq("deal_id", dealId);

  // 1i. Financial facts for historical data
  const { data: revenuesFacts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, period_label")
    .eq("deal_id", dealId)
    .in("fact_key", ["TOTAL_REVENUE", "TOTAL_REVENUE_IS", "EBITDA", "EBITDA_IS"])
    .order("period_label", { ascending: false });

  // ── STEP 2: Determine if franchise deal ──────────────────────

  const isFranchise = !!(deal.franchise_brand_id || deal.franchise_brand_name);

  // ── STEP 3: Build trade area data ────────────────────────────
  // NOTE: In v1, trade area data comes from BIE research text analysis.
  // In v2, this will integrate with Census API for quantitative data.

  const tradeArea = buildTradeAreaFromResearch(research, deal);

  // ── STEP 4: Run all 4 analysis dimensions ────────────────────

  const marketDemand = analyzeMarketDemand({
    city: deal.city,
    state: deal.state,
    zipCode: deal.zip_code,
    naicsCode,
    naicsDescription: app?.industry ?? null,
    projectedAnnualRevenue: sbaPackage?.projections_annual?.[0]?.revenue ?? null,
    research: {
      marketIntelligence: research.marketIntelligence,
      competitiveLandscape: research.competitiveLandscape,
      industryOverview: research.industryOverview,
      demographicTrends: null, // extracted separately if available
    },
    franchise: isFranchise ? {
      brandName: deal.franchise_brand_name,
      systemAverageRevenue: null,  // from franchise DB when available
      systemMedianRevenue: null,
      existingUnitsInMarket: null,
      territoryExclusive: null,
      minimumPopulationRequired: null,
    } : null,
    benchmark,
    tradeArea,
  });

  const managementTeam = assumptions?.management_team
    ? (Array.isArray(assumptions.management_team) ? assumptions.management_team : [])
    : (owners ?? []).map((o: any) => ({
        name: o.display_name ?? "",
        title: "Owner",
        ownershipPct: 0,
        yearsInIndustry: 0,
        bio: "",
      }));

  const financialViability = analyzeFinancialViability({
    dscrYear1Base: sbaPackage?.dscr_year1_base ?? null,
    dscrYear2Base: sbaPackage?.dscr_year2_base ?? null,
    dscrYear3Base: sbaPackage?.dscr_year3_base ?? null,
    dscrYear1Downside: sbaPackage?.sensitivity_scenarios?.downside?.dscrYear1 ?? null,
    breakEvenRevenue: sbaPackage?.break_even?.breakEvenRevenue ?? null,
    projectedRevenueYear1: sbaPackage?.projections_annual?.[0]?.revenue ?? null,
    marginOfSafetyPct: sbaPackage?.break_even?.marginOfSafetyPct ?? null,
    downsideDscrYear1: sbaPackage?.sensitivity_scenarios?.downside?.dscrYear1 ?? null,
    equityInjectionPct: sbaPackage?.sources_and_uses?.equityInjectionPct ?? null,
    totalProjectCost: sbaPackage?.sources_and_uses?.totalUses ?? null,
    workingCapitalReserveMonths: null, // computed from S&U if working capital line exists
    globalDscr: sbaPackage?.global_dscr ?? null,
    guarantorsWithNegativeCF: (guarantorCF ?? [])
      .filter((g: any) => {
        const income = (g.w2_salary ?? 0) + (g.other_personal_income ?? 0);
        const obligations = (g.mortgage_payment ?? 0) + (g.auto_payments ?? 0) + (g.student_loans ?? 0) + (g.credit_card_minimums ?? 0) + (g.other_personal_debt ?? 0);
        return income - obligations < 0;
      })
      .map((g: any) => g.entity_id),
    currentRatioYear1: sbaPackage?.balance_sheet_projections?.[1]?.currentRatio ?? null,
    debtToEquityYear1: sbaPackage?.balance_sheet_projections?.[1]?.debtToEquity ?? null,
    historicalRevenueGrowth: null, // computed from revenue facts if 2+ years
    historicalEBITDAMargin: null,
    isNewBusiness: (app?.years_in_business ?? 0) < 2,
    loanAmount: assumptions?.loan_impact?.loanAmount ?? 0,
    loanTermMonths: (assumptions?.loan_impact?.loanTermYears ?? 10) * 12,
  });

  const operationalReadiness = analyzeOperationalReadiness({
    managementTeam,
    plannedHires: assumptions?.cost_assumptions?.plannedHires ?? [],
    managementIntelligence: research.managementIntelligence,
    managementValidated: false, // check BIE entity_validation_passed
    isFranchise,
    franchiseTrainingWeeks: null,    // from franchise DB when available
    franchiseOngoingSupport: null,
    franchiseOperationsManual: null,
  });

  const locationSuitability = analyzeLocationSuitability({
    city: deal.city,
    state: deal.state,
    zipCode: deal.zip_code,
    research: {
      marketIntelligence: research.marketIntelligence,
      areaSpecificRisks: null,    // separate BIE extraction
      realEstateMarket: null,
      trendDirection: null,       // from BIE market trend
    },
    tradeArea: tradeArea ? {
      unemploymentRate: null,
      medianHouseholdIncome: tradeArea.medianHouseholdIncome,
      populationGrowthRate5yr: tradeArea.populationGrowthRate5yr,
      commercialVacancyRate: null,
      medianRentPsf: null,
    } : null,
    property: null,  // future: from deal property data
  });

  // ── STEP 5: Compute composite score ──────────────────────────

  const composite = computeCompositeFeasibility({
    marketDemand,
    financialViability,
    operationalReadiness,
    locationSuitability,
    isFranchise,
  });

  // ── STEP 6: Franchise comparison (if applicable) ─────────────

  let franchiseComparison = null;
  if (isFranchise) {
    franchiseComparison = await runFranchiseComparison({
      proposedBrandId: deal.franchise_brand_id,
      proposedBrandName: deal.franchise_brand_name,
      naicsCode,
      borrowerEquity: sbaPackage?.sources_and_uses?.equityInjectionAmount ?? 0,
      borrowerExperienceYears: Math.max(0, ...managementTeam.map((m: any) => m.yearsInIndustry ?? 0)),
      tradeAreaPopulation: tradeArea?.populationRadius5mi ?? null,
      tradeAreaMedianIncome: tradeArea?.medianHouseholdIncome ?? null,
    });
  }

  // ── STEP 7: Generate narratives ──────────────────────────────

  const narratives = await generateFeasibilityNarratives({
    dealName: deal.name,
    city: deal.city,
    state: deal.state,
    composite,
    marketDemand,
    financialViability,
    operationalReadiness,
    locationSuitability,
    franchiseComparison,
    research,
    isFranchise,
    brandName: deal.franchise_brand_name,
    managementTeam,
  });

  // ── STEP 8: Render PDF ───────────────────────────────────────

  const pdfUrl = await renderFeasibilityPDF({
    dealName: deal.name,
    city: deal.city,
    state: deal.state,
    composite,
    marketDemand,
    financialViability,
    operationalReadiness,
    locationSuitability,
    narratives,
    franchiseComparison,
    isFranchise,
    brandName: deal.franchise_brand_name,
    projections: sbaPackage,
  });

  // ── STEP 9: Store results ────────────────────────────────────

  const { data: study } = await sb
    .from("buddy_feasibility_studies")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      composite_score: composite.overallScore,
      recommendation: composite.recommendation,
      confidence_level: composite.confidenceLevel,
      market_demand_score: marketDemand.overallScore,
      financial_viability_score: financialViability.overallScore,
      operational_readiness_score: operationalReadiness.overallScore,
      location_suitability_score: locationSuitability.overallScore,
      market_demand_detail: marketDemand,
      financial_viability_detail: financialViability,
      operational_readiness_detail: operationalReadiness,
      location_suitability_detail: locationSuitability,
      narratives,
      franchise_comparison: franchiseComparison,
      flags: composite.allFlags,
      data_completeness: composite.overallDataCompleteness,
      pdf_url: pdfUrl,
      projections_package_id: sbaPackage?.id ?? null,
      is_franchise: isFranchise,
      status: "completed",
    })
    .select("id")
    .single();

  return {
    ok: true,
    studyId: study?.id,
    composite,
    pdfUrl,
  };
}

// ── Helper: Extract trade area data from BIE research text ─────────

function buildTradeAreaFromResearch(
  research: ExtractedResearch,
  deal: { city: string | null; state: string | null; zip_code: string | null },
): MarketDemandInput["tradeArea"] | null {
  // In v1: return null (trade area data not yet available programmatically)
  // In v2: integrate Census API for quantitative trade area data
  // In v3: integrate third-party data providers (Esri, Placer.ai, etc.)
  return null;
}
```

### 6.2 Narrative Generator

**New file:** `src/lib/feasibility/feasibilityNarrative.ts`

```typescript
import "server-only";
import { callGeminiJSON } from "@/lib/ai/geminiClient";

export interface FeasibilityNarratives {
  executiveSummary: string;         // 1-page overview with recommendation
  marketDemandNarrative: string;    // 2-3 pages
  financialViabilityNarrative: string;
  operationalReadinessNarrative: string;
  locationSuitabilityNarrative: string;
  riskAssessment: string;           // consolidated risks + mitigations
  recommendation: string;           // final recommendation with conditions
  franchiseComparisonNarrative: string | null;  // only for franchise deals
}

export async function generateFeasibilityNarratives(params: {
  dealName: string;
  city: string | null;
  state: string | null;
  composite: CompositeFeasibilityScore;
  marketDemand: MarketDemandScore;
  financialViability: FinancialViabilityScore;
  operationalReadiness: OperationalReadinessScore;
  locationSuitability: LocationSuitabilityScore;
  franchiseComparison: ComparativeAnalysisResult | null;
  research: ExtractedResearch;
  isFranchise: boolean;
  brandName: string | null;
  managementTeam: any[];
}): Promise<FeasibilityNarratives> {

  // Run all narrative calls in parallel
  const [execResult, marketResult, financialResult, opsResult, locationResult, riskResult, recoResult, franchiseResult] = await Promise.allSettled([

    // ── Executive Summary ──────────────────────────────────────
    callGeminiJSON(`You are a senior feasibility consultant writing the executive summary of a feasibility study.

Borrower: ${params.dealName}
Location: ${params.city ? `${params.city}, ${params.state}` : "Not specified"}
${params.isFranchise ? `Franchise: ${params.brandName}` : ""}

COMPOSITE FEASIBILITY SCORE: ${params.composite.overallScore}/100
RECOMMENDATION: ${params.composite.recommendation}
CONFIDENCE: ${params.composite.confidenceLevel}

Dimension Scores:
- Market Demand: ${params.composite.marketDemand.score}/100
- Financial Viability: ${params.composite.financialViability.score}/100
- Operational Readiness: ${params.composite.operationalReadiness.score}/100
- Location Suitability: ${params.composite.locationSuitability.score}/100

Critical Flags: ${params.composite.criticalFlags}
Warning Flags: ${params.composite.warningFlags}

Write a 400-500 word executive summary that:
1. Opens with the borrower name, location, and proposed business concept
2. States the overall feasibility score and recommendation clearly in the second paragraph
3. Summarizes the strongest dimension and the weakest dimension
4. Lists any critical flags that must be addressed
5. Closes with the specific conditions under which this venture is recommended (or not)

RULES:
- Be honest. If the score is low, say so and explain why.
- Use specific numbers from the scores. "Market demand scored 72/100" not "market demand appears adequate."
- Name management team members when discussing operational readiness.
- This is a judgment document, not a sales pitch.
- Third person, professional tone.

Return ONLY valid JSON: { "executiveSummary": "..." }`),

    // ── Market Demand ──────────────────────────────────────────
    callGeminiJSON(`You are writing the Market Demand section of a feasibility study.

Borrower: ${params.dealName}
Location: ${params.city}, ${params.state}
Score: ${params.marketDemand.overallScore}/100

Dimension Details:
- Population Adequacy: ${params.marketDemand.populationAdequacy.score}/100 — ${params.marketDemand.populationAdequacy.detail}
- Income Alignment: ${params.marketDemand.incomeAlignment.score}/100 — ${params.marketDemand.incomeAlignment.detail}
- Competitive Density: ${params.marketDemand.competitiveDensity.score}/100 — ${params.marketDemand.competitiveDensity.detail}
- Demand Trend: ${params.marketDemand.demandTrend.score}/100 — ${params.marketDemand.demandTrend.detail}

Flags: ${JSON.stringify(params.marketDemand.flags)}

BIE Research Context:
${params.research.marketIntelligence ? `Market Intelligence: ${params.research.marketIntelligence.slice(0, 2000)}` : "No market intelligence available."}
${params.research.competitiveLandscape ? `Competitive Landscape: ${params.research.competitiveLandscape.slice(0, 2000)}` : ""}

Write 600-800 words covering:
1. Trade area demographics and population adequacy
2. Income alignment with the business concept
3. Competitive landscape — who exists, how saturated is the market
4. Demand trajectory — is this market growing or shrinking
5. Specific opportunities or threats identified

RULES:
- Ground every claim in the score data or research. No invented statistics.
- If data was unavailable for a dimension, state that honestly.
- Use the exact numbers from the dimension details.

Return ONLY valid JSON: { "marketDemandNarrative": "..." }`),

    // ── Financial Viability ────────────────────────────────────
    callGeminiJSON(`You are writing the Financial Viability section of a feasibility study.

Score: ${params.financialViability.overallScore}/100

Dimensions:
- DSCR Coverage: ${params.financialViability.debtServiceCoverage.score}/100 — ${params.financialViability.debtServiceCoverage.detail}
- Break-Even Margin: ${params.financialViability.breakEvenMargin.score}/100 — ${params.financialViability.breakEvenMargin.detail}
- Capitalization: ${params.financialViability.capitalizationAdequacy.score}/100 — ${params.financialViability.capitalizationAdequacy.detail}
- Cash Runway: ${params.financialViability.cashRunway.score}/100 — ${params.financialViability.cashRunway.detail}
- Downside Resilience: ${params.financialViability.downsideResilience.score}/100 — ${params.financialViability.downsideResilience.detail}

Flags: ${JSON.stringify(params.financialViability.flags)}

Write 600-800 words. Use exact DSCR numbers, break-even amounts, and margin of safety percentages.

Return ONLY valid JSON: { "financialViabilityNarrative": "..." }`),

    // ── Operational Readiness ──────────────────────────────────
    callGeminiJSON(`You are writing the Operational Readiness section of a feasibility study.

Score: ${params.operationalReadiness.overallScore}/100

Dimensions:
- Management Experience: ${params.operationalReadiness.managementExperience.score}/100 — ${params.operationalReadiness.managementExperience.detail}
- Industry Knowledge: ${params.operationalReadiness.industryKnowledge.score}/100 — ${params.operationalReadiness.industryKnowledge.detail}
- Staffing Readiness: ${params.operationalReadiness.staffingReadiness.score}/100 — ${params.operationalReadiness.staffingReadiness.detail}
${params.isFranchise ? `- Franchise Support: ${params.operationalReadiness.franchiseSupport.score}/100 — ${params.operationalReadiness.franchiseSupport.detail}` : ""}

Management Team:
${params.managementTeam.map((m: any) => `${m.name} (${m.title}, ${m.yearsInIndustry} years): ${m.bio}`).join("\n")}

Write 400-600 words. Name each team member. Be honest about experience gaps.

Return ONLY valid JSON: { "operationalReadinessNarrative": "..." }`),

    // ── Location Suitability ──────────────────────────────────
    callGeminiJSON(`You are writing the Location Suitability section of a feasibility study.

Score: ${params.locationSuitability.overallScore}/100

Dimensions:
- Economic Health: ${params.locationSuitability.economicHealth.score}/100 — ${params.locationSuitability.economicHealth.detail}
- Real Estate: ${params.locationSuitability.realEstateMarket.score}/100 — ${params.locationSuitability.realEstateMarket.detail}
- Access & Visibility: ${params.locationSuitability.accessAndVisibility.score}/100 — ${params.locationSuitability.accessAndVisibility.detail}
- Risk Exposure: ${params.locationSuitability.riskExposure.score}/100 — ${params.locationSuitability.riskExposure.detail}

BIE Market Intelligence: ${params.research.marketIntelligence?.slice(0, 1500) ?? "Not available"}

Write 400-600 words.

Return ONLY valid JSON: { "locationSuitabilityNarrative": "..." }`),

    // ── Risk Assessment ───────────────────────────────────────
    callGeminiJSON(`You are writing the Risk Assessment section of a feasibility study.

All flags from the analysis:
${JSON.stringify(params.composite.allFlags, null, 2)}

Overall Score: ${params.composite.overallScore}/100
Recommendation: ${params.composite.recommendation}

For each critical and warning flag, write:
1. The risk identified
2. The potential impact on the business
3. A specific, actionable mitigation strategy

Write 400-600 words. Be specific. Generic mitigations like "seek professional advice" are not acceptable.

Return ONLY valid JSON: { "riskAssessment": "..." }`),

    // ── Recommendation ────────────────────────────────────────
    callGeminiJSON(`You are writing the final Recommendation section of a feasibility study.

Borrower: ${params.dealName}
Location: ${params.city}, ${params.state}
Score: ${params.composite.overallScore}/100
Recommendation: ${params.composite.recommendation}
Confidence: ${params.composite.confidenceLevel}

Dimension scores:
- Market: ${params.composite.marketDemand.score}
- Financial: ${params.composite.financialViability.score}
- Operational: ${params.composite.operationalReadiness.score}
- Location: ${params.composite.locationSuitability.score}

Critical flags: ${params.composite.criticalFlags}
Dimensions missing data: ${params.composite.dimensionsMissingData.join(", ") || "None"}

Write 300-400 words. State the recommendation clearly in the first sentence. Then explain the conditions:
- If "Recommended" or "Strongly Recommended": what must the borrower execute on to succeed
- If "Conditionally Feasible": what specific changes or additional data would upgrade this to Recommended
- If "Significant Concerns" or "Not Recommended": what fundamental issues must be resolved, and whether pivot is possible

End with a clear, one-sentence verdict.

Return ONLY valid JSON: { "recommendation": "..." }`),

    // ── Franchise Comparison (if applicable) ──────────────────
    params.franchiseComparison
      ? callGeminiJSON(`Write a franchise comparison section... [franchise comparison narrative prompt]
Return ONLY valid JSON: { "franchiseComparisonNarrative": "..." }`)
      : Promise.resolve(null),
  ]);

  // Extract results with fallbacks
  return {
    executiveSummary: extractNarrativeResult(execResult, "executiveSummary"),
    marketDemandNarrative: extractNarrativeResult(marketResult, "marketDemandNarrative"),
    financialViabilityNarrative: extractNarrativeResult(financialResult, "financialViabilityNarrative"),
    operationalReadinessNarrative: extractNarrativeResult(opsResult, "operationalReadinessNarrative"),
    locationSuitabilityNarrative: extractNarrativeResult(locationResult, "locationSuitabilityNarrative"),
    riskAssessment: extractNarrativeResult(riskResult, "riskAssessment"),
    recommendation: extractNarrativeResult(recoResult, "recommendation"),
    franchiseComparisonNarrative: franchiseResult.status === "fulfilled" && franchiseResult.value
      ? extractNarrativeResult(franchiseResult, "franchiseComparisonNarrative")
      : null,
  };
}

function extractNarrativeResult(result: PromiseSettledResult<any>, key: string): string {
  if (result.status === "fulfilled" && result.value) {
    try {
      const parsed = typeof result.value === "string" ? JSON.parse(result.value) : result.value;
      return parsed[key] ?? `${key} generation failed.`;
    } catch {
      return typeof result.value === "string" ? result.value : `${key} generation failed.`;
    }
  }
  return `${key} not available.`;
}
```

### 6.3 PDF Renderer Skeleton

**New file:** `src/lib/feasibility/feasibilityRenderer.ts`

```typescript
import "server-only";
// Uses the same PDFKit patterns as sbaPackageRenderer.ts

export async function renderFeasibilityPDF(params: {
  dealName: string;
  city: string | null;
  state: string | null;
  composite: CompositeFeasibilityScore;
  marketDemand: MarketDemandScore;
  financialViability: FinancialViabilityScore;
  operationalReadiness: OperationalReadinessScore;
  locationSuitability: LocationSuitabilityScore;
  narratives: FeasibilityNarratives;
  franchiseComparison: ComparativeAnalysisResult | null;
  isFranchise: boolean;
  brandName: string | null;
  projections: any;
}): Promise<string> {

  // PAGE STRUCTURE (20-30 pages):
  //
  // Page 1:  Cover Page
  //          - "Feasibility Study" title
  //          - Borrower name, location
  //          - Large composite score badge (color-coded: green/amber/red)
  //          - Recommendation in bold
  //          - Date, confidentiality notice
  //
  // Page 2:  Table of Contents
  //
  // Page 3:  Executive Summary (narrative)
  //
  // Page 4:  Feasibility Scorecard — visual dashboard:
  //          - Composite score gauge (large, centered)
  //          - 4 dimension score bars (horizontal, color-coded)
  //          - Data completeness indicator
  //          - Confidence level badge
  //          - Flag summary (critical / warning / info counts)
  //
  // Pages 5-6:  Market Demand Analysis
  //          - 4 sub-dimension scores with mini-bars
  //          - Narrative text
  //          - Trade area data tables (if available)
  //
  // Pages 7-9:  Financial Viability Analysis
  //          - 5 sub-dimension scores
  //          - DSCR trend chart (if projections exist)
  //          - Break-even analysis summary
  //          - Sensitivity scenario comparison table
  //          - Narrative text
  //
  // Pages 10-11:  Operational Readiness Analysis
  //          - Management team profiles
  //          - Experience scoring
  //          - Franchise support assessment (if applicable)
  //          - Narrative text
  //
  // Pages 12-13:  Location Suitability Analysis
  //          - Economic health indicators
  //          - Site-specific data (if available)
  //          - Risk exposure assessment
  //          - Narrative text
  //
  // Pages 14-15:  Risk Assessment
  //          - Risk matrix: severity × likelihood
  //          - Each risk with impact and mitigation
  //          - Narrative text
  //
  // Pages 16-17:  Franchise Comparison (franchise deals only)
  //          - Proposed brand vs alternatives table
  //          - Scoring comparison chart
  //          - Match reasons and risk factors per brand
  //
  // Page 18:  Recommendation & Conditions
  //          - Clear recommendation with conditions
  //          - Next steps for the borrower
  //          - Data gaps that would improve confidence
  //
  // Page 19:  Methodology & Data Sources
  //          - How each dimension was scored
  //          - Data sources used
  //          - Disclaimer: analytical assessment, not a guarantee

  // Implementation follows the exact same PDFKit patterns as sbaPackageRenderer.ts:
  // - Same PAGE_MARGIN, FONT_BOLD, FONT_NORMAL constants
  // - Same DocState pattern for tracking cursor position
  // - Same renderTable, renderChart helper functions
  // - Same GCS upload pattern for PDF storage

  // TODO: Full renderer implementation — copy patterns from sbaPackageRenderer.ts
  // For now, return empty string to allow the engine to be wired and tested
  return "";
}
```

---

## 7. Tier 5 — The Experience Layer

### 7.1 Voice-Guided Feasibility Discovery

**New file:** `src/lib/voice/feasibilityVoiceSchema.ts`

The voice experience for feasibility is different from the business plan assumption interview. Here, Buddy LEADS with what it already knows and asks the borrower to CONFIRM.

```typescript
export const FEASIBILITY_VOICE_SCHEMA = {
  preamble: "I've already done significant research on your business concept and your market. Let me walk you through what I've found, and you can confirm or correct anything along the way.",

  steps: [
    {
      id: "concept_confirm",
      buddyLeads: true,
      prompt: "Based on what I know, you're looking to [open/expand] a [business type] in [city, state]. Is that correct?",
      extractionFields: ["confirmed_concept", "corrections"],
    },
    {
      id: "location_detail",
      buddyLeads: true,
      prompt: "Have you identified a specific location or property yet? If so, tell me about it — address, square footage, lease terms if you know them.",
      extractionFields: ["property.hasIdentifiedLocation", "property.squareFootage", "property.monthlyRent"],
    },
    {
      id: "experience",
      buddyLeads: false,
      prompt: "Tell me about your background. How many years have you been in this industry, and what roles have you held?",
      extractionFields: ["managementTeam[0].yearsInIndustry", "managementTeam[0].bio"],
    },
    {
      id: "capital",
      buddyLeads: false,
      prompt: "How much personal capital are you prepared to invest in this venture?",
      extractionFields: ["equityAvailable"],
    },
    {
      id: "research_walkthrough",
      buddyLeads: true,
      prompt: "Let me share what I've found about your market. [Buddy presents key findings from BIE research — competitive landscape, demographics, industry outlook]. Does any of this surprise you or differ from what you've observed?",
      extractionFields: ["borrower_market_corrections"],
    },
  ],

  conclusion: "Based on everything we've discussed and the research I've conducted, I'm going to run a comprehensive feasibility analysis. This will score your venture across four dimensions — market demand, financial viability, operational readiness, and location suitability — and give you a clear recommendation. Let me generate that now.",
};
```

### 7.2 Feasibility Dashboard UI

**New file:** `src/components/feasibility/FeasibilityDashboard.tsx`

```typescript
"use client";

// Real-time dashboard showing feasibility results.
// Renders the composite score as a large gauge, 4 dimension scores as horizontal bars,
// flags as an expandable list, and a "Download Full Report" button for the PDF.
//
// Key visual elements:
// - Large circular gauge: composite score with recommendation text
//   - Green (80-100): "Strongly Recommended"
//   - Blue (65-79): "Recommended"
//   - Amber (50-64): "Conditionally Feasible"
//   - Orange (35-49): "Significant Concerns"
//   - Red (0-34): "Not Recommended"
//
// - 4 horizontal dimension bars:
//   - Each shows score/100 with fill color matching the gauge thresholds
//   - Expandable: click to see sub-dimension breakdown
//
// - Confidence indicator: "High / Moderate / Low" with data completeness %
//
// - Flags panel:
//   - Critical flags (red) at top
//   - Warning flags (amber) below
//   - Info flags (blue) collapsed
//
// - Action bar:
//   - "Download Full Report (PDF)"
//   - "Generate Business Plan" (if not already done)
//   - "Regenerate with Updated Data" (if assumptions changed)
//   - "Share with Borrower" (generates a borrower-facing summary)
```

---

## 8. Migration Summary

**Migration:** `20260421_03_feasibility_studies`

```sql
CREATE TABLE IF NOT EXISTS buddy_feasibility_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,

  -- Composite score
  composite_score integer NOT NULL,                -- 0-100
  recommendation text NOT NULL,                    -- enum: 'Strongly Recommended', 'Recommended', 'Conditionally Feasible', 'Significant Concerns', 'Not Recommended'
  confidence_level text NOT NULL DEFAULT 'Low',    -- 'High', 'Moderate', 'Low'

  -- Dimension scores
  market_demand_score integer NOT NULL,
  financial_viability_score integer NOT NULL,
  operational_readiness_score integer NOT NULL,
  location_suitability_score integer NOT NULL,

  -- Full dimension detail (jsonb)
  market_demand_detail jsonb NOT NULL DEFAULT '{}',
  financial_viability_detail jsonb NOT NULL DEFAULT '{}',
  operational_readiness_detail jsonb NOT NULL DEFAULT '{}',
  location_suitability_detail jsonb NOT NULL DEFAULT '{}',

  -- Narratives
  narratives jsonb NOT NULL DEFAULT '{}',

  -- Franchise comparison (null for non-franchise)
  franchise_comparison jsonb,
  is_franchise boolean NOT NULL DEFAULT false,

  -- Flags
  flags jsonb NOT NULL DEFAULT '[]',
  data_completeness numeric NOT NULL DEFAULT 0,

  -- Outputs
  pdf_url text,
  projections_package_id uuid REFERENCES buddy_sba_packages(id),

  -- Metadata
  status text NOT NULL DEFAULT 'pending',  -- 'pending', 'generating', 'completed', 'failed'
  version_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Ensure one active study per deal (can have versions)
  UNIQUE(deal_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_feasibility_deal ON buddy_feasibility_studies(deal_id);
CREATE INDEX IF NOT EXISTS idx_feasibility_score ON buddy_feasibility_studies(composite_score);
CREATE INDEX IF NOT EXISTS idx_feasibility_recommendation ON buddy_feasibility_studies(recommendation);

COMMENT ON TABLE buddy_feasibility_studies IS 'God tier feasibility study results. Consumes BIE research + SBA projections + financial spreading. Deterministic scoring with Gemini narrative overlay.';
```

---

## 9. API Routes

### 9.1 Generate Feasibility Study

**New file:** `src/app/api/deals/[dealId]/feasibility/generate/route.ts`

```typescript
// POST: Generate a new feasibility study
// Gates:
//   - Deal must exist
//   - BIE research must have at least one completed mission
//   - SBA projections recommended but not required (partial study allowed)
// Returns: SSE stream with progress events (same pattern as SBA generate)
```

### 9.2 Get Latest Feasibility Study

**New file:** `src/app/api/deals/[dealId]/feasibility/latest/route.ts`

```typescript
// GET: Return the latest feasibility study for this deal
// Returns: Full study record including all dimension scores, flags, narratives
```

### 9.3 Feasibility Study Versions

**New file:** `src/app/api/deals/[dealId]/feasibility/versions/route.ts`

```typescript
// GET: Return all feasibility study versions with composite scores and recommendations
```

---

## 10. Verification Queries

```sql
-- 1. Verify table exists
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'buddy_feasibility_studies'
ORDER BY ordinal_position;
-- Expected: ~25 columns

-- 2. After generating a study, verify all dimensions scored
SELECT
  id,
  composite_score,
  recommendation,
  confidence_level,
  market_demand_score,
  financial_viability_score,
  operational_readiness_score,
  location_suitability_score,
  data_completeness,
  jsonb_array_length(flags) as flag_count,
  pdf_url IS NOT NULL as has_pdf,
  is_franchise
FROM buddy_feasibility_studies
WHERE deal_id = '<test_deal_id>'
ORDER BY version_number DESC
LIMIT 1;

-- 3. Verify narratives populated
SELECT
  id,
  narratives->>'executiveSummary' IS NOT NULL as has_exec_summary,
  narratives->>'marketDemandNarrative' IS NOT NULL as has_market,
  narratives->>'financialViabilityNarrative' IS NOT NULL as has_financial,
  narratives->>'operationalReadinessNarrative' IS NOT NULL as has_ops,
  narratives->>'locationSuitabilityNarrative' IS NOT NULL as has_location,
  narratives->>'riskAssessment' IS NOT NULL as has_risk,
  narratives->>'recommendation' IS NOT NULL as has_recommendation
FROM buddy_feasibility_studies
WHERE deal_id = '<test_deal_id>'
ORDER BY version_number DESC
LIMIT 1;

-- 4. Verify dimension detail structure
SELECT
  id,
  market_demand_detail->>'overallScore' as market_score,
  market_demand_detail->>'dataCompleteness' as market_data_pct,
  financial_viability_detail->>'overallScore' as fin_score,
  operational_readiness_detail->>'overallScore' as ops_score,
  location_suitability_detail->>'overallScore' as loc_score
FROM buddy_feasibility_studies
WHERE deal_id = '<test_deal_id>'
ORDER BY version_number DESC
LIMIT 1;
```

---

## 11. New & Modified Files

### New Files (15)

| File | Tier | Purpose |
|------|------|---------|
| `src/lib/feasibility/marketDemandAnalysis.ts` | 1 | Market demand scoring — population, income, competitive density, demand trend |
| `src/lib/feasibility/financialViabilityAnalysis.ts` | 1 | Financial viability scoring — DSCR, break-even, capitalization, cash runway, downside |
| `src/lib/feasibility/operationalReadinessAnalysis.ts` | 1 | Operational readiness scoring — management, industry knowledge, staffing, franchise support |
| `src/lib/feasibility/locationSuitabilityAnalysis.ts` | 1 | Location scoring — economic health, real estate, access, risk exposure |
| `src/lib/feasibility/feasibilityScorer.ts` | 2 | Composite scorer — weighted average + recommendation + confidence |
| `src/lib/feasibility/franchiseComparator.ts` | 3 | Franchise brand comparison (placeholder until franchise DB is live) |
| `src/lib/feasibility/feasibilityEngine.ts` | 4 | Main orchestrator — gathers inputs, runs analyses, generates narratives, renders PDF |
| `src/lib/feasibility/feasibilityNarrative.ts` | 4 | 8 parallel Gemini Pro calls for consultant-quality narrative sections |
| `src/lib/feasibility/feasibilityRenderer.ts` | 4 | PDFKit renderer for 20-30 page feasibility report |
| `src/lib/voice/feasibilityVoiceSchema.ts` | 5 | Voice interview schema — Buddy leads with research, borrower confirms |
| `src/components/feasibility/FeasibilityDashboard.tsx` | 5 | Real-time score dashboard with gauge, bars, flags, actions |
| `src/app/api/deals/[dealId]/feasibility/generate/route.ts` | 4 | POST — generate new feasibility study with SSE progress |
| `src/app/api/deals/[dealId]/feasibility/latest/route.ts` | 4 | GET — latest feasibility study |
| `src/app/api/deals/[dealId]/feasibility/versions/route.ts` | 4 | GET — all versions |
| `src/lib/feasibility/types.ts` | 1 | Shared types: DimensionScore, MarketFlag, etc. |

### Modified Files (0)

This system is entirely additive. It CONSUMES existing systems but does NOT modify them.

---

## 12. Implementation Order

Build in this sequence. Each step is independently testable.

1. **Migration** — `buddy_feasibility_studies` table (non-breaking, no FK conflicts)
2. **`types.ts`** — shared types (DimensionScore, MarketFlag, etc.)
3. **`marketDemandAnalysis.ts`** — pure function, no dependencies beyond types
4. **`financialViabilityAnalysis.ts`** — pure function
5. **`operationalReadinessAnalysis.ts`** — pure function
6. **`locationSuitabilityAnalysis.ts`** — pure function
7. **`feasibilityScorer.ts`** — pure function, depends on types only
8. **`franchiseComparator.ts`** — placeholder (returns null until franchise DB)
9. **`feasibilityNarrative.ts`** — Gemini calls, depends on types
10. **`feasibilityRenderer.ts`** — PDFKit, depends on types + narratives
11. **`feasibilityEngine.ts`** — orchestrator, wires everything together
12. **API routes** — generate, latest, versions
13. **`FeasibilityDashboard.tsx`** — UI component
14. **`feasibilityVoiceSchema.ts`** — voice experience schema

**Steps 2-7 can be built and unit tested without any DB, API, or LLM calls.** They are pure functions that accept structured input and return structured output. This makes them easy to test with hardcoded fixtures.

---

## 13. Future Enhancements (v2+)

These are NOT in scope for v1 but are designed to slot in cleanly:

| Enhancement | What it adds | Integration point |
|-------------|-------------|-------------------|
| Census API integration | Quantitative trade area data (population, income, growth rate by radius) | `buildTradeAreaFromResearch()` in feasibilityEngine.ts |
| Esri/Placer.ai integration | Traffic counts, foot traffic, drive-time polygons | `locationSuitabilityAnalysis.ts` — accessAndVisibility dimension |
| Franchise DB integration | FDD Item 7/19 data, brand benchmarks, system performance | `franchiseComparator.ts` + enrichments to all 4 analysis modules |
| Comparative market analysis | "What if this business was in [alternative location]?" | New dimension or mode in the engine |
| Historical feasibility accuracy | Track actual performance of businesses that received feasibility studies | New table + feedback loop to calibrate scoring weights |
| Borrower-facing summary | Simplified, encouraging version of the report for the borrower (vs the full bank-ready version) | New renderer mode |

---

*End of spec. Copy-pasteable for Claude Code. Every file path, type contract, SQL statement, and verification query is exact. The feasibility engine is entirely additive — it consumes existing systems without modifying them.*
