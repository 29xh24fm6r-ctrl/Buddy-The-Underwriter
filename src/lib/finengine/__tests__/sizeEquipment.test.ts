/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream A: equipment sizing.
 *
 * NEW equipment advances against invoice cost; USED against NOLV. A separate
 * useful-life term gate flags when the proposed term outruns the asset's life.
 * Registry-driven rates (advance_rate_equipment_new/_used_nolv, term_to_useful_life_max).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sizeEquipment } from "@/lib/finengine/sizing";

describe("Workstream A — sizeEquipment", () => {
  it("new equipment binds on cost × advance rate (80% default)", () => {
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: true });
    assert.equal(r.maxLoan, 80_000);
    assert.equal(r.bindingConstraint?.name, "EQUIP_COST_ADVANCE");
  });

  it("used equipment binds on NOLV × advance rate (80% default)", () => {
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: false, nolv: 60_000 });
    assert.equal(r.maxLoan, 48_000);
    assert.equal(r.bindingConstraint?.name, "EQUIP_NOLV_ADVANCE");
  });

  it("used equipment with no NOLV is null-safe (cannot size — flags the missing input)", () => {
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: false });
    assert.equal(r.maxLoan, null);
    assert.equal(r.bindingConstraint, null);
    assert.match(r.constraints[0].note, /requires NOLV/);
  });

  it("zero cost is null-safe", () => {
    const r = sizeEquipment({ equipmentCost: 0, isNew: true });
    assert.equal(r.maxLoan, null);
  });

  it("useful-life term gate fires when term outruns the asset (term > 80% of useful life)", () => {
    // 10y life × 0.80 = 8y max term; a 9y term exceeds it.
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: true, usefulLifeYears: 10, proposedTermYears: 9 });
    assert.equal(r.termExceedsUsefulLife, true);
    assert.match(r.termNote, /EXCEEDS/);
  });

  it("useful-life term gate passes when term is within the asset's life", () => {
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: true, usefulLifeYears: 10, proposedTermYears: 7 });
    assert.equal(r.termExceedsUsefulLife, false);
    assert.match(r.termNote, /within/);
  });

  it("term gate is skipped (null) when useful life or term is absent — sizing still works", () => {
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: true });
    assert.equal(r.termExceedsUsefulLife, null);
    assert.equal(r.maxLoan, 80_000); // sizing unaffected by the missing term check
    assert.match(r.termNote, /skipped/);
  });

  it("honors a tenant override on the advance rate (registry, not hardcoded)", () => {
    const r = sizeEquipment({ equipmentCost: 100_000, isNew: true, ctx: { overrides: { advance_rate_equipment_new: 0.7 } } });
    assert.equal(r.maxLoan, 70_000);
  });
});
