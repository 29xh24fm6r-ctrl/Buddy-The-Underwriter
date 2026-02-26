/**
 * Entity-Aware Slot Binding — Post-Processor
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Applies entity bindings from a DealEntityGraph to slot definitions.
 * Works with ANY slot policy output (conventional, SBA, etc.).
 *
 * Rules:
 *   - Single entity: ALL entity-scoped slots get required_entity_id = primaryBorrowerId
 *   - Multi entity: entity-scoped slots expanded per matching entity (by type)
 *   - Global/non-entity docs (IS, BS, RENT_ROLL, etc.): required_entity_id = null (untouched)
 *
 * Invariants:
 *   - No entity-scoped slot has null required_entity_id after processing
 *   - Global docs never get entity bindings
 */

import type { DealEntityGraph, DealEntity, DealEntityRole } from "./buildDealEntityGraph";
import { mapCanonicalTypeToEntityType } from "./mapCanonicalTypeToEntityType";

// ---------------------------------------------------------------------------
// Constants: entity-scoped doc types (mirrored from entityScopedDocTypes.ts)
// ---------------------------------------------------------------------------

const ENTITY_SCOPED_DOC_TYPES = new Set([
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BUSINESS_TAX_RETURN",
]);

// ---------------------------------------------------------------------------
// Role mapping
// ---------------------------------------------------------------------------

const GRAPH_ROLE_TO_SLOT_ROLE: Record<DealEntityRole, string> = {
  BORROWER: "borrower",
  GUARANTOR: "guarantor",
  OPERATING_CO: "operating",
  HOLDCO: "holding",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal slot shape for entity binding — matches SlotDefinition. */
export type SlotForBinding = {
  slot_key: string;
  required_doc_type: string;
  required_entity_id?: string | null;
  required_entity_role?: string | null;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply entity bindings from a DealEntityGraph to slot definitions.
 *
 * @param slots - Base slot definitions from any policy
 * @param graph - The authoritative DealEntityGraph
 * @returns Slot definitions with entity bindings applied
 */
export function applyEntityBindingsFromGraph<T extends SlotForBinding>(
  slots: T[],
  graph: DealEntityGraph,
): T[] {
  if (graph.entities.length === 1) {
    return applySingleEntityBindings(slots, graph);
  }
  return applyMultiEntityBindings(slots, graph);
}

// ---------------------------------------------------------------------------
// Single-entity: bind ALL entity-scoped slots to primaryBorrowerId
// ---------------------------------------------------------------------------

function applySingleEntityBindings<T extends SlotForBinding>(
  slots: T[],
  graph: DealEntityGraph,
): T[] {
  const entity = graph.entities[0];
  const role = GRAPH_ROLE_TO_SLOT_ROLE[entity.role] ?? null;

  return slots.map((slot) => {
    if (!ENTITY_SCOPED_DOC_TYPES.has(slot.required_doc_type)) {
      return slot;
    }
    return {
      ...slot,
      required_entity_id: entity.entityId,
      required_entity_role: role,
    };
  });
}

// ---------------------------------------------------------------------------
// Multi-entity: expand entity-scoped slots per matching entity
// ---------------------------------------------------------------------------

function applyMultiEntityBindings<T extends SlotForBinding>(
  slots: T[],
  graph: DealEntityGraph,
): T[] {
  const result: T[] = [];

  for (const slot of slots) {
    if (!ENTITY_SCOPED_DOC_TYPES.has(slot.required_doc_type)) {
      result.push(slot);
      continue;
    }

    const targetEntityType = mapCanonicalTypeToEntityType(slot.required_doc_type);
    if (!targetEntityType) {
      result.push(slot);
      continue;
    }

    const matchingEntities = graph.entities.filter(
      (e) => e.entityType === targetEntityType,
    );

    if (matchingEntities.length === 0) {
      // No matching entity type in graph — keep slot unbound
      result.push(slot);
    } else if (matchingEntities.length === 1) {
      // One match → bind directly, no slot key change needed
      const entity = matchingEntities[0];
      result.push({
        ...slot,
        required_entity_id: entity.entityId,
        required_entity_role: GRAPH_ROLE_TO_SLOT_ROLE[entity.role] ?? null,
      });
    } else {
      // Multiple matches → expand into per-entity slots
      for (const entity of matchingEntities) {
        const suffix = entity.entityId.slice(0, 8).toUpperCase();
        result.push({
          ...slot,
          slot_key: `${slot.slot_key}_${suffix}`,
          required_entity_id: entity.entityId,
          required_entity_role: GRAPH_ROLE_TO_SLOT_ROLE[entity.role] ?? null,
        });
      }
    }
  }

  return result;
}
