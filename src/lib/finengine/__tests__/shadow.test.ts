import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compareProducers, type ShadowValue, type GoldenSetEntry } from "@/lib/finengine/shadow";

function v(p: Partial<ShadowValue> & { value: number | null }): ShadowValue {
  return {
    dealId: p.dealId ?? "deal-1",
    factKey: p.factKey ?? "DSCR",
    ownerType: p.ownerType ?? "DEAL",
    fiscalPeriodEnd: p.fiscalPeriodEnd ?? "2024-12-31",
    value: p.value,
  };
}

describe("compareProducers (§7 shadow reconciliation)", () => {
  it("classifies identical values as ZERO and does not block cutover", () => {
    const r = compareProducers([v({ value: 1.25 })], [v({ value: 1.25 })]);
    assert.equal(r.zero, 1);
    assert.equal(r.unexpected, 0);
    assert.equal(r.cutoverBlocked, false);
  });

  it("classifies an unregistered divergence as UNEXPECTED and blocks cutover", () => {
    const r = compareProducers([v({ value: 1.25 })], [v({ value: 2.0 })]);
    assert.equal(r.unexpected, 1);
    assert.equal(r.cutoverBlocked, true);
  });

  it("classifies a divergence matching the golden-set as INTENDED (allowed)", () => {
    const golden: GoldenSetEntry[] = [
      {
        dealId: "deal-1",
        factKey: "DSCR",
        expectedNewValue: 1.25,
        rationale: "OmniCare C-corp EBITDA base fix",
        spec: "SPEC-...-ELITE-1 Phase 2",
      },
    ];
    const r = compareProducers([v({ value: 7.12 })], [v({ value: 1.25 })], golden);
    assert.equal(r.intended, 1);
    assert.equal(r.unexpected, 0);
    assert.equal(r.cutoverBlocked, false);
    assert.match(r.divergences[0].note ?? "", /Phase 2/);
  });

  it("flags UNEXPECTED when a golden entry exists but the new value misses the expected", () => {
    const golden: GoldenSetEntry[] = [
      { dealId: "deal-1", factKey: "DSCR", expectedNewValue: 1.25, rationale: "x", spec: "y" },
    ];
    const r = compareProducers([v({ value: 7.12 })], [v({ value: 3.0 })], golden);
    assert.equal(r.unexpected, 1);
    assert.match(r.divergences[0].note ?? "", /does not match expected/);
  });
});
