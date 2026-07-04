/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 5 tests.
 *
 * Manufacturing (inventory-heavy), service (no inventory → graceful degrade),
 * and AR-heavy profiles, plus missing-data degradation and normalized FCF.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeCashConversion } from "@/lib/finengine/cashConversion";

describe("PR5 — manufacturing profile (full data)", () => {
  const cc = computeCashConversion({
    facts: {
      TOTAL_REVENUE: 12_000_000,
      COST_OF_GOODS_SOLD: 8_000_000,
      ACCOUNTS_RECEIVABLE: 1_500_000,
      INVENTORY: 2_000_000,
      ACCOUNTS_PAYABLE: 900_000,
    },
    operatingCashFlow: 1_400_000,
    capex: 500_000,
    ebitda: 1_800_000,
    cashTaxes: 300_000,
    deltaWorkingCapital: 200_000,
    netWorkingCapital: 2_600_000,
  });

  it("computes DSO/DPO/DIO in days", () => {
    assert.equal(cc.dso.value, Math.round((1_500_000 / 12_000_000) * 365)); // 46
    assert.equal(cc.dio.value, Math.round((2_000_000 / 8_000_000) * 365)); // 91
    assert.equal(cc.dpo.value, Math.round((900_000 / 8_000_000) * 365)); // 41
  });
  it("CCC = DSO + DIO - DPO", () => {
    assert.equal(cc.ccc.value, cc.dso.value! + cc.dio.value! - cc.dpo.value!);
  });
  it("operating + free cash conversion", () => {
    assert.equal(cc.operatingCashConversion.value, round2(1_400_000 / 1_800_000));
    assert.equal(cc.freeCashConversion.value, round2((1_400_000 - 500_000) / 1_800_000));
  });
  it("normalized FCF = EBITDA - capex - taxes - ΔWC", () => {
    assert.equal(cc.normalizedFcf.value, 1_800_000 - 500_000 - 300_000 - 200_000);
    assert.deepEqual(cc.warnings, []); // all inputs supplied
  });
  it("working capital velocity", () => {
    assert.equal(cc.workingCapitalVelocity.value, round2(12_000_000 / 2_600_000));
  });
});

describe("PR5 — service profile (no inventory) degrades gracefully", () => {
  const cc = computeCashConversion({
    facts: {
      TOTAL_REVENUE: 5_000_000,
      COST_OF_GOODS_SOLD: 1_200_000,
      ACCOUNTS_RECEIVABLE: 600_000,
      ACCOUNTS_PAYABLE: 200_000,
      // INVENTORY absent
    },
    operatingCashFlow: 700_000,
    ebitda: 900_000,
    capex: 100_000,
  });

  it("DSO/DPO still compute", () => {
    assert.ok(cc.dso.value! > 0);
    assert.ok(cc.dpo.value! > 0);
  });
  it("DIO / inventory turnover / CCC degrade to null with missing INVENTORY", () => {
    assert.equal(cc.dio.value, null);
    assert.ok(cc.dio.missingInputs.includes("INVENTORY"));
    assert.equal(cc.inventoryTurnover.value, null);
    assert.equal(cc.ccc.value, null);
  });
  it("normalized FCF warns on assumed-zero taxes and ΔWC", () => {
    assert.ok(cc.warnings.includes("normalized_fcf_assumed_zero_cash_taxes"));
    assert.ok(cc.warnings.includes("normalized_fcf_assumed_zero_delta_wc"));
    assert.equal(cc.normalizedFcf.value, 900_000 - 100_000);
  });
});

describe("PR5 — AR-heavy profile", () => {
  it("high AR drives high DSO", () => {
    const cc = computeCashConversion({
      facts: { TOTAL_REVENUE: 4_000_000, COST_OF_GOODS_SOLD: 2_000_000, ACCOUNTS_RECEIVABLE: 1_800_000, ACCOUNTS_PAYABLE: 100_000 },
    });
    assert.ok(cc.dso.value! > 120, `DSO ${cc.dso.value} should be high`);
  });
});

describe("PR5 — missing-data degradation (no false precision)", () => {
  it("returns null (not 0) when revenue is missing", () => {
    const cc = computeCashConversion({ facts: { ACCOUNTS_RECEIVABLE: 100_000 } });
    assert.equal(cc.dso.value, null);
    assert.ok(cc.dso.missingInputs.length > 0);
  });
  it("null EBITDA → conversion + normalized FCF null", () => {
    const cc = computeCashConversion({ facts: {}, operatingCashFlow: 100, capex: 10 });
    assert.equal(cc.operatingCashConversion.value, null);
    assert.equal(cc.normalizedFcf.value, null);
    assert.ok(cc.normalizedFcf.missingInputs.includes("EBITDA"));
  });
});

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
