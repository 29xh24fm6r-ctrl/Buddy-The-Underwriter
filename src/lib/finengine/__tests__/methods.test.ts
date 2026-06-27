import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  adjustedEbitdaMethod,
  sdeMethod,
  traditionalMethod,
  ucaMethod,
  creNoiMethod,
  reconcileMethods,
} from "@/lib/finengine/methods";
import { section179Acceleration } from "@/lib/finengine/methods/foundation";
import type { SpreadInputs } from "@/lib/finengine/contracts";

const noPolicy = () => {
  throw new Error("policy not used");
};

function inputs(facts: Record<string, number | null>, extra?: Partial<SpreadInputs>): SpreadInputs {
  return { facts, entityForm: extra?.entityForm ?? "UNKNOWN", formType: extra?.formType, fiscalPeriodEnd: "2024-12-31" };
}

describe("entity-form-aware EBITDA base (C-corp fix preserved)", () => {
  it("C-corp (TAXABLE_INCOME, no OBI) flows the waterfall — base is TAXABLE_INCOME, not crude fallback", () => {
    const r = traditionalMethod.compute(
      inputs({ TAXABLE_INCOME: 200_000, INTEREST_EXPENSE: 50_000, DEPRECIATION: 30_000 }),
      noPolicy,
    );
    assert.equal(r.base.key, "TAXABLE_INCOME");
    assert.equal(r.cashFlowAvailable, 200_000 + 50_000 + 30_000);
  });

  it("pass-through (OBI present) uses ORDINARY_BUSINESS_INCOME base unchanged", () => {
    const r = traditionalMethod.compute(
      inputs({ ORDINARY_BUSINESS_INCOME: 150_000, INTEREST_EXPENSE: 10_000, DEPRECIATION: 20_000 }),
      noPolicy,
    );
    assert.equal(r.base.key, "ORDINARY_BUSINESS_INCOME");
    assert.equal(r.cashFlowAvailable, 180_000);
  });
});

describe("§179 is NOT a full add-back (acceleration only)", () => {
  it("full §179 with no straight-line baseline is NOT added back", () => {
    const s = section179Acceleration({ SECTION_179_EXPENSE: 100_000 });
    assert.equal(s.amount, 0);
  });
  it("only acceleration above straight-line is added back", () => {
    const s = section179Acceleration({ SECTION_179_EXPENSE: 100_000, STRAIGHT_LINE_DEPRECIATION: 20_000 });
    assert.equal(s.amount, 80_000);
  });
  it("adjusted EBITDA does not balloon from full §179", () => {
    const base = { TAXABLE_INCOME: 100_000, INTEREST_EXPENSE: 0, DEPRECIATION: 0, SECTION_179_EXPENSE: 250_000, GROSS_RECEIPTS: 1_000_000 };
    const adj = adjustedEbitdaMethod.compute(inputs(base), noPolicy);
    // §179 not added back (no straight-line baseline) → adjusted == base (+0 owner comp here)
    assert.equal(adj.cashFlowAvailable, 100_000);
  });
});

describe("owner-comp: SDE vs Adjusted EBITDA differ by the replacement-manager salary", () => {
  const facts = {
    TAXABLE_INCOME: 300_000,
    INTEREST_EXPENSE: 0,
    DEPRECIATION: 0,
    OFFICER_COMPENSATION: 500_000, // 50% of revenue -> EXTREME_HIGH
    GROSS_RECEIPTS: 1_000_000,
  };

  it("over-paid owner: SDE adds full comp, Adjusted EBITDA adds only the excess; gap == market replacement salary", () => {
    const adj = adjustedEbitdaMethod.compute(inputs(facts), noPolicy);
    const sde = sdeMethod.compute(inputs(facts), noPolicy);
    // market rate = 10% of 1,000,000 = 100,000; excess = 400,000
    assert.equal(adj.cashFlowAvailable, 300_000 + 400_000);
    assert.equal(sde.cashFlowAvailable, 300_000 + 500_000);
    assert.equal((sde.cashFlowAvailable as number) - (adj.cashFlowAvailable as number), 100_000);
  });

  it("under-paid owner: Adjusted EBITDA DEDUCTS a market replacement salary", () => {
    const underpaid = { TAXABLE_INCOME: 300_000, INTEREST_EXPENSE: 0, DEPRECIATION: 0, OFFICER_COMPENSATION: 10_000, GROSS_RECEIPTS: 1_000_000 };
    const adj = adjustedEbitdaMethod.compute(inputs(underpaid), noPolicy);
    // market = 100,000; shortfall = 90,000 deducted
    assert.equal(adj.cashFlowAvailable, 300_000 - 90_000);
  });
});

describe("method reconciliation emits a conflict signal (no silent pick)", () => {
  it("flags conflict when methods diverge beyond tolerance", () => {
    const facts = {
      TAXABLE_INCOME: 300_000, INTEREST_EXPENSE: 0, DEPRECIATION: 0,
      OFFICER_COMPENSATION: 500_000, GROSS_RECEIPTS: 1_000_000,
    };
    const results = [adjustedEbitdaMethod.compute(inputs(facts), noPolicy), sdeMethod.compute(inputs(facts), noPolicy)];
    const rec = reconcileMethods(results);
    assert.equal(rec.status, "conflict");
    assert.ok((rec.relativeSpread ?? 0) > 0.01);
  });
  it("reconciled when methods agree", () => {
    const facts = { TAXABLE_INCOME: 300_000, INTEREST_EXPENSE: 0, DEPRECIATION: 0 };
    const results = [traditionalMethod.compute(inputs(facts), noPolicy), traditionalMethod.compute(inputs(facts), noPolicy)];
    assert.equal(reconcileMethods(results).status, "reconciled");
  });
});

describe("UCA + CRE NOI methods", () => {
  it("UCA traces net income + non-cash ± working-capital change", () => {
    const r = ucaMethod.compute(inputs({ NET_INCOME: 100_000, DEPRECIATION: 20_000, AR_CHANGE: 15_000, AP_CHANGE: 5_000 }), noPolicy);
    assert.equal(r.cashFlowAvailable, 100_000 + 20_000 - 15_000 + 5_000);
  });
  it("CRE NOI derives NOI from income − opex when NOI_TTM absent", () => {
    const r = creNoiMethod.compute(inputs({ TOTAL_INCOME_TTM: 500_000, OPEX_TTM: 200_000 }), noPolicy);
    assert.equal(r.cashFlowAvailable, 300_000);
  });
});
