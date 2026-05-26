/**
 * CREDIT_DECISION_QUALITY_CONTRACT_V1
 *
 * Tests the conventional risk rating model, DSCR reconciliation,
 * exhibit registry, and data sufficiency evaluator.
 *
 * Pure module — no server-only.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildConventionalRiskRating, DEFAULT_RISK_SCALE } from "@/lib/creditMemo/riskRating/buildConventionalRiskRating";
import { buildExhibitRegistry } from "@/lib/creditMemo/canonical/buildExhibitRegistry";
import { buildDscrReconciliation } from "@/lib/creditMemo/financials/buildDscrReconciliation";
import { evaluateCreditDecisionDataSufficiency } from "@/lib/creditMemo/decisionQuality/evaluateCreditDecisionDataSufficiency";

// ══════════════════════════════════════════════════════════════════════════
// 1. Conventional risk rating
// ══════════════════════════════════════════════════════════════════════════

describe("DECISION §1 — Conventional risk rating model", () => {
  it("strong DSCR + collateral + guarantor does not produce D/Substandard", () => {
    const r = buildConventionalRiskRating({
      dscr: 7.12,
      stressedDscr: 4.93,
      worstYearDscr: 2.03,
      cfadsTrend: "down",
      revenueTrend: "down",
      ltvPct: 49.88,
      collateralCoverageRatio: 1.60,
      arBorrowingBaseAvailable: true,
      guarantorNetWorth: 24_840_000,
      currentRatio: 4.5,
      debtToEquity: 0.11,
      grossMarginPct: 0.136,
      managementYearsExperience: 25,
      characterScore: 4,
      gcfComplete: false,
      formalDiligenceComplete: false,
      customerConcentrationRisk: true,
      hasAdverseFindings: false,
      financialStatementQuality: "tax_returns",
    });

    assert.ok(r.risk_grade <= 5, `Strong deal must not be Grade 6+ (Substandard), got ${r.risk_grade} — ${r.risk_grade_label}`);
    assert.ok(r.risk_grade >= 3, `Incomplete GCF/diligence should cap at Grade 3+, got ${r.risk_grade}`);
    assert.ok(r.score >= 45, `Score should be >= 45, got ${r.score}`);
    assert.ok(r.grade_bridge.length > 0, "Must have grade bridge entries");
    assert.ok(r.primary_drivers.some((d) => d.impact === "positive"), "Must have positive drivers");
  });

  it("thin margin + declining trend caps but does not drive to Substandard", () => {
    const r = buildConventionalRiskRating({
      dscr: 2.5,
      stressedDscr: 1.8,
      worstYearDscr: 2.0,
      cfadsTrend: "down",
      revenueTrend: "down",
      ltvPct: 65,
      collateralCoverageRatio: null,
      arBorrowingBaseAvailable: false,
      guarantorNetWorth: 500_000,
      currentRatio: 1.2,
      debtToEquity: 1.5,
      grossMarginPct: 0.12,
      managementYearsExperience: 10,
      characterScore: 3,
      gcfComplete: false,
      formalDiligenceComplete: false,
      customerConcentrationRisk: false,
      hasAdverseFindings: false,
      financialStatementQuality: "compiled",
    });

    assert.ok(r.risk_grade <= 5, `Should be Watch or better, got ${r.risk_grade}`);
    assert.ok(r.primary_drivers.some((d) => d.factor === "Margins"), "Must flag margins");
  });

  it("adverse findings can downgrade to Special Mention", () => {
    const r = buildConventionalRiskRating({
      dscr: 3.0,
      stressedDscr: 2.0,
      worstYearDscr: 2.5,
      cfadsTrend: "up",
      revenueTrend: "up",
      ltvPct: 50,
      collateralCoverageRatio: 2.0,
      arBorrowingBaseAvailable: true,
      guarantorNetWorth: 5_000_000,
      currentRatio: 2.0,
      debtToEquity: 1.0,
      grossMarginPct: 0.40,
      managementYearsExperience: 15,
      characterScore: 2,
      gcfComplete: true,
      formalDiligenceComplete: true,
      customerConcentrationRisk: false,
      hasAdverseFindings: true,
      financialStatementQuality: "reviewed",
    });

    assert.ok(r.risk_grade >= 6, `Adverse findings must floor at Special Mention, got ${r.risk_grade}`);
  });

  it("missing DSCR blocks at Special Mention", () => {
    const r = buildConventionalRiskRating({
      dscr: null,
      stressedDscr: null,
      worstYearDscr: null,
      cfadsTrend: "unknown",
      revenueTrend: "unknown",
      ltvPct: null,
      collateralCoverageRatio: null,
      arBorrowingBaseAvailable: false,
      guarantorNetWorth: null,
      currentRatio: null,
      debtToEquity: null,
      grossMarginPct: null,
      managementYearsExperience: null,
      characterScore: 3,
      gcfComplete: false,
      formalDiligenceComplete: false,
      customerConcentrationRisk: false,
      hasAdverseFindings: false,
      financialStatementQuality: "unknown",
    });

    assert.ok(r.risk_grade >= 6, `No DSCR must floor at Special Mention, got ${r.risk_grade}`);
  });

  it("scale has 8 grades", () => {
    assert.equal(DEFAULT_RISK_SCALE.length, 8);
    assert.equal(DEFAULT_RISK_SCALE[0].grade, 1);
    assert.equal(DEFAULT_RISK_SCALE[7].grade, 8);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Exhibit registry
// ══════════════════════════════════════════════════════════════════════════

describe("DECISION §2 — Exhibit registry", () => {
  it("no duplicate exhibit letters", () => {
    const reg = buildExhibitRegistry({
      hasDebtCoverage: true,
      hasIncomeStatement: true,
      hasBalanceSheet: true,
      gcfStatus: "proxy_with_pfs",
      hasPfs: true,
      hasRatioAnalysis: true,
      hasStressAnalysis: true,
      hasCovenantPackage: true,
      hasQualitativeAssessment: true,
      hasBreakeven: true,
    });
    const letters = reg.entries.map((e) => e.letter);
    const unique = new Set(letters);
    assert.equal(letters.length, unique.size, `Duplicate letters: ${letters.join(", ")}`);
  });

  it("GCF proxy changes label", () => {
    const reg = buildExhibitRegistry({
      hasDebtCoverage: true, hasIncomeStatement: true, hasBalanceSheet: true,
      gcfStatus: "proxy_with_pfs", hasPfs: true, hasRatioAnalysis: false,
      hasStressAnalysis: false, hasCovenantPackage: false, hasQualitativeAssessment: false, hasBreakeven: false,
    });
    const gcfEntry = reg.entries.find((e) => e.label.includes("Global Cash Flow"));
    assert.ok(gcfEntry);
    assert.ok(gcfEntry!.label.includes("Guarantor Support"), `GCF proxy must mention Guarantor Support, got: ${gcfEntry!.label}`);
  });

  it("formal GCF has simple label", () => {
    const reg = buildExhibitRegistry({
      hasDebtCoverage: true, hasIncomeStatement: true, hasBalanceSheet: true,
      gcfStatus: "formal_complete", hasPfs: true, hasRatioAnalysis: false,
      hasStressAnalysis: false, hasCovenantPackage: false, hasQualitativeAssessment: false, hasBreakeven: false,
    });
    const gcfEntry = reg.entries.find((e) => e.label.includes("Global Cash Flow"));
    assert.ok(gcfEntry);
    assert.ok(!gcfEntry!.label.includes("Guarantor"), "Formal GCF must not mention Guarantor");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. DSCR reconciliation
// ══════════════════════════════════════════════════════════════════════════

describe("DECISION §3 — DSCR reconciliation", () => {
  it("shows calculation with numerator/denominator", () => {
    const r = buildDscrReconciliation({
      uwDscr: 7.12,
      cfads: 721_132,
      ads: 101_250,
      dscrSource: "canonical normalized CFADS",
      periodTable: [
        { period_end: "2025-12-31", dscr: 2.03 },
        { period_end: "2024-12-31", dscr: 6.55 },
      ],
    });
    assert.ok(r.calculation.includes("721,132") || r.calculation.includes("$721"), "Must show CFADS");
    assert.ok(r.calculation.includes("101,250") || r.calculation.includes("$101"), "Must show ADS");
    assert.ok(r.calculation.includes("7.12"), "Must show DSCR result");
  });

  it("material mismatch creates reconciliation note", () => {
    const r = buildDscrReconciliation({
      uwDscr: 7.12,
      cfads: 721_132,
      ads: 101_250,
      dscrSource: "canonical",
      periodTable: [
        { period_end: "2025-12-31", dscr: 2.03 },
        { period_end: "2024-12-31", dscr: 6.55 },
      ],
    });
    assert.ok(r.reconciliation_note !== null, "Must have reconciliation note for 7.12x vs 2.03x");
    assert.ok(r.reconciliation_note!.includes("normalized"), "Must explain normalization");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. Data sufficiency
// ══════════════════════════════════════════════════════════════════════════

describe("DECISION §4 — Credit decision data sufficiency", () => {
  it("OmniCare-style deal is conditional_ready", () => {
    const r = evaluateCreditDecisionDataSufficiency({
      hasBorrowerName: true, hasOwnership: true, hasGuarantor: true,
      hasManagementProfile: true, hasYearsInBusiness: true,
      hasLoanAmount: true, hasProduct: true, hasPurpose: true,
      hasCollateral: true, hasPricing: true,
      hasIncomeStatement: true, hasBalanceSheet: true, hasDscr: true,
      hasTrendAnalysis: true, hasGlobalCashFlow: false, hasDebtSchedule: false,
      hasArAging: true, hasBorrowingBase: true, hasAppraisal: false,
      hasPfs: true, hasPersonalIncome: true, hasPersonalDebtService: false,
      hasNaics: true, hasPeerBenchmarks: true, hasIndustryResearch: true,
      hasAdverseMediaCheck: false, hasOfacCheck: false,
      hasUccSearch: false, hasTaxLienCheck: false, hasBackgroundCheck: false,
      hasBankerNotes: true,
    });
    assert.ok(r.decision_quality === "conditional_ready" || r.decision_quality === "committee_ready",
      `OmniCare should be conditional_ready or better, got: ${r.decision_quality}`);
    assert.ok(r.items_that_cap_risk_rating.length > 0, "Should have rating-cap items");
  });

  it("missing DSCR = not_ready", () => {
    const r = evaluateCreditDecisionDataSufficiency({
      hasBorrowerName: true, hasOwnership: true, hasGuarantor: true,
      hasManagementProfile: true, hasYearsInBusiness: true,
      hasLoanAmount: true, hasProduct: true, hasPurpose: true,
      hasCollateral: true, hasPricing: true,
      hasIncomeStatement: true, hasBalanceSheet: true, hasDscr: false,
      hasTrendAnalysis: false, hasGlobalCashFlow: false, hasDebtSchedule: false,
      hasArAging: false, hasBorrowingBase: false, hasAppraisal: false,
      hasPfs: false, hasPersonalIncome: false, hasPersonalDebtService: false,
      hasNaics: true, hasPeerBenchmarks: false, hasIndustryResearch: false,
      hasAdverseMediaCheck: false, hasOfacCheck: false,
      hasUccSearch: false, hasTaxLienCheck: false, hasBackgroundCheck: false,
      hasBankerNotes: false,
    });
    assert.equal(r.decision_quality, "not_ready");
  });

  it("incomplete GCF is condition not blocker", () => {
    const r = evaluateCreditDecisionDataSufficiency({
      hasBorrowerName: true, hasOwnership: true, hasGuarantor: true,
      hasManagementProfile: true, hasYearsInBusiness: true,
      hasLoanAmount: true, hasProduct: true, hasPurpose: true,
      hasCollateral: true, hasPricing: true,
      hasIncomeStatement: true, hasBalanceSheet: true, hasDscr: true,
      hasTrendAnalysis: true, hasGlobalCashFlow: false, hasDebtSchedule: true,
      hasArAging: true, hasBorrowingBase: true, hasAppraisal: false,
      hasPfs: true, hasPersonalIncome: true, hasPersonalDebtService: true,
      hasNaics: true, hasPeerBenchmarks: true, hasIndustryResearch: true,
      hasAdverseMediaCheck: true, hasOfacCheck: true,
      hasUccSearch: true, hasTaxLienCheck: true, hasBackgroundCheck: true,
      hasBankerNotes: true,
    });
    assert.ok(r.items_that_are_conditions_not_blockers.some((c) => c.includes("GCF")));
    assert.ok(r.decision_quality !== "not_ready", "Incomplete GCF should not make deal not_ready");
  });
});
