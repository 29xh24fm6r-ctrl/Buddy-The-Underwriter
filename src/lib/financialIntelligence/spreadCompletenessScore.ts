/**
 * Spread Completeness Score — Pure Function
 *
 * Evaluates how complete a Classic Spread is by checking which required
 * rows/sections have data versus those that are still empty.
 *
 * No DB access. No side effects.
 */

import type { ClassicSpreadInput, FinancialRow, CashFlowRow, RatioSection } from "@/lib/classicSpread/types";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface SectionScore {
  score: number;
  missingKeys: string[];
}

export interface MissingField {
  key: string;
  label: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  remediation: string;
}

export interface SpreadCompletenessResult {
  overallScore: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  sections: {
    balanceSheet: SectionScore;
    incomeStatement: SectionScore;
    cashFlow: SectionScore;
    ratios: SectionScore;
    globalCashFlow: SectionScore;
  };
  topMissingFields: MissingField[];
  meetsMinimumStandard: boolean; // score >= 70
}

// ---------------------------------------------------------------------------
// Required field definitions per section
// ---------------------------------------------------------------------------

const BS_REQUIRED: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }> = [
  { key: "Cash & Equivalents", label: "Cash & Equivalents", impact: "HIGH" },
  { key: "Accounts Receivable", label: "Accounts Receivable", impact: "HIGH" },
  { key: "Total Current Assets", label: "Total Current Assets", impact: "HIGH" },
  { key: "Net Fixed Assets", label: "Net Fixed Assets", impact: "MEDIUM" },
  { key: "TOTAL ASSETS", label: "Total Assets", impact: "HIGH" },
  { key: "Accounts Payable", label: "Accounts Payable", impact: "HIGH" },
  { key: "Total Current Liabilities", label: "Total Current Liabilities", impact: "HIGH" },
  { key: "Long-Term Debt", label: "Long-Term Debt", impact: "HIGH" },
  { key: "TOTAL LIABILITIES", label: "Total Liabilities", impact: "HIGH" },
  { key: "Net Worth", label: "Net Worth", impact: "HIGH" },
  { key: "TOTAL LIABILITIES & NET WORTH", label: "Total Liabilities & Net Worth", impact: "HIGH" },
  { key: "Inventory", label: "Inventory", impact: "MEDIUM" },
];

const IS_REQUIRED: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }> = [
  { key: "Sales / Revenues", label: "Revenue / Gross Receipts", impact: "HIGH" },
  { key: "Cost of Goods Sold", label: "Cost of Goods Sold", impact: "HIGH" },
  { key: "GROSS PROFIT", label: "Gross Profit", impact: "HIGH" },
  { key: "TOTAL OPERATING EXPENSE", label: "Total Operating Expenses", impact: "HIGH" },
  { key: "NET PROFIT", label: "Net Income", impact: "HIGH" },
  { key: "EBITDA", label: "EBITDA", impact: "HIGH" },
];

const CF_REQUIRED: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }> = [
  { key: "Net Income", label: "CF: Net Income", impact: "HIGH" },
  { key: "Depreciation & Amortization", label: "CF: Depreciation", impact: "HIGH" },
  { key: "Cash from Operations", label: "Cash from Operations", impact: "HIGH" },
  { key: "Capital Expenditures", label: "Capital Expenditures", impact: "MEDIUM" },
  { key: "Cash After Debt Service", label: "Cash After Debt Service", impact: "HIGH" },
];

const RATIO_REQUIRED: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }> = [
  { key: "Current Ratio", label: "Current Ratio", impact: "HIGH" },
  { key: "DSCR", label: "Debt Service Coverage Ratio", impact: "HIGH" },
  { key: "Debt / Tangible Net Worth", label: "Debt / Tangible Net Worth", impact: "MEDIUM" },
  { key: "Working Capital", label: "Working Capital", impact: "MEDIUM" },
  { key: "Revenue Growth", label: "Revenue Growth", impact: "LOW" },
];

const GCF_REQUIRED: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }> = [
  { key: "entityCashFlowAvailable", label: "Entity Cash Flow Available", impact: "HIGH" },
  { key: "globalCashFlow", label: "Global Cash Flow", impact: "HIGH" },
  { key: "globalDscr", label: "Global DSCR", impact: "HIGH" },
  { key: "proposedAnnualDebtService", label: "Proposed Annual Debt Service", impact: "HIGH" },
];

// ---------------------------------------------------------------------------
// Section weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  incomeStatement: 0.30,
  balanceSheet: 0.25,
  cashFlow: 0.25,
  globalCashFlow: 0.10,
  ratios: 0.10,
} as const;

// ---------------------------------------------------------------------------
// Grade thresholds
// ---------------------------------------------------------------------------

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a FinancialRow has any non-null values. */
function rowHasData(row: FinancialRow): boolean {
  return row.values.some((v) => v != null);
}

/** Check if a CashFlowRow has any non-null values. */
function cfRowHasData(row: CashFlowRow): boolean {
  return row.values.some((v) => v != null);
}

/** Find a row by matching label (case-insensitive, trimmed). */
function findRow<T extends { label: string }>(rows: T[], key: string): T | undefined {
  const norm = key.toLowerCase().trim();
  return rows.find((r) => r.label.toLowerCase().trim() === norm);
}

