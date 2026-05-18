import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GCF_SRC = readFileSync(resolve(__dirname, "../persistGlobalCashFlow.ts"), "utf-8");
const AGG_SRC = readFileSync(resolve(__dirname, "../../financialFacts/runCashFlowAggregator.ts"), "utf-8");

describe("SPEC-ENTITY-MODEL-RECONCILIATION-1 guards", () => {
  test("persistGlobalCashFlow queries ownership_entities as fallback", () => {
    assert.ok(GCF_SRC.includes("ownership_entities"));
  });

  test("runCashFlowAggregator has deal-scoped EBITDA fallback path", () => {
    assert.ok(AGG_SRC.includes('.eq("owner_type", "DEAL")'));
  });

  test("runCashFlowAggregator has TAX_RETURN fallback", () => {
    assert.ok(AGG_SRC.includes('.eq("fact_type", "TAX_RETURN")'));
  });
});
