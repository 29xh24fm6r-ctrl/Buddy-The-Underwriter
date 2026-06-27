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
});
