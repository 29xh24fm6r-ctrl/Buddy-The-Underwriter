// ---------------------------------------------------------------------------
// Phase 15B — Slot Policy Registry
// ---------------------------------------------------------------------------

import type { IntakeScenario, SlotDefinition, SlotPolicy } from "../types";
import { CONVENTIONAL_POLICY } from "./conventional";
import { SBA_7A_POLICY } from "./sba7a";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const SLOT_POLICY_REGISTRY: Record<string, SlotPolicy> = {
  SBA_7A: SBA_7A_POLICY,
  CONVENTIONAL: CONVENTIONAL_POLICY,
};

/** All SBA product codes that map to the SBA 7(a) policy. */
const SBA_7A_PRODUCTS = new Set([
  "SBA_7A",
  "SBA_7A_STANDARD",
  "SBA_7A_SMALL",
  "SBA_EXPRESS",
  "SBA_CAPLines",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the slot policy for a product type.
 * SBA variants all map to the SBA_7A policy.
 * Unknown product types fall back to CONVENTIONAL.
 */
export function resolveSlotPolicy(productType: string): SlotPolicy {
  if (SBA_7A_PRODUCTS.has(productType)) return SLOT_POLICY_REGISTRY.SBA_7A;
  return SLOT_POLICY_REGISTRY[productType] ?? CONVENTIONAL_POLICY;
}

/**
 * Generate the deterministic slot list for a given intake scenario.
 * Pure function — no DB, no side effects.
 */
export function generateSlotsForScenario(
  scenario: IntakeScenario,
  now?: Date,
): SlotDefinition[] {
  const policy = resolveSlotPolicy(scenario.product_type);
  return policy.generateSlots(scenario, now);
}
