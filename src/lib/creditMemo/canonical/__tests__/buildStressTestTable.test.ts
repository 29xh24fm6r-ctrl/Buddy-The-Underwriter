import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStressTestTable } from "../buildStressTestTable";

describe("buildStressTestTable governed evidence contract", () => {
  it("uses the resolved policy floor and labels EBITDA cushion accurately", () => {
    const result = buildStressTestTable({
      ebitda: 360_000,
      annualDebtService: 150_000,
      revenue: 2_400_000,
      grossMargin: 0.45,
      dscrFloor: 1.2,
      policyCitation: "governed test policy",
      inputsCertified: true,
    });

    assert.equal(result.policy_dscr_floor, 1.2);
    assert.equal(result.breakeven_ebitda_125x, 180_000);
    assert.equal(result.ebitda_cushion_pct, 50);
    assert.equal(result.revenue_cushion_pct, null);
    assert.match(result.narrative, /EBITDA can decline/);
    assert.doesNotMatch(result.narrative, /Revenue/);
  });

  it("withholds all quantitative stress claims when inputs are not governed", () => {
    const result = buildStressTestTable({
      ebitda: 360_000,
      annualDebtService: 150_000,
      revenue: 2_400_000,
      grossMargin: 0.45,
      dscrFloor: 1.2,
      inputsCertified: false,
    });

    assert.equal(result.baseline_dscr, null);
    assert.equal(result.worst_case_dscr, null);
    assert.equal(result.scenarios.every((row) => row.assessment === "N/A"), true);
    assert.match(result.narrative, /withheld/);
  });
});
