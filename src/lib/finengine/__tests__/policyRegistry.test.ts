import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolvePolicy,
  listPolicyAxes,
  getStressParams,
  POLICY_REGISTRY_VERSION,
} from "@/lib/finengine/policyRegistry";

describe("policyRegistry — resolution precedence (V1.1)", () => {
  it("tenant override wins over overlay and floor", () => {
    const r = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL", overrides: { dscr_floor: 1.35 } });
    assert.equal(r.tenantOverride, 1.35);
    assert.equal(r.effective, 1.35);
  });

  it("institutional overlay wins when no tenant override (non-SBA product)", () => {
    // CI_TERM is institutional territory: no regulatory floor, 1.25 overlay.
    const r = resolvePolicy("dscr_floor", { productId: "CI_TERM" });
    assert.equal(r.institutionalOverlay, 1.25);
    assert.equal(r.effective, 1.25);
  });

  // 2026-09-01 SOP alignment: Buddy underwrites SBA deals to the SBA's own
  // published floor. An overlay above the SOP fails deals the SBA would
  // accept, and produced fabricated "below policy minimum" exceptions in
  // shipped memos.
  it("SBA products carry NO institutional overlay — the SOP floor is the effective value", () => {
    const small = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL" });
    assert.equal(small.institutionalOverlay, null);
    assert.equal(small.effective, 1.1, "7(a) Small (≤$350K) — SOP 50 10 8 + Mar-2026 notices: 1.10x");
    assert.match(small.citation, /5000-875701/);

    const standard = resolvePolicy("dscr_floor", { productId: "SBA_7A_STANDARD" });
    assert.equal(standard.institutionalOverlay, null);
    assert.equal(standard.effective, 1.15, "Standard 7(a) — SOP 50 10 8: 1.15x");

    const cdc = resolvePolicy("dscr_floor", { productId: "SBA_504" });
    assert.equal(cdc.effective, 1.15, "504 — project-level coverage 1.15x");
  });

  it("with no product resolved, the default is the Standard 7(a) SOP floor", () => {
    const r = resolvePolicy("dscr_floor");
    assert.equal(r.effective, 1.15);
    assert.match(r.citation, /SOP 50 10 8/);
  });

  it("falls back to the regulatory floor when no overlay/override", () => {
    const r = resolvePolicy("occupancy_min", { productId: "SBA_504" });
    assert.equal(r.regulatoryFloor, 0.51);
    assert.equal(r.effective, 0.51);
  });

  it("product-specific floors apply (504 new construction occupancy 0.60)", () => {
    const r = resolvePolicy("occupancy_min", { productId: "SBA_504_NEW_CONSTRUCTION" });
    assert.equal(r.effective, 0.6);
  });

  it("conservative clamp: a 'floor' axis can be raised but never lowered below the regulator", () => {
    // Try to weaken DSCR below the SBA standard floor of 1.15 — clamp holds at 1.15.
    const r = resolvePolicy("dscr_floor", { productId: "SBA_7A_STANDARD", overrides: { dscr_floor: 1.0 } });
    assert.equal(r.regulatoryFloor, 1.15);
    assert.equal(r.effective, 1.15, "override below the floor must clamp up to the floor");
  });

  it("conservative clamp: a 'cap' axis can be tightened but never loosened above the regulator", () => {
    // ltv_max has no regulatory cap, so override applies directly (tightening).
    const tighten = resolvePolicy("ltv_max", { overrides: { ltv_max: 0.65 } });
    assert.equal(tighten.effective, 0.65);
  });

  it("every seeded axis carries version, citation and asOf", () => {
    for (const axis of listPolicyAxes()) {
      const r = resolvePolicy(axis);
      assert.equal(r.version, POLICY_REGISTRY_VERSION, `${axis} version`);
      assert.ok(r.citation && r.citation.length > 5, `${axis} citation`);
      assert.match(r.asOf, /^\d{4}-\d{2}-\d{2}$/, `${axis} asOf`);
    }
  });

  it("throws on an unknown axis (fail loud, never silent default)", () => {
    assert.throws(() => resolvePolicy("nonexistent_axis"), /unknown policy axis/);
  });

  it("stress params bundle resolves rate/revenue/dscr-min", () => {
    const s = getStressParams();
    assert.equal(s.rateBps, 300);
    assert.equal(s.revenueCompression, 0.15);
    assert.equal(s.dscrMin, 1.0);
  });

  it("seeds at least the spec-required axes", () => {
    const axes = new Set(listPolicyAxes());
    for (const required of ["dscr_floor", "leverage_max", "advance_rate_ar", "occupancy_min", "equity_injection_min"]) {
      assert.ok(axes.has(required), `missing axis ${required}`);
    }
  });

  // 2026-09-01 SOP alignment: the prior uniform 1.25x "new business projected
  // DSCR" variant cited SOP 50 10 8 §B Ch.1; verification against the
  // published SOP found no such standard. A startup carries its product's own
  // floor (projections permitted) — the startup-specific SOP rule is the 10%
  // equity injection, not an elevated coverage bar. The genuine upcoming
  // 1.25x (SOP 50 10 8.1 Appendix 15) applies to change-of-ownership deals
  // only, on a historical basis, for loan numbers issued 2026-10-01+ — a
  // startup is not a change of ownership.
  it("isNewBusiness does NOT elevate the DSCR floor — the product's SOP floor governs", () => {
    const small = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL", isNewBusiness: true });
    assert.equal(small.effective, 1.1, "a small 7(a) startup is governed at 1.10x, not a fabricated 1.25x");

    const standard = resolvePolicy("dscr_floor", { productId: "SBA_7A_STANDARD", isNewBusiness: true });
    assert.equal(standard.effective, 1.15, "a standard 7(a) startup is governed at 1.15x");
  });

  it("isNewBusiness=false (or unset) resolves identically", () => {
    const r = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL", isNewBusiness: false });
    assert.equal(r.effective, 1.1);
  });

  it("isNewBusiness has no effect on an axis with no newBusiness variant (e.g. occupancy_min)", () => {
    const r = resolvePolicy("occupancy_min", { productId: "SBA_504", isNewBusiness: true });
    assert.equal(r.effective, 0.51); // unchanged — occupancy_min defines no newBusiness override
  });

  it("a new-business tenant override still wins (precedence unchanged)", () => {
    const r = resolvePolicy("dscr_floor", { isNewBusiness: true, overrides: { dscr_floor: 1.4 } });
    assert.equal(r.effective, 1.4);
  });
});
