import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconcileFinancialFacts, type ReconcileFact } from "../reconcileFinancialFacts";

/**
 * SPEC-SPREAD-FACT-RECONCILIATION-AND-CONFIDENCE-GATES-1 — OmniCare-shaped facts.
 */

const P = "2024-12-31";
function f(over: Partial<ReconcileFact>): ReconcileFact {
  return {
    fact_key: "WAGES_W2",
    fact_period_end: P,
    owner_type: "PERSONAL",
    owner_entity_id: "owner-1",
    source_document_id: "doc-1",
    source_canonical_type: "PERSONAL_TAX_RETURN",
    confidence: 0.8,
    extractor: "gemini_primary_v1",
    fact_value_num: 0,
    ...over,
  };
}

const find = (r: ReturnType<typeof reconcileFinancialFacts>, key: string, val: number) =>
  r.rejected.find((x) => x.fact.fact_key === key && x.fact.fact_value_num === val);

describe("duplicate / stub rejection", () => {
  it("rejects WAGES_W2 = 3 when 310,134 is present for the same period/owner", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "WAGES_W2", fact_value_num: 310134, extractor: "personalIncomeExtractor:v2:deterministic", confidence: 1 }),
      f({ fact_key: "WAGES_W2", fact_value_num: 3, extractor: "gemini_primary_v1", confidence: 0.8 }),
    ]);
    const rej = find(r, "WAGES_W2", 3);
    assert.ok(rej, "the 3 stub must be rejected");
    assert.equal(rej!.conflictClass, "duplicate_active_same_key_period_owner");
    assert.equal(r.selected.filter((s) => s.fact_key === "WAGES_W2").length, 1);
    assert.equal(r.selected.find((s) => s.fact_key === "WAGES_W2")!.fact_value_num, 310134);
  });

  it("a duplicate same-key/period cannot both survive (personal income spread protection)", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "TAXABLE_INCOME", fact_value_num: 249968, extractor: "personalIncomeExtractor:v2:deterministic", confidence: 1 }),
      f({ fact_key: "TAXABLE_INCOME", fact_value_num: 456, extractor: "gemini_primary_v1", confidence: 0.55 }),
    ]);
    assert.equal(r.selected.filter((s) => s.fact_key === "TAXABLE_INCOME").length, 1);
    assert.equal(r.selected.find((s) => s.fact_key === "TAXABLE_INCOME")!.fact_value_num, 249968);
  });
});

describe("impossible personal-income relationships", () => {
  it("rejects AGI = 0 when material wages exist, and blocks canonical use", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "WAGES_W2", fact_value_num: 310134, confidence: 1, extractor: "personalIncomeExtractor:v2:deterministic" }),
      f({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0 }),
    ]);
    const rej = find(r, "ADJUSTED_GROSS_INCOME", 0);
    assert.ok(rej);
    assert.equal(rej!.conflictClass, "material_zero_fact");
    assert.equal(r.blocked, true);
    assert.equal(r.confidenceTier, "blocked");
    assert.ok(!r.selected.some((s) => s.fact_key === "ADJUSTED_GROSS_INCOME"));
  });

  it("rejects TOTAL_INCOME below WAGES_W2", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "WAGES_W2", fact_value_num: 310134, confidence: 1 }),
      f({ fact_key: "TOTAL_INCOME", fact_value_num: 200000 }),
    ]);
    const rej = find(r, "TOTAL_INCOME", 200000);
    assert.ok(rej);
    assert.equal(rej!.conflictClass, "impossible_personal_income_relationship");
    assert.equal(r.blocked, true);
  });

  it("rejects NET_INCOME = 0 when material TAXABLE_INCOME exists", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "TAXABLE_INCOME", fact_value_num: 249968, owner_type: "DEAL", owner_entity_id: null }),
      f({ fact_key: "NET_INCOME", fact_value_num: 0, owner_type: "DEAL", owner_entity_id: null }),
    ]);
    const rej = find(r, "NET_INCOME", 0);
    assert.ok(rej);
    assert.equal(rej!.conflictClass, "material_zero_fact");
  });
});

describe("extractor conflict + source priority", () => {
  it("resolves deterministic-vs-gemini material disagreement to the higher-priority source", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "AGI", fact_value_num: 240486, extractor: "personalIncomeExtractor:v2:deterministic", confidence: 1 }),
      f({ fact_key: "AGI", fact_value_num: 99999, extractor: "gemini_primary_v1", confidence: 0.8 }),
    ]);
    const sel = r.selected.find((s) => s.fact_key === "AGI");
    assert.equal(sel!.fact_value_num, 240486);
    const rej = find(r, "AGI", 99999);
    assert.ok(rej);
    assert.equal(rej!.conflictClass, "extractor_conflict");
  });
});

describe("clean facts", () => {
  it("no conflicts → tier high, nothing rejected, not blocked", () => {
    const r = reconcileFinancialFacts([
      f({ fact_key: "WAGES_W2", fact_value_num: 310134, confidence: 1 }),
      f({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 340000, confidence: 1 }),
      f({ fact_key: "TOTAL_INCOME", fact_value_num: 360000, confidence: 1 }),
    ]);
    assert.equal(r.rejected.length, 0);
    assert.equal(r.blocked, false);
    assert.equal(r.confidenceTier, "high");
  });
});
