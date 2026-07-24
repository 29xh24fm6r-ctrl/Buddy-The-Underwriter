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

  it("institutional overlay wins when no tenant override", () => {
    const r = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL" });
    assert.equal(r.institutionalOverlay, 1.2);
    assert.equal(r.effective, 1.2); // overlay above the 1.10 floor
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

  // SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 / SPEC-BROKERAGE-SBA-READY-V1: a
  // business ≤24mo old requires the SOP's stricter projected-DSCR standard
  // (1.25x) uniformly, regardless of 7(a) small/standard/504 product tier —
  // this is the single source of truth src/lib/sba/newBusinessProtocol.ts
  // now reads instead of hardcoding 1.25/1.10 locally.
  it("isNewBusiness overrides byProduct for dscr_floor (uniform 1.25x, not the product tier's own floor)", () => {
    const small = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL", isNewBusiness: true });
    assert.equal(small.effective, 1.25);
    assert.match(small.citation, /new business/i);

    const standard = resolvePolicy("dscr_floor", { productId: "SBA_7A_STANDARD", isNewBusiness: true });
    assert.equal(standard.effective, 1.25);
  });

  it("isNewBusiness=false (or unset) falls back to the normal byProduct resolution", () => {
    const r = resolvePolicy("dscr_floor", { productId: "SBA_7A_SMALL", isNewBusiness: false });
    assert.equal(r.effective, 1.2); // unchanged from the existing byProduct test above
  });

  it("isNewBusiness has no effect on an axis with no newBusiness variant (e.g. occupancy_min)", () => {
    const r = resolvePolicy("occupancy_min", { productId: "SBA_504", isNewBusiness: true });
    assert.equal(r.effective, 0.51); // unchanged — occupancy_min defines no newBusiness override
  });

  it("a new-business tenant override still wins over the new-business floor (precedence unchanged)", () => {
    const r = resolvePolicy("dscr_floor", { isNewBusiness: true, overrides: { dscr_floor: 1.4 } });
    assert.equal(r.effective, 1.4);
  });
});
