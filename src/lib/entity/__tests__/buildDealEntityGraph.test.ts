/**
 * Deal Entity Graph Builder — v1.0.0 Behavioral Tests
 *
 * Tests:
 *   1. Single-entity deal (1 business → graph has 1 entity)
 *   2. Multi-entity deal (1 business + 1 person → 2 entities, correct roles)
 *   3. Duplicate EIN collapse (2 entities same EIN → collapsed to 1)
 *   4. Duplicate SSN collapse (2 person entities same SSN → collapsed to 1)
 *   5. Duplicate name collapse (2 entities same normalized name → collapsed to 1)
 *   6. Role overlap detection (1 entity bound to borrower + guarantor slots)
 *   7. Duplicate tax forms detection (2 OPCOs → duplicateTaxForms=true)
 *   8. GROUP entities filtered out
 *   9. Empty entities throws error
 *  10. Synthetic vs non-synthetic preference
 *  11. Primary borrower resolution priority
 *  12. Version constant
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealEntityGraph,
  computeFingerprint,
  DEAL_ENTITY_GRAPH_VERSION,
  type RawDealEntity,
  type EntitySlotBinding,
  type BuildGraphInput,
} from "../buildDealEntityGraph";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides?: Partial<RawDealEntity>): RawDealEntity {
  return {
    id: "entity-1",
    entityKind: "OPCO",
    name: "Test Business LLC",
    legalName: "Test Business LLC",
    ein: null,
    ssnLast4: null,
    synthetic: false,
    ...overrides,
  };
}

function makeSlotBinding(
  overrides?: Partial<EntitySlotBinding>,
): EntitySlotBinding {
  return {
    requiredDocType: "BUSINESS_TAX_RETURN",
    requiredEntityId: "entity-1",
    requiredEntityRole: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TEST 1 — Single-entity deal
// ---------------------------------------------------------------------------

test("Single-entity: 1 OPCO → graph has 1 entity, role=OPERATING_CO, primaryBorrowerId set", () => {
  const input: BuildGraphInput = {
    entities: [makeEntity({ id: "biz-1", entityKind: "OPCO", ein: "123456789" })],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-1" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1);
  assert.equal(graph.entities[0].entityId, "biz-1");
  assert.equal(graph.entities[0].role, "OPERATING_CO");
  assert.equal(graph.entities[0].entityType, "BUSINESS");
  assert.equal(graph.primaryBorrowerId, "biz-1");
  assert.equal(graph.ambiguityFlags.duplicateTaxForms, false);
  assert.equal(graph.ambiguityFlags.overlappingRoles, false);
  assert.equal(graph.version, "v1.0.0");
});

// ---------------------------------------------------------------------------
// TEST 2 — Multi-entity deal
// ---------------------------------------------------------------------------

test("Multi-entity: 1 OPCO + 1 PERSON → 2 entities, correct roles and types", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "biz-1", entityKind: "OPCO", ein: "123456789" }),
      makeEntity({ id: "person-1", entityKind: "PERSON", name: "John Doe", legalName: "John Doe", ssnLast4: "5678" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-1" }),
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "person-1", requiredEntityRole: "borrower" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 2);

  const biz = graph.entities.find((e) => e.entityId === "biz-1");
  assert.ok(biz);
  assert.equal(biz.role, "OPERATING_CO");
  assert.equal(biz.entityType, "BUSINESS");
  assert.ok(biz.taxFormSignatures.includes("1120S"));

  const person = graph.entities.find((e) => e.entityId === "person-1");
  assert.ok(person);
  assert.equal(person.role, "BORROWER");
  assert.equal(person.entityType, "PERSON");
  assert.ok(person.taxFormSignatures.includes("1040"));

  // OPERATING_CO takes priority for primaryBorrowerId
  assert.equal(graph.primaryBorrowerId, "biz-1");
});

// ---------------------------------------------------------------------------
// TEST 3 — Duplicate EIN collapse
// ---------------------------------------------------------------------------

test("Duplicate EIN collapse: 2 entities same EIN → collapsed to 1", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "biz-1", entityKind: "OPCO", name: "Business A", ein: "123456789" }),
      makeEntity({ id: "biz-2", entityKind: "OPCO", name: "Business B", ein: "123456789", synthetic: true }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-1" }),
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-2" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1);
  // Non-synthetic entity preferred as representative
  assert.equal(graph.entities[0].entityId, "biz-1");
  assert.equal(graph.entities[0].fingerprint, "ein:123456789");
});

// ---------------------------------------------------------------------------
// TEST 4 — Duplicate SSN collapse
// ---------------------------------------------------------------------------

test("Duplicate SSN collapse: 2 PERSON entities same SSN last 4 → collapsed to 1", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "Jane Doe", ssnLast4: "5678" }),
      makeEntity({ id: "p-2", entityKind: "PERSON", name: "Jane Doe", ssnLast4: "5678", synthetic: true }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "borrower" }),
      makeSlotBinding({ requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", requiredEntityId: "p-2", requiredEntityRole: "borrower" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1);
  assert.equal(graph.entities[0].entityId, "p-1");
  assert.equal(graph.entities[0].fingerprint, "ssn:5678");
  assert.equal(graph.entities[0].role, "BORROWER");
});

// ---------------------------------------------------------------------------
// TEST 5 — Duplicate name collapse
// ---------------------------------------------------------------------------

test("Duplicate name collapse: 2 entities same normalized name → collapsed to 1", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "s-1", entityKind: "OPCO", name: "Unassigned Business", synthetic: true }),
      makeEntity({ id: "s-2", entityKind: "OPCO", name: "Unassigned Business", synthetic: true }),
      makeEntity({ id: "s-3", entityKind: "OPCO", name: "Unassigned Business", synthetic: true }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "s-1" }),
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "s-2" }),
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "s-3" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1, "All 3 synthetics with same name must collapse to 1");
  assert.equal(graph.entities[0].role, "OPERATING_CO");
});

// ---------------------------------------------------------------------------
// TEST 6 — Role overlap detection
// ---------------------------------------------------------------------------

test("Role overlap: 1 entity bound to both borrower + guarantor slots → overlappingRoles=true", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "John Doe", ssnLast4: "1234" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "borrower" }),
      makeSlotBinding({ requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", requiredEntityId: "p-1", requiredEntityRole: "guarantor" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1);
  assert.equal(graph.ambiguityFlags.overlappingRoles, true, "Same entity in borrower + guarantor → overlap");
});

test("No role overlap: 2 separate entities in different roles → overlappingRoles=false", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "John Doe", ssnLast4: "1234" }),
      makeEntity({ id: "p-2", entityKind: "PERSON", name: "Jane Smith", ssnLast4: "5678" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "borrower" }),
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-2", requiredEntityRole: "guarantor" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 2);
  assert.equal(graph.ambiguityFlags.overlappingRoles, false);
});

// ---------------------------------------------------------------------------
// TEST 7 — Duplicate tax forms detection
// ---------------------------------------------------------------------------

test("Duplicate tax forms: 2 OPCOs with different EINs → duplicateTaxForms=true", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "biz-1", entityKind: "OPCO", name: "Business A", ein: "111111111" }),
      makeEntity({ id: "biz-2", entityKind: "OPCO", name: "Business B", ein: "222222222" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-1" }),
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-2" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 2);
  assert.equal(graph.ambiguityFlags.duplicateTaxForms, true, "Two OPCOs both claiming BTR forms");
});

test("No duplicate tax forms: OPCO + PERSON → different form signatures", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "biz-1", entityKind: "OPCO", ein: "111111111" }),
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "John Doe", ssnLast4: "1234" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "BUSINESS_TAX_RETURN", requiredEntityId: "biz-1" }),
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "borrower" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.ambiguityFlags.duplicateTaxForms, false);
});

// ---------------------------------------------------------------------------
// TEST 8 — GROUP entities filtered out
// ---------------------------------------------------------------------------

test("GROUP entities are excluded from the graph", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "biz-1", entityKind: "OPCO", ein: "111111111" }),
      makeEntity({ id: "grp-1", entityKind: "GROUP", name: "Deal Group" }),
    ],
    slotBindings: [],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1);
  assert.equal(graph.entities[0].entityId, "biz-1");
});

// ---------------------------------------------------------------------------
// TEST 9 — Empty entities throws
// ---------------------------------------------------------------------------

test("Empty entities after GROUP filter → throws", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "grp-1", entityKind: "GROUP", name: "Deal Group" }),
    ],
    slotBindings: [],
  };

  assert.throws(
    () => buildDealEntityGraph(input),
    /no entities after GROUP filter/,
  );
});

test("Zero entities → throws", () => {
  const input: BuildGraphInput = {
    entities: [],
    slotBindings: [],
  };

  assert.throws(
    () => buildDealEntityGraph(input),
    /no entities after GROUP filter/,
  );
});

// ---------------------------------------------------------------------------
// TEST 10 — Synthetic vs non-synthetic preference
// ---------------------------------------------------------------------------

test("Non-synthetic entity preferred as representative in dedup group", () => {
  const input: BuildGraphInput = {
    entities: [
      // Synthetic comes first in array
      makeEntity({ id: "syn-1", entityKind: "OPCO", name: "Acme Corp", legalName: "Acme Corp", synthetic: true }),
      // Real entity with same name
      makeEntity({ id: "real-1", entityKind: "OPCO", name: "Acme Corp", legalName: "Acme Corp", synthetic: false }),
    ],
    slotBindings: [],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities.length, 1);
  assert.equal(graph.entities[0].entityId, "real-1", "Non-synthetic must be representative");
});

// ---------------------------------------------------------------------------
// TEST 11 — Primary borrower resolution priority
// ---------------------------------------------------------------------------

test("Primary borrower priority: OPERATING_CO > BORROWER > HOLDCO", () => {
  // Only HOLDCO
  const holdcoOnly: BuildGraphInput = {
    entities: [makeEntity({ id: "h-1", entityKind: "HOLDCO", ein: "111" })],
    slotBindings: [],
  };
  assert.equal(buildDealEntityGraph(holdcoOnly).primaryBorrowerId, "h-1");

  // BORROWER + HOLDCO → BORROWER wins
  const borrowerAndHoldco: BuildGraphInput = {
    entities: [
      makeEntity({ id: "h-1", entityKind: "HOLDCO", ein: "111" }),
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "John", ssnLast4: "1234" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "borrower" }),
    ],
  };
  assert.equal(buildDealEntityGraph(borrowerAndHoldco).primaryBorrowerId, "p-1");

  // OPERATING_CO + BORROWER → OPERATING_CO wins
  const opcoAndBorrower: BuildGraphInput = {
    entities: [
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "John", ssnLast4: "1234" }),
      makeEntity({ id: "biz-1", entityKind: "OPCO", ein: "222" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "borrower" }),
    ],
  };
  assert.equal(buildDealEntityGraph(opcoAndBorrower).primaryBorrowerId, "biz-1");
});

// ---------------------------------------------------------------------------
// TEST 12 — Version constant
// ---------------------------------------------------------------------------

test("DEAL_ENTITY_GRAPH_VERSION is v1.0.0", () => {
  assert.equal(DEAL_ENTITY_GRAPH_VERSION, "v1.0.0");
});

// ---------------------------------------------------------------------------
// TEST 13 — Fingerprint computation
// ---------------------------------------------------------------------------

test("Fingerprint: EIN takes priority over name", () => {
  const entity = makeEntity({ ein: "12-3456789", name: "Test" });
  assert.equal(computeFingerprint(entity), "ein:123456789");
});

test("Fingerprint: SSN takes priority over name", () => {
  const entity = makeEntity({ entityKind: "PERSON", ssnLast4: "5678", name: "John" });
  assert.equal(computeFingerprint(entity), "ssn:5678");
});

test("Fingerprint: normalized name as fallback", () => {
  const entity = makeEntity({ name: "Test Business, LLC.", legalName: null });
  assert.equal(computeFingerprint(entity), "name:testbusinessllc");
});

test("Fingerprint: legalName preferred over name for name-based fingerprint", () => {
  const entity = makeEntity({ name: "Short Name", legalName: "Full Legal Name Inc" });
  assert.equal(computeFingerprint(entity), "name:fulllegalnameinc");
});

// ---------------------------------------------------------------------------
// TEST 14 — Default tax form signatures from entity kind
// ---------------------------------------------------------------------------

test("Default tax form signatures: OPCO gets business forms, PERSON gets 1040", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "biz-1", entityKind: "OPCO", ein: "111" }),
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "John", ssnLast4: "1234" }),
    ],
    slotBindings: [], // No slot bindings → use defaults
  };

  const graph = buildDealEntityGraph(input);

  const biz = graph.entities.find((e) => e.entityId === "biz-1");
  assert.ok(biz);
  assert.deepEqual(biz.taxFormSignatures, ["1065", "1120", "1120S"]);

  const person = graph.entities.find((e) => e.entityId === "p-1");
  assert.ok(person);
  assert.deepEqual(person.taxFormSignatures, ["1040"]);
});

// ---------------------------------------------------------------------------
// TEST 15 — PROPCO maps to OPERATING_CO
// ---------------------------------------------------------------------------

test("PROPCO entity maps to role=OPERATING_CO, entityType=BUSINESS", () => {
  const input: BuildGraphInput = {
    entities: [makeEntity({ id: "prop-1", entityKind: "PROPCO", ein: "999" })],
    slotBindings: [],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities[0].role, "OPERATING_CO");
  assert.equal(graph.entities[0].entityType, "BUSINESS");
});

// ---------------------------------------------------------------------------
// TEST 16 — PERSON with guarantor slot role
// ---------------------------------------------------------------------------

test("PERSON entity with guarantor slot role → role=GUARANTOR", () => {
  const input: BuildGraphInput = {
    entities: [
      makeEntity({ id: "p-1", entityKind: "PERSON", name: "Guarantor Jane", ssnLast4: "9999" }),
    ],
    slotBindings: [
      makeSlotBinding({ requiredDocType: "PERSONAL_TAX_RETURN", requiredEntityId: "p-1", requiredEntityRole: "guarantor" }),
    ],
  };

  const graph = buildDealEntityGraph(input);

  assert.equal(graph.entities[0].role, "GUARANTOR");
});
