/**
 * Phase E4 — Defense-in-Depth Processing Proof
 *
 * Deterministic invariant validation: processing violation detectors
 * correctly identify tampered state. Mirrors processConfirmedIntake.ts
 * defense-in-depth guards exactly.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { ENTITY_SCOPED_DOC_TYPES } from "../identity/entityScopedDocTypes";

// ── Types ──────────────────────────────────────────────────────────────

type ProcessingDoc = {
  id: string;
  canonical_type: string | null;
  doc_year: number | null;
  is_active: boolean;
  intake_status: string;
  logical_key: string | null;
};

type Violation =
  | { kind: "inactive_locked"; docIds: string[] }
  | { kind: "identity_ambiguity"; groups: Array<{ key: string; count: number }> };

// ── Pure Violation Detector (mirrors processConfirmedIntake guards) ───

function detectProcessingViolations(docs: ProcessingDoc[]): Violation[] {
  const violations: Violation[] = [];

  // Guard 1: No inactive docs with LOCKED_FOR_PROCESSING status
  const inactiveLocked = docs.filter(
    (d) => !d.is_active && d.intake_status === "LOCKED_FOR_PROCESSING",
  );
  if (inactiveLocked.length > 0) {
    violations.push({
      kind: "inactive_locked",
      docIds: inactiveLocked.map((d) => d.id),
    });
  }

  // Guard 2: No null-key entity-scoped duplicates in active locked set
  const nullKeyLocked = docs.filter(
    (d) =>
      d.is_active &&
      d.logical_key == null &&
      d.intake_status === "LOCKED_FOR_PROCESSING" &&
      d.canonical_type != null &&
      ENTITY_SCOPED_DOC_TYPES.has(d.canonical_type),
  );

  const groups = new Map<string, number>();
  for (const d of nullKeyLocked) {
    const key = `${d.canonical_type}|${d.doc_year ?? "NA"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const duplicateGroups = [...groups.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  if (duplicateGroups.length > 0) {
    violations.push({
      kind: "identity_ambiguity",
      groups: duplicateGroups,
    });
  }

  return violations;
}

// ── Helpers ────────────────────────────────────────────────────────────

function pdoc(overrides: Partial<ProcessingDoc> & { id: string }): ProcessingDoc {
  return {
    id: overrides.id,
    canonical_type: overrides.canonical_type ?? "RENT_ROLL",
    doc_year: overrides.doc_year ?? 2024,
    is_active: overrides.is_active ?? true,
    intake_status: overrides.intake_status ?? "LOCKED_FOR_PROCESSING",
    logical_key: "logical_key" in overrides ? (overrides.logical_key ?? null) : `key-${overrides.id}`,
  };
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Processing Defense-in-Depth Proof", () => {
  test("Scenario A: Inactive + LOCKED detected", () => {
    const violations = detectProcessingViolations([
      pdoc({ id: "a", is_active: false }),
    ]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "inactive_locked");
    assert.deepEqual((violations[0] as any).docIds, ["a"]);
  });

  test("Scenario B: All clean — no violations", () => {
    const violations = detectProcessingViolations([
      pdoc({ id: "a", canonical_type: "BUSINESS_TAX_RETURN", logical_key: "BTR|2024|e1" }),
    ]);
    assert.equal(violations.length, 0);
  });

  test("Scenario C: Single null-key entity-scoped locked = OK (no duplicate)", () => {
    const violations = detectProcessingViolations([
      pdoc({
        id: "a",
        canonical_type: "PERSONAL_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
      }),
    ]);
    assert.equal(violations.length, 0);
  });

  test("Scenario D: Two null-key entity-scoped locked same type+year = violation", () => {
    const violations = detectProcessingViolations([
      pdoc({
        id: "a",
        canonical_type: "PERSONAL_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
      }),
      pdoc({
        id: "b",
        canonical_type: "PERSONAL_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
      }),
    ]);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].kind, "identity_ambiguity");
    assert.equal((violations[0] as any).groups[0].key, "PERSONAL_TAX_RETURN|2024");
    assert.equal((violations[0] as any).groups[0].count, 2);
  });

  test("Scenario E: Two null-key different types = no violation", () => {
    const violations = detectProcessingViolations([
      pdoc({
        id: "a",
        canonical_type: "PERSONAL_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
      }),
      pdoc({
        id: "b",
        canonical_type: "BUSINESS_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
      }),
    ]);
    assert.equal(violations.length, 0);
  });

  test("Scenario F: Both violations simultaneously", () => {
    const violations = detectProcessingViolations([
      pdoc({ id: "a", is_active: false }),
      pdoc({
        id: "b",
        canonical_type: "PERSONAL_FINANCIAL_STATEMENT",
        doc_year: 2023,
        logical_key: null,
      }),
      pdoc({
        id: "c",
        canonical_type: "PERSONAL_FINANCIAL_STATEMENT",
        doc_year: 2023,
        logical_key: null,
      }),
    ]);
    assert.equal(violations.length, 2);
    const kinds = violations.map((v) => v.kind).sort();
    assert.deepEqual(kinds, ["identity_ambiguity", "inactive_locked"]);
  });

  test("Scenario G: Non-LOCKED docs excluded from both guards", () => {
    const violations = detectProcessingViolations([
      pdoc({ id: "a", is_active: false, intake_status: "AUTO_CONFIRMED" }),
      pdoc({
        id: "b",
        canonical_type: "PERSONAL_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
        intake_status: "AUTO_CONFIRMED",
      }),
      pdoc({
        id: "c",
        canonical_type: "PERSONAL_TAX_RETURN",
        doc_year: 2024,
        logical_key: null,
        intake_status: "AUTO_CONFIRMED",
      }),
    ]);
    assert.equal(violations.length, 0);
  });

  test("Scenario H: Non-entity-scoped null-key locked = no identity_ambiguity", () => {
    const violations = detectProcessingViolations([
      pdoc({
        id: "a",
        canonical_type: "RENT_ROLL",
        doc_year: 2024,
        logical_key: null,
      }),
      pdoc({
        id: "b",
        canonical_type: "RENT_ROLL",
        doc_year: 2024,
        logical_key: null,
      }),
    ]);
    assert.equal(violations.length, 0);
  });
});
