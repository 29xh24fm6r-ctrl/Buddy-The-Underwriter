/**
 * Phase 53 — Plausibility Checks (Deterministic)
 *
 * Ratio sanity bands. Flag (not block) outliers.
 */

import type { ValidationCheck } from "./validationTypes";

type FactMap = Record<string, number | null>;

type Band = { min: number; max: number; label: string };

const SANITY_BANDS: Record<string, Band> = {
  DSCR: { min: 0.1, max: 8.0, label: "DSCR" },
  LTV_GROSS: { min: 0.0, max: 1.5, label: "LTV" },
  DEBT_TO_EQUITY: { min: -5, max: 50, label: "Debt-to-Equity" },
  CURRENT_RATIO: { min: 0, max: 30, label: "Current Ratio" },
  OCCUPANCY_PCT: { min: 0, max: 1.05, label: "Occupancy" },
};

export function runPlausibilityChecks(facts: FactMap): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  for (const [key, band] of Object.entries(SANITY_BANDS)) {
    const val = facts[key];
    if (val === null || val === undefined) continue;

    const inBand = val >= band.min && val <= band.max;
    checks.push({
      family: "plausibility",
      name: `${band.label} plausibility`,
      status: inBand ? "PASS" : "FLAG",
      message: inBand
        ? `${band.label} (${val}) is within expected range.`
        : `${band.label} (${val}) outside expected range [${band.min}, ${band.max}]. Verify source data.`,
      affectedFields: [key],
      severity: inBand ? "info" : "warning",
    });
  }

  return checks;
}
