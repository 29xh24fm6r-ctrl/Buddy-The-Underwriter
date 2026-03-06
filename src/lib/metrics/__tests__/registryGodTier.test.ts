import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { METRIC_REGISTRY, METRIC_REGISTRY_VERSION } from "../registry";

describe("God Tier Ratio Metrics", () => {
  const GOD_TIER_IDS = [
    "DSO",
    "DIO",
    "DPO",
    "CCC",
    "AR_TURNOVER",
    "INVENTORY_TURNOVER",
    "FIXED_ASSET_TURNOVER",
    "DEBT_TO_EBITDA",
    "SENIOR_DEBT_TO_EBITDA",
    "TANGIBLE_NET_WORTH",
    "LIABILITIES_TO_TNW",
    "NET_DEBT",
    "CASH_RATIO",
    "DAYS_CASH_ON_HAND",
    "WORKING_CAPITAL_TURNOVER",
    "REVENUE_GROWTH_PCT",
    "EBITDA_GROWTH_PCT",
  ];

  it("all 17 God Tier metrics exist in registry", () => {
    for (const id of GOD_TIER_IDS) {
      assert.ok(METRIC_REGISTRY[id], `Missing metric: ${id}`);
    }
  });

  it("every metric has required fields", () => {
    for (const id of GOD_TIER_IDS) {
      const m = METRIC_REGISTRY[id];
      assert.equal(m.id, id);
      assert.ok(m.label.length > 0, `${id} label is empty`);
      assert.ok(m.expr.length > 0, `${id} expr is empty`);
      assert.ok(typeof m.precision === "number", `${id} precision not a number`);
      assert.ok(Array.isArray(m.requiredFacts), `${id} requiredFacts not array`);
      assert.ok(Array.isArray(m.applicableTo), `${id} applicableTo not array`);
      assert.ok(m.version >= 1, `${id} version < 1`);
    }
  });

  it("DSO uses correct formula", () => {
    assert.equal(
      METRIC_REGISTRY.DSO.expr,
      "ACCOUNTS_RECEIVABLE / TOTAL_REVENUE * 365"
    );
  });

  it("CCC composes from DSO + DIO - DPO", () => {
    assert.equal(METRIC_REGISTRY.CCC.expr, "DSO + DIO - DPO");
  });

  it("Tangible Net Worth subtracts intangibles", () => {
    assert.equal(
      METRIC_REGISTRY.TANGIBLE_NET_WORTH.expr,
      "NET_WORTH - INTANGIBLES_NET"
    );
  });

  it("growth metrics are percent type", () => {
    assert.equal(METRIC_REGISTRY.REVENUE_GROWTH_PCT.isPercent, true);
    assert.equal(METRIC_REGISTRY.EBITDA_GROWTH_PCT.isPercent, true);
  });

  it("registry version bumped to 4", () => {
    assert.equal(METRIC_REGISTRY_VERSION, 4);
  });

  it("total registry has at least 62 metrics (45 existing + 17 new)", () => {
    const count = Object.keys(METRIC_REGISTRY).length;
    assert.ok(count >= 62, `Only ${count} metrics in registry`);
  });
});
