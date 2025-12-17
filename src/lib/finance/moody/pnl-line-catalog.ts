// src/lib/finance/moody/pnl-line-catalog.ts

export type PnlLineId =
  | "REVENUE"
  | "COGS"
  | "GROSS_PROFIT"
  | "OPERATING_EXPENSES"
  | "EBITDA"
  | "DEPRECIATION_AMORTIZATION"
  | "INTEREST_EXPENSE"
  | "NET_INCOME"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE"
  | "UNKNOWN";

export const PNL_LINE_ORDER: PnlLineId[] = [
  "REVENUE",
  "COGS",
  "GROSS_PROFIT",
  "OPERATING_EXPENSES",
  "EBITDA",
  "DEPRECIATION_AMORTIZATION",
  "INTEREST_EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
  "NET_INCOME",
];

export const PNL_LINE_LABEL: Record<PnlLineId, string> = {
  REVENUE: "Revenue",
  COGS: "COGS",
  GROSS_PROFIT: "Gross Profit",
  OPERATING_EXPENSES: "Operating Expenses",
  EBITDA: "EBITDA",
  DEPRECIATION_AMORTIZATION: "Depreciation & Amortization",
  INTEREST_EXPENSE: "Interest Expense",
  NET_INCOME: "Net Income",
  OTHER_INCOME: "Other Income",
  OTHER_EXPENSE: "Other Expense",
  UNKNOWN: "Other",
};

// Regex-based synonym matcher (loose but practical)
const RULES: Array<{ id: PnlLineId; re: RegExp; weight: number }> = [
  { id: "REVENUE", re: /\b(total\s+)?revenue\b|\bsales\b|\bgross\s+sales\b/i, weight: 0.9 },
  { id: "COGS", re: /\b(cogs|cost\s+of\s+goods|cost\s+of\s+sales)\b/i, weight: 0.9 },
  { id: "GROSS_PROFIT", re: /\bgross\s+profit\b/i, weight: 0.95 },
  { id: "OPERATING_EXPENSES", re: /\boperating\s+expenses\b|\bopex\b|\bsga\b|\bselling.*general.*admin/i, weight: 0.8 },
  { id: "EBITDA", re: /\bebitda\b/i, weight: 0.95 },
  { id: "DEPRECIATION_AMORTIZATION", re: /\bdepreciation\b|\bamortization\b|\b(d\s*&\s*a|d\/a)\b/i, weight: 0.75 },
  { id: "INTEREST_EXPENSE", re: /\binterest\s+expense\b|\binterest\b/i, weight: 0.7 },
  { id: "NET_INCOME", re: /\bnet\s+(income|profit|earnings)\b/i, weight: 0.9 },
  { id: "OTHER_INCOME", re: /\bother\s+income\b|\bnon[-\s]?operating\s+income\b/i, weight: 0.6 },
  { id: "OTHER_EXPENSE", re: /\bother\s+expense\b|\bnon[-\s]?operating\s+expense\b/i, weight: 0.6 },
];

export function canonicalizePnlLabel(label: string): { id: PnlLineId; canonical_label: string; confidence: number } {
  const raw = (label ?? "").trim();
  if (!raw) return { id: "UNKNOWN", canonical_label: PNL_LINE_LABEL.UNKNOWN, confidence: 0 };

  for (const r of RULES) {
    if (r.re.test(raw)) {
      return { id: r.id, canonical_label: PNL_LINE_LABEL[r.id], confidence: r.weight };
    }
  }
  return { id: "UNKNOWN", canonical_label: raw, confidence: 0.2 };
}
