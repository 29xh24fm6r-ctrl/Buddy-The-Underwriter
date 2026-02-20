/**
 * Phase E4 — Snapshot Integrity Proof
 *
 * Deterministic invariant validation: computeIntakeSnapshotHash is
 * deterministic, order-independent, mutation-sensitive, and format-correct.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { computeIntakeSnapshotHash } from "../confirmation/types";

// ── Helpers ────────────────────────────────────────────────────────────

type HashDoc = { id: string; canonical_type: string | null; doc_year: number | null };

function makeDocs(...specs: Array<[string, string | null, number | null]>): HashDoc[] {
  return specs.map(([id, canonical_type, doc_year]) => ({
    id,
    canonical_type,
    doc_year,
  }));
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Snapshot Integrity Proof", () => {
  test("Scenario A: Determinism — same set hashed twice produces identical hash", () => {
    const docs = makeDocs(
      ["a", "BUSINESS_TAX_RETURN", 2024],
      ["b", "RENT_ROLL", 2023],
    );
    const hash1 = computeIntakeSnapshotHash(docs);
    const hash2 = computeIntakeSnapshotHash(docs);
    assert.equal(hash1, hash2);
  });

  test("Scenario B: Order independence — 3 explicit orderings produce identical hash", () => {
    const a: HashDoc = { id: "a", canonical_type: "BTR", doc_year: 2024 };
    const b: HashDoc = { id: "b", canonical_type: "RR", doc_year: 2023 };
    const c: HashDoc = { id: "c", canonical_type: "PFS", doc_year: null };

    const h1 = computeIntakeSnapshotHash([a, b, c]);
    const h2 = computeIntakeSnapshotHash([c, a, b]);
    const h3 = computeIntakeSnapshotHash([b, c, a]);

    assert.equal(h1, h2);
    assert.equal(h2, h3);
  });

  test("Scenario C: Mutation detection — changing any field changes hash", () => {
    const docs = makeDocs(
      ["a", "BUSINESS_TAX_RETURN", 2024],
      ["b", "RENT_ROLL", 2023],
    );
    const baseline = computeIntakeSnapshotHash(docs);

    // Change canonical_type
    const mutType = makeDocs(
      ["a", "PERSONAL_TAX_RETURN", 2024],
      ["b", "RENT_ROLL", 2023],
    );
    assert.notEqual(computeIntakeSnapshotHash(mutType), baseline);

    // Change doc_year
    const mutYear = makeDocs(
      ["a", "BUSINESS_TAX_RETURN", 2025],
      ["b", "RENT_ROLL", 2023],
    );
    assert.notEqual(computeIntakeSnapshotHash(mutYear), baseline);

    // Change id
    const mutId = makeDocs(
      ["x", "BUSINESS_TAX_RETURN", 2024],
      ["b", "RENT_ROLL", 2023],
    );
    assert.notEqual(computeIntakeSnapshotHash(mutId), baseline);
  });

  test("Scenario D: Removal detection — subset produces different hash", () => {
    const full = makeDocs(
      ["a", "BTR", 2024],
      ["b", "RR", 2023],
      ["c", "PFS", null],
    );
    const subset = makeDocs(
      ["a", "BTR", 2024],
      ["b", "RR", 2023],
    );

    const hashFull = computeIntakeSnapshotHash(full);
    const hashSubset = computeIntakeSnapshotHash(subset);
    assert.notEqual(hashFull, hashSubset);
  });

  test("Scenario E: Sealed set = logical_key IS NOT NULL only", () => {
    // Simulate docs with mixed logical_key presence
    const allDocs = [
      { id: "a", canonical_type: "BTR", doc_year: 2024, logical_key: "BTR|2024|e1" },
      { id: "b", canonical_type: "PTR", doc_year: 2024, logical_key: null },
      { id: "c", canonical_type: "RR", doc_year: 2023, logical_key: "RR|2023|NA" },
    ];

    // Filter to sealable (as confirm route does)
    const sealable = allDocs
      .filter((d) => d.logical_key != null)
      .map((d) => ({ id: d.id, canonical_type: d.canonical_type, doc_year: d.doc_year }));

    assert.equal(sealable.length, 2);
    assert.equal(sealable[0].id, "a");
    assert.equal(sealable[1].id, "c");

    // Hash is deterministic for sealed set
    const hash1 = computeIntakeSnapshotHash(sealable);
    const hash2 = computeIntakeSnapshotHash(sealable);
    assert.equal(hash1, hash2);

    // Including doc b would produce different hash
    const withB = makeDocs(
      ["a", "BTR", 2024],
      ["b", "PTR", 2024],
      ["c", "RR", 2023],
    );
    assert.notEqual(computeIntakeSnapshotHash(withB), hash1);
  });

  test("Scenario F: Empty sealed set — hash of [] is deterministic", () => {
    const hash1 = computeIntakeSnapshotHash([]);
    const hash2 = computeIntakeSnapshotHash([]);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(hash1));
  });

  test("Scenario G: Format invariant — 64-char lowercase hex for all sizes", () => {
    const sizes = [1, 2, 5, 10, 20];
    for (const size of sizes) {
      const docs: HashDoc[] = [];
      for (let i = 0; i < size; i++) {
        docs.push({
          id: `doc-${i}`,
          canonical_type: i % 2 === 0 ? "BTR" : "RR",
          doc_year: 2020 + i,
        });
      }
      const hash = computeIntakeSnapshotHash(docs);
      assert.equal(hash.length, 64, `Size ${size}: hash must be 64 chars`);
      assert.ok(
        /^[0-9a-f]{64}$/.test(hash),
        `Size ${size}: hash must be lowercase hex`,
      );
    }
  });

  test("Scenario H: Snapshot invalidation — hash changes when active set changes", () => {
    // Original active set
    const s1 = makeDocs(
      ["a", "BTR", 2024],
      ["b", "RR", 2023],
      ["c", "PFS", null],
    );
    const h1 = computeIntakeSnapshotHash(s1);

    // After supersession: doc "a" deactivated, doc "d" replaces it
    const s2 = makeDocs(
      ["d", "BTR", 2024],
      ["b", "RR", 2023],
      ["c", "PFS", null],
    );
    const h2 = computeIntakeSnapshotHash(s2);

    assert.notEqual(h1, h2, "Hash must change when active set changes");
  });
});
