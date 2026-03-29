/**
 * Phase 53 — Mathematical Checks (Pure, Deterministic)
 *
 * No LLM. Same input → same output, always.
 */

import type { ValidationCheck } from "./validationTypes";

type FactMap = Record<string, number | null>;

const TOLERANCE = 0.02; // 2% rounding tolerance

function withinTolerance(a: number, b: number, tol = TOLERANCE): boolean {
  if (b === 0) return Math.abs(a) < 1;
  return Math.abs((a - b) / b) <= tol;
}

export function runMathematicalChecks(facts: FactMap): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1. Balance sheet balance: assets = liabilities + equity
  const totalAssets = facts["TOTAL_ASSETS"] ?? null;
  const totalLiabilities = facts["TOTAL_LIABILITIES"] ?? null;
  const netWorth = facts["NET_WORTH"] ?? null;

  if (totalAssets !== null && totalLiabilities !== null && netWorth !== null) {
    const expected = totalLiabilities + netWorth;
    const passes = withinTolerance(totalAssets, expected);
    checks.push({
      family: "mathematical",
      name: "Balance sheet balances",
      status: passes ? "PASS" : "BLOCK",
      message: passes
        ? "Assets = Liabilities + Equity within tolerance."
        : `Balance sheet imbalance: Assets (${totalAssets}) ≠ Liabilities (${totalLiabilities}) + Equity (${netWorth}) = ${expected}.`,
      affectedFields: ["TOTAL_ASSETS", "TOTAL_LIABILITIES", "NET_WORTH"],
      severity: passes ? "info" : "error",
    });
  }

  // 2. DSCR reconciliation: DSCR = cash_flow_available / annual_debt_service
  const cfa = facts["CASH_FLOW_AVAILABLE"] ?? null;
  const ads = facts["ANNUAL_DEBT_SERVICE"] ?? null;
  const dscr = facts["DSCR"] ?? null;

  if (cfa !== null && ads !== null && ads !== 0 && dscr !== null) {
    const computedDscr = cfa / ads;
    const passes = withinTolerance(dscr, computedDscr);
    checks.push({
      family: "mathematical",
      name: "DSCR reconciliation",
      status: passes ? "PASS" : "BLOCK",
      message: passes
        ? "DSCR matches cash flow / debt service."
        : `DSCR (${dscr.toFixed(2)}) does not match CFA (${cfa}) / ADS (${ads}) = ${computedDscr.toFixed(2)}.`,
      affectedFields: ["DSCR", "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE"],
      severity: passes ? "info" : "error",
    });
  }

  // 3. Net income = revenue - expenses (approximate)
  const revenue = facts["TOTAL_REVENUE"] ?? facts["TOTAL_INCOME_TTM"] ?? null;
  const expenses = facts["OPEX_TTM"] ?? null;
  const netIncome = facts["NET_INCOME"] ?? null;

  if (revenue !== null && expenses !== null && netIncome !== null) {
    const expected = revenue - expenses;
    const passes = withinTolerance(netIncome, expected, 0.10); // 10% tolerance for addbacks
    checks.push({
      family: "mathematical",
      name: "Net income reconciliation",
      status: passes ? "PASS" : "FLAG",
      message: passes
        ? "Net income broadly consistent with revenue minus expenses."
        : `Net income (${netIncome}) diverges from revenue (${revenue}) - expenses (${expenses}) = ${expected}. May include addbacks.`,
      affectedFields: ["NET_INCOME", "TOTAL_REVENUE", "OPEX_TTM"],
      severity: passes ? "info" : "warning",
    });
  }

  // 4. Current ratio = current assets / current liabilities (if available)
  const currentRatio = facts["CURRENT_RATIO"] ?? null;
  if (currentRatio !== null) {
    if (currentRatio < 0) {
      checks.push({
        family: "mathematical",
        name: "Current ratio sign check",
        status: "BLOCK",
        message: `Current ratio is negative (${currentRatio}), which is mathematically impossible.`,
        affectedFields: ["CURRENT_RATIO"],
        severity: "error",
      });
    } else {
      checks.push({
        family: "mathematical",
        name: "Current ratio sign check",
        status: "PASS",
        message: "Current ratio is non-negative.",
        affectedFields: ["CURRENT_RATIO"],
        severity: "info",
      });
    }
  }

  return checks;
}
