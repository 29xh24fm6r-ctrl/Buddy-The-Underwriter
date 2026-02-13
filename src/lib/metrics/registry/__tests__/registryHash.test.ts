import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeEntryJson,
  hashEntry,
  canonicalizeRegistryJson,
  hashRegistry,
  hashOutputs,
} from "../hash";

// ── Canonical entry JSON ────────────────────────────────────────────────────

describe("canonicalizeEntryJson", () => {
  it("sorts keys deterministically", () => {
    const a = canonicalizeEntryJson({ z: 1, a: 2, m: 3 });
    const b = canonicalizeEntryJson({ a: 2, m: 3, z: 1 });
    assert.equal(a, b);
    // Keys should be alphabetically ordered
    const parsed = JSON.parse(a);
    assert.deepEqual(Object.keys(parsed), ["a", "m", "z"]);
  });

  it("strips non-semantic fields (id, created_at, etc.)", () => {
    const result = canonicalizeEntryJson({
      id: "should-be-stripped",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      registry_version_id: "abc",
      definition_hash: "def",
      label: "Total Income",
      expr: "A + B",
    });
    const parsed = JSON.parse(result);
    assert.equal(parsed.label, "Total Income");
    assert.equal(parsed.expr, "A + B");
    assert.equal(parsed.id, undefined);
    assert.equal(parsed.created_at, undefined);
    assert.equal(parsed.registry_version_id, undefined);
    assert.equal(parsed.definition_hash, undefined);
  });

  it("handles nested objects", () => {
    const result = canonicalizeEntryJson({
      formula: { type: "divide", left: "A", right: "B" },
      label: "DSCR",
    });
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.formula, { left: "A", right: "B", type: "divide" });
  });

  it("handles null and undefined values", () => {
    const a = canonicalizeEntryJson({ a: null, b: undefined, c: 1 });
    const parsed = JSON.parse(a);
    assert.equal(parsed.a, null);
    assert.equal(parsed.c, 1);
  });
});

// ── Entry hash ──────────────────────────────────────────────────────────────

describe("hashEntry", () => {
  it("produces consistent SHA-256 for identical inputs", () => {
    const def = { label: "DSCR", expr: "CFADS / DEBT_SERVICE", precision: 2 };
    const hash1 = hashEntry(def);
    const hash2 = hashEntry(def);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64); // SHA-256 hex = 64 chars
  });

  it("is order-independent", () => {
    const a = hashEntry({ precision: 2, label: "DSCR", expr: "X / Y" });
    const b = hashEntry({ label: "DSCR", expr: "X / Y", precision: 2 });
    assert.equal(a, b);
  });

  it("different content produces different hashes", () => {
    const a = hashEntry({ label: "DSCR", expr: "A / B" });
    const b = hashEntry({ label: "DSCR", expr: "A / C" });
    assert.notEqual(a, b);
  });
});

// ── Registry-level canonical JSON ───────────────────────────────────────────

describe("canonicalizeRegistryJson", () => {
  it("sorts entries by metric_key", () => {
    const entries = [
      { metric_key: "LEVERAGE", definition_json: { label: "Leverage" } },
      { metric_key: "DSCR", definition_json: { label: "DSCR" } },
      { metric_key: "CURRENT_RATIO", definition_json: { label: "Current Ratio" } },
    ];
    const json = canonicalizeRegistryJson(entries);
    const parsed = JSON.parse(json);
    assert.equal(parsed[0].metric_key, "CURRENT_RATIO");
    assert.equal(parsed[1].metric_key, "DSCR");
    assert.equal(parsed[2].metric_key, "LEVERAGE");
  });

  it("produces same output regardless of input order", () => {
    const a = canonicalizeRegistryJson([
      { metric_key: "B", definition_json: { x: 1 } },
      { metric_key: "A", definition_json: { x: 2 } },
    ]);
    const b = canonicalizeRegistryJson([
      { metric_key: "A", definition_json: { x: 2 } },
      { metric_key: "B", definition_json: { x: 1 } },
    ]);
    assert.equal(a, b);
  });
});

// ── Registry hash ───────────────────────────────────────────────────────────

describe("hashRegistry", () => {
  it("produces consistent SHA-256", () => {
    const entries = [
      { metric_key: "DSCR", definition_json: { label: "DSCR", expr: "A/B" } },
      { metric_key: "LTV", definition_json: { label: "LTV", expr: "C/D" } },
    ];
    const h1 = hashRegistry(entries);
    const h2 = hashRegistry(entries);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  it("is order-independent", () => {
    const a = hashRegistry([
      { metric_key: "LTV", definition_json: { label: "LTV" } },
      { metric_key: "DSCR", definition_json: { label: "DSCR" } },
    ]);
    const b = hashRegistry([
      { metric_key: "DSCR", definition_json: { label: "DSCR" } },
      { metric_key: "LTV", definition_json: { label: "LTV" } },
    ]);
    assert.equal(a, b);
  });

  it("different entries produce different hashes", () => {
    const a = hashRegistry([
      { metric_key: "DSCR", definition_json: { expr: "A/B" } },
    ]);
    const b = hashRegistry([
      { metric_key: "DSCR", definition_json: { expr: "A/C" } },
    ]);
    assert.notEqual(a, b);
  });

  it("ignores non-semantic fields in entries", () => {
    const a = hashRegistry([
      { metric_key: "DSCR", definition_json: { label: "DSCR", id: "abc", created_at: "2026-01-01" } },
    ]);
    const b = hashRegistry([
      { metric_key: "DSCR", definition_json: { label: "DSCR" } },
    ]);
    assert.equal(a, b);
  });
});

// ── Outputs hash ────────────────────────────────────────────────────────────

describe("hashOutputs", () => {
  it("produces consistent hash for identical outputs", () => {
    const outputs = { snapshot: { dscr: 1.25 }, policy: { tier: "A" } };
    const h1 = hashOutputs(outputs);
    const h2 = hashOutputs(outputs);
    assert.equal(h1, h2);
    assert.equal(h1.length, 64);
  });

  it("is key-order independent", () => {
    const a = hashOutputs({ b: 2, a: 1 });
    const b = hashOutputs({ a: 1, b: 2 });
    assert.equal(a, b);
  });

  it("strips timestamp-like fields from outputs", () => {
    const a = hashOutputs({ dscr: 1.25, created_at: "2026-01-01" });
    const b = hashOutputs({ dscr: 1.25 });
    assert.equal(a, b);
  });
});
