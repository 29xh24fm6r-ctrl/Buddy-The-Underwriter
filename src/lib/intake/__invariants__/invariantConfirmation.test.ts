/**
 * Phase E4 — Entity Ambiguity Gate Proof
 *
 * Deterministic invariant validation: entity ambiguity detection blocks
 * confirmation when multiple unresolved entity-scoped docs share the
 * same canonical_type + doc_year. Mirrors confirm route logic exactly.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ENTITY_SCOPED_DOC_TYPES } from "../identity/entityScopedDocTypes";

// ── Types ──────────────────────────────────────────────────────────────

type AmbiguityDoc = {
  canonical_type: string | null;
  doc_year: number | null;
  logical_key: string | null;
  is_active: boolean;
};

// ── Pure Ambiguity Detection (mirrors confirm route lines 132-182) ────

function detectEntityAmbiguity(docs: AmbiguityDoc[]): {
  blocked: boolean;
  duplicateGroups: Array<{ key: string; count: number }>;
} {
  // Filter: active, null logical_key, entity-scoped type
  const candidates = docs.filter(
    (d) =>
      d.is_active &&
      d.logical_key == null &&
      d.canonical_type != null &&
      ENTITY_SCOPED_DOC_TYPES.has(d.canonical_type),
  );

  // Group by canonical_type|doc_year
  const groups = new Map<string, number>();
  for (const d of candidates) {
    const key = `${d.canonical_type}|${d.doc_year ?? "NA"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  return {
    blocked: duplicateGroups.length > 0,
    duplicateGroups,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function doc(
  type: string | null,
  year: number | null,
  key: string | null,
  active = true,
): AmbiguityDoc {
  return { canonical_type: type, doc_year: year, logical_key: key, is_active: active };
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Entity Ambiguity Gate Proof", () => {
  test("Scenario A: Two PTR|2024 with null key → blocked", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2024, null),
      doc("PERSONAL_TAX_RETURN", 2024, null),
    ]);
    assert.equal(result.blocked, true);
    assert.equal(result.duplicateGroups.length, 1);
    assert.equal(result.duplicateGroups[0].key, "PERSONAL_TAX_RETURN|2024");
    assert.equal(result.duplicateGroups[0].count, 2);
  });

  test("Scenario B: Two PTR|2024, one resolved → not blocked", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2024, "PTR|2024|p1"),
      doc("PERSONAL_TAX_RETURN", 2024, null),
    ]);
    assert.equal(result.blocked, false);
  });

  test("Scenario C: Two PTR|2024 both resolved to different entities → not blocked", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2024, "PTR|2024|p1"),
      doc("PERSONAL_TAX_RETURN", 2024, "PTR|2024|p2"),
    ]);
    assert.equal(result.blocked, false);
  });

  test("Scenario D: Cross-type — PTR|2024 + PFS|2024 both null key → not blocked", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2024, null),
      doc("PERSONAL_FINANCIAL_STATEMENT", 2024, null),
    ]);
    assert.equal(result.blocked, false);
  });

  test("Scenario E: Same type, different years — PTR|2023 + PTR|2024 both null key → not blocked", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2023, null),
      doc("PERSONAL_TAX_RETURN", 2024, null),
    ]);
    assert.equal(result.blocked, false);
  });

  test("Scenario F: Three BTR|2024 null key → blocked, count=3", () => {
    const result = detectEntityAmbiguity([
      doc("BUSINESS_TAX_RETURN", 2024, null),
      doc("BUSINESS_TAX_RETURN", 2024, null),
      doc("BUSINESS_TAX_RETURN", 2024, null),
    ]);
    assert.equal(result.blocked, true);
    assert.equal(result.duplicateGroups[0].count, 3);
  });

  test("Scenario G: Non-entity-scoped type duplicates are ignored", () => {
    const result = detectEntityAmbiguity([
      doc("RENT_ROLL", 2023, null),
      doc("RENT_ROLL", 2023, null),
    ]);
    assert.equal(result.blocked, false);
  });

  test("Scenario H: Inactive docs excluded", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2024, null, false),
      doc("PERSONAL_TAX_RETURN", 2024, null, true),
    ]);
    assert.equal(result.blocked, false);
  });

  test("Scenario I: Exhaustive matrix — 3 types × 2 years × 3 counts × 2 resolved", () => {
    const entityTypes = [
      "PERSONAL_TAX_RETURN",
      "PERSONAL_FINANCIAL_STATEMENT",
      "BUSINESS_TAX_RETURN",
    ];
    const years: Array<number | null> = [2024, null];
    const counts = [1, 2, 3];
    const resolvedStates = [true, false];

    for (const type of entityTypes) {
      for (const year of years) {
        for (const count of counts) {
          for (const isResolved of resolvedStates) {
            const docs: AmbiguityDoc[] = Array.from({ length: count }, () =>
              doc(
                type,
                year,
                isResolved ? `${type}|${year ?? "NA"}|entity-a` : null,
              ),
            );

            const result = detectEntityAmbiguity(docs);
            const expectedBlocked = !isResolved && count > 1;

            assert.equal(
              result.blocked,
              expectedBlocked,
              `type=${type} year=${year} count=${count} resolved=${isResolved}: ` +
                `expected blocked=${expectedBlocked}, got ${result.blocked}`,
            );
          }
        }
      }
    }
  });

  test("Scenario J: Mixed entity-scoped and non-entity-scoped", () => {
    const result = detectEntityAmbiguity([
      doc("PERSONAL_TAX_RETURN", 2024, null),
      doc("PERSONAL_TAX_RETURN", 2024, null),
      doc("RENT_ROLL", 2024, null),
      doc("RENT_ROLL", 2024, null),
    ]);
    assert.equal(result.blocked, true);
    // Only PTR group is ambiguous, RR is ignored
    assert.equal(result.duplicateGroups.length, 1);
    assert.equal(result.duplicateGroups[0].key, "PERSONAL_TAX_RETURN|2024");
  });
});
