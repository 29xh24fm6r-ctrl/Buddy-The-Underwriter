/**
 * SPEC-CLASSIC-SPREAD-CERTIFIED-NUMBER-SOURCES-1 (Phase 1)
 *
 * Every DERIVED spread row (totals, subtotals, ratios) must be produced by a NAMED formula
 * over certified inputs — never an inline ad-hoc number. The engine enforces:
 *   - required input missing  → unavailable (render blank, NOT zero);
 *   - input explicitly zero-safe and missing → contributes 0 (the only sanctioned "missing = 0");
 *   - any input blocked       → result blocked (conflict propagates, no false precision);
 *   - all inputs satisfied    → certified derived value carrying formulaName + input trace.
 *
 * Phase 1 ships the engine + a small starter registry proving the semantics. Per-domain
 * phases (balance-sheet gates, ratios, GCF) register their own formulas against this engine.
 * Pure — no DB, no IO.
 */

import {
  certifiedBlocked,
  certifiedDerived,
  certifiedUnavailable,
  type CertifiedSpreadValue,
} from "./certifiedSpreadValue";

export type FormulaInputSpec = {
  /** logical input name referenced by the compute fn */
  name: string;
  /**
   * When true, a missing/unavailable input is treated as 0 (the only place "missing = 0"
   * is allowed). A blocked input is NEVER zero-safe — conflict always propagates.
   */
  zeroSafe?: boolean;
};

export type CertifiedFormula = {
  name: string;
  inputs: FormulaInputSpec[];
  compute: (resolved: Record<string, number>) => number;
};

type InputMap = Record<string, CertifiedSpreadValue | null | undefined>;

/**
 * Evaluate a formula over certified inputs, returning a CertifiedSpreadValue whose status
 * reflects input availability/conflict.
 */
export function evaluateFormula(formula: CertifiedFormula, inputs: InputMap): CertifiedSpreadValue {
  const resolved: Record<string, number> = {};
  const contributingTraces: CertifiedSpreadValue[] = [];
  const missingRequired: string[] = [];
  const blockedInputs: { name: string; reason: string | null }[] = [];

  for (const spec of formula.inputs) {
    const cv = inputs[spec.name];

    if (cv && cv.status === "blocked") {
      // Conflict always propagates — never silenced by zero-safe.
      blockedInputs.push({ name: spec.name, reason: cv.failureReason });
      continue;
    }

    const usable = cv && cv.status === "certified" && cv.value !== null;
    if (usable) {
      resolved[spec.name] = cv!.value as number;
      contributingTraces.push(cv!);
      continue;
    }

    // Missing or unavailable.
    if (spec.zeroSafe) {
      resolved[spec.name] = 0; // explicitly sanctioned
      if (cv) contributingTraces.push(cv); // keep any partial trace/caveats
    } else {
      missingRequired.push(spec.name);
    }
  }

  if (blockedInputs.length > 0) {
    const detail = blockedInputs
      .map((b) => `${b.name}${b.reason ? ` (${b.reason})` : ""}`)
      .join(", ");
    return certifiedBlocked(
      `${formula.name}: blocked input(s) — ${detail}`,
      contributingTraces,
    );
  }

  if (missingRequired.length > 0) {
    return certifiedUnavailable(
      `${formula.name}: required input(s) unavailable — ${missingRequired.join(", ")}`,
      contributingTraces.flatMap((t) => t.caveats),
    );
  }

  const value = formula.compute(resolved);
  return certifiedDerived(value, formula.name, contributingTraces);
}

// ── starter formula registry ───────────────────────────────────────────────
// A minimal, correct set proving the engine. Per-domain phases extend FORMULAS.

export const FORMULAS = {
  WORKING_CAPITAL: {
    name: "WORKING_CAPITAL",
    inputs: [{ name: "totalCurrentAssets" }, { name: "totalCurrentLiabilities" }],
    compute: (r) => r.totalCurrentAssets - r.totalCurrentLiabilities,
  },
  /**
   * Balance-sheet residual liabilities. Components are zero-safe so a clean statement with
   * no liabilities derives 0, but SPEC-...-BALANCE-SHEET-ACCOUNTING-GATES-1 will wrap this
   * with the conflict check that BLOCKS a derived 0 when material liability components exist.
   */
  TOTAL_LIABILITIES_FROM_ASSETS_EQUITY: {
    name: "TOTAL_LIABILITIES_FROM_ASSETS_EQUITY",
    inputs: [{ name: "totalAssets" }, { name: "totalEquity" }],
    compute: (r) => r.totalAssets - r.totalEquity,
  },
  NET_FIXED_ASSETS: {
    name: "NET_FIXED_ASSETS",
    inputs: [{ name: "ppeGross" }, { name: "accumulatedDepreciation", zeroSafe: true }],
    compute: (r) => r.ppeGross - r.accumulatedDepreciation,
  },
} satisfies Record<string, CertifiedFormula>;
