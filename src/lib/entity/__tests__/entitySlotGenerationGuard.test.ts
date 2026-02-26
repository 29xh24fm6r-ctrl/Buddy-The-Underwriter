/**
 * Entity-Aware Slot Generation — Invariant Guard
 *
 * Verifies:
 *   1. Single-entity deal: ALL entity-scoped slots have required_entity_id set
 *   2. Multi-entity deal: ALL entity-scoped slots have required_entity_id set
 *   3. Global docs never get entity bindings
 *   4. Multi-entity expansion produces correct per-entity slots
 *   5. No entity-scoped slot with null required_entity_id after processing
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applyEntityBindingsFromGraph, type SlotForBinding } from "../applyEntityBindingsFromGraph";
import type { DealEntityGraph, DealEntity } from "../buildDealEntityGraph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(entities: DealEntity[]): DealEntityGraph {
  return {
    entities,
    primaryBorrowerId: entities[0]?.entityId ?? "fallback",
    ambiguityFlags: { duplicateTaxForms: false, overlappingRoles: false },
    version: "v1.0.0",
  };
}

function makeDealEntity(overrides?: Partial<DealEntity>): DealEntity {
  return {
    entityId: "entity-1",
    role: "OPERATING_CO",
    entityType: "BUSINESS",
    taxFormSignatures: ["1120", "1120S", "1065"],
    fingerprint: "ein:123456789",
    ...overrides,
  };
}

function makeSlot(overrides?: Partial<SlotForBinding>): SlotForBinding {
  return {
    slot_key: "BUSINESS_TAX_RETURN_2024",
    required_doc_type: "BUSINESS_TAX_RETURN",
    slot_group: "BUSINESS_TAX_RETURN",
    required_tax_year: 2024,
    required_entity_id: null,
    required_entity_role: null,
    ...overrides,
  };
}

const ENTITY_SCOPED_DOC_TYPES = [
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BUSINESS_TAX_RETURN",
];

// ---------------------------------------------------------------------------
// TEST 1 — Single-entity: all entity-scoped slots bound
// ---------------------------------------------------------------------------

test("Single entity: all entity-scoped slots get required_entity_id", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", role: "OPERATING_CO" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ slot_key: "BTR_2024", required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "BTR_2023", required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "PTR_2024", required_doc_type: "PERSONAL_TAX_RETURN" }),
    makeSlot({ slot_key: "PFS_CURRENT", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT" }),
    makeSlot({ slot_key: "IS_YTD", required_doc_type: "INCOME_STATEMENT" }),
    makeSlot({ slot_key: "BS_CURRENT", required_doc_type: "BALANCE_SHEET" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  // Entity-scoped slots must have entity ID
  for (const slot of result) {
    if (ENTITY_SCOPED_DOC_TYPES.includes(slot.required_doc_type)) {
      assert.equal(
        slot.required_entity_id,
        "biz-1",
        `${slot.slot_key} must have required_entity_id=biz-1`,
      );
    }
  }
});

test("Single entity: no null required_entity_id on entity-scoped slots", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "PTR_2024", required_doc_type: "PERSONAL_TAX_RETURN" }),
    makeSlot({ slot_key: "PFS", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  for (const slot of result) {
    assert.notEqual(
      slot.required_entity_id,
      null,
      `Entity-scoped slot ${slot.slot_key} must not have null entity ID`,
    );
  }
});

// ---------------------------------------------------------------------------
// TEST 2 — Multi-entity: entity-scoped slots bound
// ---------------------------------------------------------------------------

test("Multi entity: each entity-scoped slot has required_entity_id set", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", role: "OPERATING_CO", entityType: "BUSINESS" }),
    makeDealEntity({ entityId: "person-1", role: "BORROWER", entityType: "PERSON", fingerprint: "ssn:1234" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ slot_key: "BTR_2024", required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "PTR_2024", required_doc_type: "PERSONAL_TAX_RETURN" }),
    makeSlot({ slot_key: "PFS", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT" }),
    makeSlot({ slot_key: "IS_YTD", required_doc_type: "INCOME_STATEMENT" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  // BTR → biz-1
  const btr = result.find((s) => s.slot_key === "BTR_2024");
  assert.ok(btr);
  assert.equal(btr.required_entity_id, "biz-1");
  assert.equal(btr.required_entity_role, "operating");

  // PTR → person-1
  const ptr = result.find((s) => s.slot_key === "PTR_2024");
  assert.ok(ptr);
  assert.equal(ptr.required_entity_id, "person-1");
  assert.equal(ptr.required_entity_role, "borrower");

  // PFS → person-1
  const pfs = result.find((s) => s.slot_key === "PFS");
  assert.ok(pfs);
  assert.equal(pfs.required_entity_id, "person-1");

  // IS (not entity-scoped) → null
  const is = result.find((s) => s.slot_key === "IS_YTD");
  assert.ok(is);
  assert.equal(is.required_entity_id, null);
});

test("Multi entity: no null required_entity_id on entity-scoped slots", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", entityType: "BUSINESS" }),
    makeDealEntity({ entityId: "person-1", entityType: "PERSON", fingerprint: "ssn:1234" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "PTR_2024", required_doc_type: "PERSONAL_TAX_RETURN" }),
    makeSlot({ slot_key: "PFS", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  for (const slot of result) {
    if (ENTITY_SCOPED_DOC_TYPES.includes(slot.required_doc_type)) {
      assert.notEqual(
        slot.required_entity_id,
        null,
        `Entity-scoped slot ${slot.slot_key} must not have null entity ID`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// TEST 3 — Global docs never get entity bindings
// ---------------------------------------------------------------------------

test("Global docs: INCOME_STATEMENT, BALANCE_SHEET, RENT_ROLL never get entity ID", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ slot_key: "IS_YTD", required_doc_type: "INCOME_STATEMENT" }),
    makeSlot({ slot_key: "BS_CURRENT", required_doc_type: "BALANCE_SHEET" }),
    makeSlot({ slot_key: "RR_CURRENT", required_doc_type: "RENT_ROLL" }),
    makeSlot({ slot_key: "SBA_1919", required_doc_type: "SBA_APPLICATION" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  for (const slot of result) {
    assert.equal(
      slot.required_entity_id,
      null,
      `Global doc ${slot.slot_key} must NOT have entity binding`,
    );
  }
});

// ---------------------------------------------------------------------------
// TEST 4 — Multi-entity expansion: 2 BUSINESS entities → 2 BTR slots per year
// ---------------------------------------------------------------------------

test("Multi entity expansion: 2 BUSINESS entities → per-entity BTR slots", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-aaaa", entityType: "BUSINESS", fingerprint: "ein:111" }),
    makeDealEntity({ entityId: "biz-bbbb", entityType: "BUSINESS", fingerprint: "ein:222" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ slot_key: "BTR_2024", required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "BTR_2023", required_doc_type: "BUSINESS_TAX_RETURN" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  // 2 base slots × 2 entities = 4 expanded slots
  const btrSlots = result.filter((s) => s.required_doc_type === "BUSINESS_TAX_RETURN");
  assert.equal(btrSlots.length, 4, "2 BTR years × 2 business entities = 4 slots");

  // Each expanded slot has unique key and entity binding
  const entityIds = new Set(btrSlots.map((s) => s.required_entity_id));
  assert.equal(entityIds.size, 2, "Must have 2 distinct entity IDs");
  assert.ok(entityIds.has("biz-aaaa"));
  assert.ok(entityIds.has("biz-bbbb"));

  // All expanded slots have non-null entity ID
  for (const slot of btrSlots) {
    assert.ok(slot.required_entity_id, `Expanded slot ${slot.slot_key} must have entity ID`);
  }
});

// ---------------------------------------------------------------------------
// TEST 5 — Slot key uniqueness after expansion
// ---------------------------------------------------------------------------

test("Expanded slots have unique slot keys", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-aaaa1111", entityType: "BUSINESS", fingerprint: "ein:111" }),
    makeDealEntity({ entityId: "biz-bbbb2222", entityType: "BUSINESS", fingerprint: "ein:222" }),
    makeDealEntity({ entityId: "person-1", entityType: "PERSON", fingerprint: "ssn:1234" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ slot_key: "BTR_2024", required_doc_type: "BUSINESS_TAX_RETURN" }),
    makeSlot({ slot_key: "PTR_2024", required_doc_type: "PERSONAL_TAX_RETURN" }),
    makeSlot({ slot_key: "IS_YTD", required_doc_type: "INCOME_STATEMENT" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  const keys = result.map((s) => s.slot_key);
  const uniqueKeys = new Set(keys);
  assert.equal(keys.length, uniqueKeys.size, "All slot keys must be unique");
});

// ---------------------------------------------------------------------------
// TEST 6 — Entity role propagation
// ---------------------------------------------------------------------------

test("Entity role propagates: GUARANTOR → 'guarantor' on slot", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "g-1", role: "GUARANTOR", entityType: "PERSON", fingerprint: "ssn:9999" }),
  ]);

  const slots: SlotForBinding[] = [
    makeSlot({ slot_key: "PTR_2024", required_doc_type: "PERSONAL_TAX_RETURN" }),
  ];

  const result = applyEntityBindingsFromGraph(slots, graph);

  assert.equal(result[0].required_entity_id, "g-1");
  assert.equal(result[0].required_entity_role, "guarantor");
});
