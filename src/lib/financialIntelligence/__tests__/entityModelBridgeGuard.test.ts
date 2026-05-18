/**
 * SPEC-ENTITY-MODEL-RECONCILIATION-1 — Source-inspection guards (2026-05-18)
 *
 * Proves:
 *   1. persistGlobalCashFlow queries ownership_entities as fallback
 *   2. runCashFlowAggregator has deal-scoped EBITDA fallback path
 *   3. runCashFlowAggregator has TAX_RETURN fallback when no EBITDA/OBI/NI facts
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GCF_SRC = readFileSync(
  resolve(__dirname, "../persistGlobalCashFlow.ts"),
  "utf-8",
);

const AGG_SRC = readFileSync(
  resolve(__dirname, "../../financialFacts/runCashFlowAggregator.ts"),
  "utf-8",
);

describe("SPEC-ENTITY-MODEL-RECONCILIATION-1 guards", () => {
  test("persistGlobalCashFlow queries ownership_entities as fallback", () => {
    assert.ok(
      GCF_SRC.includes("ownership_entities"),
      "persistGlobalCashFlow must query ownership_entities when deal_entities is empty",
    );
  });

  test("persistGlobalCashFlow fallback only fires when entities is empty", () => {
    assert.ok(
      GCF_SRC.includes("if (entities.length === 0)"),
      "ownership_entities fallback must be gated by entities.length === 0",
    );
  });

  test("persistGlobalCashFlow has individual entity sponsor fallback", () => {
    assert.ok(
      GCF_SRC.includes("personalEntityIds.size === 0"),
      "sponsor fallback must be gated by personalEntityIds.size === 0",
    );
  });

  test("runCashFlowAggregator has deal-scoped EBITDA fallback path", () => {
    assert.ok(
      AGG_SRC.includes('.eq("owner_type", "DEAL")'),
      "runCashFlowAggregator must fall back to deal-scoped EBITDA when entity-scoped is empty",
    );
  });

  test("runCashFlowAggregator has TAX_RETURN fallback when no EBITDA facts", () => {
    assert.ok(
      AGG_SRC.includes('.eq("fact_type", "TAX_RETURN")'),
      "runCashFlowAggregator must try TAX_RETURN facts as last-resort NCADS source",
    );
  });

  test("runCashFlowAggregator TAX_RETURN fallback prefers NET_INCOME over GROSS_RECEIPTS", () => {
    // The fallback must select NET_INCOME first
    const niIdx = AGG_SRC.indexOf("const niRow = (taxFallback");
    const grIdx = AGG_SRC.indexOf("const grRow = (taxFallback");
    assert.ok(niIdx > 0 && grIdx > 0, "Both niRow and grRow must be declared");
    assert.ok(niIdx < grIdx, "NET_INCOME lookup must come before GROSS_RECEIPTS");
  });
});
