/**
 * Gatekeeper Readiness — Scenario Requirements (PURE)
 *
 * Derives what documents are required to underwrite a deal,
 * based on the intake scenario and current date.
 *
 * SLOT-INDEPENDENT: Requirements derive directly from scenario fields
 * + computeTaxYears(), NOT from generateSlotsForScenario().
 *
 * No DB, no IO, no side effects. Fully testable.
 */

import type { IntakeScenario } from "@/lib/intake/slots/types";
import { computeTaxYears } from "@/lib/intake/slots/taxYears";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScenarioRequirements = {
  /** Required business tax return years (e.g. [2024, 2023, 2022]) */
  businessTaxYears: number[];
  /** Required personal tax return years (always populated) */
  personalTaxYears: number[];
  /** Whether financial statements (P&L / balance sheet) are required */
  requiresFinancialStatements: boolean;
  /** Whether a personal financial statement is required */
  requiresPFS: boolean;
};

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Derive document requirements from an intake scenario.
 *
 * Rules (derived from scenario fields, NOT from slot policies):
 * - businessTaxYears: computeTaxYears(now) when has_business_tax_returns, else []
 * - personalTaxYears: computeTaxYears(now) always (personal returns always required)
 * - requiresFinancialStatements: scenario.has_financial_statements
 * - requiresPFS: true always (industry standard for commercial lending)
 */
export function deriveScenarioRequirements(params: {
  scenario: IntakeScenario;
  now?: Date;
}): ScenarioRequirements {
  const { scenario, now } = params;
  const taxYears = computeTaxYears(now);

  return {
    businessTaxYears: scenario.has_business_tax_returns ? taxYears : [],
    personalTaxYears: taxYears,
    requiresFinancialStatements: scenario.has_financial_statements,
    requiresPFS: true,
  };
}
