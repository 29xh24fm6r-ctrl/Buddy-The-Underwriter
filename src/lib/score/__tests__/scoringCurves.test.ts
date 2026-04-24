import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreFicoBand,
  scoreLiquidityRatio,
  scoreNetWorthRatio,
  scoreIndustryExperience,
  scoreManagementDepth,
  scoreYearsInBusiness,
  scoreFeasibilityComposite,
  scoreIndustryDefaultTier,
  scoreEquityInjectionPct,
  scoreLoanToProject,
  scoreCollateralCoverage,
  scoreGuarantyCoverage,
  scoreBaseDSCR,
  scoreStressDSCR,
  scoreProjectedVsHistoricalVariance,
  scoreGlobalDSCR,
  scoreLoanTermRiskTier,
  scoreFranchiseSbaCertification,
  scoreFddItem19Percentile,
  scoreBrandMaturity,
  scoreFranchisorSupportBinary,
} from "../scoringCurves";

// ─── null propagation — every curve must return null on null input ─────

test("every curve returns null when primary input is null", () => {
  assert.equal(scoreFicoBand(null), null);
  assert.equal(scoreLiquidityRatio(null, 100), null);
  assert.equal(scoreLiquidityRatio(100, null), null);
  assert.equal(scoreNetWorthRatio(null, 100), null);
  assert.equal(scoreNetWorthRatio(100, null), null);
  assert.equal(scoreIndustryExperience(null), null);
  assert.equal(scoreManagementDepth(null), null);
  assert.equal(scoreYearsInBusiness(null), null);
  assert.equal(scoreFeasibilityComposite(null), null);
  assert.equal(scoreIndustryDefaultTier(null), null);
  assert.equal(scoreEquityInjectionPct(null), null);
  assert.equal(scoreLoanToProject(null), null);
  assert.equal(scoreCollateralCoverage(null), null);
  assert.equal(scoreGuarantyCoverage(null), null);
  assert.equal(scoreBaseDSCR(null), null);
  assert.equal(scoreStressDSCR(null), null);
  assert.equal(scoreProjectedVsHistoricalVariance(null, 100), null);
  assert.equal(scoreProjectedVsHistoricalVariance(100, null), null);
  assert.equal(scoreGlobalDSCR(null), null);
  assert.equal(scoreLoanTermRiskTier(null), null);
  assert.equal(scoreFranchiseSbaCertification(null), null);
  assert.equal(scoreFddItem19Percentile(null), null);
  assert.equal(scoreBrandMaturity(null), null);
  assert.equal(scoreFranchisorSupportBinary(null), null);
});

// ─── FICO ──────────────────────────────────────────────────────────────

test("scoreFicoBand: 760+ = 5, 720-759 = 4, 680-719 = 3, 640-679 = 2, <640 = 1", () => {
  assert.equal(scoreFicoBand(800), 5);
  assert.equal(scoreFicoBand(760), 5);
  assert.equal(scoreFicoBand(759), 4);
  assert.equal(scoreFicoBand(720), 4);
  assert.equal(scoreFicoBand(719), 3);
  assert.equal(scoreFicoBand(680), 3);
  assert.equal(scoreFicoBand(679), 2);
  assert.equal(scoreFicoBand(640), 2);
  assert.equal(scoreFicoBand(639), 1);
  assert.equal(scoreFicoBand(300), 1);
});

// ─── Liquidity ─────────────────────────────────────────────────────────

test("scoreLiquidityRatio: 2x = 5, 1.5x = 4, 1x = 3, 0.5x = 2, <0.5x = 1", () => {
  assert.equal(scoreLiquidityRatio(200, 100), 5);
  assert.equal(scoreLiquidityRatio(150, 100), 4);
  assert.equal(scoreLiquidityRatio(100, 100), 3);
  assert.equal(scoreLiquidityRatio(50, 100), 2);
  assert.equal(scoreLiquidityRatio(10, 100), 1);
});

test("scoreLiquidityRatio: zero required injection → neutral 3", () => {
  assert.equal(scoreLiquidityRatio(100, 0), 3);
  assert.equal(scoreLiquidityRatio(0, 0), 3);
});

// ─── Net worth ─────────────────────────────────────────────────────────

