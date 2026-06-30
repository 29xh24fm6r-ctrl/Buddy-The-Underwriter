/**
 * SPEC-BALANCE-SHEET-INTEGRITY-GATE-1 §1 — real balance-sheet integrity check.
 *
 * Unlike the 1120 Schedule L identity (tautological — the preparer forces line 28
 * to equal line 15, and there is no standalone total-liabilities/total-equity line),
 * an actual business balance-sheet document (Statement of Assets, Liabilities and
 * Equity) carries explicit, labeled Total Liabilities and Total Equity lines where
 * nothing forces A = L + E to foot. That is where the identity has teeth.
 *
 * The validator canonicalizes the extractor's SL_TOTAL_* facts to the canonical
 * TOTAL_* keys (canonicalFactKeys.ts) BEFORE checks run, so this spec binds the
 * canonical keys — no SL-prefixed operands appear here.
 *
 * Pure module — no DB, no server-only.
 */

import type { FormSpecification } from "../types";

export const BALANCE_SHEET_SPEC: FormSpecification = {
  formType: "BALANCE_SHEET",
  taxYear: 0, // period-stamped by the factory; identity is year-independent
  version: 1,
  description: "Business Balance Sheet — Statement of Assets, Liabilities and Equity",
  softwareVariants: ["QuickBooks", "Xero", "Generic"],
  fields: [
    {
      canonicalKey: "TOTAL_ASSETS",
      lineNumbers: [],
      label: "Total assets",
      labelVariants: ["Total assets"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "TOTAL_LIABILITIES",
      lineNumbers: [],
      label: "Total liabilities",
      labelVariants: ["Total liabilities"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
    {
      canonicalKey: "TOTAL_EQUITY",
      lineNumbers: [],
      label: "Total equity",
      labelVariants: ["Total equity", "Total shareholders' equity", "Total stockholders' equity"],
      requiredForValidation: true,
      nullAsZero: false,
      isEbitdaAddBack: false,
    },
  ],
  identityChecks: [
    {
      id: "BALANCE_SHEET_IDENTITY",
      description: "Total Assets = Total Liabilities + Total Equity",
      lhs: ["TOTAL_ASSETS"],
      rhs: ["TOTAL_LIABILITIES", "TOTAL_EQUITY"],
      operator: "=",
      toleranceDollars: 1,
      requiredForValidation: true,
      severity: "flag", // §3 — fail → FLAGGED (analyst sign-off), NOT BLOCKED
      sourceDescription: "Statement of Assets, Liabilities and Equity",
    },
  ],
  ebitdaAddBackKeys: [],
};

export function getBalanceSheetSpec(periodYear: number): FormSpecification {
  return { ...BALANCE_SHEET_SPEC, taxYear: periodYear };
}
