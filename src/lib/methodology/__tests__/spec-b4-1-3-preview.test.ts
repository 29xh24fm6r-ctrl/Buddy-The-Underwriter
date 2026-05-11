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