test("scoreNetWorthRatio: caps handled, null/zero loan amount returns null", () => {
  assert.equal(scoreNetWorthRatio(1_000_000, 500_000), 5); // 2x → 5
  assert.equal(scoreNetWorthRatio(300_000, 500_000), 4); // 0.6 → 4
  assert.equal(scoreNetWorthRatio(125_000, 500_000), 3); // 0.25 → 3 (boundary)
  assert.equal(scoreNetWorthRatio(60_000, 500_000), 2); // 0.12 → 2
  assert.equal(scoreNetWorthRatio(100_000, 500_000), 2); // 0.20 → 2 (below 0.25)
  assert.equal(scoreNetWorthRatio(10_000, 500_000), 1); // 0.02 → 1
  assert.equal(scoreNetWorthRatio(100_000, 0), null); // invalid
});

// ─── Industry experience / management depth / years in business ────────

test("scoreIndustryExperience: 10+ years = 5, <1 year = 1", () => {
  assert.equal(scoreIndustryExperience(15), 5);
  assert.equal(scoreIndustryExperience(10), 5);
  assert.equal(scoreIndustryExperience(5), 4);
  assert.equal(scoreIndustryExperience(3), 3);
  assert.equal(scoreIndustryExperience(1), 2);
  assert.equal(scoreIndustryExperience(0), 1);
});

test("scoreManagementDepth: 4+ = 5, 0 = 1 (with explicit 0)", () => {
  assert.equal(scoreManagementDepth(4), 5);
  assert.equal(scoreManagementDepth(3), 4);
  assert.equal(scoreManagementDepth(2), 3);
  assert.equal(scoreManagementDepth(1), 2);
  assert.equal(scoreManagementDepth(0), 1);
});

test("scoreYearsInBusiness: startups score low", () => {
  assert.equal(scoreYearsInBusiness(10), 5);
  assert.equal(scoreYearsInBusiness(5), 4);
  assert.equal(scoreYearsInBusiness(3), 3);
  assert.equal(scoreYearsInBusiness(2), 2);
  assert.equal(scoreYearsInBusiness(0.5), 1);
  assert.equal(scoreYearsInBusiness(0), 1);
});

// ─── Feasibility ───────────────────────────────────────────────────────

test("scoreFeasibilityComposite: 85+ = 5, boundary values", () => {
  assert.equal(scoreFeasibilityComposite(100), 5);
  assert.equal(scoreFeasibilityComposite(85), 5);
  assert.equal(scoreFeasibilityComposite(84), 4);
  assert.equal(scoreFeasibilityComposite(75), 4);
  assert.equal(scoreFeasibilityComposite(65), 3);
  assert.equal(scoreFeasibilityComposite(55), 2);
  assert.equal(scoreFeasibilityComposite(40), 1);
});

// ─── Industry default tier (from buildSBARiskProfile) ──────────────────

test("scoreIndustryDefaultTier: lower risk = higher score (inverted)", () => {
  assert.equal(scoreIndustryDefaultTier("low"), 5);
  assert.equal(scoreIndustryDefaultTier("medium"), 4);
  assert.equal(scoreIndustryDefaultTier("high"), 2);
  assert.equal(scoreIndustryDefaultTier("very_high"), 1);
  assert.equal(scoreIndustryDefaultTier("unknown"), 3);
});

// ─── Deal structure ────────────────────────────────────────────────────

test("scoreEquityInjectionPct: SBA 10% floor lands at 3", () => {
  assert.equal(scoreEquityInjectionPct(0.3), 5);
  assert.equal(scoreEquityInjectionPct(0.25), 5);
  assert.equal(scoreEquityInjectionPct(0.15), 4);
  assert.equal(scoreEquityInjectionPct(0.1), 3);
  assert.equal(scoreEquityInjectionPct(0.05), 2);
  assert.equal(scoreEquityInjectionPct(0), 1);
});

test("scoreLoanToProject: lower is better", () => {
  assert.equal(scoreLoanToProject(0.5), 5);
  assert.equal(scoreLoanToProject(0.7), 4);
  assert.equal(scoreLoanToProject(0.8), 3);
  assert.equal(scoreLoanToProject(0.88), 2);
  assert.equal(scoreLoanToProject(0.95), 1);
});

test("scoreCollateralCoverage", () => {
  assert.equal(scoreCollateralCoverage(1.5), 5);
  assert.equal(scoreCollateralCoverage(0.8), 4);
  assert.equal(scoreCollateralCoverage(0.5), 3);
  assert.equal(scoreCollateralCoverage(0.3), 2);
  assert.equal(scoreCollateralCoverage(0), 1);
});

