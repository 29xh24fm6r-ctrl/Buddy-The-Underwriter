import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyEntityTaxForm, ownerCompTreatment, toEngineFormType } from "../entityTaxForm";

/**
 * SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 2 (PR-518) — entity-aware
 * owner-compensation normalization across 1120 / 1120S / 1065 / Schedule C / LLC.
 */

describe("classifyEntityTaxForm (form/LLC-classification driven)", () => {
  it("Schedule C net profit → SOLE_PROP (incl. single-member LLC)", () => {
    assert.equal(classifyEntityTaxForm({ SCH_C_NET_PROFIT: 120_000 }), "SOLE_PROP");
    assert.equal(classifyEntityTaxForm({ SCHEDULE_C_NET_PROFIT: 120_000 }), "SOLE_PROP");
  });
  it("guaranteed payments → PARTNERSHIP (incl. LLC-as-partnership)", () => {
    assert.equal(classifyEntityTaxForm({ GUARANTEED_PAYMENTS: 80_000, ORDINARY_BUSINESS_INCOME: 200_000 }), "PARTNERSHIP");
  });
  it("ordinary business income (no GP) → S_CORP (incl. LLC-as-S-corp)", () => {
    assert.equal(classifyEntityTaxForm({ ORDINARY_BUSINESS_INCOME: 300_000, OFFICER_COMPENSATION: 120_000 }), "S_CORP");
  });
  it("taxable income, no OBI/GP → C_CORP", () => {
    assert.equal(classifyEntityTaxForm({ TAXABLE_INCOME: 200_000, OFFICER_COMPENSATION: 310_000 }), "C_CORP");
  });
  it("no signature → UNKNOWN", () => {
    assert.equal(classifyEntityTaxForm({ DEPRECIATION: 10_000 }), "UNKNOWN");
  });
  it("maps to the coarse engine form string", () => {
    assert.equal(toEngineFormType("PARTNERSHIP"), "FORM_1065");
    assert.equal(toEngineFormType("C_CORP"), "FORM_1120");
    assert.equal(toEngineFormType("S_CORP"), "FORM_1120");
  });
});

describe("ownerCompTreatment never adds back 100% by default", () => {
  it("C-corp: reasonable officer comp (within market) → no add-back", () => {
    const t = ownerCompTreatment({ TAXABLE_INCOME: 200_000, OFFICER_COMPENSATION: 20_000, GROSS_RECEIPTS: 100_000 }, "C_CORP");
    assert.equal(t.addback, 0);
    assert.match(t.note, /within market range/i);
  });
  it("C-corp: excessive officer comp → excess only, NOT the full amount", () => {
    const t = ownerCompTreatment({ TAXABLE_INCOME: 50_000, OFFICER_COMPENSATION: 60_000, GROSS_RECEIPTS: 100_000 }, "C_CORP");
    assert.ok(t.addback > 0, "some excess added back");
    assert.ok(t.addback < 60_000, "less than 100% of officer comp");
    assert.equal(t.addback, 60_000 - 10_000); // excess over 10% market rate
    assert.match(t.note, /replacement compensation/i);
  });
  it("OmniCare-shaped C-corp ($310k officer) is NOT fully added back", () => {
    const t = ownerCompTreatment({ TAXABLE_INCOME: 200_925, OFFICER_COMPENSATION: 310_000, GROSS_RECEIPTS: 4_000_000 }, "C_CORP");
    // 310k is < 40% of $4M revenue → within range → no add-back at all (certainly not 100%).
    assert.notEqual(t.addback, 310_000);
  });
});

describe("form-specific owner-comp treatment", () => {
  it("sole prop (Schedule C): net profit is the owner return — no add-back, not payroll", () => {
    const t = ownerCompTreatment({ SCH_C_NET_PROFIT: 150_000, OFFICER_COMPENSATION: 999_999 }, "SOLE_PROP");
    assert.equal(t.addback, 0);
    assert.match(t.note, /not payroll|owner's return/i);
  });
  it("partnership: guaranteed payments normalized as owner comp (excess only)", () => {
    const t = ownerCompTreatment({ GUARANTEED_PAYMENTS: 60_000, GROSS_RECEIPTS: 100_000 }, "PARTNERSHIP");
    assert.ok(t.addback > 0 && t.addback < 60_000);
    assert.match(t.note, /guaranteed payments/i);
  });
  it("S-corp: W-2 wages normalized + K-1 not double-counted at entity", () => {
    const t = ownerCompTreatment({ ORDINARY_BUSINESS_INCOME: 50_000, OFFICER_COMPENSATION: 60_000, GROSS_RECEIPTS: 100_000 }, "S_CORP");
    assert.ok(t.addback < 60_000);
    assert.match(t.note, /K-1.*not double-counted/i);
    assert.match(t.note, /owner W-2 wages/i);
  });
  it("no_normalization slate → no add-back regardless of form", () => {
    const slate = { officer_comp: "no_normalization" } as any;
    const t = ownerCompTreatment({ TAXABLE_INCOME: 50_000, OFFICER_COMPENSATION: 60_000, GROSS_RECEIPTS: 100_000 }, "C_CORP", slate);
    assert.equal(t.addback, 0);
  });
});
