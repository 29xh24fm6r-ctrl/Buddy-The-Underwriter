/**
 * SPEC-INCOME-STATEMENT-INTEGRITY-GATE-1 §2 — real income-statement integrity checks.
 *
 * A standalone business income statement (Statement of Revenues and Expenses)
 * carries the two core P&L arithmetic identities — Revenue − COGS = Gross Profit
 * and Gross Profit − OpEx = Operating Income — where nothing forces the statement
 * to foot. That is where these identities have teeth (unlike the tautological
 * 1120 Schedule L balance-sheet check on a tax return).
 *
 * The validator canonicalizes the extractor's facts to the canonical keys
 * (canonicalFactKeys.ts) BEFORE checks run; the income-statement extractor emits
 * TOTAL_REVENUE / COST_OF_GOODS_SOLD / GROSS_PROFIT / TOTAL_OPERATING_EXPENSES /
 * OPERATING_INCOME verbatim, so these operands bind with no alias.
 *
 * NOTE: the operating identity binds OPERATING_INCOME (= the exact result of
 * Gross Profit − OpEx, "Net Ordinary Income"), NOT NET_INCOME — binding net income
 * would falsely flag any statement with non-zero other income/expense.
 *
 * Pure module — no DB, no server-only.
 */

import type { FormSpecification } from "../types";

export const INCOME_STATEMENT_SPEC: FormSpecification = {
  formType: "INCOME_STATEMENT",
  taxYear: 0, // period-stamped by the factory; identities are year-independent
  version: 1,
  description: "Business Income Statement — Statement of Revenues and Expenses",
  softwareVariants: ["QuickBooks", "Xero", "Generic"],
  fields: [
    {
      canonicalKey: "TOTAL_REVENUE",
      lineNumbers: [],
      label: "Total revenue",
      labelVariants: ["Total income", "Total revenue", "Net sales"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "COST_OF_GOODS_SOLD",
      lineNumbers: [],
      label: "Cost of goods sold",
      labelVariants: ["Total COGS", "Cost of sales"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "GROSS_PROFIT",
      lineNumbers: [],
      label: "Gross profit",
      labelVariants: ["Gross profit"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "TOTAL_OPERATING_EXPENSES",
      lineNumbers: [],
      label: "Total operating expenses",
      labelVariants: ["Total expense", "Total operating expenses", "Operating expenses"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "OPERATING_INCOME",
      lineNumbers: [],
      label: "Operating income",
      labelVariants: ["Net ordinary income", "Operating income", "Income from operations"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
  ],
  identityChecks: [
    {
      id: "IS_GROSS_PROFIT",
      description: "Total Revenue - COGS = Gross Profit",
      lhs: ["TOTAL_REVENUE"],
      rhs: ["COST_OF_GOODS_SOLD", "GROSS_PROFIT"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      severity: "flag", // §5 — fail → FLAGGED (analyst sign-off), NOT BLOCKED
      sourceDescription: "Statement of Revenues and Expenses — revenue, COGS, gross profit",
    },
    {
      id: "IS_OPERATING_INCOME",
      description: "Gross Profit - Total Operating Expenses = Operating Income",
      lhs: ["GROSS_PROFIT"],
      rhs: ["TOTAL_OPERATING_EXPENSES", "OPERATING_INCOME"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      severity: "flag", // §5 — fail → FLAGGED (analyst sign-off), NOT BLOCKED
      sourceDescription: "Statement of Revenues and Expenses — gross profit, operating expenses, operating income",
    },
  ],
  ebitdaAddBackKeys: [],
};

export function getIncomeStatementSpec(periodYear: number): FormSpecification {
  return { ...INCOME_STATEMENT_SPEC, taxYear: periodYear };
}
