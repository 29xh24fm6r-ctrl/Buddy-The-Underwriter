// ---------------------------------------------------------------------------
// Phase 15B — Slot Policy Registry
// ---------------------------------------------------------------------------

import type { IntakeScenario, SlotDefinition, SlotPolicy } from "../types";
import { CONVENTIONAL_POLICY } from "./conventional";
import { SBA_7A_POLICY } from "./sba7a";
import type { DealEntityGraph } from "@/lib/entity/buildDealEntityGraph";
import { applyEntityBindingsFromGraph } from "@/lib/entity/applyEntityBindingsFromGraph";

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
 *
 * When a DealEntityGraph is provided (v1.4.0+):
 *   - Single entity: all entity-scoped slots get required_entity_id = primaryBorrowerId
 *   - Multi entity: entity-scoped slots expanded per matching entity
 *   - Global docs: required_entity_id remains null
 *
 * Backward compatible: omit graph parameter for legacy behavior.
 */
export function generateSlotsForScenario(
  scenario: IntakeScenario,
  now?: Date,
  graph?: DealEntityGraph,
): SlotDefinition[] {
  const policy = resolveSlotPolicy(scenario.product_type);
  const slots = policy.generateSlots(scenario, now);

  if (!graph) return slots;

  return applyEntityBindingsFromGraph(slots, graph);
}
