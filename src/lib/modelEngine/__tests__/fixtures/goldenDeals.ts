/**
 * Golden test fixtures for parity comparison.
 *
 * Each fixture provides:
 * - v1Spreads: Pre-built V1SpreadData (what V1 renders from deal_spreads)
 * - v2Model:   Pre-built FinancialModel (what V2 builds from facts)
 * - expected:  Expected parity result (passFail, headline tolerance, etc.)
 *
 * Fixtures test the comparison engine in isolation — no DB, no renderers.
 */

import type { V1SpreadData } from "../../parity/types";
import type { FinancialModel } from "../../types";

// ===================================================================
// Fixture 1: Clean FYE — single period, exact match → PASS
// ===================================================================

export const CLEAN_FYE = {
  name: "Clean FYE (single period, exact match)",
  dealId: "golden-clean-fye",

  v1Spreads: [
    {
      spreadType: "T12",
      periods: [
        { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
      ],
      rows: [
        { key: "TOTAL_INCOME", label: "Total Income", section: "INCOME", valueByPeriod: { "2024-12-31": 1360479 } },
        { key: "TOTAL_OPEX", label: "Total Opex", section: "OPERATING_EXPENSES", valueByPeriod: { "2024-12-31": 392171 } },
        { key: "NOI", label: "Net Operating Income", section: "NOI", valueByPeriod: { "2024-12-31": 968308 } },
        { key: "DEBT_SERVICE", label: "Debt Service", section: "CASH_FLOW", valueByPeriod: { "2024-12-31": 145000 } },
      ],
    } satisfies V1SpreadData,
    {
      spreadType: "BALANCE_SHEET",
      periods: [
        { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
      ],
      rows: [
        { key: "CASH_AND_EQUIVALENTS", label: "Cash", section: "CURRENT_ASSETS", valueByPeriod: { "2024-12-31": 93087 } },
        { key: "ACCOUNTS_RECEIVABLE", label: "A/R", section: "CURRENT_ASSETS", valueByPeriod: { "2024-12-31": 144000 } },
        { key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL_ASSETS", valueByPeriod: { "2024-12-31": 2571777 } },
        { key: "SHORT_TERM_DEBT", label: "Short-Term Debt", section: "CURRENT_LIABILITIES", valueByPeriod: { "2024-12-31": 50000 } },
        { key: "LONG_TERM_DEBT", label: "Long-Term Debt", section: "NON_CURRENT_LIABILITIES", valueByPeriod: { "2024-12-31": 1200000 } },
        { key: "TOTAL_LIABILITIES", label: "Total Liabilities", section: "TOTAL_LIABILITIES", valueByPeriod: { "2024-12-31": 1250000 } },
        { key: "TOTAL_EQUITY", label: "Total Equity", section: "EQUITY", valueByPeriod: { "2024-12-31": 1321777 } },
      ],
    } satisfies V1SpreadData,
  ] as V1SpreadData[],

  v2Model: {
    dealId: "golden-clean-fye",
    periods: [
      {
        periodId: "golden-clean-fye:2024-12-31",
        periodEnd: "2024-12-31",
        type: "FYE",
        income: {
          revenue: 1360479,
          operatingExpenses: 392171,
          interest: 145000,
        },
        balance: {
          cash: 93087,
          accountsReceivable: 144000,
          totalAssets: 2571777,
          shortTermDebt: 50000,
          longTermDebt: 1200000,
          totalLiabilities: 1250000,
          equity: 1321777,
        },
        cashflow: {
          ebitda: 968308,
        },
        qualityFlags: [],
      },
    ],
  } satisfies FinancialModel,

  expected: {
    passFail: "PASS" as const,
    periodCount: 1,
    headlineAllPass: true,
    mismatchCount: 0,
    errorFlagCount: 0,
  },
};

// ===================================================================
// Fixture 2: Two FYE periods — both match → PASS
// ===================================================================

export const TWO_FYE = {
  name: "Two FYE periods (multi-year, exact match)",
  dealId: "golden-two-fye",

  v1Spreads: [
    {
      spreadType: "BALANCE_SHEET",
      periods: [
        { key: "2023-12-31", label: "Dec 2023", endDate: "2023-12-31", isAggregate: false },
        { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
      ],
      rows: [
        { key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL_ASSETS", valueByPeriod: { "2023-12-31": 2200000, "2024-12-31": 2571777 } },
        { key: "TOTAL_LIABILITIES", label: "Total Liabilities", section: "TOTAL_LIABILITIES", valueByPeriod: { "2023-12-31": 1100000, "2024-12-31": 1250000 } },
        { key: "TOTAL_EQUITY", label: "Total Equity", section: "EQUITY", valueByPeriod: { "2023-12-31": 1100000, "2024-12-31": 1321777 } },
      ],
    } satisfies V1SpreadData,
  ] as V1SpreadData[],

  v2Model: {
    dealId: "golden-two-fye",
    periods: [
      {
        periodId: "golden-two-fye:2023-12-31",
        periodEnd: "2023-12-31",
        type: "FYE",
        income: {},
        balance: {
          totalAssets: 2200000,
          totalLiabilities: 1100000,
          equity: 1100000,
        },
        cashflow: {},
        qualityFlags: [],
      },
      {
        periodId: "golden-two-fye:2024-12-31",
        periodEnd: "2024-12-31",
        type: "FYE",
        income: {},
        balance: {
          totalAssets: 2571777,
          totalLiabilities: 1250000,
          equity: 1321777,
        },
        cashflow: {},
        qualityFlags: [],
      },
    ],
  } satisfies FinancialModel,

  expected: {
    passFail: "PASS" as const,
    periodCount: 2,
    headlineAllPass: true,
    mismatchCount: 0,
    errorFlagCount: 0,
  },
};

// ===================================================================
// Fixture 3: FYE + Interim — two periods with mixed types → PASS
// ===================================================================

export const FYE_WITH_INTERIM = {
  name: "FYE + Interim (fiscal year + mid-year)",
  dealId: "golden-fye-interim",

  v1Spreads: [
    {
      spreadType: "T12",
      periods: [
        { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
        { key: "2025-06-30", label: "Jun 2025", endDate: "2025-06-30", isAggregate: false },
      ],
      rows: [
        { key: "TOTAL_INCOME", label: "Total Income", section: "INCOME", valueByPeriod: { "2024-12-31": 1000000, "2025-06-30": 520000 } },
        { key: "TOTAL_OPEX", label: "Total Opex", section: "OPERATING_EXPENSES", valueByPeriod: { "2024-12-31": 400000, "2025-06-30": 210000 } },
        { key: "DEBT_SERVICE", label: "Debt Service", section: "CASH_FLOW", valueByPeriod: { "2024-12-31": 120000, "2025-06-30": 60000 } },
      ],
    } satisfies V1SpreadData,
  ] as V1SpreadData[],

  v2Model: {
    dealId: "golden-fye-interim",
    periods: [
      {
        periodId: "golden-fye-interim:2024-12-31",
        periodEnd: "2024-12-31",
        type: "FYE",
        income: {
          revenue: 1000000,
          operatingExpenses: 400000,
          interest: 120000,
        },
        balance: {},
        cashflow: { ebitda: 600000 },
        qualityFlags: [],
      },
      {
        periodId: "golden-fye-interim:2025-06-30",
        periodEnd: "2025-06-30",
        type: "TTM",
        income: {
          revenue: 520000,
          operatingExpenses: 210000,
          interest: 60000,
        },
        balance: {},
        cashflow: { ebitda: 310000 },
        qualityFlags: [],
      },
    ],
  } satisfies FinancialModel,

  expected: {
    passFail: "PASS" as const,
    periodCount: 2,
    headlineAllPass: true,
    mismatchCount: 0,
    errorFlagCount: 0,
  },
};

// ===================================================================
// Fixture 4: V1 missing period — V2 has a period V1 lacks → FAIL
// ===================================================================

export const V2_EXTRA_PERIOD = {
  name: "V2 has extra period not in V1 (warning only, not error)",
  dealId: "golden-v2-extra",

  v1Spreads: [
    {
      spreadType: "BALANCE_SHEET",
      periods: [
        { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
      ],
      rows: [
        { key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL_ASSETS", valueByPeriod: { "2024-12-31": 2000000 } },
        { key: "TOTAL_LIABILITIES", label: "Total Liabilities", section: "TOTAL_LIABILITIES", valueByPeriod: { "2024-12-31": 800000 } },
        { key: "TOTAL_EQUITY", label: "Total Equity", section: "EQUITY", valueByPeriod: { "2024-12-31": 1200000 } },
      ],
    } satisfies V1SpreadData,
  ] as V1SpreadData[],

  v2Model: {
    dealId: "golden-v2-extra",
    periods: [
      {
        periodId: "golden-v2-extra:2024-12-31",
        periodEnd: "2024-12-31",
        type: "FYE",
        income: {},
        balance: { totalAssets: 2000000, totalLiabilities: 800000, equity: 1200000 },
        cashflow: {},
        qualityFlags: [],
      },
      {
        periodId: "golden-v2-extra:2025-06-30",
        periodEnd: "2025-06-30",
        type: "TTM",
        income: { revenue: 500000 },
        balance: {},
        cashflow: { ebitda: 250000 },
        qualityFlags: [],
      },
    ],
  } satisfies FinancialModel,

  expected: {
    passFail: "PASS" as const, // V2-only is a warning, not error
    periodCount: 2,
    headlineAllPass: true,
    mismatchCount: 0,
    errorFlagCount: 0,
  },
};

// ===================================================================
// Fixture 5: Scaling error — V1 in thousands, V2 in units → FAIL
// ===================================================================

export const SCALING_ERROR = {
  name: "Scaling error (V1 in thousands vs V2 in units)",
  dealId: "golden-scaling",

  v1Spreads: [
    {
      spreadType: "BALANCE_SHEET",
      periods: [
        { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
      ],
      rows: [
        { key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL_ASSETS", valueByPeriod: { "2024-12-31": 2572 } },       // V1: thousands
        { key: "TOTAL_LIABILITIES", label: "Total Liabilities", section: "TOTAL_LIABILITIES", valueByPeriod: { "2024-12-31": 1250 } },
        { key: "TOTAL_EQUITY", label: "Total Equity", section: "EQUITY", valueByPeriod: { "2024-12-31": 1322 } },
      ],
    } satisfies V1SpreadData,
  ] as V1SpreadData[],

  v2Model: {
    dealId: "golden-scaling",
    periods: [
      {
        periodId: "golden-scaling:2024-12-31",
        periodEnd: "2024-12-31",
        type: "FYE",
        income: {},
        balance: {
          totalAssets: 2571777,       // V2: units
          totalLiabilities: 1250000,
          equity: 1321777,
        },
        cashflow: {},
        qualityFlags: [],
      },
    ],
  } satisfies FinancialModel,

  expected: {
    passFail: "FAIL" as const,
    periodCount: 1,
    headlineAllPass: false,
    mismatchCount: 3, // total_assets, total_liabilities, equity all mismatch
    errorFlagCount: 3, // 3 scaling errors
  },
};

// ===================================================================
// All fixtures for iteration
// ===================================================================

export const ALL_GOLDEN_FIXTURES = [
  CLEAN_FYE,
  TWO_FYE,
  FYE_WITH_INTERIM,
  V2_EXTRA_PERIOD,
  SCALING_ERROR,
];
