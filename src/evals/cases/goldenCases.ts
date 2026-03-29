/**
 * Phase 54 — Golden Dataset (10 cases)
 *
 * Synthetic, anonymized. No real deal data.
 */

import type { EvalCase } from "../types";

export const GOLDEN_CASES: EvalCase[] = [
  // 3 clean operating company deals
  {
    id: "oc_1yr_clean",
    name: "Operating Co — 1-year clean",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 2400000, NET_INCOME: 240000, TOTAL_ASSETS: 1800000,
      TOTAL_LIABILITIES: 1100000, NET_WORTH: 700000, ANNUAL_DEBT_SERVICE: 160000,
      CASH_FLOW_AVAILABLE: 240000, DSCR: 1.50,
    },
    expectedOutputs: {
      facts: { TOTAL_REVENUE: 2400000, NET_INCOME: 240000, DSCR: 1.50 },
      ratios: { dscr: 1.50, cashFlowAfterDebtService: 80000 },
      validationStatus: "PASS",
    },
    tags: ["operating", "1yr", "clean"],
  },
  {
    id: "oc_2yr_clean",
    name: "Operating Co — 2-year clean",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 3600000, NET_INCOME: 360000, TOTAL_ASSETS: 2500000,
      TOTAL_LIABILITIES: 1500000, NET_WORTH: 1000000, ANNUAL_DEBT_SERVICE: 240000,
      CASH_FLOW_AVAILABLE: 360000, DSCR: 1.50,
    },
    expectedOutputs: {
      facts: { TOTAL_REVENUE: 3600000, DSCR: 1.50 },
      ratios: { dscr: 1.50 },
      validationStatus: "PASS",
    },
    tags: ["operating", "2yr", "clean"],
  },
  {
    id: "oc_3yr_clean",
    name: "Operating Co — 3-year history",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 5000000, NET_INCOME: 500000, TOTAL_ASSETS: 3500000,
      TOTAL_LIABILITIES: 2000000, NET_WORTH: 1500000, ANNUAL_DEBT_SERVICE: 350000,
      CASH_FLOW_AVAILABLE: 500000, DSCR: 1.43, CURRENT_RATIO: 2.1,
    },
    expectedOutputs: {
      facts: { TOTAL_REVENUE: 5000000, DSCR: 1.43 },
      ratios: { dscr: 1.43 },
      validationStatus: "PASS",
    },
    tags: ["operating", "3yr", "clean"],
  },

  // 3 real estate deals
  {
    id: "re_multifamily",
    name: "CRE — Multifamily",
    dealType: "real_estate",
    facts: {
      NOI_TTM: 450000, ANNUAL_DEBT_SERVICE: 320000, DSCR: 1.41,
      OCCUPANCY_PCT: 0.95, COLLATERAL_GROSS_VALUE: 5500000, LTV_GROSS: 0.65,
      TOTAL_ASSETS: 5500000, TOTAL_LIABILITIES: 3575000, NET_WORTH: 1925000,
      CASH_FLOW_AVAILABLE: 450000,
    },
    expectedOutputs: {
      facts: { NOI_TTM: 450000, DSCR: 1.41 },
      ratios: { dscr: 1.41, netOperatingIncome: 450000 },
      validationStatus: "PASS",
    },
    tags: ["real_estate", "multifamily"],
  },
  {
    id: "re_retail",
    name: "CRE — Retail strip",
    dealType: "real_estate",
    facts: {
      NOI_TTM: 180000, ANNUAL_DEBT_SERVICE: 140000, DSCR: 1.29,
      OCCUPANCY_PCT: 0.88, COLLATERAL_GROSS_VALUE: 2200000, LTV_GROSS: 0.73,
      TOTAL_ASSETS: 2200000, TOTAL_LIABILITIES: 1606000, NET_WORTH: 594000,
      CASH_FLOW_AVAILABLE: 180000,
    },
    expectedOutputs: {
      facts: { NOI_TTM: 180000, DSCR: 1.29 },
      ratios: { dscr: 1.29 },
      validationStatus: "PASS",
    },
    tags: ["real_estate", "retail"],
  },
  {
    id: "re_schedule_e",
    name: "CRE — Schedule E rental income",
    dealType: "real_estate",
    facts: {
      NOI_TTM: 96000, ANNUAL_DEBT_SERVICE: 72000, DSCR: 1.33,
      OCCUPANCY_PCT: 1.0, COLLATERAL_GROSS_VALUE: 1200000, LTV_GROSS: 0.67,
      TOTAL_ASSETS: 1200000, TOTAL_LIABILITIES: 800000, NET_WORTH: 400000,
      CASH_FLOW_AVAILABLE: 96000,
    },
    expectedOutputs: {
      facts: { NOI_TTM: 96000, DSCR: 1.33 },
      ratios: { dscr: 1.33 },
      validationStatus: "PASS",
    },
    tags: ["real_estate", "schedule_e"],
  },

  // 2 intentional error cases (BVP should fire)
  {
    id: "err_bs_imbalance",
    name: "Error — Balance sheet imbalance",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 1000000, NET_INCOME: 100000,
      TOTAL_ASSETS: 800000, TOTAL_LIABILITIES: 600000, NET_WORTH: 100000, // Should be 200000
      ANNUAL_DEBT_SERVICE: 50000, CASH_FLOW_AVAILABLE: 100000, DSCR: 2.0,
    },
    expectedOutputs: {
      facts: {},
      ratios: {},
      validationStatus: "FAIL",
    },
    tags: ["error", "balance_sheet"],
  },
  {
    id: "err_missing_data",
    name: "Error — Missing critical data",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 500000,
      // Missing: NET_INCOME, TOTAL_ASSETS, TOTAL_LIABILITIES, NET_WORTH, ADS, CFA, DSCR
    },
    expectedOutputs: {
      facts: {},
      ratios: {},
      validationStatus: "FAIL",
    },
    tags: ["error", "missing_data"],
  },

  // 2 edge cases
  {
    id: "edge_high_dscr",
    name: "Edge — Very high DSCR",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 10000000, NET_INCOME: 3000000, TOTAL_ASSETS: 8000000,
      TOTAL_LIABILITIES: 2000000, NET_WORTH: 6000000, ANNUAL_DEBT_SERVICE: 300000,
      CASH_FLOW_AVAILABLE: 3000000, DSCR: 10.0,
    },
    expectedOutputs: {
      facts: { DSCR: 10.0 },
      ratios: { dscr: 10.0 },
      validationStatus: "PASS_WITH_FLAGS", // DSCR outside normal band
    },
    tags: ["edge", "high_dscr"],
  },
  {
    id: "edge_low_dscr",
    name: "Edge — Near-zero DSCR",
    dealType: "operating_company",
    facts: {
      TOTAL_REVENUE: 500000, NET_INCOME: 10000, TOTAL_ASSETS: 400000,
      TOTAL_LIABILITIES: 350000, NET_WORTH: 50000, ANNUAL_DEBT_SERVICE: 80000,
      CASH_FLOW_AVAILABLE: 10000, DSCR: 0.125,
    },
    expectedOutputs: {
      facts: { DSCR: 0.125 },
      ratios: { dscr: 0.125 },
      validationStatus: "PASS_WITH_FLAGS", // DSCR outside normal band
    },
    tags: ["edge", "low_dscr"],
  },
];
