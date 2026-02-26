/**
 * Identity Contract Strictness — v2.0.0 Invariant Guard
 *
 * Enforces the strict bidirectional contract:
 *   entityId === null  ⇔  ambiguous === true
 *
 * No other state is allowed. This guard verifies all resolution paths
 * honor the contract, preventing silent misrouting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveIdentityV2,
  IDENTITY_RESOLUTION_VERSION,
  type IdentityResolutionV2Result,
} from "../resolveIdentityV2";
import type { DealEntityGraph, DealEntity } from "../buildDealEntityGraph";
import type { EntityCandidate, EntityTextSignals } from "../../intake/identity/entityResolver";

// ---------------------------------------------------------------------------
// Contract validator
// ---------------------------------------------------------------------------

function assertStrictContract(result: IdentityResolutionV2Result, label: string): void {
  // ambiguous must never be undefined
  assert.equal(
    typeof result.ambiguous,
    "boolean",
    `[${label}] ambiguous must be boolean, got ${typeof result.ambiguous}`,
  );

  // entityId === null → ambiguous must be true
  if (result.entityId === null) {
    assert.equal(
      result.ambiguous,
      true,
      `[${label}] entityId=null requires ambiguous=true`,
    );
  }

  // entityId present → ambiguous must be false
  if (result.entityId !== null) {
    assert.equal(
      result.ambiguous,
      false,
      `[${label}] entityId="${result.entityId}" requires ambiguous=false`,
    );
  }

  // Version stamp
  assert.equal(result.resolutionVersion, "v2.0.0", `[${label}] version must be v2.0.0`);
}

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

function makeCandidate(overrides?: Partial<EntityCandidate>): EntityCandidate {
  return {
    entityId: "entity-1",
    entityRole: "operating",
    legalName: "Test LLC",
    einLast4: "6789",
    ssnLast4: null,
    normalizedNameTokens: ["test"],
    ...overrides,
  };
}

const EMPTY_SIGNALS: EntityTextSignals = { text: "", filename: "", hasEin: false, hasSsn: false };

// ---------------------------------------------------------------------------
// Path 1: Single-entity pre-bind → entityId non-null, ambiguous false
// ---------------------------------------------------------------------------

test("Contract: single_entity_prebind → entityId set, ambiguous=false", () => {
  const graph = makeGraph([makeDealEntity({ entityId: "biz-1" })]);
  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: EMPTY_SIGNALS,
    candidates: [],
  });
  assertStrictContract(result, "single_entity_prebind");
  assert.equal(result.entityId, "biz-1");
});

// ---------------------------------------------------------------------------
// Path 2: Type-unique pre-bind → entityId non-null, ambiguous false
// ---------------------------------------------------------------------------

test("Contract: type_unique_prebind → entityId set, ambiguous=false", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", entityType: "BUSINESS" }),
    makeDealEntity({ entityId: "person-1", entityType: "PERSON", fingerprint: "ssn:1234" }),
  ]);
  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: EMPTY_SIGNALS,
    candidates: [],
  });
  assertStrictContract(result, "type_unique_prebind");
  assert.equal(result.entityId, "biz-1");
});

// ---------------------------------------------------------------------------
// Path 3: 6-tier resolved → entityId non-null, ambiguous false
// ---------------------------------------------------------------------------

test("Contract: 6-tier EIN match → entityId set, ambiguous=false", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", fingerprint: "ein:111" }),
    makeDealEntity({ entityId: "biz-2", fingerprint: "ein:222" }),
  ]);
  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: { text: "EIN: 12-3456111", filename: "", hasEin: true, hasSsn: false },
    candidates: [
      makeCandidate({ entityId: "biz-1", einLast4: "6111" }),
      makeCandidate({ entityId: "biz-2", einLast4: "6222" }),
    ],
  });
  assertStrictContract(result, "6-tier-ein-match");
  assert.equal(result.entityId, "biz-1");
});

// ---------------------------------------------------------------------------
// Path 4: 6-tier ambiguous (multi-candidate same tier) → null, ambiguous true
// ---------------------------------------------------------------------------

test("Contract: 6-tier ambiguous → entityId=null, ambiguous=true", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", fingerprint: "ein:111" }),
    makeDealEntity({ entityId: "biz-2", fingerprint: "ein:222" }),
  ]);
  // Both candidates share the same EIN last 4 → ambiguous
  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: { text: "EIN: 12-3456789", filename: "", hasEin: true, hasSsn: false },
    candidates: [
      makeCandidate({ entityId: "biz-1", einLast4: "6789" }),
      makeCandidate({ entityId: "biz-2", einLast4: "6789" }),
    ],
  });
  assertStrictContract(result, "6-tier-ambiguous");
  assert.equal(result.entityId, null);
  assert.equal(result.ambiguous, true);
});

// ---------------------------------------------------------------------------
// Path 5: 6-tier no match → null, ambiguous true (strict upgrade)
// ---------------------------------------------------------------------------

test("Contract: 6-tier no match → entityId=null upgraded to ambiguous=true", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", fingerprint: "ein:111" }),
    makeDealEntity({ entityId: "biz-2", fingerprint: "ein:222" }),
  ]);
  // Empty signals → no tier matches → legacy would return ambiguous=false
  // Strict contract upgrades to ambiguous=true
  const result = resolveIdentityV2({
    graph,
    documentEntityType: "business",
    textSignals: EMPTY_SIGNALS,
    candidates: [
      makeCandidate({ entityId: "biz-1" }),
      makeCandidate({ entityId: "biz-2" }),
    ],
  });
  assertStrictContract(result, "6-tier-no-match-upgrade");
  assert.equal(result.entityId, null);
  assert.equal(result.ambiguous, true, "Strict upgrade: no-match → ambiguous");
});

// ---------------------------------------------------------------------------
// Path 6: No entity type + multi-entity → falls to 6-tier → strict contract
// ---------------------------------------------------------------------------

test("Contract: null entityType + multi-entity + empty signals → ambiguous=true", () => {
  const graph = makeGraph([
    makeDealEntity({ entityId: "biz-1", entityType: "BUSINESS" }),
    makeDealEntity({ entityId: "person-1", entityType: "PERSON", fingerprint: "ssn:5678" }),
  ]);
  const result = resolveIdentityV2({
    graph,
    documentEntityType: null,
    textSignals: EMPTY_SIGNALS,
    candidates: [makeCandidate({ entityId: "biz-1" }), makeCandidate({ entityId: "person-1" })],
  });
  assertStrictContract(result, "null-entityType-multi-entity");
});

// ---------------------------------------------------------------------------
// Version constant
// ---------------------------------------------------------------------------

test("IDENTITY_RESOLUTION_VERSION is v2.0.0", () => {
  assert.equal(IDENTITY_RESOLUTION_VERSION, "v2.0.0");
});