/** Find a ratio row across all ratio sections. */
function findRatioRow(sections: RatioSection[], key: string): boolean {
  const norm = key.toLowerCase().trim();
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.label.toLowerCase().trim() === norm) {
        return row.values.some((v) => v != null);
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Section scoring
// ---------------------------------------------------------------------------

function scoreFinancialSection(
  rows: FinancialRow[],
  required: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }>,
): { score: number; missingKeys: string[]; missingFields: MissingField[] } {
  const missingKeys: string[] = [];
  const missingFields: MissingField[] = [];
  let found = 0;

  for (const req of required) {
    const row = findRow(rows, req.key);
    if (row && rowHasData(row)) {
      found++;
    } else {
      missingKeys.push(req.key);
      missingFields.push({
        key: req.key,
        label: req.label,
        impact: req.impact,
        remediation: `Re-extract documents to populate ${req.label}`,
      });
    }
  }

  const score = required.length > 0 ? Math.round((found / required.length) * 100) : 100;
  return { score, missingKeys, missingFields };
}

function scoreCashFlowSection(
  rows: CashFlowRow[],
  required: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }>,
): { score: number; missingKeys: string[]; missingFields: MissingField[] } {
  const missingKeys: string[] = [];
  const missingFields: MissingField[] = [];
  let found = 0;

  for (const req of required) {
    const row = findRow(rows, req.key);
    if (row && cfRowHasData(row)) {
      found++;
    } else {
      missingKeys.push(req.key);
      missingFields.push({
        key: req.key,
        label: req.label,
        impact: req.impact,
        remediation: `Re-extract documents to populate ${req.label}`,
      });
    }
  }

  const score = required.length > 0 ? Math.round((found / required.length) * 100) : 100;
  return { score, missingKeys, missingFields };
}

function scoreRatioSection(
  sections: RatioSection[],
  required: Array<{ key: string; label: string; impact: "HIGH" | "MEDIUM" | "LOW" }>,
): { score: number; missingKeys: string[]; missingFields: MissingField[] } {
  const missingKeys: string[] = [];
  const missingFields: MissingField[] = [];
  let found = 0;

  for (const req of required) {
    if (findRatioRow(sections, req.key)) {
      found++;
    } else {
      missingKeys.push(req.key);
      missingFields.push({
        key: req.key,
        label: req.label,
        impact: req.impact,
        remediation: `Re-extract or re-save pricing to compute ${req.label}`,
      });
    }
  }

  const score = required.length > 0 ? Math.round((found / required.length) * 100) : 100;
  return { score, missingKeys, missingFields };
}

function scoreGlobalCashFlow(
  gcf: ClassicSpreadInput["globalCashFlow"],
): { score: number; missingKeys: string[]; missingFields: MissingField[] } {
  if (!gcf) {
    return {
      score: 0,
      missingKeys: GCF_REQUIRED.map((r) => r.key),
      missingFields: GCF_REQUIRED.map((r) => ({
        key: r.key,
        label: r.label,
        impact: r.impact,
        remediation: "Run Global Cash Flow computation or add personal financial data",
      })),
    };
  }

  const missingKeys: string[] = [];
  const missingFields: MissingField[] = [];
  let found = 0;

  for (const req of GCF_REQUIRED) {
    const val = (gcf as any)[req.key];
    if (val != null) {
      found++;
    } else {
      missingKeys.push(req.key);
      missingFields.push({
        key: req.key,
        label: req.label,
        impact: req.impact,
        remediation: "Run Global Cash Flow computation or add personal financial data",
      });
    }
  }

  const score = GCF_REQUIRED.length > 0 ? Math.round((found / GCF_REQUIRED.length) * 100) : 100;
  return { score, missingKeys, missingFields };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function computeSpreadCompleteness(
  input: ClassicSpreadInput,
): SpreadCompletenessResult {
  const bs = scoreFinancialSection(input.balanceSheet, BS_REQUIRED);
  const is = scoreFinancialSection(input.incomeStatement, IS_REQUIRED);
  const cf = scoreCashFlowSection(input.cashFlow, CF_REQUIRED);
  const ratios = scoreRatioSection(input.ratioSections, RATIO_REQUIRED);
  const gcf = scoreGlobalCashFlow(input.globalCashFlow);

  // Weighted overall score
  const overallScore = Math.round(
    bs.score * WEIGHTS.balanceSheet +
    is.score * WEIGHTS.incomeStatement +
    cf.score * WEIGHTS.cashFlow +
    ratios.score * WEIGHTS.ratios +
    gcf.score * WEIGHTS.globalCashFlow,
  );

  // Collect all missing fields, sort by impact priority
  const allMissing = [
    ...is.missingFields,
    ...bs.missingFields,
    ...cf.missingFields,
    ...gcf.missingFields,
    ...ratios.missingFields,
  ];

  const impactOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  allMissing.sort(
    (a, b) => (impactOrder[a.impact] ?? 2) - (impactOrder[b.impact] ?? 2),
  );

  return {
    overallScore,
    grade: scoreToGrade(overallScore),
    sections: {
      balanceSheet: { score: bs.score, missingKeys: bs.missingKeys },
      incomeStatement: { score: is.score, missingKeys: is.missingKeys },
      cashFlow: { score: cf.score, missingKeys: cf.missingKeys },
      ratios: { score: ratios.score, missingKeys: ratios.missingKeys },
      globalCashFlow: { score: gcf.score, missingKeys: gcf.missingKeys },
    },
    topMissingFields: allMissing.slice(0, 5),
    meetsMinimumStandard: overallScore >= 70,
  };
}
