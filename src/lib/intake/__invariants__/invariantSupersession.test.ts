/**
 * Phase E4 — Supersession Ordering Proof
 *
 * Deterministic invariant validation: at most one active document per
 * logical_key, regardless of insertion order. Pure state machine mirroring
 * resolveSupersession.ts algorithm exactly.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { computeLogicalKey } from "../supersession/computeLogicalKey";

// ── Types ──────────────────────────────────────────────────────────────

type SimDoc = {
  id: string;
  canonical_type: string | null;
  doc_year: number | null;
  quality_status: string;
  entity_id: string | null;
  sha256: string;
  is_active: boolean;
  logical_key: string | null;
  superseded_by: string | null;
};

type SupersessionOutcome =
  | { outcome: "no_key" }
  | { outcome: "no_conflict" }
  | { outcome: "duplicate_rejected"; existingDocId: string }
  | { outcome: "superseded"; supersededDocId: string };

// ── Pure State Machine (mirrors resolveSupersession.ts) ────────────────

function simulateSupersession(
  docs: Map<string, SimDoc>,
  activeKeys: Map<string, string>,
  newDoc: SimDoc,
): SupersessionOutcome {
  // Step 1: NULL key → no_key
  if (newDoc.logical_key == null) {
    docs.set(newDoc.id, newDoc);
    return { outcome: "no_key" };
  }

  // Step 2: Check existing active doc with same key
  const existingId = activeKeys.get(newDoc.logical_key);

  if (!existingId) {
    // No conflict — register
    docs.set(newDoc.id, newDoc);
    activeKeys.set(newDoc.logical_key, newDoc.id);
    return { outcome: "no_conflict" };
  }

  const existing = docs.get(existingId)!;

  // Step 3-4: Duplicate detection (same SHA + same type + same year)
  const isSameSha =
    newDoc.sha256 != null &&
    existing.sha256 != null &&
    newDoc.sha256 === existing.sha256;
  const isSameType = newDoc.canonical_type === existing.canonical_type;
  const isSameYear = newDoc.doc_year === existing.doc_year;

  if (isSameSha && isSameType && isSameYear) {
    // Duplicate: deactivate NEW doc
    newDoc.is_active = false;
    docs.set(newDoc.id, newDoc);
    return { outcome: "duplicate_rejected", existingDocId: existing.id };
  }

  // Step 5: Supersession — deactivate OLD first, then register NEW
  existing.is_active = false;
  existing.superseded_by = newDoc.id;
  activeKeys.delete(newDoc.logical_key);

  docs.set(newDoc.id, newDoc);
  activeKeys.set(newDoc.logical_key, newDoc.id);
  return { outcome: "superseded", supersededDocId: existing.id };
}

// ── Invariant Checker ──────────────────────────────────────────────────

function assertCoreInvariant(
  docs: Map<string, SimDoc>,
  activeKeys: Map<string, string>,
): void {
  // Invariant: at most 1 active doc per logical_key
  const activeByKey = new Map<string, string[]>();
  for (const [id, doc] of docs) {
    if (doc.is_active && doc.logical_key != null) {
      const arr = activeByKey.get(doc.logical_key) ?? [];
      arr.push(id);
      activeByKey.set(doc.logical_key, arr);
    }
  }
  for (const [key, ids] of activeByKey) {
    assert.ok(
      ids.length <= 1,
      `Multiple active docs for key "${key}": ${ids.join(", ")}`,
    );
  }

  // activeKeys map consistent with docs
  for (const [key, id] of activeKeys) {
    const doc = docs.get(id);
    assert.ok(doc, `activeKeys references non-existent doc ${id}`);
    assert.ok(doc.is_active, `activeKeys references inactive doc ${id}`);
    assert.equal(doc.logical_key, key);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<SimDoc> & { id: string }): SimDoc {
  const base: SimDoc = {
    id: overrides.id,
    canonical_type: "BUSINESS_TAX_RETURN",
    doc_year: 2024,
    quality_status: "PASSED",
    entity_id: "entity-a",
    sha256: `sha-${overrides.id}`,
    is_active: true,
    logical_key: null,
    superseded_by: null,
  };
  const doc = { ...base, ...overrides };
  // Compute logical_key from fields
  doc.logical_key = computeLogicalKey({
    canonicalType: doc.canonical_type,
    taxYear: doc.doc_year,
    qualityStatus: doc.quality_status,
    entityId: doc.entity_id,
  });
  return doc;
}

function freshDeal(): { docs: Map<string, SimDoc>; activeKeys: Map<string, string> } {
  return { docs: new Map(), activeKeys: new Map() };
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Supersession Ordering Proof", () => {
  test("Scenario A: Dual upload same key, ordering A→B", () => {
    const { docs, activeKeys } = freshDeal();
    const docA = makeDoc({ id: "doc-a", sha256: "aaa" });
    const docB = makeDoc({ id: "doc-b", sha256: "bbb" });

    const r1 = simulateSupersession(docs, activeKeys, docA);
    assert.equal(r1.outcome, "no_conflict");

    const r2 = simulateSupersession(docs, activeKeys, docB);
    assert.equal(r2.outcome, "superseded");
    assert.equal(
      (r2 as { supersededDocId: string }).supersededDocId,
      "doc-a",
    );

    assertCoreInvariant(docs, activeKeys);
    assert.equal(docs.get("doc-a")!.is_active, false);
    assert.equal(docs.get("doc-a")!.superseded_by, "doc-b");
    assert.equal(docs.get("doc-b")!.is_active, true);
    assert.equal(activeKeys.get("BUSINESS_TAX_RETURN|2024|entity-a"), "doc-b");
  });

  test("Scenario B: Same pair, reversed ordering B→A", () => {
    const { docs, activeKeys } = freshDeal();
    const docA = makeDoc({ id: "doc-a", sha256: "aaa" });
    const docB = makeDoc({ id: "doc-b", sha256: "bbb" });

    const r1 = simulateSupersession(docs, activeKeys, docB);
    assert.equal(r1.outcome, "no_conflict");

    const r2 = simulateSupersession(docs, activeKeys, docA);
    assert.equal(r2.outcome, "superseded");
    assert.equal(
      (r2 as { supersededDocId: string }).supersededDocId,
      "doc-b",
    );

    assertCoreInvariant(docs, activeKeys);
    // Invariant holds regardless of order
    const activeCount = [...docs.values()].filter(
      (d) => d.is_active && d.logical_key === "BUSINESS_TAX_RETURN|2024|entity-a",
    ).length;
    assert.equal(activeCount, 1);
  });

  test("Scenario C: Identical SHA-256 duplicate race A→B", () => {
    const { docs, activeKeys } = freshDeal();
    const docA = makeDoc({ id: "doc-a", sha256: "same-content" });
    const docB = makeDoc({ id: "doc-b", sha256: "same-content" });

    const r1 = simulateSupersession(docs, activeKeys, docA);
    assert.equal(r1.outcome, "no_conflict");

    const r2 = simulateSupersession(docs, activeKeys, docB);
    assert.equal(r2.outcome, "duplicate_rejected");
    assert.equal(
      (r2 as { existingDocId: string }).existingDocId,
      "doc-a",
    );

    assertCoreInvariant(docs, activeKeys);
    assert.equal(docs.get("doc-a")!.is_active, true);
    assert.equal(docs.get("doc-b")!.is_active, false);
    assert.equal(docs.get("doc-a")!.superseded_by, null);
  });

  test("Scenario D: Reverse duplicate race B→A", () => {
    const { docs, activeKeys } = freshDeal();
    const docA = makeDoc({ id: "doc-a", sha256: "same-content" });
    const docB = makeDoc({ id: "doc-b", sha256: "same-content" });

    simulateSupersession(docs, activeKeys, docB);
    const r2 = simulateSupersession(docs, activeKeys, docA);
    assert.equal(r2.outcome, "duplicate_rejected");

    assertCoreInvariant(docs, activeKeys);
    // One active, one rejected
    const activeCount = [...docs.values()].filter((d) => d.is_active).length;
    assert.equal(activeCount, 1);
  });

  test("Scenario E: NULL logical_key docs never conflict", () => {
    const { docs, activeKeys } = freshDeal();

    // Unclassified
    const docA = makeDoc({
      id: "doc-a",
      canonical_type: null,
    });
    assert.equal(docA.logical_key, null);

    // Quality-failed
    const docB = makeDoc({
      id: "doc-b",
      quality_status: "FAILED_LOW_TEXT",
    });
    assert.equal(docB.logical_key, null);

    // Entity-scoped without entity
    const docC = makeDoc({
      id: "doc-c",
      canonical_type: "PERSONAL_TAX_RETURN",
      entity_id: null,
    });
    assert.equal(docC.logical_key, null);

    simulateSupersession(docs, activeKeys, docA);
    simulateSupersession(docs, activeKeys, docB);
    simulateSupersession(docs, activeKeys, docC);

    assertCoreInvariant(docs, activeKeys);
    // All 3 remain active
    assert.equal(docs.get("doc-a")!.is_active, true);
    assert.equal(docs.get("doc-b")!.is_active, true);
    assert.equal(docs.get("doc-c")!.is_active, true);
    assert.equal(activeKeys.size, 0);
  });

  test("Scenario F: Quality-failed doc cannot supersede PASSED doc", () => {
    const { docs, activeKeys } = freshDeal();

    const docA = makeDoc({ id: "doc-a", quality_status: "PASSED" });
    const docB = makeDoc({ id: "doc-b", quality_status: "FAILED_LOW_TEXT" });

    simulateSupersession(docs, activeKeys, docA);
    const r2 = simulateSupersession(docs, activeKeys, docB);
    assert.equal(r2.outcome, "no_key");

    assertCoreInvariant(docs, activeKeys);
    assert.equal(docs.get("doc-a")!.is_active, true);
    assert.notEqual(docs.get("doc-a")!.logical_key, null);
    assert.equal(docs.get("doc-b")!.is_active, true);
    assert.equal(docs.get("doc-b")!.logical_key, null);
  });

  test("Scenario G: Three-way supersession chain", () => {
    const { docs, activeKeys } = freshDeal();

    const docA = makeDoc({
      id: "doc-a",
      canonical_type: "RENT_ROLL",
      doc_year: 2023,
      entity_id: null,
      sha256: "v1",
    });
    const docB = makeDoc({
      id: "doc-b",
      canonical_type: "RENT_ROLL",
      doc_year: 2023,
      entity_id: null,
      sha256: "v2",
    });
    const docC = makeDoc({
      id: "doc-c",
      canonical_type: "RENT_ROLL",
      doc_year: 2023,
      entity_id: null,
      sha256: "v3",
    });

    const r1 = simulateSupersession(docs, activeKeys, docA);
    assert.equal(r1.outcome, "no_conflict");

    const r2 = simulateSupersession(docs, activeKeys, docB);
    assert.equal(r2.outcome, "superseded");

    const r3 = simulateSupersession(docs, activeKeys, docC);
    assert.equal(r3.outcome, "superseded");

    assertCoreInvariant(docs, activeKeys);
    assert.equal(docs.get("doc-a")!.is_active, false);
    assert.equal(docs.get("doc-a")!.superseded_by, "doc-b");
    assert.equal(docs.get("doc-b")!.is_active, false);
    assert.equal(docs.get("doc-b")!.superseded_by, "doc-c");
    assert.equal(docs.get("doc-c")!.is_active, true);
  });

  test("Scenario H: Entity-scoped type with entity gains key, without entity does not", () => {
    const docA = makeDoc({
      id: "doc-a",
      canonical_type: "PERSONAL_TAX_RETURN",
      entity_id: "person-1",
    });
    assert.equal(docA.logical_key, "PERSONAL_TAX_RETURN|2024|person-1");

    const docB = makeDoc({
      id: "doc-b",
      canonical_type: "PERSONAL_TAX_RETURN",
      entity_id: null,
    });
    assert.equal(docB.logical_key, null);

    // No conflict possible — different key spaces
    const { docs, activeKeys } = freshDeal();
    simulateSupersession(docs, activeKeys, docA);
    simulateSupersession(docs, activeKeys, docB);

    assertCoreInvariant(docs, activeKeys);
    assert.equal(docs.get("doc-a")!.is_active, true);
    assert.equal(docs.get("doc-b")!.is_active, true);
  });
});
