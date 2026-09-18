import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { computeItemLendableValue, getEffectiveAdvanceRate, computeCollateralLtv } =
  require("../collateralLtv") as typeof import("../collateralLtv");
const { computeCollateralFactValues } =
  require("../../underwritingSynthesis/computePure") as typeof import("../../underwritingSynthesis/computePure");

import type { CollateralItem } from "../builderTypes";

function item(over: Partial<CollateralItem>): CollateralItem {
  return {
    id: "i1",
    deal_id: "d1",
    item_type: "real_estate",
    lien_position: 1,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  } as CollateralItem;
}

/**
 * This module used to keep a second, private DEFAULT_ADVANCE_RATES — keyed on
 * the dead vocabulary the memo's copy carried before #1022: `blanket_lien`
 * where the classifiers emit `ucc_lien`, `other` where they emit `general`,
 * and no entry at all for `insurance_backed` or `purchase_target`, each
 * falling through a silent `?? 0.50`.
 *
 * So the advance rate a banker read in the builder was not the rate the credit
 * memo underwrote to, for four of the six types in daily use. Both now read
 * the one contract in src/lib/collateral/collateralTypes.ts.
 */

test("a ucc_lien is the blanket lien it is — 70%, not the retired 50% fallback", () => {
  assert.equal(getEffectiveAdvanceRate(item({ item_type: "ucc_lien" })), 0.7);
});

test("general collateral resolves — the table used to key this as `other`", () => {
  assert.equal(getEffectiveAdvanceRate(item({ item_type: "general" })), 0.5);
});

test("a type with no defensible default reports null rather than guessing", () => {
  for (const type of ["insurance_backed", "purchase_target"] as const) {
    assert.equal(
      getEffectiveAdvanceRate(item({ item_type: type })),
      null,
      `${type} has no defensible default and must not be invented one`,
    );
  }
});

test("an item with no defensible rate lends nothing", () => {
  const lendable = computeItemLendableValue(
    item({ item_type: "purchase_target", estimated_value: 900_000 }),
  );
  assert.equal(lendable, 0, "900k must not be admitted at a rate nobody chose");
});

test("a rate stored as a percentage lends nothing instead of eighty times the value", () => {
  const bad = item({ item_type: "real_estate", estimated_value: 1_200_000, advance_rate: 80 });

  assert.equal(getEffectiveAdvanceRate(bad), null);
  assert.equal(computeItemLendableValue(bad), 0);
  assert.notEqual(computeItemLendableValue(bad), 96_000_000);
});

test("an explicit in-range rate is used as given", () => {
  assert.equal(
    computeItemLendableValue(
      item({ item_type: "real_estate", estimated_value: 1_200_000, advance_rate: 0.8 }),
    ),
    960_000,
  );
});

test("LTV counts only lendable value, excluding what has no rate", () => {
  const summary = computeCollateralLtv(
    [
      item({ id: "a", item_type: "real_estate", estimated_value: 1_000_000 }),
      item({ id: "b", item_type: "purchase_target", estimated_value: 900_000 }),
    ],
    400_000,
  );

  assert.equal(summary.totalGrossValue, 1_900_000, "gross counts everything pledged");
  assert.equal(summary.totalLendableValue, 800_000, "lendable counts only what has a rate");
  assert.equal(summary.ltv, 0.5);
  assert.equal(summary.withinPolicy, true);
});

// ── The builder and the credit memo must agree ────────────────────────
//
// They disagreed for four of the six types in daily use, which is the whole
// reason this module no longer owns a rate table. Pin it.

test("the builder's lendable value equals the memo's net collateral value", () => {
  const items = [
    { item_type: "ucc_lien", estimated_value: 2_400_000, advance_rate: null },
    { item_type: "real_estate", estimated_value: 1_200_000, advance_rate: null },
    { item_type: "general", estimated_value: 500_000, advance_rate: null },
    { item_type: "insurance_backed", estimated_value: 750_000, advance_rate: null },
  ];

  const builderTotal = items.reduce(
    (sum, i) =>
      sum +
      computeItemLendableValue(
        item({ item_type: i.item_type as CollateralItem["item_type"], estimated_value: i.estimated_value }),
      ),
    0,
  );

  const { facts } = computeCollateralFactValues({
    collateral: items,
    bankLoanTotal: 1_000_000,
  } as Parameters<typeof computeCollateralFactValues>[0]);

  assert.equal(builderTotal, facts.COLLATERAL_NET_VALUE);
  // 2.4M×0.70 + 1.2M×0.80 + 500k×0.50 + insurance_backed excluded.
  assert.equal(builderTotal, 1_680_000 + 960_000 + 250_000);
});
