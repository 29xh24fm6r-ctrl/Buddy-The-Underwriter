import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveAdvanceRate, DEFAULT_ADVANCE_RATES, COLLATERAL_TYPES } =
  require("../collateralTypes") as typeof import("../collateralTypes");
const { computeCollateralFactValues } =
  require("../../underwritingSynthesis/computePure") as typeof import("../../underwritingSynthesis/computePure");

/**
 * deal_collateral_items in production holds exactly these three rows:
 *
 *   item_type            n   with an explicit advance_rate
 *   ucc_lien             2   1
 *   accounts_receivable  1   1
 *   real_estate          1   1
 *
 * The ucc_lien row without a rate is the one that was silently discounted at
 * 50% — the table had `blanket_lien`, the classifiers emit `ucc_lien`.
 */

test("a ucc_lien without an explicit rate is discounted as the blanket lien it is", () => {
  const resolved = resolveAdvanceRate({ item_type: "ucc_lien", advance_rate: null });

  assert.deepEqual(resolved, { status: "default", rate: 0.70, itemType: "ucc_lien" });
  assert.notEqual(
    (resolved as { rate: number }).rate,
    0.50,
    "0.50 was the silent fallback this module exists to remove",
  );
});

test("ucc_lien and blanket_lien are the same collateral and must not drift", () => {
  assert.equal(DEFAULT_ADVANCE_RATES.ucc_lien, DEFAULT_ADVANCE_RATES.blanket_lien);
});

test("every type the classifiers and the dropdown emit resolves to something explicit", () => {
  // The six values all three producers agree on.
  for (const type of ["real_estate", "equipment", "ucc_lien", "insurance_backed", "purchase_target", "general"]) {
    const resolved = resolveAdvanceRate({ item_type: type, advance_rate: null });
    assert.notEqual(
      resolved.status,
      "unknown_type",
      `${type} is emitted by a producer but is not a known collateral type`,
    );
  }
});

test("a type with no defensible default asks for a banker rate instead of guessing", () => {
  for (const type of ["insurance_backed", "purchase_target"]) {
    const resolved = resolveAdvanceRate({ item_type: type, advance_rate: null });
    assert.equal(resolved.status, "needs_banker_rate", `${type} must not be silently discounted`);
  }
});

test("an explicit banker rate always wins", () => {
  const resolved = resolveAdvanceRate({ item_type: "ucc_lien", advance_rate: 0.55 });
  assert.deepEqual(resolved, { status: "explicit", rate: 0.55 });
});

// ── Unit discipline: the rate is a fraction, never a percentage ───────
//
// Production held two rows storing `80` where every producer and consumer
// means `0.80`. Nothing rejected it: computeCollateralFactValues multiplied
// by it, so a $1.2M property reached the credit memo carrying $96,000,000 of
// lendable value, and LTV read as a hundredth of the truth.

test("a rate stored as a percentage is rejected, not multiplied by", () => {
  const resolved = resolveAdvanceRate({ item_type: "real_estate", advance_rate: 80 });
  assert.deepEqual(resolved, { status: "invalid_rate", itemType: "real_estate", rate: 80 });
});

test("a rate out of range is never repaired into a plausible one", () => {
  // 80 is recoverable by eye as 0.80. Guessing that is how a number nobody
  // entered reaches the memo, which is the failure this module removes.
  const resolved = resolveAdvanceRate({ item_type: "real_estate", advance_rate: 80 });
  assert.notEqual((resolved as { rate: number }).rate, 0.8);
  assert.equal(resolved.status, "invalid_rate");
});

test("the valid range is the closed interval [0, 1]", () => {
  for (const rate of [0, 0.5, 1]) {
    assert.equal(
      resolveAdvanceRate({ item_type: "real_estate", advance_rate: rate }).status,
      "explicit",
      `${rate} is a valid fraction of value`,
    );
  }
  for (const rate of [-0.1, 1.01, 80, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.notEqual(
      resolveAdvanceRate({ item_type: "real_estate", advance_rate: rate }).status,
      "explicit",
      `${rate} is not a fraction of value and must not be underwritten to`,
    );
  }
});

test("an unrecognised type is reported, never defaulted", () => {
  const resolved = resolveAdvanceRate({ item_type: "crypto_pledge", advance_rate: null });
  assert.deepEqual(resolved, { status: "unknown_type", itemType: "crypto_pledge" });
});

test("every declared type has a rate decision recorded", () => {
  for (const type of COLLATERAL_TYPES) {
    assert.ok(type in DEFAULT_ADVANCE_RATES, `${type} has no rate entry`);
  }
});

// ── The figure that reaches the credit memo ────────────────────────────

test("net collateral value uses the blanket-lien rate for a ucc_lien", () => {
  const { facts } = computeCollateralFactValues({
    collateral: [{ item_type: "ucc_lien", estimated_value: 1_000_000, advance_rate: null }],
    bankLoanTotal: 500_000,
  } as Parameters<typeof computeCollateralFactValues>[0]);

  assert.equal(facts.COLLATERAL_GROSS_VALUE, 1_000_000);
  assert.equal(facts.COLLATERAL_NET_VALUE, 700_000);
});

test("collateral with no defensible rate is excluded and the gap is recorded", () => {
  const { facts, missing } = computeCollateralFactValues({
    collateral: [
      { item_type: "real_estate", estimated_value: 1_000_000, advance_rate: null },
      { item_type: "purchase_target", estimated_value: 900_000, advance_rate: null },
    ],
    bankLoanTotal: 500_000,
  } as Parameters<typeof computeCollateralFactValues>[0]);

  // Gross still counts everything the borrower pledged.
  assert.equal(facts.COLLATERAL_GROSS_VALUE, 1_900_000);
  // Lendable value counts only what has a defensible advance rate.
  assert.equal(facts.COLLATERAL_NET_VALUE, 800_000);
  assert.ok(
    missing.some((m) => m.reason === "collateral_advance_rate_required:purchase_target"),
    "the missing rate must be recorded, not priced in",
  );
});

test("a percentage-unit rate contributes nothing and records the gap", () => {
  // The exact production row: real_estate, $1.2M, advance_rate stored as 80.
  const { facts, missing } = computeCollateralFactValues({
    collateral: [{ item_type: "real_estate", estimated_value: 1_200_000, advance_rate: 80 }],
    bankLoanTotal: 500_000,
  } as Parameters<typeof computeCollateralFactValues>[0]);

  assert.equal(facts.COLLATERAL_GROSS_VALUE, 1_200_000);
  assert.notEqual(facts.COLLATERAL_NET_VALUE, 96_000_000, "the memo must never carry 80x the collateral");
  assert.equal(facts.COLLATERAL_NET_VALUE, undefined);
  assert.ok(
    missing.some((m) => m.reason === "collateral_advance_rate_out_of_range:real_estate:80"),
    "the bad unit must be named in the gap, so the row can be found and fixed",
  );
});

test("LTV is not reported off a rate the system rejected", () => {
  const { facts } = computeCollateralFactValues({
    collateral: [{ item_type: "real_estate", estimated_value: 1_200_000, advance_rate: 80 }],
    bankLoanTotal: 960_000,
  } as Parameters<typeof computeCollateralFactValues>[0]);

  // 960k / 96M would read as 1% — spectacularly over-collateralised.
  assert.equal(facts.LTV_NET, undefined);
});
