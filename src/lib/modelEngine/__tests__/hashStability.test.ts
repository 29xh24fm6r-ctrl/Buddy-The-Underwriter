import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize, canonicalHash, hashFinancialModel } from "../hash/canonicalSerialize";
import { buildFinancialModel } from "../buildFinancialModel";
import type { FactInput } from "../buildFinancialModel";
import type { FinancialModel } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEAL_ID = "hash-stability-test";

const BASE_FACTS: FactInput[] = [
  { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 1000000, fact_period_end: "2024-12-31" },
  { fact_type: "INCOME_STATEMENT", fact_key: "COST_OF_GOODS_SOLD", fact_value_num: 400000, fact_period_end: "2024-12-31" },
  { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_OPERATING_EXPENSES", fact_value_num: 200000, fact_period_end: "2024-12-31" },
  { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 300000, fact_period_end: "2024-12-31" },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 5000000, fact_period_end: "2024-12-31" },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_LIABILITIES", fact_value_num: 3000000, fact_period_end: "2024-12-31" },
  { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_EQUITY", fact_value_num: 2000000, fact_period_end: "2024-12-31" },
  { fact_type: "BALANCE_SHEET", fact_key: "CASH_AND_EQUIVALENTS", fact_value_num: 500000, fact_period_end: "2024-12-31" },
];

// ---------------------------------------------------------------------------
// canonicalSerialize
// ---------------------------------------------------------------------------

describe("canonicalSerialize", () => {
  it("produces identical output regardless of key order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    assert.equal(canonicalSerialize(a), canonicalSerialize(b));
  });

  it("strips non-deterministic fields", () => {
    const obj = {
      dealId: "d1",
      generatedAt: "2024-01-01T00:00:00Z",
      calculatedAt: "2024-01-01T00:00:00Z",
      computedAt: "2024-01-01T00:00:00Z",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      value: 42,
    };
    const serialized = canonicalSerialize(obj);
    assert.ok(!serialized.includes("generatedAt"));
    assert.ok(!serialized.includes("calculatedAt"));
    assert.ok(!serialized.includes("computedAt"));
    assert.ok(!serialized.includes("created_at"));
    assert.ok(!serialized.includes("updated_at"));
    assert.ok(serialized.includes("dealId"));
    assert.ok(serialized.includes("value"));
  });

  it("handles nested objects with sorted keys", () => {
    const a = { outer: { z: 1, a: 2 }, top: "v" };
    const b = { top: "v", outer: { a: 2, z: 1 } };
    assert.equal(canonicalSerialize(a), canonicalSerialize(b));
  });

  it("preserves array order", () => {
    const a = { items: [3, 1, 2] };
    const b = { items: [1, 2, 3] };
    assert.notEqual(canonicalSerialize(a), canonicalSerialize(b));
  });

  it("handles null and undefined", () => {
    assert.equal(canonicalSerialize(null), "null");
    assert.equal(canonicalSerialize(undefined), undefined);
  });

  it("handles primitives", () => {
    assert.equal(canonicalSerialize(42), "42");
    assert.equal(canonicalSerialize("hello"), '"hello"');
    assert.equal(canonicalSerialize(true), "true");
  });
});

// ---------------------------------------------------------------------------
// canonicalHash
// ---------------------------------------------------------------------------

describe("canonicalHash", () => {
  it("returns SHA-256 hex string", () => {
    const hash = canonicalHash({ test: true });
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64); // SHA-256 = 64 hex chars
    assert.ok(/^[0-9a-f]{64}$/.test(hash));
  });

  it("same content different key order → same hash", () => {
    const h1 = canonicalHash({ a: 1, b: 2 });
    const h2 = canonicalHash({ b: 2, a: 1 });
    assert.equal(h1, h2);
  });

  it("different content → different hash", () => {
    const h1 = canonicalHash({ a: 1 });
    const h2 = canonicalHash({ a: 2 });
    assert.notEqual(h1, h2);
  });

  it("strips timestamps before hashing", () => {
    const h1 = canonicalHash({ value: 42, generatedAt: "2024-01-01" });
    const h2 = canonicalHash({ value: 42, generatedAt: "2025-06-15" });
    assert.equal(h1, h2);
  });
});

// ---------------------------------------------------------------------------
// hashFinancialModel — build→hash→rebuild→rehash stability
// ---------------------------------------------------------------------------

describe("hashFinancialModel stability", () => {
  it("build→hash→rebuild→rehash produces same hash", () => {
    const model1 = buildFinancialModel(DEAL_ID, BASE_FACTS);
    const hash1 = hashFinancialModel(model1);

    const model2 = buildFinancialModel(DEAL_ID, BASE_FACTS);
    const hash2 = hashFinancialModel(model2);

    assert.equal(hash1, hash2);
  });

  it("shuffled facts order → same hash", () => {
    const model1 = buildFinancialModel(DEAL_ID, BASE_FACTS);
    const hash1 = hashFinancialModel(model1);

    // Shuffle the facts
    const shuffled = [...BASE_FACTS].reverse();
    const model2 = buildFinancialModel(DEAL_ID, shuffled);
    const hash2 = hashFinancialModel(model2);

    assert.equal(hash1, hash2);
  });

  it("different deal ID → different hash", () => {
    const model1 = buildFinancialModel("deal-A", BASE_FACTS);
    const model2 = buildFinancialModel("deal-B", BASE_FACTS);

    assert.notEqual(hashFinancialModel(model1), hashFinancialModel(model2));
  });

  it("different fact values → different hash", () => {
    const alteredFacts = BASE_FACTS.map((f) =>
      f.fact_key === "TOTAL_REVENUE" ? { ...f, fact_value_num: 9999999 } : f,
    );

    const model1 = buildFinancialModel(DEAL_ID, BASE_FACTS);
    const model2 = buildFinancialModel(DEAL_ID, alteredFacts);

    assert.notEqual(hashFinancialModel(model1), hashFinancialModel(model2));
  });

  it("multi-period model hashes are stable", () => {
    const multiPeriodFacts: FactInput[] = [
      ...BASE_FACTS,
      { fact_type: "INCOME_STATEMENT", fact_key: "TOTAL_REVENUE", fact_value_num: 900000, fact_period_end: "2023-12-31" },
      { fact_type: "INCOME_STATEMENT", fact_key: "NET_INCOME", fact_value_num: 250000, fact_period_end: "2023-12-31" },
      { fact_type: "BALANCE_SHEET", fact_key: "TOTAL_ASSETS", fact_value_num: 4500000, fact_period_end: "2023-12-31" },
    ];

    const model1 = buildFinancialModel(DEAL_ID, multiPeriodFacts);
    const hash1 = hashFinancialModel(model1);

    // Shuffle and rebuild
    const shuffled = [...multiPeriodFacts].sort(() => Math.random() - 0.5);
    const model2 = buildFinancialModel(DEAL_ID, shuffled);
    const hash2 = hashFinancialModel(model2);

    assert.equal(hash1, hash2);
    assert.equal(model1.periods.length, 2);
  });
});
