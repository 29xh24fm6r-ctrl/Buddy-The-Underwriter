/**
 * Legacy collateral row normalization for Builder UI.
 * Handles pre-53A.1 rows that lack valuation_method, advance_rate, net_lendable_value.
 * Pure module — no DB, no server-only.
 */

import type { CollateralItem, CollateralValuationMethod } from "./builderTypes";
import { getDefaultAdvanceRate } from "./builderPolicyDefaults";

// ── Types ────────────────────────────────────────────────────────

export type NormalizedCollateralItem = CollateralItem & {
  /** Whether this item had to be filled with defaults */
  had_missing_fields: boolean;
  /** Specific fields that were missing and auto-filled */
  auto_filled: string[];
  /** Effective advance rate (from item, policy, or default) */
  effective_advance_rate: number | null;
  /** Computed lendable value */
  computed_lendable_value: number | null;
  /** Row-level status for display */
  policy_status: "within_policy" | "needs_advance_rate" | "needs_valuation_method" | "manual_override" | "incomplete";
};

// ── Normalizer ───────────────────────────────────────────────────

/**
 * Normalize a collateral item for builder display.
 * Fills defaults where possible, tracks what was auto-filled.
 */
export function normalizeCollateralItemForBuilder(
  item: CollateralItem,
  resolvedAdvanceRate?: number | null,
): NormalizedCollateralItem {
  const autoFilled: string[] = [];
  let effectiveAdvRate: number | null = null;

  // Resolve advance rate
  if (item.advance_rate != null) {
    effectiveAdvRate = item.advance_rate;
  } else if (resolvedAdvanceRate != null) {
    effectiveAdvRate = resolvedAdvanceRate;
    autoFilled.push("advance_rate");
  } else {
    const defaultRate = getDefaultAdvanceRate(item.item_type);
    if (defaultRate != null) {
      effectiveAdvRate = defaultRate;
      autoFilled.push("advance_rate");
    }
  }

  // Compute lendable value
  const grossValue = item.estimated_value ?? 0;
  const computedLendable = effectiveAdvRate != null && grossValue > 0
    ? grossValue * effectiveAdvRate
    : null;

  // Determine policy status
  let policyStatus: NormalizedCollateralItem["policy_status"] = "within_policy";
  if (!item.valuation_method) {
    policyStatus = "needs_valuation_method";
  } else if (item.advance_rate == null && effectiveAdvRate == null) {
    policyStatus = "needs_advance_rate";
  } else if (grossValue <= 0) {
    policyStatus = "incomplete";
  }

  return {
    ...item,
    had_missing_fields: autoFilled.length > 0 || !item.valuation_method,
    auto_filled: autoFilled,
    effective_advance_rate: effectiveAdvRate,
    computed_lendable_value: computedLendable,
    policy_status: policyStatus,
  };
}

/**
 * Normalize all collateral items, applying policy-resolved advance rates.
 */
export function normalizeCollateralForBuilder(
  items: CollateralItem[],
  resolvedRates?: Record<string, number>,
): NormalizedCollateralItem[] {
  return items.map((item) =>
    normalizeCollateralItemForBuilder(
      item,
      resolvedRates?.[item.item_type],
    ),
  );
}
