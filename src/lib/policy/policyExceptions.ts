/**
 * Pure policy exception detection.
 * Generates deterministic exceptions from deal state + resolved policy.
 * No DB, no server-only.
 */

import type { CollateralLtvSummary } from "@/lib/builder/collateralLtv";

// ── Types ────────────────────────────────────────────────────────

export type PolicyExceptionType =
  | "ltv_exceeded"
  | "equity_shortfall"
  | "advance_rate_override"
  | "missing_valuation_method";

export type PolicyException = {
  type: PolicyExceptionType;
  severity: "warning" | "exception";
  description: string;
  policy_reference?: string | null;
  details?: Record<string, unknown>;
};

// ── Exception generators ─────────────────────────────────────────

export type PolicyExceptionInput = {
  ltv: CollateralLtvSummary;
  equityRequiredPct?: number | null;
  equityActualPct?: number | null;
  collateralOverrides?: Array<{
    description: string;
    itemType: string;
    overriddenAdvanceRate: number;
    defaultAdvanceRate: number;
  }>;
  missingValuationCount?: number;
};

/**
 * Generate all policy exceptions for current deal state.
 */
export function computePolicyExceptions(input: PolicyExceptionInput): PolicyException[] {
  const exceptions: PolicyException[] = [];

  // LTV exceeded
  if (input.ltv.ltv != null && input.ltv.policyLimit != null && input.ltv.ltv > input.ltv.policyLimit) {
    exceptions.push({
      type: "ltv_exceeded",
      severity: "exception",
      description: `LTV of ${(input.ltv.ltv * 100).toFixed(1)}% exceeds policy limit of ${(input.ltv.policyLimit * 100).toFixed(0)}%`,
      details: {
        ltv: input.ltv.ltv,
        policyLimit: input.ltv.policyLimit,
        lendableValue: input.ltv.totalLendableValue,
      },
    });
  }

  // Equity shortfall
  if (
    input.equityRequiredPct != null &&
    input.equityActualPct != null &&
    input.equityActualPct < input.equityRequiredPct
  ) {
    const shortfallPct = input.equityRequiredPct - input.equityActualPct;
    exceptions.push({
      type: "equity_shortfall",
      severity: "exception",
      description: `Proposed equity of ${(input.equityActualPct * 100).toFixed(0)}% is ${(shortfallPct * 100).toFixed(0)}% below the required ${(input.equityRequiredPct * 100).toFixed(0)}%`,
      details: {
        requiredPct: input.equityRequiredPct,
        actualPct: input.equityActualPct,
        shortfallPct,
      },
    });
  }

  // Advance rate overrides
  for (const override of input.collateralOverrides ?? []) {
    exceptions.push({
      type: "advance_rate_override",
      severity: "warning",
      description: `${override.description || override.itemType} advance rate manually changed from ${Math.round(override.defaultAdvanceRate * 100)}% to ${Math.round(override.overriddenAdvanceRate * 100)}%`,
      details: {
        itemType: override.itemType,
        original: override.defaultAdvanceRate,
        overridden: override.overriddenAdvanceRate,
      },
    });
  }

  // Missing valuation methods
  if (input.missingValuationCount && input.missingValuationCount > 0) {
    exceptions.push({
      type: "missing_valuation_method",
      severity: "warning",
      description: `${input.missingValuationCount} collateral item${input.missingValuationCount > 1 ? "s" : ""} missing valuation method`,
    });
  }

  return exceptions;
}
