/**
 * SPEC-FACT-DISAMBIGUATION-1 — Guard tests (2026-05-18)
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SELECT_BEST_SRC = readFileSync(
  resolve(__dirname, "../selectBestFact.ts"), "utf-8",
);
const SNAPSHOT_CORE_SRC = readFileSync(
  resolve(__dirname, "../../deals/financialSnapshotCore.ts"), "utf-8",
);
const AGG_SRC = readFileSync(
  resolve(__dirname, "../runCashFlowAggregator.ts"), "utf-8",
);
const GCF_SRC = readFileSync(
  resolve(__dirname, "../../financialIntelligence/persistGlobalCashFlow.ts"), "utf-8",
);
const WRITE_FACT_SRC = readFileSync(
  resolve(__dirname, "../writeFact.ts"), "utf-8",
);

describe("SPEC-FACT-DISAMBIGUATION-1 guards", () => {
  test("selectBestFact is exported from selectBestFact.ts", () => {
    assert.ok(SELECT_BEST_SRC.includes("export function selectBestFact"));
  });

  test("financialSnapshotCore imports selectBestFact from selectBestFact.ts", () => {
    assert.ok(SNAPSHOT_CORE_SRC.includes("from \"@/lib/financialFacts/selectBestFact\""));
  });

  test("runCashFlowAggregator imports selectBestFact from selectBestFact.ts", () => {
    assert.ok(AGG_SRC.includes("from \"@/lib/financialFacts/selectBestFact\""));
  });

  test("persistGlobalCashFlow imports selectBestFact from selectBestFact.ts", () => {
    assert.ok(GCF_SRC.includes("from \"@/lib/financialFacts/selectBestFact\""));
  });

  test("runCashFlowAggregator uses source_canonical_type filter (not bizTaxDocIds)", () => {
    assert.ok(AGG_SRC.includes("source_canonical_type"));
    assert.ok(!AGG_SRC.includes("bizTaxDocIds"));
  });

  test("upsertDealFinancialFact includes source_canonical_type in the row object", () => {
    assert.ok(WRITE_FACT_SRC.includes("source_canonical_type"));
  });

  test("writeFact.ts row object contains source_canonical_type key", () => {
    assert.ok(WRITE_FACT_SRC.includes("source_canonical_type: sourceCanonicalType"));
  });

  test("selectBestFact sorts MANUAL above DOC_EXTRACT", () => {
    assert.ok(SELECT_BEST_SRC.includes('"MANUAL":     return 4'));
    assert.ok(SELECT_BEST_SRC.includes('"DOC_EXTRACT": return 1'));
  });
});
