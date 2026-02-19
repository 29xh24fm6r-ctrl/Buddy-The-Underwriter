/**
 * entityResolver — Unit Tests
 *
 * ~15 test cases covering all 6 deterministic tiers, ambiguity detection,
 * privacy invariants, and edge cases.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEntity,
  buildEntityCandidate,
  type EntityCandidate,
  type EntityTextSignals,
} from "../entityResolver";

// ---------------------------------------------------------------------------
// Helpers — build candidates for tests
// ---------------------------------------------------------------------------

function makeCandidate(
  overrides: Partial<EntityCandidate> & { entityId: string },
): EntityCandidate {
  return {
    entityRole: "operating",
    legalName: "",
    einLast4: null,
    ssnLast4: null,
    normalizedNameTokens: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tier 1: EIN match
// ---------------------------------------------------------------------------

test("Tier 1: EIN last4 exact match resolves entity", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-opco",
      legalName: "ABC Holdings LLC",
      einLast4: "6789",
      normalizedNameTokens: ["abc", "holdings"],
    }),
    makeCandidate({
      entityId: "ent-holdco",
      legalName: "XYZ Corp",
      einLast4: "1234",
      normalizedNameTokens: ["xyz"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "Employer ID: 12-3456789",
    filename: "tax_return.pdf",
    hasEin: true,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, "ent-opco");
  assert.equal(r.tier, "ein_match");
  assert.equal(r.confidence, 0.95);
  assert.equal(r.ambiguous, false);
});

// ---------------------------------------------------------------------------
// Tier 2: SSN match
// ---------------------------------------------------------------------------

test("Tier 2: SSN last4 match for personal docs", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-guarantor",
      entityRole: "guarantor",
      legalName: "John Smith",
      ssnLast4: "4321",
      normalizedNameTokens: ["john", "smith"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "Personal Financial Statement\nSSN: ***-**-4321",
    filename: "PFS_Smith.pdf",
    hasEin: false,
    hasSsn: true,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, "ent-guarantor");
  assert.equal(r.tier, "ssn_match");
  assert.equal(r.confidence, 0.85);
  assert.equal(r.ambiguous, false);
});

// ---------------------------------------------------------------------------
// Tier 3: Name exact match
// ---------------------------------------------------------------------------

test("Tier 3: normalized name exact match", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-abc",
      legalName: "ABC Holdings LLC",
      normalizedNameTokens: ["abc", "holdings"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "Prepared for ABC Holdings LLC\nBalance Sheet as of 12/31/2024",
    filename: "balance_sheet.pdf",
    hasEin: false,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, "ent-abc");
  assert.equal(r.tier, "name_exact");
  assert.equal(r.confidence, 0.85);
});

// ---------------------------------------------------------------------------
// Tier 4: Name fuzzy match (token overlap)
// ---------------------------------------------------------------------------

test("Tier 4: fuzzy name match via token overlap ≥ 80%", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-abc",
      legalName: "ABC Holdings, LLC",
      normalizedNameTokens: ["abc", "holdings"],
    }),
  ];

  // Text contains "ABC Holdings" without the LLC suffix
  const signals: EntityTextSignals = {
    text: "Tax Return for ABC Holdings for fiscal year 2024",
    filename: "tax.pdf",
    hasEin: false,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, "ent-abc");
  // Could match name_exact since "abc holdings" is in the text as substring
  // Either tier 3 or 4 is acceptable
  assert.ok(
    r.tier === "name_exact" || r.tier === "name_fuzzy",
    `Expected name_exact or name_fuzzy, got ${r.tier}`,
  );
});

// ---------------------------------------------------------------------------
// Tier 5: Filename hint
// ---------------------------------------------------------------------------

test("Tier 5: filename hint — entity name tokens in filename", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-smith",
      entityRole: "guarantor",
      legalName: "Robert Smith",
      normalizedNameTokens: ["robert", "smith"],
    }),
    makeCandidate({
      entityId: "ent-jones",
      entityRole: "guarantor",
      legalName: "Jane Jones",
      normalizedNameTokens: ["jane", "jones"],
    }),
  ];

  // Text has no identifying info, but filename has name tokens
  const signals: EntityTextSignals = {
    text: "Personal Financial Statement\nAssets: $500,000",
    filename: "Robert_Smith_PFS.pdf",
    hasEin: false,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, "ent-smith");
  assert.equal(r.tier, "filename_hint");
  assert.equal(r.confidence, 0.50);
});

// ---------------------------------------------------------------------------
// Tier 6: Role inference (single candidate of matching role)
// ---------------------------------------------------------------------------

test("Tier 6: role inference — single guarantor for personal doc", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-opco",
      entityRole: "operating",
      legalName: "Big Corp Inc",
      normalizedNameTokens: ["big"],
    }),
    makeCandidate({
      entityId: "ent-person",
      entityRole: "guarantor",
      legalName: "Someone",
      normalizedNameTokens: ["someone"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "Personal Financial Statement",
    filename: "pfs.pdf",
    hasEin: false,
    hasSsn: false,
  };

  // entityType = "personal" should infer guarantor
  const r = resolveEntity(signals, candidates, "personal");
  assert.equal(r.entityId, "ent-person");
  assert.equal(r.tier, "role_inference");
  assert.equal(r.confidence, 0.40);
});

// ---------------------------------------------------------------------------
// Ambiguity: two entities with same EIN last4
// ---------------------------------------------------------------------------

test("Ambiguity: two entities with same EIN last4 → ambiguous", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-a",
      legalName: "Company A",
      einLast4: "6789",
      normalizedNameTokens: ["company", "a"],
    }),
    makeCandidate({
      entityId: "ent-b",
      legalName: "Company B",
      einLast4: "6789",
      normalizedNameTokens: ["company", "b"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "EIN: 12-3456789",
    filename: "doc.pdf",
    hasEin: true,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, null);
  assert.equal(r.ambiguous, true);
  assert.equal(r.tier, "ein_match");
});

// ---------------------------------------------------------------------------
// No match: no signals at all
// ---------------------------------------------------------------------------

test("No match: no signals → entityId null, confidence 0", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-opco",
      legalName: "Very Specific Company Name XYZ",
      normalizedNameTokens: ["very", "specific", "company", "name", "xyz"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "Totally unrelated document content about gardening tips",
    filename: "random.pdf",
    hasEin: false,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, null);
  assert.equal(r.confidence, 0);
  assert.equal(r.tier, "none");
  assert.equal(r.ambiguous, false);
});

// ---------------------------------------------------------------------------
// Empty entity list
// ---------------------------------------------------------------------------

test("Empty entity list → no match", () => {
  const signals: EntityTextSignals = {
    text: "Some content",
    filename: "doc.pdf",
    hasEin: true,
    hasSsn: false,
  };

  const r = resolveEntity(signals, []);
  assert.equal(r.entityId, null);
  assert.equal(r.tier, "none");
});

// ---------------------------------------------------------------------------
// EIN match takes priority over name match
// ---------------------------------------------------------------------------

test("Priority: EIN match wins over name match", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-a",
      legalName: "Alpha Corp",
      einLast4: "1111",
      normalizedNameTokens: ["alpha"],
    }),
    makeCandidate({
      entityId: "ent-b",
      legalName: "Beta LLC",
      einLast4: "9999",
      normalizedNameTokens: ["beta"],
    }),
  ];

  // Text mentions "Alpha Corp" (name match → ent-a) but EIN matches ent-b
  const signals: EntityTextSignals = {
    text: "Prepared for Alpha Corp\nEIN: 55-5559999",
    filename: "doc.pdf",
    hasEin: true,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  assert.equal(r.entityId, "ent-b");
  assert.equal(r.tier, "ein_match");
});

// ---------------------------------------------------------------------------
// SSN match skipped when hasSsn = false
// ---------------------------------------------------------------------------

test("SSN matching skipped when hasSsn flag is false", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-person",
      entityRole: "guarantor",
      legalName: "Jane Doe",
      ssnLast4: "5678",
      normalizedNameTokens: ["jane", "doe"],
    }),
  ];

  // Text has SSN pattern but hasSsn flag is false (gatekeeper didn't detect)
  const signals: EntityTextSignals = {
    text: "SSN: 123-45-5678\nJane Doe Personal Return",
    filename: "return.pdf",
    hasEin: false,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  // Should fall through to name match, not SSN
  assert.ok(r.tier !== "ssn_match", `Expected NOT ssn_match, got ${r.tier}`);
  assert.equal(r.entityId, "ent-person"); // name match still works
});

// ---------------------------------------------------------------------------
// Role inference not triggered with multiple candidates of same role
// ---------------------------------------------------------------------------

test("Role inference: multiple guarantors → no role inference match", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-g1",
      entityRole: "guarantor",
      legalName: "Person One",
      normalizedNameTokens: ["person", "one"],
    }),
    makeCandidate({
      entityId: "ent-g2",
      entityRole: "guarantor",
      legalName: "Person Two",
      normalizedNameTokens: ["person", "two"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "Personal Financial Statement",
    filename: "pfs.pdf",
    hasEin: false,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates, "personal");
  // With two guarantors, role inference returns null (not ambiguous — just no match at that tier)
  // The "person" token fuzzy overlap might trigger name_fuzzy ambiguity though
  // Key: should NOT auto-match to one of them via role inference alone
  assert.ok(r.tier !== "role_inference", `Should not use role_inference with 2 guarantors`);
});

// ---------------------------------------------------------------------------
// buildEntityCandidate utility
// ---------------------------------------------------------------------------

test("buildEntityCandidate maps OPCO → operating", () => {
  const c = buildEntityCandidate({
    id: "e1",
    entityKind: "OPCO",
    legalName: "Acme Holdings, LLC",
    ein: "12-3456789",
  });
  assert.equal(c.entityRole, "operating");
  assert.equal(c.einLast4, "6789");
  assert.deepEqual(c.normalizedNameTokens, ["acme", "holdings"]);
});

test("buildEntityCandidate maps PERSON → guarantor", () => {
  const c = buildEntityCandidate({
    id: "e2",
    entityKind: "PERSON",
    legalName: "John Doe",
    ssnLast4: "4321",
  });
  assert.equal(c.entityRole, "guarantor");
  assert.equal(c.ssnLast4, "4321");
  assert.equal(c.einLast4, null);
});

test("buildEntityCandidate maps HOLDCO → holding", () => {
  const c = buildEntityCandidate({
    id: "e3",
    entityKind: "HOLDCO",
    legalName: "Parent Group Inc",
  });
  assert.equal(c.entityRole, "holding");
});

// ---------------------------------------------------------------------------
// Privacy: evidence never contains full EIN/SSN
// ---------------------------------------------------------------------------

test("Privacy: evidence never contains full EIN", () => {
  const candidates: EntityCandidate[] = [
    makeCandidate({
      entityId: "ent-a",
      legalName: "Corp",
      einLast4: "6789",
      normalizedNameTokens: ["corp"],
    }),
  ];

  const signals: EntityTextSignals = {
    text: "EIN: 12-3456789",
    filename: "doc.pdf",
    hasEin: true,
    hasSsn: false,
  };

  const r = resolveEntity(signals, candidates);
  for (const e of r.evidence) {
    assert.ok(
      !e.matchedText.includes("12-3456789"),
      "Evidence should not contain full EIN",
    );
    assert.ok(
      !e.matchedText.includes("123456789"),
      "Evidence should not contain full EIN without dash",
    );
  }
});
