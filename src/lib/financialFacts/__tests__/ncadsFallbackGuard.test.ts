import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AGG_SRC = readFileSync(resolve(__dirname, "../runCashFlowAggregator.ts"), "utf-8");
const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts"),
  "utf-8",
);

describe("SPEC-NCADS-SUPERSEDED-FALLBACK-1 + OFFICER-COMP-ADDBACK-1 guards", () => {
  test("result type includes ncadsWarnings", () => {
    assert.ok(AGG_SRC.includes("ncadsWarnings: string[]"));
  });
  test("checks NET_INCOME = 0 warning", () => {
    assert.ok(AGG_SRC.includes('ncads === 0 && ncadsSource === "NET_INCOME"'));
  });
  test("ncadsWarnings in success return", () => {
    assert.ok(AGG_SRC.includes("ncadsWarnings,"));
  });
  test("snapshot route surfaces dscr_blocker", () => {
    assert.ok(ROUTE_SRC.includes("dscr_blocker"));
  });
  test("C-Corp addback checks TAXABLE_INCOME + OFFICER_COMPENSATION", () => {
    assert.ok(AGG_SRC.includes("TAXABLE_INCOME") && AGG_SRC.includes("OFFICER_COMPENSATION"));
  });
test("C-Corp addback requires resolution_status active", () => {
  assert.ok(
    AGG_SRC.includes('.neq("resolution_status", "rejected")') &&
      AGG_SRC.includes('.order("resolution_status", { ascending: true })'),
  );
});
  test("C-Corp addback excludes zero TAXABLE_INCOME", () => {
    assert.ok(AGG_SRC.includes("Number(r.fact_value_num) > 0"));
  });
  test("recompute route forwards ncadsWarnings", () => {
    assert.ok(ROUTE_SRC.includes("ncadsWarnings: aggregatorWarnings"));
  });
});
