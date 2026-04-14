/**
 * Gatekeeper Readiness — Scenario Requirements (PURE)
 * No DB, no IO, no side effects.
 */

import type { IntakeScenario } from "@/lib/intake/slots/types";
import { computeTaxYears } from "@/lib/intake/slots/taxYears";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScenarioRequirements = {
  /** Required business tax return years (e.g. [2024, 2023, 2022]) */
  businessTaxYears: number[];
  /** Required personal tax return years */
  personalTaxYears: number[];
  /** Whether financial statements (P&L / balance sheet) are required */
  requiresFinancialStatements: boolean;
  /** Whether a personal financial statement is required */
  requiresPFS: boolean;
};

// ─── Derivation ──────────────────────────────────────────────────────────────

export function deriveScenarioRequirements(params: {
  scenario: IntakeScenario;
  now?: Date;
  dealMode?: "quick_look" | "full_underwrite" | null;
}): ScenarioRequirements {
  const { scenario, now, dealMode } = params;
  const taxYears = computeTaxYears(now);

  if (dealMode === "quick_look") {
    return {
      businessTaxYears: scenario.has_business_tax_returns ? taxYears.slice(0, 2) : [],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: false,
    };
  }

  return {
    businessTaxYears: scenario.has_business_tax_returns ? taxYears : [],
    personalTaxYears: taxYears,
    requiresFinancialStatements: scenario.has_financial_statements,
    requiresPFS: true,
  };
}
