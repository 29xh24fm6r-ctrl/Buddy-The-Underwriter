/**
 * Policy Engine — Baseline Policy Definitions
 *
 * Centralized thresholds per product type.
 * No hard-coded numbers in logic files — all thresholds here.
 *
 * PHASE 5: Policy layer only — no pricing, no lifecycle mutation.
 */

import type { ProductType } from "@/lib/creditLenses/types";
import type { PolicyDefinition } from "./types";

// ---------------------------------------------------------------------------
// Thresholds (configurable constants)
// ---------------------------------------------------------------------------

/** Minor breach band: deviation within this % is "minor", beyond is "severe" */
export const MINOR_BREACH_BAND = 0.15;

// ---------------------------------------------------------------------------
// Policy Definitions
// ---------------------------------------------------------------------------

const SBA_POLICY: PolicyDefinition = {
  product: "SBA",
  thresholds: [
    { metric: "dscr", minimum: 1.25 },
    { metric: "leverage", maximum: 4.0 },
  ],
};

const LOC_POLICY: PolicyDefinition = {
  product: "LOC",
  thresholds: [{ metric: "currentRatio", minimum: 1.0 }],
};

const EQUIPMENT_POLICY: PolicyDefinition = {
  product: "EQUIPMENT",
  thresholds: [{ metric: "dscr", minimum: 1.15 }],
};

const ACQUISITION_POLICY: PolicyDefinition = {
  product: "ACQUISITION",
  thresholds: [
    { metric: "leverage", maximum: 5.0 },
    { metric: "dscr", minimum: 1.2 },
  ],
};

const CRE_POLICY: PolicyDefinition = {
  product: "CRE",
  thresholds: [{ metric: "dscr", minimum: 1.25 }],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const POLICY_REGISTRY: Record<ProductType, PolicyDefinition> = {
  SBA: SBA_POLICY,
  LOC: LOC_POLICY,
  EQUIPMENT: EQUIPMENT_POLICY,
  ACQUISITION: ACQUISITION_POLICY,
  CRE: CRE_POLICY,
};

/**
 * Get the policy definition for a product type.
 */
export function getPolicyDefinition(product: ProductType): PolicyDefinition {
  return POLICY_REGISTRY[product];
}
