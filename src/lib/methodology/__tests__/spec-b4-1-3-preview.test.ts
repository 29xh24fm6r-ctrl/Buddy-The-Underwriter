/**
 * SPEC-B4.1.3 — Projection preview tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { projectDscrForVariant } from "@/lib/methodology/projectDscrForVariant";
import type { MethodologySlate } from "@/lib/methodology/types";

function defaultSlate(): MethodologySlate {
  return {
    ncads_source: "standard",
    ebitda_addback_stack: "standard",
    officer_comp: "standard",
    affiliate_ownership: "standard",
    living_expense: "standard",
  };
}

function baseFacts(): Record<string, number | null> {
  return {
    ORDINARY_BUSINESS_INCOME: 500_000,
    INTEREST_EXPENSE: 20_000,
    DEPRECIATION: 30_000,
    AMORTIZATION: 0,
    SECTION_179_EXPENSE: 15_000,
    BONUS_DEPRECIATION: 10_000,
    NON_RECURRING_EXPENSE: 5_000,
    NON_RECURRING_INCOME: 0,
    GUARANTEED_PAYMENTS: 0,
    COST_OF_GOODS_SOLD: 200_000,
    OFFICER_COMPENSATION: 200_000,
    GROSS_RECEIPTS: 1_000_000,
    NET_INCOME: 480_000,
  };
}

test("[b4-1-3-v1] projectDscrForVariant returns expected shape", () => {
  const result = projectDscrForVariant({
    facts: baseFacts(),
    formType: "FORM_1120",
    currentSlate: defaultSlate(),
    override: null,
    proposedAds: 400_000,
  });
  assert.ok(typeof result.projectedDscr === "number" || result.projectedDscr === null);
  assert.ok(typeof result.projectedNcads === "number" || result.projectedNcads === null);
  assert.ok(typeof result.projectedEbitda === "number" || result.projectedEbitda === null);
  assert.ok(typeof result.projectedOfficerCompAddback === "number");
  assert.ok(typeof result.components === "string");
  assert.ok(result.effectiveSlate);
});

test("[b4-1-3-v2] override replaces the chosen axis variant in effectiveSlate", () => {
  const result = projectDscrForVariant({
    facts: baseFacts(),
    formType: "FORM_1120",
    currentSlate: defaultSlate(),
    override: { axis: "ebitda_addback_stack", variant: "conservative" },
    proposedAds: 400_000,
  });
  assert.equal(result.effectiveSlate.ebitda_addback_stack, "conservative");
  assert.equal(result.effectiveSlate.ncads_source, "standard");
  assert.equal(result.effectiveSlate.officer_comp, "standard");
});

test("[b4-1-3-v3] Axis 2 conservative produces lower DSCR than standard", () => {
  const facts = baseFacts();
  const ads = 400_000;
  const standard = projectDscrForVariant({
    facts, formType: "FORM_1120", currentSlate: defaultSlate(),
    override: { axis: "ebitda_addback_stack", variant: "standard" },
    proposedAds: ads,
  });
  const conservative = projectDscrForVariant({
    facts, formType: "FORM_1120", currentSlate: defaultSlate(),
    override: { axis: "ebitda_addback_stack", variant: "conservative" },
    proposedAds: ads,
  });
  assert.ok(
    conservative.projectedDscr! < standard.projectedDscr!,
    `Conservative DSCR (${conservative.projectedDscr}) must be < standard (${standard.projectedDscr})`,
  );
  assert.ok(conservative.projectedEbitda! < standard.projectedEbitda!);
});

test("[b4-1-3-v4] Axis 3 no_normalization → zero officer-comp addback", () => {
  const result = projectDscrForVariant({
    facts: baseFacts(),
    formType: "FORM_1120",
    currentSlate: defaultSlate(),
    override: { axis: "officer_comp", variant: "no_normalization" },
    proposedAds: 400_000,
  });
  assert.equal(result.projectedOfficerCompAddback, 0);
});

test("[b4-1-3-v5] Axis 3 conservative addback < standard for EXTREME_HIGH comp", () => {
  const highCompFacts = { ...baseFacts(), OFFICER_COMPENSATION: 500_000 };
  const ads = 400_000;
  const standard = projectDscrForVariant({
    facts: highCompFacts, formType: "FORM_1120", currentSlate: defaultSlate(),
    override: { axis: "officer_comp", variant: "standard" },
    proposedAds: ads,
  });
  const conservative = projectDscrForVariant({
    facts: highCompFacts, formType: "FORM_1120", currentSlate: defaultSlate(),
    override: { axis: "officer_comp", variant: "conservative" },
    proposedAds: ads,
  });
  assert.ok(
    conservative.projectedOfficerCompAddback < standard.projectedOfficerCompAddback,
    `Conservative addback (${conservative.projectedOfficerCompAddback}) must be < standard (${standard.projectedOfficerCompAddback})`,
  );
});

test("[b4-1-3-v6] Axis 1 conservative uses NET_INCOME as NCADS", () => {
  const facts = baseFacts();
  const result = projectDscrForVariant({
    facts, formType: "FORM_1120", currentSlate: defaultSlate(),
    override: { axis: "ncads_source", variant: "conservative" },
    proposedAds: 400_000,
  });
  assert.equal(result.projectedNcads, facts.NET_INCOME);
});

test("[b4-1-3-v7] Axis 1 tax_return_basis uses OBI as NCADS", () => {
  const facts = baseFacts();
  const result = projectDscrForVariant({
    facts, formType: "FORM_1120", currentSlate: defaultSlate(),
    override: { axis: "ncads_source", variant: "tax_return_basis" },
    proposedAds: 400_000,
  });
  assert.equal(result.projectedNcads, facts.ORDINARY_BUSINESS_INCOME);
});

test("[b4-1-3-v8] override=null preserves currentSlate", () => {
  const slate = defaultSlate();
  const result = projectDscrForVariant({
    facts: baseFacts(), formType: "FORM_1120", currentSlate: slate,
    override: null, proposedAds: 400_000,
  });
  assert.deepEqual(result.effectiveSlate, slate);
});

test("[b4-1-3-v9] proposedAds=0 returns null DSCR gracefully", () => {
  const result = projectDscrForVariant({
    facts: baseFacts(), formType: "FORM_1120", currentSlate: defaultSlate(),
    override: null, proposedAds: 0,
  });
  assert.equal(result.projectedDscr, null);
});

// ── SPEC-B4.1.4 — conditional officer-comp fold-in at the projection layer ──

test("[b4-1-3-v10] (SPEC-B4.1.4) standard ebitda_addback_stack does NOT fold officer-comp into NCADS", () => {
  const highCompFacts = { ...baseFacts(), OFFICER_COMPENSATION: 500_000 };
  const result = projectDscrForVariant({
    facts: highCompFacts,
    formType: "FORM_1120",
    currentSlate: defaultSlate(), // standard everywhere
    override: null,
    proposedAds: 400_000,
  });
  assert.ok(result.projectedOfficerCompAddback > 0, "EXTREME_HIGH comp must produce a non-zero addback");
  assert.equal(
    result.projectedNcads,
    result.projectedEbitda,
    "Standard variant must NOT fold officer-comp into NCADS",
  );
});

test("[b4-1-3-v11] (SPEC-B4.1.4) aggressive ebitda_addback_stack DOES fold officer-comp into NCADS", () => {
  const highCompFacts = { ...baseFacts(), OFFICER_COMPENSATION: 500_000 };
  const result = projectDscrForVariant({
    facts: highCompFacts,
    formType: "FORM_1120",
    currentSlate: defaultSlate(),
    override: { axis: "ebitda_addback_stack", variant: "aggressive" },
    proposedAds: 400_000,
  });
  assert.ok(result.projectedOfficerCompAddback > 0, "EXTREME_HIGH comp must produce a non-zero addback");
  assert.equal(
    result.projectedNcads,
    result.projectedEbitda! + result.projectedOfficerCompAddback,
    "Aggressive variant must fold officer-comp into NCADS",
  );
});

// ── Guaranteed-payments double-count guard (Tier-3 methodology fix) ─────────
// For a FORM_1065 partnership, computeEbitda already adds back the FULL
// guaranteed payments. When OFFICER_COMPENSATION is absent, the officer-comp
// fold-in acts on those SAME dollars — applying it double-counts. The guard
// suppresses the fold-in in exactly that case, and only that case.

function partnershipGpFacts(officerComp: number | null): Record<string, number | null> {
  return {
    ORDINARY_BUSINESS_INCOME: 200_000,
    INTEREST_EXPENSE: 0,
    DEPRECIATION: 20_000,
    AMORTIZATION: 0,
    SECTION_179_EXPENSE: 0,
    BONUS_DEPRECIATION: 0,
    NON_RECURRING_EXPENSE: 0,
    NON_RECURRING_INCOME: 0,
    GUARANTEED_PAYMENTS: 60_000,
    COST_OF_GOODS_SOLD: 0,
    OFFICER_COMPENSATION: officerComp,
    GROSS_RECEIPTS: 100_000,
    NET_INCOME: 200_000,
  };
}

test("[gp-guard-1] 1065 with GP and no officer comp → fold-in subsumed, NCADS == EBITDA (no double count)", () => {
  const aggressive: MethodologySlate = { ...defaultSlate(), ebitda_addback_stack: "aggressive" };
  const r = projectDscrForVariant({
    facts: partnershipGpFacts(null),
    formType: "FORM_1065",
    currentSlate: aggressive,
    override: null,
    proposedAds: 100_000,
  });
  // The excess-of-GP fold-in is NOT added on top of the full-GP EBITDA add-back.
  assert.equal(r.projectedNcads, r.projectedEbitda);
  assert.match(r.components, /subsumed by guaranteed-payments/);
});

test("[gp-guard-2] 1065 with real officer comp distinct from GP → fold-in still applies", () => {
  const aggressive: MethodologySlate = { ...defaultSlate(), ebitda_addback_stack: "aggressive" };
  const r = projectDscrForVariant({
    facts: partnershipGpFacts(80_000),
    formType: "FORM_1065",
    currentSlate: aggressive,
    override: null,
    proposedAds: 100_000,
  });
  // Officer comp (80k) and guaranteed payments (60k) are different dollars —
  // the fold-in acts on the officer-comp excess, so NCADS exceeds EBITDA.
  assert.ok(r.projectedNcads! > r.projectedEbitda!);
});
