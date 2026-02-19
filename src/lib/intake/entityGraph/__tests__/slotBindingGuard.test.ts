/**
 * Slot Entity Binding Guard — CI-Blocking Governance Invariants (Layer 2.3)
 *
 * Validates that the slot ↔ entity structural integrity layer:
 *   1. ENTITY_SCOPED_DOC_TYPES contains exactly the 3 approved doc types
 *   2. ENTITY_SCOPED_DOC_TYPES excludes non-entity doc types
 *   3. generateConventionalSlots with multiple guarantors → PTR/PFS have required_entity_id
 *      (policy CAN produce bound slots — the capability exists)
 *   4. generateConventionalSlots without entities → entity-scoped slots have null required_entity_id
 *      (confirms the structural gap that Layer 2.3 audits and Layer 2.4 will close)
 *
 * Pure function tests — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ENTITY_SCOPED_DOC_TYPES } from "../../identity/entityScopedDocTypes";
import { generateConventionalSlots } from "../../slots/policies/conventional";
import type { IntakeScenario } from "../../slots/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Inline scenario — avoids pulling in "server-only" from ensureDeterministicSlots
const SCENARIO: IntakeScenario = {
  product_type: "CONVENTIONAL",
  borrower_business_stage: "EXISTING",
  has_business_tax_returns: true,
  has_financial_statements: true,
  has_projections: false,
  entity_age_months: null,
};

const FIXED_DATE = new Date("2025-01-15");

// ---------------------------------------------------------------------------
// Guard 1: ENTITY_SCOPED_DOC_TYPES contains exactly 3 expected types
// ---------------------------------------------------------------------------

test("ENTITY_SCOPED_DOC_TYPES contains exactly 3 expected doc types", () => {
  assert.ok(
    ENTITY_SCOPED_DOC_TYPES.has("PERSONAL_TAX_RETURN"),
    "Must contain PERSONAL_TAX_RETURN",
  );
  assert.ok(
    ENTITY_SCOPED_DOC_TYPES.has("PERSONAL_FINANCIAL_STATEMENT"),
    "Must contain PERSONAL_FINANCIAL_STATEMENT",
  );
  assert.ok(
    ENTITY_SCOPED_DOC_TYPES.has("BUSINESS_TAX_RETURN"),
    "Must contain BUSINESS_TAX_RETURN",
  );
  assert.strictEqual(
    ENTITY_SCOPED_DOC_TYPES.size,
    3,
    `Expected exactly 3 entity-scoped doc types, got ${ENTITY_SCOPED_DOC_TYPES.size}`,
  );
  console.log(`[slotBindingGuard] ENTITY_SCOPED_DOC_TYPES size=3 ✓`);
});

// ---------------------------------------------------------------------------
// Guard 2: Non-entity doc types excluded
// ---------------------------------------------------------------------------

test("ENTITY_SCOPED_DOC_TYPES excludes non-entity doc types", () => {
  const excluded = [
    "INCOME_STATEMENT",
    "BALANCE_SHEET",
    "OTHER",
    "FINANCIAL_STATEMENT",
    "RENT_ROLL",
  ];
  for (const docType of excluded) {
    assert.ok(
      !ENTITY_SCOPED_DOC_TYPES.has(docType),
      `${docType} must NOT be entity-scoped`,
    );
  }
  console.log(`[slotBindingGuard] non-entity doc types excluded ✓`);
});

// ---------------------------------------------------------------------------
// Guard 3: With multiple guarantors → PTR/PFS slots bound
// (Policy CAN produce bound slots when entities are provided)
// ---------------------------------------------------------------------------

test("generateConventionalSlots with multiple guarantors → PTR/PFS have required_entity_id", () => {
  const slots = generateConventionalSlots(SCENARIO, FIXED_DATE, [
    { entityId: "g1", entityRole: "guarantor", legalName: "Alice Smith" },
    { entityId: "g2", entityRole: "guarantor", legalName: "Bob Jones" },
  ]);

  const ptrSlots = slots.filter(
    (s) => s.required_doc_type === "PERSONAL_TAX_RETURN",
  );
  assert.ok(ptrSlots.length > 0, "Should generate PTR slots for multiple guarantors");
  assert.ok(
    ptrSlots.every((s) => s.required_entity_id != null),
    "All PTR slots must have required_entity_id when multiple guarantors provided",
  );

  const pfsSlots = slots.filter(
    (s) => s.required_doc_type === "PERSONAL_FINANCIAL_STATEMENT",
  );
  assert.ok(pfsSlots.length > 0, "Should generate PFS slots for multiple guarantors");
  assert.ok(
    pfsSlots.every((s) => s.required_entity_id != null),
    "All PFS slots must have required_entity_id when multiple guarantors provided",
  );

  console.log(
    `[slotBindingGuard] multi-guarantor: ${ptrSlots.length} PTR + ${pfsSlots.length} PFS slots bound ✓`,
  );
});

// ---------------------------------------------------------------------------
// Guard 4: Without entities → entity-scoped slots have null binding
// (Confirms structural gap that Layer 2.3 audits, Layer 2.4 will close)
// ---------------------------------------------------------------------------

test("generateConventionalSlots without entities → entity-scoped slots have null required_entity_id", () => {
  const slots = generateConventionalSlots(SCENARIO, FIXED_DATE);

  const ptrSlots = slots.filter(
    (s) => s.required_doc_type === "PERSONAL_TAX_RETURN",
  );
  assert.ok(ptrSlots.length > 0, "Should generate PTR slots without entities");
  assert.ok(
    ptrSlots.every((s) => s.required_entity_id == null),
    "PTR slots must have null required_entity_id when no entities provided (structural gap)",
  );

  const pfsSlots = slots.filter(
    (s) => s.required_doc_type === "PERSONAL_FINANCIAL_STATEMENT",
  );
  assert.ok(pfsSlots.length > 0, "Should generate PFS slots without entities");
  assert.ok(
    pfsSlots.every((s) => s.required_entity_id == null),
    "PFS slots must have null required_entity_id when no entities provided (structural gap)",
  );

  console.log(
    `[slotBindingGuard] unbound gap confirmed: ${ptrSlots.length} PTR + ${pfsSlots.length} PFS slots have null entity binding ✓`,
  );
});
