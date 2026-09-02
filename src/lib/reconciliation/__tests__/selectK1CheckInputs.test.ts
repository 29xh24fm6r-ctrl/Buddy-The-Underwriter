import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectK1CheckInputs } from "../selectK1CheckInputs";

describe("selectK1CheckInputs", () => {
  it("compares OBI and K-1 income from the same, latest year", () => {
    const periodFacts = new Map<string, Record<string, number | null>>([
      ["2024", { ORDINARY_BUSINESS_INCOME: 178_938, K1_ORDINARY_INCOME: 178_938, K1_OWNERSHIP_PCT: 100 }],
      ["2025", { ORDINARY_BUSINESS_INCOME: 133_679, K1_ORDINARY_INCOME: 133_679, K1_OWNERSHIP_PCT: 100 }],
      ["unknown", { K1_ORDINARY_INCOME: 999 }],
    ]);
    // The flat map happens to hold the 2024 K-1 (arbitrary row order).
    const allFacts = { ORDINARY_BUSINESS_INCOME: 133_679, K1_ORDINARY_INCOME: 178_938, K1_OWNERSHIP_PCT: 100 };
    const r = selectK1CheckInputs(periodFacts, allFacts);
    assert.equal(r.year, "2025");
    assert.equal(r.entityObi, 133_679);
    assert.equal(r.k1Income, 133_679);
    assert.equal(r.k1Pct, 100);
  });

  it("skips a newer year that has no entity OBI (interim statements)", () => {
    const periodFacts = new Map<string, Record<string, number | null>>([
      ["2026", { NET_INCOME: 35_746 }],
      ["2025", { ORDINARY_BUSINESS_INCOME: 133_679, K1_ORDINARY_INCOME: 133_679 }],
    ]);
    const r = selectK1CheckInputs(periodFacts, { ORDINARY_BUSINESS_INCOME: 133_679, K1_ORDINARY_INCOME: 133_679, K1_OWNERSHIP_PCT: 100 });
    assert.equal(r.year, "2025");
    assert.equal(r.k1Income, 133_679);
    // Ownership pct not present for that year → cross-period fallback.
    assert.equal(r.k1Pct, 100);
  });

  it("falls back to the cross-period map when no year carries an OBI", () => {
    const r = selectK1CheckInputs(new Map(), { ORDINARY_BUSINESS_INCOME: 10, K1_ORDINARY_INCOME: 10, K1_OWNERSHIP_PCT: null });
    assert.equal(r.year, null);
    assert.equal(r.entityObi, 10);
    assert.equal(r.k1Income, 10);
    assert.equal(r.k1Pct, null);
  });
});
