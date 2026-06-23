/**
 * SPEC-CLEANUP-BATCH-1 — Guard tests (2026-05-18)
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGG_SRC = readFileSync(
  resolve(__dirname, "../runCashFlowAggregator.ts"), "utf-8",
);
const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../../app/api/deals/[dealId]/spread-output/route.ts"), "utf-8",
);

describe("SPEC-CLEANUP-BATCH-1 guards", () => {
  test("ncadsWarnings does not contain secondary ccorpCheck DB query", () => {
    // The old pattern had a second query after "C-Corp addback annotation"
    // Now we use in-memory ccorpTaxableUsed/ccorpOfficerUsed/ccorpDeprUsed
    assert.ok(
      !AGG_SRC.includes("ccorpCheck"),
      "Must not contain secondary ccorpCheck DB query — use in-memory values",
    );
  });

  test("ccorpTaxableUsed variable is defined before the addback block", () => {
    const varIdx = AGG_SRC.indexOf("let ccorpTaxableUsed");
    const addbackIdx = AGG_SRC.indexOf("selectBestFact(taxableFacts)");
    assert.ok(varIdx > 0, "ccorpTaxableUsed must be declared");
    assert.ok(varIdx < addbackIdx, "ccorpTaxableUsed must be declared before the addback");
  });

  test("spread-output route falls back to financial_snapshots DSCR", () => {
    assert.ok(
      ROUTE_SRC.includes("financial_snapshots") && ROUTE_SRC.includes("ratio_dscr_final"),
      "spread-output must fall back to snapshot DSCR when inline ratio is null",
    );
  });
});
