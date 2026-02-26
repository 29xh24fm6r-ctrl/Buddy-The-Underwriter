/**
 * Identity Resolution v2.0.0 — Behavioral Tests
 *
 * Tests:
 *   1. Single-entity pre-bind (graph.entities.length === 1)
 *   2. Type-unique pre-bind (1 BUSINESS + 1 PERSON → BTR pre-binds to BUSINESS)
 *   3. Multi-entity standard resolution (2 OPCOs → falls through to 6-tier)
 *   4. No entity type → standard resolution (null entityType skips type-unique)
 *   5. Pre-bind always confidence 1.0, never ambiguous
 *   6. Role mapping correctness
 *   7. Version stamps
 *   8. Multi-entity with no text signals → no resolution (E3.3 soft-skip still catches)
 *   9. Type-unique for PERSON (1 PERSON + 1 OPCO → PTR pre-binds to PERSON)
 *  10. 2 PERSONs → no type-unique, falls to 6-tier
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIdentityV2,
  IDENTITY_RESOLUTION_VERSION,
  type ResolveIdentityV2Params,
} from "../resolveIdentityV2";
import type { DealEntityGraph, DealEntity } from "../buildDealEntityGraph";
import type { EntityCandidate, EntityTextSignals } from "../../intake/identity/entityResolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(
  entities: DealEntity[],
  overrides?: Partial<Omit<DealEntityGraph, "entities">>,
): DealEntityGraph {
  return {
    entities,
    primaryBorrowerId: entities[0]?.entityId ?? "fallback",
    ambiguityFlags: {
      duplicateTaxForms: false,
      overlappingRoles: false,
    },
    version: "v1.0.0",
    ...overrides,
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

function makeCandidate(overrides?: Partial<EntityCandidate>): EntityCandidate {
  return {
    entityId: "entity-1",
    entityRole: "operating",
    legalName: "Test Business LLC",
    einLast4: "6789",
    ssnLast4: null,
    normalizedNameTokens: ["test", "business"],
    ...overrides,
  };
}

function emptySignals(): EntityTextSignals {
  return { text: "", filename: "", hasEin: false, hasSsn: false };
}

// ---------------------------------------------------------------------------
// TEST 1 — Single-entity pre-bind
// ---------------------------------------------------------------------------

test("Single-entity deal: pre-binds unconditionally regardless of signals", () => {
  const entity = makeDealEntity({ entityId: "biz-1", role: "OPERATING_CO" });
  const graph = makeGraph([entity]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: emptySignals(), // No text signals at all
    candidates: [],
  });

  assert.equal(result.entityId, "biz-1");
  assert.equal(result.entityRole, "operating");
  assert.equal(result.confidence, 1.0);
  assert.equal(result.ambiguous, false);
  assert.equal(result.tier, "single_entity_prebind");
  assert.equal(result.preBound, true);
  assert.equal(result.resolutionVersion, "v2.0.0");
  assert.equal(result.graphVersion, "v1.0.0");
});

test("Single-entity deal: pre-binds even when documentEntityType is null", () => {
  const entity = makeDealEntity({ entityId: "biz-1" });
  const graph = makeGraph([entity]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: null,
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.entityId, "biz-1");
  assert.equal(result.tier, "single_entity_prebind");
  assert.equal(result.preBound, true);
});

test("Single-entity deal: pre-binds PERSON entity for PTR document", () => {
  const entity = makeDealEntity({
    entityId: "person-1",
    role: "BORROWER",
    entityType: "PERSON",
    taxFormSignatures: ["1040"],
    fingerprint: "ssn:5678",
  });
  const graph = makeGraph([entity]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "personal",
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.entityId, "person-1");
  assert.equal(result.entityRole, "borrower");
  assert.equal(result.tier, "single_entity_prebind");
});

// ---------------------------------------------------------------------------
// TEST 2 — Type-unique pre-bind
// ---------------------------------------------------------------------------

test("Type-unique: 1 BUSINESS + 1 PERSON, BTR doc → pre-binds to BUSINESS entity", () => {
  const biz = makeDealEntity({ entityId: "biz-1", role: "OPERATING_CO", entityType: "BUSINESS" });
  const person = makeDealEntity({ entityId: "person-1", role: "BORROWER", entityType: "PERSON", fingerprint: "ssn:5678" });
  const graph = makeGraph([biz, person]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.entityId, "biz-1");
  assert.equal(result.entityRole, "operating");
  assert.equal(result.tier, "type_unique_prebind");
  assert.equal(result.confidence, 1.0);
  assert.equal(result.preBound, true);
});

// ---------------------------------------------------------------------------
// TEST 3 — Multi-entity standard resolution fallthrough
// ---------------------------------------------------------------------------

test("Multi-entity same type: 2 OPCOs → falls through to 6-tier resolution", () => {
  const biz1 = makeDealEntity({ entityId: "biz-1", fingerprint: "ein:111" });
  const biz2 = makeDealEntity({ entityId: "biz-2", fingerprint: "ein:222" });
  const graph = makeGraph([biz1, biz2], {
    ambiguityFlags: { duplicateTaxForms: true, overlappingRoles: false },
  });

  // Provide EIN in text signals to enable 6-tier resolution
  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: { text: "EIN: 12-3456111", filename: "", hasEin: true, hasSsn: false },
    candidates: [
      makeCandidate({ entityId: "biz-1", einLast4: "6111" }),
      makeCandidate({ entityId: "biz-2", einLast4: "6222" }),
    ],
  });

  // Should resolve via EIN match (6-tier)
  assert.equal(result.entityId, "biz-1");
  assert.equal(result.tier, "ein_match");
  assert.equal(result.preBound, false);
  assert.equal(result.resolutionVersion, "v2.0.0");
});

// ---------------------------------------------------------------------------
// TEST 4 — No entity type → standard resolution
// ---------------------------------------------------------------------------

test("No documentEntityType: skips type-unique, falls to 6-tier", () => {
  const biz = makeDealEntity({ entityId: "biz-1", entityType: "BUSINESS" });
  const person = makeDealEntity({ entityId: "person-1", entityType: "PERSON", fingerprint: "ssn:5678" });
  const graph = makeGraph([biz, person]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: null, // No entity type from classification
    textSignals: emptySignals(),
    candidates: [makeCandidate({ entityId: "biz-1" }), makeCandidate({ entityId: "person-1" })],
  });

  // No pre-bind possible without entityType and with empty text signals
  assert.equal(result.preBound, false);
  assert.equal(result.resolutionVersion, "v2.0.0");
});

// ---------------------------------------------------------------------------
// TEST 5 — Pre-bind always confidence 1.0, never ambiguous
// ---------------------------------------------------------------------------

test("Pre-bind confidence is always 1.0 and never ambiguous", () => {
  // Single entity
  const graph1 = makeGraph([makeDealEntity({ entityId: "e-1" })]);
  const r1 = resolveIdentityV2({
    graph: graph1,
    documentEntityType: "business",
    textSignals: emptySignals(),
    candidates: [],
  });
  assert.equal(r1.confidence, 1.0);
  assert.equal(r1.ambiguous, false);

  // Type-unique
  const graph2 = makeGraph([
    makeDealEntity({ entityId: "biz-1", entityType: "BUSINESS" }),
    makeDealEntity({ entityId: "person-1", entityType: "PERSON", fingerprint: "ssn:9999" }),
  ]);
  const r2 = resolveIdentityV2({
    graph: graph2,
    documentEntityType: "personal",
    textSignals: emptySignals(),
    candidates: [],
  });
  assert.equal(r2.confidence, 1.0);
  assert.equal(r2.ambiguous, false);
});

// ---------------------------------------------------------------------------
// TEST 6 — Role mapping correctness
// ---------------------------------------------------------------------------

test("Role mapping: BORROWER → borrower, GUARANTOR → guarantor, OPERATING_CO → operating, HOLDCO → holding", () => {
  const roles: Array<{ graphRole: "BORROWER" | "GUARANTOR" | "OPERATING_CO" | "HOLDCO"; expected: string }> = [
    { graphRole: "BORROWER", expected: "borrower" },
    { graphRole: "GUARANTOR", expected: "guarantor" },
    { graphRole: "OPERATING_CO", expected: "operating" },
    { graphRole: "HOLDCO", expected: "holding" },
  ];

  for (const { graphRole, expected } of roles) {
    const entity = makeDealEntity({ entityId: `e-${graphRole}`, role: graphRole });
    const graph = makeGraph([entity]);

    const result = resolveIdentityV2({
      graph,
      documentEntityType: null,
      textSignals: emptySignals(),
      candidates: [],
    });

    assert.equal(result.entityRole, expected, `${graphRole} should map to ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// TEST 7 — Version stamps
// ---------------------------------------------------------------------------

test("Version stamps: resolutionVersion=v2.0.0, graphVersion from graph", () => {
  const graph = makeGraph([makeDealEntity()]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: null,
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.resolutionVersion, "v2.0.0");
  assert.equal(result.graphVersion, "v1.0.0");
});

test("IDENTITY_RESOLUTION_VERSION constant is v2.0.0", () => {
  assert.equal(IDENTITY_RESOLUTION_VERSION, "v2.0.0");
});

// ---------------------------------------------------------------------------
// TEST 8 — Multi-entity with no text signals → no resolution
// ---------------------------------------------------------------------------

test("Multi-entity + no text signals → entityId=null, ambiguous=true (strict contract)", () => {
  const biz1 = makeDealEntity({ entityId: "biz-1", fingerprint: "ein:111" });
  const biz2 = makeDealEntity({ entityId: "biz-2", fingerprint: "ein:222" });
  const graph = makeGraph([biz1, biz2], {
    ambiguityFlags: { duplicateTaxForms: true, overlappingRoles: false },
  });

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: emptySignals(), // No signals at all
    candidates: [
      makeCandidate({ entityId: "biz-1" }),
      makeCandidate({ entityId: "biz-2" }),
    ],
  });

  // 2 OPCOs, no text signals → can't pre-bind, can't resolve → ambiguous
  assert.equal(result.entityId, null);
  assert.equal(result.ambiguous, true, "Strict contract: entityId=null → ambiguous=true");
  assert.equal(result.preBound, false);
});

// ---------------------------------------------------------------------------
// TEST 9 — Type-unique for PERSON
// ---------------------------------------------------------------------------

test("Type-unique: 1 PERSON + 1 OPCO, PTR doc → pre-binds to PERSON entity", () => {
  const biz = makeDealEntity({ entityId: "biz-1", role: "OPERATING_CO", entityType: "BUSINESS" });
  const person = makeDealEntity({
    entityId: "person-1",
    role: "BORROWER",
    entityType: "PERSON",
    taxFormSignatures: ["1040"],
    fingerprint: "ssn:5678",
  });
  const graph = makeGraph([biz, person]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "personal",
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.entityId, "person-1");
  assert.equal(result.entityRole, "borrower");
  assert.equal(result.tier, "type_unique_prebind");
  assert.equal(result.preBound, true);
});

// ---------------------------------------------------------------------------
// TEST 10 — 2 PERSONs → no type-unique
// ---------------------------------------------------------------------------

test("2 PERSONs: no type-unique pre-bind, falls to 6-tier", () => {
  const person1 = makeDealEntity({
    entityId: "p-1",
    role: "BORROWER",
    entityType: "PERSON",
    fingerprint: "ssn:1111",
  });
  const person2 = makeDealEntity({
    entityId: "p-2",
    role: "GUARANTOR",
    entityType: "PERSON",
    fingerprint: "ssn:2222",
  });
  const graph = makeGraph([person1, person2]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "personal",
    textSignals: emptySignals(),
    candidates: [
      makeCandidate({ entityId: "p-1", entityRole: "borrower", ssnLast4: "1111" }),
      makeCandidate({ entityId: "p-2", entityRole: "guarantor", ssnLast4: "2222" }),
    ],
  });

  // 2 PERSONs → can't pre-bind by type, no text signals → ambiguous
  assert.equal(result.preBound, false);
  assert.equal(result.entityId, null);
  assert.equal(result.ambiguous, true, "Strict contract: entityId=null → ambiguous=true");
});

// ---------------------------------------------------------------------------
// TEST 11 — Evidence on pre-bind includes entity context
// ---------------------------------------------------------------------------

test("Pre-bind evidence includes entityId and role", () => {
  const entity = makeDealEntity({ entityId: "biz-abc", role: "OPERATING_CO" });
  const graph = makeGraph([entity]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].signal, "single_entity_prebind");
  assert.ok(result.evidence[0].matchedText.includes("biz-abc"));
  assert.ok(result.evidence[0].matchedText.includes("OPERATING_CO"));
  assert.equal(result.evidence[0].candidateId, "biz-abc");
  assert.equal(result.evidence[0].confidence, 1.0);
});

// ---------------------------------------------------------------------------
// TEST 12 — HOLDCO entity pre-bind
// ---------------------------------------------------------------------------

test("Single HOLDCO entity → pre-binds with role=holding", () => {
  const entity = makeDealEntity({
    entityId: "holdco-1",
    role: "HOLDCO",
    entityType: "BUSINESS",
  });
  const graph = makeGraph([entity]);

  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: emptySignals(),
    candidates: [],
  });

  assert.equal(result.entityId, "holdco-1");
  assert.equal(result.entityRole, "holding");
  assert.equal(result.tier, "single_entity_prebind");
});