test("scoreGuarantyCoverage", () => {
  assert.equal(scoreGuarantyCoverage(0.9), 5);
  assert.equal(scoreGuarantyCoverage(0.75), 4);
  assert.equal(scoreGuarantyCoverage(0.5), 3);
  assert.equal(scoreGuarantyCoverage(0.25), 2);
  assert.equal(scoreGuarantyCoverage(0.1), 1);
});

// ─── DSCRs ─────────────────────────────────────────────────────────────

test("scoreBaseDSCR: SBA 1.25 floor = 3", () => {
  assert.equal(scoreBaseDSCR(1.7), 5);
  assert.equal(scoreBaseDSCR(1.4), 4);
  assert.equal(scoreBaseDSCR(1.25), 3);
  assert.equal(scoreBaseDSCR(1.15), 2);
  assert.equal(scoreBaseDSCR(1.0), 1);
});

test("scoreStressDSCR", () => {
  assert.equal(scoreStressDSCR(1.5), 5);
  assert.equal(scoreStressDSCR(1.2), 4);
  assert.equal(scoreStressDSCR(1.1), 3);
  assert.equal(scoreStressDSCR(1.0), 2);
  assert.equal(scoreStressDSCR(0.8), 1);
});

test("scoreGlobalDSCR", () => {
  assert.equal(scoreGlobalDSCR(1.6), 5);
  assert.equal(scoreGlobalDSCR(1.3), 4);
  assert.equal(scoreGlobalDSCR(1.2), 3);
  assert.equal(scoreGlobalDSCR(1.0), 2);
  assert.equal(scoreGlobalDSCR(0.9), 1);
});

test("scoreLoanTermRiskTier: matches industry tier inversion", () => {
  assert.equal(scoreLoanTermRiskTier("low"), 5);
  assert.equal(scoreLoanTermRiskTier("medium"), 4);
  assert.equal(scoreLoanTermRiskTier("high"), 2);
  assert.equal(scoreLoanTermRiskTier("very_high"), 1);
  assert.equal(scoreLoanTermRiskTier("unknown"), 3);
});

// ─── Projection variance ───────────────────────────────────────────────

test("scoreProjectedVsHistoricalVariance: tight projections = 5", () => {
  assert.equal(scoreProjectedVsHistoricalVariance(105, 100), 5); // 5% variance
  assert.equal(scoreProjectedVsHistoricalVariance(115, 100), 4); // 15%
  assert.equal(scoreProjectedVsHistoricalVariance(130, 100), 3); // 30%
  assert.equal(scoreProjectedVsHistoricalVariance(145, 100), 2); // 45%
  assert.equal(scoreProjectedVsHistoricalVariance(200, 100), 1); // 100%
});

test("scoreProjectedVsHistoricalVariance: zero historical = null", () => {
  assert.equal(scoreProjectedVsHistoricalVariance(100, 0), null);
});

// ─── Franchise ─────────────────────────────────────────────────────────

test("scoreFranchiseSbaCertification: certified/approved = 5", () => {
  assert.equal(scoreFranchiseSbaCertification("certified"), 5);
  assert.equal(scoreFranchiseSbaCertification("Approved"), 5);
  assert.equal(scoreFranchiseSbaCertification("eligible"), 4);
  assert.equal(scoreFranchiseSbaCertification("conditional"), 3);
  assert.equal(scoreFranchiseSbaCertification("not_listed"), 2);
  assert.equal(scoreFranchiseSbaCertification("unknown-status"), 1);
});

test("scoreFddItem19Percentile", () => {
  assert.equal(scoreFddItem19Percentile(90), 5);
  assert.equal(scoreFddItem19Percentile(65), 4);
  assert.equal(scoreFddItem19Percentile(50), 3);
  assert.equal(scoreFddItem19Percentile(35), 2);
  assert.equal(scoreFddItem19Percentile(10), 1);
});

test("scoreBrandMaturity: 500+ units = 5, <50 = 1", () => {
  assert.equal(scoreBrandMaturity(1000), 5);
  assert.equal(scoreBrandMaturity(300), 4);
  assert.equal(scoreBrandMaturity(150), 3);
  assert.equal(scoreBrandMaturity(60), 2);
  assert.equal(scoreBrandMaturity(20), 1);
});

test("scoreFranchisorSupportBinary: supported=4, not-supported=2", () => {
  assert.equal(scoreFranchisorSupportBinary(true), 4);
  assert.equal(scoreFranchisorSupportBinary(false), 2);
});
