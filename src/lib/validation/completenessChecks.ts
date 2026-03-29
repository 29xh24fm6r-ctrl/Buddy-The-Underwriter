/**
 * Phase 53 — Completeness Checks (Deterministic)
 *
 * Are all required fields present for the deal type?
 */

import type { ValidationCheck } from "./validationTypes";

type FactMap = Record<string, number | null>;

const REQUIRED_OPERATING = [
  "TOTAL_REVENUE",
  "NET_INCOME",
  "ANNUAL_DEBT_SERVICE",
  "DSCR",
  "CASH_FLOW_AVAILABLE",
];

const REQUIRED_REAL_ESTATE = [
  "NOI_TTM",
  "ANNUAL_DEBT_SERVICE",
  "DSCR",
  "OCCUPANCY_PCT",
  "COLLATERAL_GROSS_VALUE",
  "LTV_GROSS",
];

const REQUIRED_BOTH = [
  "TOTAL_ASSETS",
  "TOTAL_LIABILITIES",
  "NET_WORTH",
];

export function runCompletenessChecks(
  facts: FactMap,
  dealType: "operating_company" | "real_estate" | "mixed",
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  const required =
    dealType === "real_estate"
      ? [...REQUIRED_REAL_ESTATE, ...REQUIRED_BOTH]
      : dealType === "mixed"
        ? [...REQUIRED_OPERATING, ...REQUIRED_REAL_ESTATE, ...REQUIRED_BOTH]
        : [...REQUIRED_OPERATING, ...REQUIRED_BOTH];

  const missing = required.filter((k) => facts[k] === null || facts[k] === undefined);

  if (missing.length === 0) {
    checks.push({
      family: "completeness",
      name: "Required fields present",
      status: "PASS",
      message: `All ${required.length} required fields are present.`,
      severity: "info",
    });
  } else if (missing.length <= 2) {
    checks.push({
      family: "completeness",
      name: "Required fields present",
      status: "FLAG",
      message: `${missing.length} required field(s) missing: ${missing.join(", ")}.`,
      affectedFields: missing,
      severity: "warning",
    });
  } else {
    checks.push({
      family: "completeness",
      name: "Required fields present",
      status: "BLOCK",
      message: `${missing.length} required fields missing: ${missing.join(", ")}. Cannot produce reliable analysis.`,
      affectedFields: missing,
      severity: "error",
    });
  }

  return checks;
}
