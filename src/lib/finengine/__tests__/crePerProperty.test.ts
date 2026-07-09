/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream C — per-property CRE tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computePerPropertyCre, type PropertyInput } from "@/lib/finengine/methods/crePerProperty";

const approx = (a: number | null, b: number, t = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= t, `${a} ≈ ${b}`);

describe("Workstream C — per-property CRE metrics + most-restrictive aggregation", () => {
  // Strong property: low LTV, high DSCR. Weak property: high LTV, thin DSCR.
  const strong: PropertyInput = { id: "A", label: "Strong tower", value: 5_000_000, loanAllocation: 3_000_000, noi: 400_000, annualDebtService: 220_000 };
  const weak: PropertyInput = { id: "B", label: "Weak strip mall", value: 2_000_000, loanAllocation: 1_700_000, noi: 130_000, annualDebtService: 125_000, lienPosition: 2 };

  it("computes per-property LTV / DSCR / debt-yield / cap-rate", () => {
    const r = computePerPropertyCre([strong, weak]);
    const a = r.properties.find((p) => p.id === "A")!;
    approx(a.ltv, 3_000_000 / 5_000_000); // 0.60
    approx(a.dscr, 400_000 / 220_000); // 1.82
    approx(a.debtYield, 400_000 / 3_000_000); // 0.133
    approx(a.capRate, 400_000 / 5_000_000); // 0.08
    const b = r.properties.find((p) => p.id === "B")!;
    approx(b.ltv, 1_700_000 / 2_000_000); // 0.85
    approx(b.dscr, 130_000 / 125_000); // 1.04
  });

  it("binds to the weakest property (highest LTV, lowest DSCR), not the blend", () => {
    const r = computePerPropertyCre([strong, weak]);
    assert.equal(r.binding.ltv?.id, "B"); // 0.85 is the highest LTV
    assert.equal(r.binding.dscr?.id, "B"); // 1.04 is the lowest DSCR
    assert.equal(r.weakestProperty, "B");
    // the blended LTV (4.7M/7M ≈ 0.67) would hide the weak property's 0.85
    approx(r.portfolio.blendedLtv, 4_700_000 / 7_000_000);
  });

  it("flags the registry breaches on the weak property (LTV>cap, DSCR<floor, junior lien)", () => {
    const r = computePerPropertyCre([strong, weak]);
    assert.ok(r.flags.some((f) => /Weak strip mall.*LTV/.test(f)));
    assert.ok(r.flags.some((f) => /Weak strip mall.*DSCR/.test(f)));
    assert.ok(r.flags.some((f) => /junior lien/.test(f)));
    // the strong property triggers no flags
    assert.ok(!r.flags.some((f) => /Strong tower/.test(f)));
  });

  it("degrades gracefully when per-property NOI is absent (value metrics still compute)", () => {
    const noNoi: PropertyInput = { id: "C", value: 3_000_000, loanAllocation: 2_000_000 };
    const r = computePerPropertyCre([noNoi]);
    const c = r.properties[0];
    approx(c.ltv, 2_000_000 / 3_000_000); // LTV still computes from value
    assert.equal(c.dscr, null); // no NOI ⇒ no DSCR
    assert.equal(c.debtYield, null);
    assert.equal(r.portfolio.totalNoi, null); // unknown when any property's NOI is missing
  });

  it("Tier-7: per-property LTV includes senior liens ahead of a junior loan", () => {
    // 2nd-lien loan of 500k behind a 1M senior on a 2M property: true exposure
    // LTV = (1M senior + 500k) / 2M = 0.75, NOT 500k/2M = 0.25.
    const junior: PropertyInput = { id: "J", value: 2_000_000, loanAllocation: 500_000, lienPosition: 2, seniorLienBalance: 1_000_000 };
    const r = computePerPropertyCre([junior]);
    approx(r.properties[0].ltv, (1_000_000 + 500_000) / 2_000_000); // 0.75, not 0.25
    assert.ok(r.flags.some((f) => /junior lien.*senior debt/.test(f)));
    // blended LTV also reflects the senior lien: (500k loan + 1M senior) / 2M.
    approx(r.portfolio.blendedLtv, 1_500_000 / 2_000_000);
  });

  it("Tier-7: a junior lien with no senior balance is flagged as understating leverage", () => {
    const junior: PropertyInput = { id: "J", value: 2_000_000, loanAllocation: 500_000, lienPosition: 2 };
    const r = computePerPropertyCre([junior]);
    // LTV falls back to our own loan only, but the gap is surfaced loudly.
    approx(r.properties[0].ltv, 500_000 / 2_000_000);
    assert.ok(r.flags.some((f) => /senior lien balance not provided.*UNDERSTATES/.test(f)));
  });

  it("Tier-7: missing per-property debt service does NOT inflate blended DSCR", () => {
    // Property B has NOI but no debt service. The old code summed debt service
    // with ??0, shrinking the denominator and overstating blended DSCR.
    const a: PropertyInput = { id: "A", value: 5_000_000, loanAllocation: 3_000_000, noi: 400_000, annualDebtService: 220_000 };
    const bNoDs: PropertyInput = { id: "B", value: 2_000_000, loanAllocation: 1_700_000, noi: 130_000 };
    const r = computePerPropertyCre([a, bNoDs]);
    assert.equal(r.portfolio.blendedDscr, null); // not computable, never overstated
    assert.ok(r.flags.some((f) => /Blended DSCR not computed/.test(f)));
    assert.ok(r.flags.some((f) => /debt service not modeled/.test(f)));
    // per-property DSCR still binds to the one property that has debt service.
    assert.equal(r.binding.dscr?.id, "A");
  });

  it("a tenant LTV-cap override changes the breach flags (registry-driven, NG4)", () => {
    // strong property LTV 0.60 — clean at the default 0.75 cap…
    assert.ok(!computePerPropertyCre([strong]).flags.some((f) => /Strong tower.*LTV/.test(f)));
    // …but flagged once the tenant tightens the cap to 0.55.
    const r = computePerPropertyCre([strong], { overrides: { ltv_max: 0.55 } });
    assert.ok(r.flags.some((f) => /Strong tower.*LTV/.test(f)));
  });
});
