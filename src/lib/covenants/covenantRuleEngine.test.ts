/**
 * Phase 55 — Covenant Rule Engine Tests (Deterministic)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCovenantRuleEngine, type RuleEngineInput } from "./covenantRuleEngine";

const BASE: RuleEngineInput = {
  riskGrade: "BB",
  dealType: "operating_company",
  actualDscr: 1.35,
  actualLeverage: 2.5,
  actualDebtYield: null,
  actualOccupancy: null,
  actualGlobalCashFlow: null,
  loanAmount: 1000000,
};

describe("covenantRuleEngine", () => {
  it("produces all 4 covenant families", () => {
    const result = runCovenantRuleEngine(BASE);
    assert.ok(result.financial.length > 0);
    assert.ok(result.reporting.length > 0);
    assert.ok(result.behavioral.length > 0);
    assert.ok(result.springing.length > 0);
  });

  it("DSCR floor calibrates by risk grade", () => {
    const bbResult = runCovenantRuleEngine({ ...BASE, riskGrade: "BB" });
    const cccResult = runCovenantRuleEngine({ ...BASE, riskGrade: "CCC" });
    const bbDscr = bbResult.financial.find((c) => c.category === "dscr")!.threshold;
    const cccDscr = cccResult.financial.find((c) => c.category === "dscr")!.threshold;
    assert.ok(cccDscr > bbDscr, "CCC should have higher floor than BB");
  });

  it("tightens DSCR floor when actual DSCR is thin", () => {
    const thinDscr = runCovenantRuleEngine({ ...BASE, actualDscr: 1.25 });
    const comfyDscr = runCovenantRuleEngine({ ...BASE, actualDscr: 2.0 });
    const thin = thinDscr.financial.find((c) => c.category === "dscr")!.threshold;
    const comfy = comfyDscr.financial.find((c) => c.category === "dscr")!.threshold;
    assert.ok(thin > comfy, "Thin DSCR should produce tighter floor");
  });

  it("adds CRE-specific covenants for real_estate", () => {
    const result = runCovenantRuleEngine({ ...BASE, dealType: "real_estate" });
    assert.ok(result.financial.some((c) => c.category === "debt_yield"));
    assert.ok(result.financial.some((c) => c.category === "occupancy"));
  });

  it("omits CRE covenants for operating_company", () => {
    const result = runCovenantRuleEngine(BASE);
    assert.ok(!result.financial.some((c) => c.category === "debt_yield"));
    assert.ok(!result.financial.some((c) => c.category === "occupancy"));
  });

  it("adds speculative-grade reporting for non-investment grade", () => {
    const bbResult = runCovenantRuleEngine({ ...BASE, riskGrade: "BB" });
    const aaResult = runCovenantRuleEngine({ ...BASE, riskGrade: "AA" });
    assert.ok(bbResult.reporting.length > aaResult.reporting.length);
  });

  it("all covenants have source = rule_engine", () => {
    const result = runCovenantRuleEngine(BASE);
    for (const c of [...result.financial, ...result.reporting, ...result.behavioral]) {
      assert.equal(c.source, "rule_engine");
    }
  });

  it("deterministic: same input always produces same output", () => {
    const r1 = runCovenantRuleEngine(BASE);
    const r2 = runCovenantRuleEngine(BASE);
    assert.equal(r1.financial.length, r2.financial.length);
    assert.equal(
      r1.financial.find((c) => c.category === "dscr")!.threshold,
      r2.financial.find((c) => c.category === "dscr")!.threshold,
    );
  });

  it("springing DSCR trigger is below the floor", () => {
    const result = runCovenantRuleEngine(BASE);
    const floor = result.financial.find((c) => c.category === "dscr")!.threshold;
    const trigger = result.springing.find((c) => c.triggerMetric === "DSCR")!.triggerThreshold;
    assert.ok(trigger < floor, "Springing trigger must be below the floor");
  });
});
