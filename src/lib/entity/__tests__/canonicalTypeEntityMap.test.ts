/**
 * Canonical Type → Entity Type Mapping — Invariant Guard
 *
 * Verifies the mapping is complete and correct. Every entity-scoped
 * document type must have a mapping. No personal doc maps to BUSINESS.
 * No business doc maps to PERSON.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mapCanonicalTypeToEntityType,
  mapCanonicalTypeToClassificationEntityType,
} from "../mapCanonicalTypeToEntityType";

// ---------------------------------------------------------------------------
// ENTITY_SCOPED_DOC_TYPES must all have mappings
// ---------------------------------------------------------------------------

const ENTITY_SCOPED_DOC_TYPES = [
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BUSINESS_TAX_RETURN",
];

test("Every ENTITY_SCOPED_DOC_TYPE has a canonical → entity type mapping", () => {
  for (const docType of ENTITY_SCOPED_DOC_TYPES) {
    const result = mapCanonicalTypeToEntityType(docType);
    assert.ok(result, `${docType} must have a mapping, got null`);
  }
});

// ---------------------------------------------------------------------------
// Personal docs → PERSON
// ---------------------------------------------------------------------------

test("PERSONAL_TAX_RETURN → PERSON", () => {
  assert.equal(mapCanonicalTypeToEntityType("PERSONAL_TAX_RETURN"), "PERSON");
});

test("PERSONAL_FINANCIAL_STATEMENT → PERSON", () => {
  assert.equal(mapCanonicalTypeToEntityType("PERSONAL_FINANCIAL_STATEMENT"), "PERSON");
});

// ---------------------------------------------------------------------------
// Business docs → BUSINESS
// ---------------------------------------------------------------------------

test("BUSINESS_TAX_RETURN → BUSINESS", () => {
  assert.equal(mapCanonicalTypeToEntityType("BUSINESS_TAX_RETURN"), "BUSINESS");
});

test("INCOME_STATEMENT → BUSINESS", () => {
  assert.equal(mapCanonicalTypeToEntityType("INCOME_STATEMENT"), "BUSINESS");
});

test("BALANCE_SHEET → BUSINESS", () => {
  assert.equal(mapCanonicalTypeToEntityType("BALANCE_SHEET"), "BUSINESS");
});

test("K1 → BUSINESS", () => {
  assert.equal(mapCanonicalTypeToEntityType("K1"), "BUSINESS");
});

// ---------------------------------------------------------------------------
// Non-entity-scoped types → null
// ---------------------------------------------------------------------------

test("SBA_APPLICATION → null (not entity-scoped)", () => {
  assert.equal(mapCanonicalTypeToEntityType("SBA_APPLICATION"), null);
});

test("VOIDED_CHECK → null", () => {
  assert.equal(mapCanonicalTypeToEntityType("VOIDED_CHECK"), null);
});

test("RENT_ROLL → null", () => {
  assert.equal(mapCanonicalTypeToEntityType("RENT_ROLL"), null);
});

test("UNKNOWN_TYPE → null", () => {
  assert.equal(mapCanonicalTypeToEntityType("UNKNOWN_TYPE"), null);
});

// ---------------------------------------------------------------------------
// Classification entity type mapping
// ---------------------------------------------------------------------------

test("mapCanonicalTypeToClassificationEntityType: personal docs → 'personal'", () => {
  assert.equal(mapCanonicalTypeToClassificationEntityType("PERSONAL_TAX_RETURN"), "personal");
  assert.equal(mapCanonicalTypeToClassificationEntityType("PERSONAL_FINANCIAL_STATEMENT"), "personal");
});

test("mapCanonicalTypeToClassificationEntityType: business docs → 'business'", () => {
  assert.equal(mapCanonicalTypeToClassificationEntityType("BUSINESS_TAX_RETURN"), "business");
  assert.equal(mapCanonicalTypeToClassificationEntityType("INCOME_STATEMENT"), "business");
  assert.equal(mapCanonicalTypeToClassificationEntityType("BALANCE_SHEET"), "business");
});

test("mapCanonicalTypeToClassificationEntityType: non-scoped → null", () => {
  assert.equal(mapCanonicalTypeToClassificationEntityType("SBA_APPLICATION"), null);
});

// ---------------------------------------------------------------------------
// Boundary: no personal doc maps to BUSINESS
// ---------------------------------------------------------------------------

test("No personal doc type ever maps to BUSINESS", () => {
  const personalTypes = ["PERSONAL_TAX_RETURN", "PERSONAL_FINANCIAL_STATEMENT"];
  for (const dt of personalTypes) {
    assert.notEqual(
      mapCanonicalTypeToEntityType(dt),
      "BUSINESS",
      `${dt} must not map to BUSINESS`,
    );
  }
});

test("No business doc type ever maps to PERSON", () => {
  const businessTypes = ["BUSINESS_TAX_RETURN", "INCOME_STATEMENT", "BALANCE_SHEET", "K1"];
  for (const dt of businessTypes) {
    assert.notEqual(
      mapCanonicalTypeToEntityType(dt),
      "PERSON",
      `${dt} must not map to PERSON`,
    );
  }
});
